import {
  ConfigurableModel,
  initChatModel,
} from "langchain/chat_models/universal";
import { BedrockChat } from "@langchain/community/chat_models/bedrock";
import { ChatAnthropic } from "@langchain/anthropic";
import { GraphConfig } from "@openswe/shared/open-swe/types";
import { createLogger, LogLevel } from "../logger.js";
import {
  LLMTask,
  TASK_TO_CONFIG_DEFAULTS_MAP,
} from "@openswe/shared/open-swe/llm-task";
import { isAllowedUser } from "@openswe/shared/github/allowed-users";
import { decryptSecret } from "@openswe/shared/crypto";
import { API_KEY_REQUIRED_MESSAGE } from "@openswe/shared/constants";
import { getRedisStore, RedisStore } from "../redis-client.js";

const logger = createLogger(LogLevel.INFO, "ModelManager");

type InitChatModelArgs = Parameters<typeof initChatModel>[1];

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  openedAt?: number;
}

export interface ModelLoadConfig {
  provider: Provider;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  thinkingModel?: boolean;
  thinkingBudgetTokens?: number;
}

export enum CircuitState {
  /*
   * CLOSED: Normal operation
   */
  CLOSED = "CLOSED",
  /*
   * OPEN: Failing, use fallback
   */
  OPEN = "OPEN",
}

export const PROVIDER_FALLBACK_ORDER = [
  "openai",
  "anthropic",
  "google-genai",
  "bedrock",
] as const;
export type Provider = (typeof PROVIDER_FALLBACK_ORDER)[number];

export interface ModelManagerConfig {
  /*
   * Failures before opening circuit
   */
  circuitBreakerFailureThreshold: number;
  /*
   * Time to wait before trying again (ms)
   */
  circuitBreakerTimeoutMs: number;
  fallbackOrder: Provider[];
}

export const DEFAULT_MODEL_MANAGER_CONFIG: ModelManagerConfig = {
  circuitBreakerFailureThreshold: 2, // TBD, need to test
  circuitBreakerTimeoutMs: 180000, // 3 minutes timeout
  fallbackOrder: [...PROVIDER_FALLBACK_ORDER],
};

const MAX_RETRIES = 3;
const THINKING_BUDGET_TOKENS = 5000;

