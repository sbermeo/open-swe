import {
  ConfigurableModel,
  initChatModel,
} from "langchain/chat_models/universal";
import { GraphConfig } from "@openswe/shared/open-swe/types";
import { createLogger, LogLevel } from "../logger.js";
import {
  LLMTask,
  TASK_TO_CONFIG_DEFAULTS_MAP,
} from "@openswe/shared/open-swe/llm-task";
import { isAllowedUser } from "@openswe/shared/github/allowed-users";
import { decryptSecret } from "@openswe/shared/crypto";
import { API_KEY_REQUIRED_MESSAGE } from "@openswe/shared/constants";

const logger = createLogger(LogLevel.INFO, "ModelManager");

type InitChatModelArgs = Parameters<typeof initChatModel>[1];

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  openedAt?: number;
}

interface ModelLoadConfig {
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
    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
};

export class ModelManager {
  private config: ModelManagerConfig;
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();

  constructor(config: Partial<ModelManagerConfig> = {}) {
    this.config = { ...DEFAULT_MODEL_MANAGER_CONFIG, ...config };

    logger.info("Initialized", {
      config: this.config,
      fallbackOrder: this.config.fallbackOrder,
    });
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

    const apiKey = this.getUserApiKey(graphConfig, provider);

    const modelOptions: InitChatModelArgs = {
      modelProvider: provider,
      max_retries: MAX_RETRIES,
      ...(apiKey ? { apiKey } : {}),
      ...(thinkingModel && provider === "anthropic"
        ? {
          thinking: { budget_tokens: thinkingBudgetTokens, type: "enabled" },
          maxTokens: thinkingMaxTokens,
        }
        : modelName.includes("gpt-5")
          ? {
            max_completion_tokens: finalMaxTokens,
            temperature: 1,
          }
          : {
            maxTokens: finalMaxTokens,
            temperature: thinkingModel ? undefined : temperature,
          }),
    };

    const fullModelName = `${provider}:${modelName}`;
    logger.info(`Initializing model: ${fullModelName} (provider: ${provider}, task config)`);

    return await initChatModel(modelName, modelOptions);
  }

  public getModelConfigs(
    config: GraphConfig,
    task: LLMTask,
    selectedModel: ConfigurableModel,
  ) {
    const configs: ModelLoadConfig[] = [];
    const baseConfig = this.getBaseConfigForTask(config, task);

    // Check if a provider is selected - if so, only use that provider's models
    const selectedProvider = (config.configurable as any)?.modelProvider as Provider | undefined;

    const defaultConfig = selectedModel._defaultConfig;
    let selectedModelConfig: ModelLoadConfig | null = null;

    if (defaultConfig) {
      const provider = defaultConfig.modelProvider as Provider;
      const modelName = defaultConfig.model;

      if (provider && modelName) {
        const isThinkingModel = baseConfig.thinkingModel;
        selectedModelConfig = {
          provider,
          modelName,
          ...(modelName.includes("gpt-5")
            ? {
              max_completion_tokens:
                defaultConfig.maxTokens ?? baseConfig.maxTokens,
              temperature: 1,
            }
            : {
              maxTokens: defaultConfig.maxTokens ?? baseConfig.maxTokens,
              temperature:
                defaultConfig.temperature ?? baseConfig.temperature,
            }),
          ...(isThinkingModel
            ? {
              thinkingModel: true,
              thinkingBudgetTokens: THINKING_BUDGET_TOKENS,
            }
            : {}),
        };
        configs.push(selectedModelConfig);
      }
    }

    // Add fallback models
    // If a provider is selected, only use fallbacks from that provider
    // Otherwise, use the default fallback order
    const fallbackProviders = selectedProvider 
      ? [selectedProvider] 
      : this.config.fallbackOrder;

    for (const provider of fallbackProviders) {
      const fallbackModel = this.getDefaultModelForProvider(provider, task);
      if (
        fallbackModel &&
        (!selectedModelConfig ||
          fallbackModel.modelName !== selectedModelConfig.modelName ||
          fallbackModel.provider !== selectedModelConfig.provider)
      ) {
        // Check if fallback model is a thinking model
        const isThinkingModel =
          (provider === "openai" && fallbackModel.modelName.startsWith("o")) ||
          fallbackModel.modelName.includes("extended-thinking");

        const fallbackConfig = {
          ...fallbackModel,
          ...(fallbackModel.modelName.includes("gpt-5")
            ? {
              max_completion_tokens: baseConfig.maxTokens,
              temperature: 1,
            }
            : {
              maxTokens: baseConfig.maxTokens,
              temperature: isThinkingModel
                ? undefined
                : baseConfig.temperature,
            }),
          ...(isThinkingModel
            ? {
              thinkingModel: true,
              thinkingBudgetTokens: THINKING_BUDGET_TOKENS,
            }
            : {}),
        };
        configs.push(fallbackConfig);
      }
    }

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
   * Example: DEFAULT_PLANNER_MODEL=anthropic:claude-opus-4-5
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
    const modelStr = taskConfig.modelName;
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
   * Example: FALLBACK_ANTHROPIC_PLANNER_MODEL=claude-opus-4-5
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
        [LLMTask.PLANNER]: "claude-sonnet-4-0",
        [LLMTask.PROGRAMMER]: "claude-sonnet-4-0",
        [LLMTask.REVIEWER]: "claude-sonnet-4-0",
        [LLMTask.ROUTER]: "claude-3-5-haiku-latest",
        [LLMTask.SUMMARIZER]: "claude-sonnet-4-0",
      },
      "google-genai": {
        [LLMTask.PLANNER]: "gemini-2.5-pro",
        [LLMTask.PROGRAMMER]: "gemini-2.5-pro",
        [LLMTask.REVIEWER]: "gemini-2.5-flash",
        [LLMTask.ROUTER]: "gemini-2.5-flash",
        [LLMTask.SUMMARIZER]: "gemini-2.5-pro",
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
   * Circuit breaker methods
   */
  public isCircuitClosed(modelKey: string): boolean {
    const state = this.getCircuitState(modelKey);

    if (state.state === CircuitState.CLOSED) {
      return true;
    }

    if (state.state === CircuitState.OPEN && state.openedAt) {
      const timeElapsed = Date.now() - state.openedAt;
      if (timeElapsed >= this.config.circuitBreakerTimeoutMs) {
        state.state = CircuitState.CLOSED;
        state.failureCount = 0;
        delete state.openedAt;

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

  private getCircuitState(modelKey: string): CircuitBreakerState {
    if (!this.circuitBreakers.has(modelKey)) {
      this.circuitBreakers.set(modelKey, {
        state: CircuitState.CLOSED,
        failureCount: 0,
        lastFailureTime: 0,
      });
    }
    return this.circuitBreakers.get(modelKey)!;
  }

  public recordSuccess(modelKey: string): void {
    const circuitState = this.getCircuitState(modelKey);

    circuitState.state = CircuitState.CLOSED;
    circuitState.failureCount = 0;
    delete circuitState.openedAt;

    logger.debug(`${modelKey}: Circuit breaker reset after successful request`);
  }

  public recordFailure(modelKey: string): void {
    const circuitState = this.getCircuitState(modelKey);
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
  }

  /**
   * Monitoring and observability methods
   */
  public getCircuitBreakerStatus(): Map<string, CircuitBreakerState> {
    return new Map(this.circuitBreakers);
  }


  /**
   * Cleanup on shutdown
   */
  public shutdown(): void {
    this.circuitBreakers.clear();
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

export function resetModelManager(): void {
  if (globalModelManager) {
    globalModelManager.shutdown();
    globalModelManager = null;
  }
}