const providerToApiKey = (
  providerName: string,
  apiKeys: Record<string, string>,
): string => {
  switch (providerName) {
    case "openai":
      return apiKeys.openaiApiKey;
    case "anthropic":
      return apiKeys.anthropicApiKey;
    case "google-genai":
      return apiKeys.googleApiKey;
    case "bedrock":
      // Bedrock uses AWS credentials, not API keys
      return "";
    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
};

export class ModelManager {
  private config: ModelManagerConfig;
  private redisStore: RedisStore | null = null;
  private readonly CIRCUIT_BREAKER_PREFIX = "circuit_breaker:";

  constructor(config: Partial<ModelManagerConfig> = {}) {
    this.config = { ...DEFAULT_MODEL_MANAGER_CONFIG, ...config };

    logger.info("Initialized", {
      config: this.config,
      fallbackOrder: this.config.fallbackOrder,
    });
  }

  /**
   * Get Redis store instance (lazy initialization)
   * Returns null if Redis is unavailable
   */
  private async getRedisStore(): Promise<RedisStore | null> {
    if (!this.redisStore) {
      this.redisStore = await getRedisStore();
    }
    return this.redisStore;
  }

  /**
   * Get Redis key for circuit breaker
   */
  private getCircuitBreakerKey(modelKey: string): string {
    return `${this.CIRCUIT_BREAKER_PREFIX}${modelKey}`;
  }

  /**
   * Load a single model (no fallback during loading)
   */
  async loadModel(graphConfig: GraphConfig, task: LLMTask) {
    const baseConfig = this.getBaseConfigForTask(graphConfig, task);
    const fullModelName = `${baseConfig.provider}:${baseConfig.modelName}`;
    logger.info(`[${task.toUpperCase()}] Loading model: ${fullModelName}`);
    const model = await this.initializeModel(baseConfig, graphConfig);
    return model;
  }

  private getUserApiKey(
    graphConfig: GraphConfig,
    provider: Provider,
  ): string | null {
    const userLogin = (graphConfig.configurable as any)?.langgraph_auth_user
      ?.display_name;
    const secretsEncryptionKey = process.env.SECRETS_ENCRYPTION_KEY;

    if (!secretsEncryptionKey) {
      throw new Error(
        "SECRETS_ENCRYPTION_KEY environment variable is required",
      );
    }
    if (!userLogin) {
      throw new Error("User login not found in config");
    }

    // If the user is allowed, we can return early
    if (isAllowedUser(userLogin)) {
      return null;
    }

    // First, try to get API key from environment variables
    const envApiKeyMap: Record<Provider, string> = {
      "openai": process.env.OPENAI_API_KEY || "",
      "anthropic": process.env.ANTHROPIC_API_KEY || "",
      "google-genai": process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "",
      "bedrock": "", // Bedrock uses AWS credentials
    };

    const envApiKey = envApiKeyMap[provider];
    if (envApiKey && envApiKey.trim() !== "") {
      logger.debug(`Using API key from environment variable for ${provider}`);
      return envApiKey;
    }

    // Fallback to API keys from config (frontend settings)
    const apiKeys = graphConfig.configurable?.apiKeys;
    if (!apiKeys) {
      throw new Error(API_KEY_REQUIRED_MESSAGE);
    }

    const missingProviderKeyMessage = `No API key found for provider: ${provider}. Please add one in the settings page or set the environment variable (${provider === "openai" ? "OPENAI_API_KEY" : provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GOOGLE_API_KEY"}).`;

    const providerApiKey = providerToApiKey(provider, apiKeys);
    if (!providerApiKey) {
      throw new Error(missingProviderKeyMessage);
    }

    const apiKey = decryptSecret(providerApiKey, secretsEncryptionKey);
    if (!apiKey) {
      throw new Error(missingProviderKeyMessage);
    }

    return apiKey;
  }

  /**
   * Initialize the model instance
   */
  public async initializeModel(
    config: ModelLoadConfig,
    graphConfig: GraphConfig,
  ) {
    const {
      provider,
      modelName,
      temperature,
      maxTokens,
      thinkingModel,
      thinkingBudgetTokens,
    } = config;

    const thinkingMaxTokens = thinkingBudgetTokens
      ? thinkingBudgetTokens * 4
      : undefined;

    let finalMaxTokens = maxTokens ?? 10_000;
    if (modelName.includes("claude-3-5-haiku")) {
      finalMaxTokens = finalMaxTokens > 8_192 ? 8_192 : finalMaxTokens;
    }

    // HOTFIX: Correct invalid model ID if present
    let correctedModelName = modelName;
    if (modelName === "claude-sonnet-4-5-20251101") {
      correctedModelName = "claude-sonnet-4-5-20250929";
      logger.warn(`Correcting invalid model ID '${modelName}' to '${correctedModelName}'`);
    }

    const apiKey = this.getUserApiKey(graphConfig, provider);

    const modelOptions: InitChatModelArgs = {
      modelProvider: provider,
      max_retries: MAX_RETRIES,
      ...(apiKey ? { apiKey } : {}),
      ...(thinkingModel && provider === "anthropic"
        ? {
          thinking: { budget_tokens: thinkingBudgetTokens, type: "enabled" },
          maxTokens: thinkingMaxTokens,
            // Don't set temperature for thinking models - let Anthropic use defaults
        }
        : correctedModelName.includes("gpt-5")
          ? {
            max_completion_tokens: finalMaxTokens,
            temperature: 1,
          }
          : {
            maxTokens: finalMaxTokens,
              // [CRITICAL FIX] DO NOT SEND TEMPERATURE FOR ANTHROPIC MODELS
              // Sending temperature (even 0 or 1e-7) triggers issues with top_p defaults
              temperature: (provider === "anthropic") 
                ? undefined 
                : (temperature !== undefined && !thinkingModel ? temperature : undefined),
          }),
    };

    // [CRITICAL FIX] For Anthropic models, use top_p=0 and DELETE temperature.
    // The API rejects requests with both parameters. We prefer top_p=0 over temperature for deterministic-like behavior.
    if (provider === "anthropic") {
      (modelOptions as any).top_p = 0;
      // We can keep topP for consistency if needed, but top_p is standard
      delete (modelOptions as any).topP; 
      
      delete (modelOptions as any).temperature; 
      logger.info(`Set top_p=0 and removed temperature for ${provider}:${correctedModelName}`);
    } else {
        // For other models, only remove if it's -1
        if ((modelOptions as any).top_p === -1 || (modelOptions as any).topP === -1) {
          delete (modelOptions as any).top_p;
          delete (modelOptions as any).topP;
          logger.warn(`Removed top_p: -1 from model options for ${provider}:${correctedModelName}`);
        }
    }

    const fullModelName = `${provider}:${correctedModelName}`;
    logger.info(`Initializing model: ${fullModelName} (provider: ${provider}, task config)`);

    // [DEBUG] Log completo para inspeccionar el request antes de enviarlo
    console.log("----------------------------------------------------------------");
    console.log(`[DEBUG REQUEST] Configuración para ${fullModelName}:`);
    console.log(JSON.stringify(modelOptions, null, 2));
    console.log("----------------------------------------------------------------");

    let initializedModel;

    // Initialize Bedrock model
    if (provider === "bedrock") {
        const region = process.env.AWS_REGION || "us-east-1";
        const regionPrefix = region.startsWith("us") ? "us" : region.split("-")[0];
        // [BEDROCK FIX] Replace old Claude 4.5 models that require inference profiles
        // with Claude 3.5 models that support on-demand directly
        let finalModelName = correctedModelName;
        // Bedrock requires inference profiles for Claude models
        // Inference profiles use format: {region}.anthropic.{model-id}
        // For us-east-1, we use "us.anthropic.{model-id}"
        
        const bedrockModelMappings: Record<string, string> = {
          // Map to inference profiles with regional prefix
          "anthropic.claude-haiku-4-5-20251001-v1:0": `${regionPrefix}.anthropic.claude-3-5-haiku-20241022-v1:0`,
          "anthropic.claude-sonnet-4-5-20250929-v1:0": `${regionPrefix}.anthropic.claude-3-5-haiku-20241022-v1:0`,
          "anthropic.claude-opus-4-5-20251101-v1:0": `${regionPrefix}.anthropic.claude-3-5-haiku-20241022-v1:0`,
          "us.anthropic.claude-haiku-4-5-20251001-v1:0": `${regionPrefix}.anthropic.claude-3-5-haiku-20241022-v1:0`,
          "us.anthropic.claude-sonnet-4-5-20250929-v1:0": `${regionPrefix}.anthropic.claude-3-5-haiku-20241022-v1:0`,
          "us.anthropic.claude-opus-4-5-20251101-v1:0": `${regionPrefix}.anthropic.claude-3-5-haiku-20241022-v1:0`,
          // Also map Claude 3.5 models to inference profiles
          "anthropic.claude-3-5-haiku-20241022-v1:0": `${regionPrefix}.anthropic.claude-3-5-haiku-20241022-v1:0`,
          "anthropic.claude-3-5-sonnet-20240620-v1:0": `${regionPrefix}.anthropic.claude-3-5-haiku-20241022-v1:0`,
        };
        
        if (bedrockModelMappings[correctedModelName]) {
          logger.warn(`[BEDROCK] Replacing unsupported model ${correctedModelName} with ${bedrockModelMappings[correctedModelName]}`);
          finalModelName = bedrockModelMappings[correctedModelName];
        } else if (correctedModelName.startsWith("anthropic.claude") && !correctedModelName.match(/^(us|eu|ap)\.anthropic\./)) {
          // Convert Claude model to inference profile format (add regional prefix)
          logger.info(`[BEDROCK] Converting Claude model to inference profile: ${correctedModelName} -> ${regionPrefix}.${correctedModelName}`);
          finalModelName = `${regionPrefix}.${correctedModelName}`;
        }
        
        logger.info(`Using BedrockChat for ${finalModelName} (inference profile)`);
        // Remove duplicate region definition - already defined above
        // On EC2, if no explicit credentials are provided, AWS SDK will automatically
        // use the IAM Role attached to the EC2 instance (via instance metadata service)
        // This is more secure than using access keys
        const hasExplicitCredentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
        const credentials = hasExplicitCredentials ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        } : undefined;
        
        if (!hasExplicitCredentials) {
            logger.info(`No explicit AWS credentials found. Will use IAM Role if running on EC2, or default AWS credential chain.`);
        }
        
        // Check for Bearer Token authentication (alternative to IAM Role)
        const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;
        
        const bedrockConfig: any = {
            model: finalModelName,
            region: region,
            maxTokens: (modelOptions as any).maxTokens,
            temperature: (modelOptions as any).temperature,
        };
        
        if (bearerToken) {
            // Use bearer token authentication with custom fetch function
            logger.info(`Using Bearer Token authentication for Bedrock`);
            // Create custom fetch function that adds bearer token to requests
            bedrockConfig.customFetchFunction = async (url: string, init?: RequestInit): Promise<Response> => {
                const headers = new Headers(init?.headers);
                headers.set('Authorization', `Bearer ${bearerToken}`);
                // Remove AWS signature headers if present
                headers.delete('X-Amz-Security-Token');
                headers.delete('X-Amz-Date');
                headers.delete('X-Amz-Signature');
                
                return fetch(url, {
                    ...init,
                    headers: headers,
                });
            };
            // Don't use IAM credentials with bearer token
            bedrockConfig.credentials = undefined;
        } else if (credentials) {
            bedrockConfig.credentials = credentials;
        }
        // If neither bearer token nor explicit credentials, BedrockChat will use IAM Role automatically
        
        initializedModel = new BedrockChat(bedrockConfig);
    } else if (provider === "anthropic") {
        // [CRITICAL FIX] Use ChatAnthropic directly to avoid initChatModel default logic
        // which incorrectly sets top_p: -1 for temperature: 0
        logger.info(`Using ChatAnthropic direct instantiation for ${correctedModelName}`);
        initializedModel = new ChatAnthropic({
            modelName: correctedModelName,
            apiKey: apiKey || undefined,
            maxTokens: (modelOptions as any).maxTokens,
            // temperature: undefined, // DO NOT SEND TEMPERATURE
            topP: 0, // Force topP to 0
            // Add thinking param if needed
            ...((modelOptions as any).thinking ? { thinking: (modelOptions as any).thinking } : {})
        });
        
        // [CRITICAL HACK] Force delete temperature from the instance to prevent LangChain default (1.0) from being sent
        if ((initializedModel as any).temperature !== undefined) {
             delete (initializedModel as any).temperature;
             logger.info(`Forcefully deleted 'temperature' property from ChatAnthropic instance for ${correctedModelName}`);
        }
    } else {
        initializedModel = await initChatModel(correctedModelName, modelOptions);
    }
    
    const initializedConfig = (initializedModel as any)?._defaultConfig;
    if (initializedConfig && (initializedConfig.top_p === -1 || initializedConfig.topP === -1)) {
      logger.warn(`Model ${fullModelName} has top_p: -1 in defaultConfig after initialization. Setting to 0.`);
      initializedConfig.top_p = 0;
      if (initializedConfig.topP !== undefined) {
        initializedConfig.topP = 0;
      }
    }
    
    return initializedModel;
  }

  public getModelConfigs(
    config: GraphConfig,
    task: LLMTask,
    selectedModel: ConfigurableModel,
  ) {
    const configs: ModelLoadConfig[] = [];
    const baseConfig = this.getBaseConfigForTask(config, task);

    // Always add the base configuration as the primary model
    // This represents what is configured in GraphConfig or env vars
    configs.push(baseConfig);
    
    // [RETRY LOGIC] Add the SAME model as fallback for retries.
    // This allows FallbackRunnable to retry execution with the exact same model configuration
    // in case of transient errors (timeouts, server errors) without switching providers.
    // We add it 2 more times for a total of 3 attempts.
    configs.push(baseConfig);
    configs.push(baseConfig);

    /*
    // Add fallback models
    // If a provider is selected, only use fallbacks from that provider
    // Otherwise, use the default fallback order
    const selectedProvider = (config.configurable as any)?.modelProvider as Provider | undefined;
    const fallbackProviders = selectedProvider 
      ? [selectedProvider] 
      : this.config.fallbackOrder;
    // ... (rest of commented fallback logic) ...
    */

    return configs;
  }

  /**
   * Get the model name for a task from GraphConfig
   * Returns full model identifier with provider (e.g., "anthropic:claude-opus-4-5")
   */
  public getModelNameForTask(config: GraphConfig, task: LLMTask): string {
    // Priority order:
    // 1. Explicit config from GraphConfig (user selected in UI)
    // 2. Environment variable (DEFAULT_{TASK}_MODEL)
    // 3. Hardcoded default from TASK_TO_CONFIG_DEFAULTS_MAP
    const defaultModelName = this.getDefaultModelForTask(task);
    const modelName = config.configurable?.[`${task}ModelName`] ?? defaultModelName;
    return modelName;
  }

  /**
   * Get default model name for a task from environment variable or use hardcoded default
   * Pattern: DEFAULT_{TASK}_MODEL
   * Example: DEFAULT_PLANNER_MODEL=anthropic:claude-sonnet-4-5-20250929
   */
  private getDefaultModelForTask(task: LLMTask): string {
    const envKey = `DEFAULT_${task.toUpperCase()}_MODEL`;
    const envValue = process.env[envKey];

    if (envValue) {
      logger.info(`[${task.toUpperCase()}] Using model from env var ${envKey}: ${envValue}`);
      return envValue;
    }

    // Fallback to hardcoded default
    const hardcodedModel = TASK_TO_CONFIG_DEFAULTS_MAP[task].modelName;
    logger.info(`[${task.toUpperCase()}] Using hardcoded default model: ${hardcodedModel}`);
    return hardcodedModel;
  }

  /**
   * Get base configuration for a task from GraphConfig
   */
  private getBaseConfigForTask(
    config: GraphConfig,
    task: LLMTask,
  ): ModelLoadConfig {
    // Priority order:
    // 1. Explicit config from GraphConfig (user selected in UI)
    // 2. If modelProvider is set, use models from that provider
    // 3. Environment variable (DEFAULT_{TASK}_MODEL)
    // 4. Hardcoded default from TASK_TO_CONFIG_DEFAULTS_MAP
    
    // Check if a provider is selected
    const selectedProvider = (config.configurable as any)?.modelProvider as Provider | undefined;
    let defaultModelName = this.getDefaultModelForTask(task);
    
    // If provider is set and no explicit model is configured for this task, use provider's default
    if (selectedProvider && !config.configurable?.[`${task}ModelName`]) {
      const providerModel = this.getDefaultModelForProvider(selectedProvider, task);
      if (providerModel) {
        defaultModelName = `${providerModel.provider}:${providerModel.modelName}`;
        logger.info(`[${task.toUpperCase()}] Using model from selected provider '${selectedProvider}': ${defaultModelName}`);
      }
    }

    const taskMap = {
      [LLMTask.PLANNER]: {
        modelName:
          config.configurable?.[`${task}ModelName`] ?? defaultModelName,
        temperature: config.configurable?.[`${task}Temperature`] ?? 0,
      },
      [LLMTask.PROGRAMMER]: {
        modelName:
          config.configurable?.[`${task}ModelName`] ?? defaultModelName,
        temperature: config.configurable?.[`${task}Temperature`] ?? 0,
      },
      [LLMTask.REVIEWER]: {
        modelName:
          config.configurable?.[`${task}ModelName`] ?? defaultModelName,
        temperature: config.configurable?.[`${task}Temperature`] ?? 0,
      },
      [LLMTask.ROUTER]: {
        modelName:
          config.configurable?.[`${task}ModelName`] ?? defaultModelName,
        temperature: config.configurable?.[`${task}Temperature`] ?? 0,
      },
      [LLMTask.SUMMARIZER]: {
        modelName:
          config.configurable?.[`${task}ModelName`] ?? defaultModelName,
        temperature: config.configurable?.[`${task}Temperature`] ?? 0,
      },
    };

    const taskConfig = taskMap[task];
    let modelStr = taskConfig.modelName;
    
    // [BEDROCK FIX] Replace old Claude 4.5 models that require inference profiles
    // with Claude 3.5 models that support on-demand directly
    if (modelStr.includes("bedrock:")) {
      const oldToNewMappings: Record<string, string> = {
        "bedrock:anthropic.claude-haiku-4-5-20251001-v1:0": "bedrock:anthropic.claude-3-5-haiku-20241022-v1:0",
        "bedrock:anthropic.claude-sonnet-4-5-20250929-v1:0": "bedrock:anthropic.claude-3-5-haiku-20241022-v1:0",
        "bedrock:anthropic.claude-opus-4-5-20251101-v1:0": "bedrock:anthropic.claude-3-5-haiku-20241022-v1:0",
        "bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0": "bedrock:anthropic.claude-3-5-haiku-20241022-v1:0",
        "bedrock:us.anthropic.claude-sonnet-4-5-20250929-v1:0": "bedrock:anthropic.claude-3-5-haiku-20241022-v1:0",
        "bedrock:us.anthropic.claude-opus-4-5-20251101-v1:0": "bedrock:anthropic.claude-3-5-haiku-20241022-v1:0",
      };
      
      if (oldToNewMappings[modelStr]) {
        logger.warn(`[${task.toUpperCase()}] Replacing unsupported Bedrock model ${modelStr} with ${oldToNewMappings[modelStr]}`);
        modelStr = oldToNewMappings[modelStr];
      }
    }
    
    const [modelProvider, ...modelNameParts] = modelStr.split(":");

    let thinkingModel = false;
    if (modelNameParts[0] === "extended-thinking") {
      thinkingModel = true;
      modelNameParts.shift();
    }

    const modelName = modelNameParts.join(":");
    if (modelProvider === "openai" && modelName.startsWith("o")) {
      thinkingModel = true;
    }

    const thinkingBudgetTokens = THINKING_BUDGET_TOKENS;

    return {
      modelName,
      provider: modelProvider as Provider,
      ...(modelName.includes("gpt-5")
        ? {
          max_completion_tokens: config.configurable?.maxTokens ?? 10_000,
          temperature: 1,
        }
        : {
          maxTokens: config.configurable?.maxTokens ?? 10_000,
          temperature: taskConfig.temperature,
        }),
      thinkingModel,
      thinkingBudgetTokens,
    };
  }

  /**
   * Get model name from environment variable or fallback to default
   * Pattern: FALLBACK_{PROVIDER}_{TASK}_MODEL
   * Example: FALLBACK_ANTHROPIC_PLANNER_MODEL=claude-sonnet-4-5-20250929
   */
  private getModelFromEnv(
    provider: Provider,
    task: LLMTask,
    defaultValue: string,
  ): string {
    // Map provider names to env var format
    const providerMap: Record<Provider, string> = {
      "anthropic": "ANTHROPIC",
      "openai": "OPENAI",
      "google-genai": "GOOGLE_GENAI",
    };

    const providerEnv = providerMap[provider] || provider.toUpperCase().replace("-", "_");
    const envKey = `FALLBACK_${providerEnv}_${task.toUpperCase()}_MODEL`;
    const envValue = process.env[envKey];

    if (envValue) {
      logger.info(`[FALLBACK ${provider.toUpperCase()}] Using fallback model from env var ${envKey}: ${envValue}`);
      return envValue;
    }

    logger.info(`[FALLBACK ${provider.toUpperCase()}] Using hardcoded fallback model: ${defaultValue}`);
    return defaultValue;
  }

  /**
   * Get default model for a provider and task
   * Models can be configured via environment variables or use hardcoded defaults
   */
  private getDefaultModelForProvider(
    provider: Provider,
    task: LLMTask,
  ): ModelLoadConfig | null {
    // Hardcoded defaults (used only if env vars are not set)
    const hardcodedDefaults: Record<Provider, Record<LLMTask, string>> = {
      anthropic: {
        // Planner: modelo fuerte (Opus 4.5 o Sonnet 4.5)
        [LLMTask.PLANNER]: "claude-sonnet-4-5-20250929",
      
        // Programmer: equilibrio coste/rendimiento
        [LLMTask.PROGRAMMER]: "claude-sonnet-4-5-20250929",
      
        // Reviewer: mismo que Programmer, suficiente para revisión
        [LLMTask.REVIEWER]: "claude-sonnet-4-5-20250929",
      
        // Router: algo rápido y barato (Haiku 3.5 o Haiku 4.5)
        [LLMTask.ROUTER]: "claude-3-5-haiku-20241022",
      
        // Summarizer: Sonnet está bien para resúmenes de calidad
        [LLMTask.SUMMARIZER]: "claude-sonnet-4-5-20250929",
      }
      ,
      "google-genai": {
        [LLMTask.PLANNER]: "gemini-2.5-pro",
        [LLMTask.PROGRAMMER]: "gemini-2.5-pro",
        [LLMTask.REVIEWER]: "gemini-2.5-flash",
        [LLMTask.ROUTER]: "gemini-2.5-flash",
        [LLMTask.SUMMARIZER]: "gemini-2.5-pro",
      },
      bedrock: {
        [LLMTask.PLANNER]: "anthropic.claude-3-5-haiku-20241022-v1:0",
        [LLMTask.PROGRAMMER]: "anthropic.claude-3-5-haiku-20241022-v1:0",
        [LLMTask.REVIEWER]: "anthropic.claude-3-5-haiku-20241022-v1:0",
        [LLMTask.ROUTER]: "anthropic.claude-3-5-haiku-20241022-v1:0",
        [LLMTask.SUMMARIZER]: "anthropic.claude-3-5-haiku-20241022-v1:0",
      },
      openai: {
        [LLMTask.PLANNER]: "gpt-5-codex",
        [LLMTask.PROGRAMMER]: "gpt-5-codex",
        [LLMTask.REVIEWER]: "gpt-5-codex",
        [LLMTask.ROUTER]: "gpt-5-nano",
        [LLMTask.SUMMARIZER]: "gpt-5-mini",
      },
    };

    // Get hardcoded default value
    const hardcodedValue = hardcodedDefaults[provider]?.[task];
    if (!hardcodedValue) {
      return null;
    }

    // Try to get model from environment variable first, fallback to hardcoded value
    const modelName = this.getModelFromEnv(provider, task, hardcodedValue);
    return { provider, modelName };
  }

  /**
   * Get all available models from all providers
   * Used for user selection when fallbacks fail
   */
  public getAllAvailableModels(task: LLMTask, currentProvider?: Provider): ModelLoadConfig[] {
    const models: ModelLoadConfig[] = [];
    const providers: Provider[] = ["anthropic", "openai", "google-genai"];
    
    for (const provider of providers) {
      // Get default model for this provider/task
      const defaultModel = this.getDefaultModelForProvider(provider, task);
      if (defaultModel) {
        // Add basic config
        models.push(defaultModel);
      }
    }
    
    return models;
  }

  /**
   * Circuit breaker methods
   */
  public async isCircuitClosed(modelKey: string): Promise<boolean> {
    const state = await this.getCircuitState(modelKey);

    if (state.state === CircuitState.CLOSED) {
      return true;
    }

    if (state.state === CircuitState.OPEN && state.openedAt) {
      const timeElapsed = Date.now() - state.openedAt;
      if (timeElapsed >= this.config.circuitBreakerTimeoutMs) {
        state.state = CircuitState.CLOSED;
        state.failureCount = 0;
        delete state.openedAt;
        await this.saveCircuitState(modelKey, state);

        logger.info(
          `${modelKey}: Circuit breaker automatically recovered: OPEN → CLOSED`,
          {
            timeElapsed: (timeElapsed / 1000).toFixed(1) + "s",
          },
        );
        return true;
      }
    }

    return false;
  }

  private async getCircuitState(modelKey: string): Promise<CircuitBreakerState> {
    const redisStore = await this.getRedisStore();
    const key = this.getCircuitBreakerKey(modelKey);
    
    if (redisStore) {
    const state = await redisStore.getJSON<CircuitBreakerState>(key);
    if (state) {
      return state;
      }
    }

    // Default state (Redis unavailable or no state found)
    const defaultState: CircuitBreakerState = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      lastFailureTime: 0,
    };
    // Try to save, but don't fail if Redis is unavailable
    if (redisStore) {
    await this.saveCircuitState(modelKey, defaultState);
    }
    return defaultState;
  }

  private async saveCircuitState(
    modelKey: string,
    state: CircuitBreakerState,
  ): Promise<void> {
    const redisStore = await this.getRedisStore();
    if (!redisStore) {
      return; // Redis unavailable, skip silently
    }
    const key = this.getCircuitBreakerKey(modelKey);
    // Store with expiration of 24 hours (circuit breaker state should persist)
    await redisStore.setJSON(key, state, 86400);
  }

  public async recordSuccess(modelKey: string): Promise<void> {
    const circuitState = await this.getCircuitState(modelKey);

    circuitState.state = CircuitState.CLOSED;
    circuitState.failureCount = 0;
    delete circuitState.openedAt;

    await this.saveCircuitState(modelKey, circuitState);
    logger.debug(`${modelKey}: Circuit breaker reset after successful request`);
  }

  public async recordFailure(modelKey: string): Promise<void> {
    const circuitState = await this.getCircuitState(modelKey);
    const now = Date.now();

    circuitState.lastFailureTime = now;
    circuitState.failureCount++;

    if (
      circuitState.failureCount >= this.config.circuitBreakerFailureThreshold
    ) {
      circuitState.state = CircuitState.OPEN;
      circuitState.openedAt = now;

      logger.warn(
        `${modelKey}: Circuit breaker opened after ${circuitState.failureCount} failures`,
        {
          timeoutMs: this.config.circuitBreakerTimeoutMs,
          willRetryAt: new Date(
            now + this.config.circuitBreakerTimeoutMs,
          ).toISOString(),
        },
      );
    }

    await this.saveCircuitState(modelKey, circuitState);
  }

  /**
   * Monitoring and observability methods
   */
  public async getCircuitBreakerStatus(): Promise<Map<string, CircuitBreakerState>> {
    const redisStore = await this.getRedisStore();
    const statusMap = new Map<string, CircuitBreakerState>();
    
    if (!redisStore) {
      return statusMap; // Redis unavailable, return empty map
    }
    
    const keys = await redisStore.keys(`${this.CIRCUIT_BREAKER_PREFIX}*`);

    for (const key of keys) {
      const modelKey = key.replace(this.CIRCUIT_BREAKER_PREFIX, "");
      const state = await redisStore.getJSON<CircuitBreakerState>(key);
      if (state) {
        statusMap.set(modelKey, state);
      }
    }

    return statusMap;
  }

  /**
   * Cleanup on shutdown
   */
  public async shutdown(): Promise<void> {
    // Note: We don't clear circuit breaker state on shutdown as it should persist
    // If you want to clear it, uncomment the following:
    // const redisStore = await this.getRedisStore();
    // await redisStore.deletePattern(`${this.CIRCUIT_BREAKER_PREFIX}*`);
    logger.info("Shutdown complete");
  }
}

let globalModelManager: ModelManager | null = null;

export function getModelManager(
  config?: Partial<ModelManagerConfig>,
): ModelManager {
  if (!globalModelManager) {
    globalModelManager = new ModelManager(config);
  }
  return globalModelManager;
}

export async function resetModelManager(): Promise<void> {
  if (globalModelManager) {
    await globalModelManager.shutdown();
    globalModelManager = null;
  }
}
