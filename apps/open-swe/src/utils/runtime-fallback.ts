import * as fs from 'fs/promises';
import { GraphConfig } from "@openswe/shared/open-swe/types";
import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import { ModelManager, Provider, ModelLoadConfig } from "./llms/model-manager.js";
import { createLogger, LogLevel } from "./logger.js";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";
import { StructuredToolInterface } from "@langchain/core/tools";
import {
  ConfigurableChatModelCallOptions,
  ConfigurableModel,
} from "langchain/chat_models/universal";
import {
  AIMessageChunk,
  BaseMessage,
  BaseMessageLike,
  isAIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ChatResult, ChatGeneration } from "@langchain/core/outputs";
import { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { BindToolsInput } from "@langchain/core/language_models/chat_models";
import { getMessageContentString } from "@openswe/shared/messages";
import { getConfig } from "@langchain/langgraph";
import { MODELS_NO_PARALLEL_TOOL_CALLING } from "./llms/load-model.js";
import { ModelFallbackInterruptError } from "./model-fallback-error.js";

const logger = createLogger(LogLevel.DEBUG, "ModelRunner");

interface ExtractedTools {
  tools: BindToolsInput[];
  kwargs: Record<string, any>;
}

function useProviderMessages(
  initialInput: BaseLanguageModelInput,
  providerMessages?: Record<Provider, BaseMessageLike[]>,
  provider?: Provider,
): BaseLanguageModelInput {
  if (!provider || !providerMessages?.[provider]) {
    return initialInput;
  }
  return providerMessages[provider];
}

// Helper to check if message is AI message (robust to serialization)
function isAIMessageLike(message: any): boolean {
  if (!message) return false;
  
  // Prioritize safe property checks for plain objects
  if (message.role === 'assistant' || message.type === 'ai') return true;
  if (message.constructor && message.constructor.name === 'AIMessage') return true;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;

  // Only use LangChain helper if object has the required method
  // isAIMessage internally calls _getType(), which crashes on plain objects
  if (typeof message._getType === 'function') {
      try {
          return isAIMessage(message);
      } catch (e) {
          return false;
      }
  }
  
  return false;
}

// Helper to check if message is Tool message (robust to serialization)
function isToolMessageLike(message: any): boolean {
  if (!message) return false;
  if (message instanceof ToolMessage) return true;
  return message.role === 'tool' || message.type === 'tool';
}

// Helper to sanitize message history and fix dangling tool calls
function sanitizeHistory(input: BaseLanguageModelInput): BaseLanguageModelInput {
  if (!Array.isArray(input)) {
    return input;
  }

  const sanitizedMessages: BaseMessageLike[] = [];
  const messages = input as any[]; // Treat as any to handle mixed types

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    sanitizedMessages.push(message);

    // Robust check for AI message with tool calls
    if (isAIMessageLike(message) && message.tool_calls && message.tool_calls.length > 0) {
      // Check if the next message is a corresponding tool result
      const nextMessage = messages[i + 1];
      
      const missingNextMessage = !nextMessage;
      const nextMessageIsNotTool = nextMessage && !isToolMessageLike(nextMessage);
      
      if (missingNextMessage || nextMessageIsNotTool) {
         // Create dummy tool results for ALL tool calls in this message
         message.tool_calls.forEach((toolCall: any) => {
             // Avoid duplicating if next message IS a tool message but for a different tool call (very rare edge case)
             // But for safety, if the next message is NOT a tool message, we definitely need to inject.
             
             logger.warn(`Injecting dummy tool result for dangling tool call: ${toolCall.name} (${toolCall.id}). Next message exists: ${!!nextMessage}, Is Tool: ${nextMessage ? isToolMessageLike(nextMessage) : 'N/A'}`);
             
             sanitizedMessages.push(new ToolMessage({
                 tool_call_id: toolCall.id!,
                 content: "Error: Tool execution interrupted or result missing. Please retry.",
                 name: toolCall.name
             }));
         });
      } else {
        // Next message IS a tool message. 
        // We should verify if ALL tool calls in the AI message are covered.
        // Anthropic requires strict ordering and completeness.
        // If there are multiple tool calls, there must be multiple tool messages following.
        
        // This is complex to check perfectly in a linear pass without lookahead, 
        // but let's at least check the first one or ensure we don't have "orphan" calls.
        // For now, the primary failure mode is a complete missing block, which the above 'if' handles.
      }
    }
  }
  return sanitizedMessages;
}

export class FallbackRunnable<
  RunInput extends BaseLanguageModelInput = BaseLanguageModelInput,
  CallOptions extends
    ConfigurableChatModelCallOptions = ConfigurableChatModelCallOptions,
> extends ConfigurableModel<RunInput, CallOptions> {
  private primaryRunnable: any;
  private config: GraphConfig;
  private task: LLMTask;
  private modelManager: ModelManager;
  private providerTools?: Record<Provider, BindToolsInput[]>;
  private providerMessages?: Record<Provider, BaseMessageLike[]>;

  constructor(
    primaryRunnable: any,
    config: GraphConfig,
    task: LLMTask,
    modelManager: ModelManager,
    options?: {
      providerTools?: Record<Provider, BindToolsInput[]>;
      providerMessages?: Record<Provider, BaseMessageLike[]>;
    },
  ) {
    super({
      configurableFields: "any",
      configPrefix: "fallback",
      queuedMethodOperations: {},
      disableStreaming: false,
    });
    this.primaryRunnable = primaryRunnable;
    this.config = config;
    this.task = task;
    this.modelManager = modelManager;
    this.providerTools = options?.providerTools;
    this.providerMessages = options?.providerMessages;
  }

  async _generate(
    messages: BaseMessage[],
    options?: Record<string, any>,
  ): Promise<ChatResult> {
    const result = await this.invoke(messages, options);
    const generation: ChatGeneration = {
      message: result,
      text: result?.content ? getMessageContentString(result.content) : "",
    };
    return {
      generations: [generation],
      llmOutput: {},
    };
  }

  async invoke(
    input: BaseLanguageModelInput,
    options?: Record<string, any>,
  ): Promise<AIMessageChunk> {
    // Sanitize input history to fix dangling tool calls
    const sanitizedInput = sanitizeHistory(input);

    // Check if primaryRunnable has top_p: -1 in its config
    const primaryModel = this.getPrimaryModel();
    const primaryConfig = (primaryModel as any)?._defaultConfig;
    if (primaryConfig) {
      logger.debug(`Primary model config:`, {
        top_p: primaryConfig.top_p,
        topP: primaryConfig.topP,
        temperature: primaryConfig.temperature,
      });
    }
    
    const modelConfigs = this.modelManager.getModelConfigs(
      this.config,
      this.task,
      primaryModel,
    );

    logger.debug(`[ModelRunner] Found ${modelConfigs.length} model configs for task ${this.task}`);

    let lastError: Error | undefined;

    for (let i = 0; i < modelConfigs.length; i++) {
      const modelConfig = modelConfigs[i];
      const modelKey = `${modelConfig.provider}:${modelConfig.modelName}`;

      logger.debug(`[ModelRunner] Checking circuit breaker for ${modelKey}`);
      if (!(await this.modelManager.isCircuitClosed(modelKey))) {
        logger.warn(`Circuit breaker open for ${modelKey}, skipping`);
        continue;
      }

      if (i === 0) {
        logger.info(`[${this.task.toUpperCase()}] Attempting to use primary model: ${modelKey}`);
      } else {
        logger.info(`[${this.task.toUpperCase()}] ⚠️  FALLBACK ${i}: Attempting to use model: ${modelKey}`);
      }

      const graphConfig = getConfig() as GraphConfig;

      try {
        const model = await this.modelManager.initializeModel(
          modelConfig,
          graphConfig,
        );
        
        // Log model configuration to debug top_p issues
        const modelConfigDebug = (model as any)?._defaultConfig;
        if (modelConfigDebug) {
          logger.debug(`Model ${modelKey} defaultConfig (before cleanup):`, {
            top_p: modelConfigDebug.top_p,
            topP: modelConfigDebug.topP,
            temperature: modelConfigDebug.temperature,
            maxTokens: modelConfigDebug.maxTokens,
          });
          
          // For models that don't support top_p: -1, ensure it's not set in defaultConfig
          // This prevents LangChain from setting it to -1 by default
          if (modelConfigDebug.top_p === -1 || modelConfigDebug.topP === -1) {
            logger.info(`Model ${modelKey}: Setting top_p=0 in defaultConfig to prevent API errors.`);
            modelConfigDebug.top_p = 0;
            if (modelConfigDebug.topP !== undefined) {
              modelConfigDebug.topP = 0;
            }
          }
          
          logger.debug(`Model ${modelKey} defaultConfig (after cleanup):`, {
            top_p: modelConfigDebug.top_p,
            topP: modelConfigDebug.topP,
            temperature: modelConfigDebug.temperature,
            maxTokens: modelConfigDebug.maxTokens,
          });
        }
        
        // [CRITICAL HACK] Force delete temperature from the runnable instance if it's Anthropic
        // This handles cases where LangChain applies a default temperature (1.0)
        if (modelConfig.provider === "anthropic") {
            if ((model as any).temperature !== undefined) {
                delete (model as any).temperature;
                logger.debug(`Forcefully deleted 'temperature' property from runnable instance for ${modelKey}`);
            }
        }
        
        let runnableToUse: Runnable<BaseLanguageModelInput, AIMessageChunk> =
          model;

        // Check if provider-specific tools exist for this provider
        const providerSpecificTools =
          this.providerTools?.[modelConfig.provider];
        let toolsToUse: ExtractedTools | null = null;

        if (providerSpecificTools) {
          // Use provider-specific tools if available
          const extractedTools = this.extractBoundTools();
          toolsToUse = {
            tools: providerSpecificTools,
            kwargs: extractedTools?.kwargs || {},
          };
        } else {
          // Fall back to extracted bound tools from primary model
          toolsToUse = this.extractBoundTools();
        }

        if (
          toolsToUse &&
          "bindTools" in runnableToUse &&
          runnableToUse.bindTools
        ) {
          const supportsParallelToolCall =
            !MODELS_NO_PARALLEL_TOOL_CALLING.some(
              (modelName) => modelKey === modelName,
            );

          const kwargs = { ...toolsToUse.kwargs };
          if (!supportsParallelToolCall && "parallel_tool_calls" in kwargs) {
            delete kwargs.parallel_tool_calls;
          }

          runnableToUse = (runnableToUse as ConfigurableModel).bindTools(
            toolsToUse.tools,
            kwargs,
          );
        }

        const config = this.extractConfig();
        if (config) {
          // Log config to debug top_p issues
          logger.debug(`Config extracted for ${modelKey}:`, {
            configurable: config.configurable,
            tags: config.tags,
            metadata: config.metadata,
          });
          runnableToUse = runnableToUse.withConfig(config);
        }

        const needsIntercept = (modelConfig.provider === "anthropic");
        
        if (needsIntercept) {
          // Wrap the runnable to ensure options are clean
          const originalInvoke = runnableToUse.invoke.bind(runnableToUse);
          runnableToUse.invoke = async (input: any, invokeOptions?: any) => {
            
            // --- DEBUG PROMPT SIZE ---
            try {
                const fullInput = useProviderMessages(input, this.providerMessages, modelConfig.provider);
                const inputStr = JSON.stringify(fullInput, null, 2);
                await fs.writeFile('/home/ubuntu/last_prompt_debug.txt', inputStr);
                logger.info(`[DEBUG] Saved prompt to /home/ubuntu/last_prompt_debug.txt (Size: ${inputStr.length} chars)`);
            } catch (err) {
                logger.error("[DEBUG] Failed to save prompt debug file", err);
            }
            // -------------------------

            // Ensure top_p is REMOVED from options
            let cleanOptions = invokeOptions || {};

            
            // [CRITICAL FIX] Enforce top_p=0 and remove temperature for Anthropic
            // If top_p is missing or invalid, set it to 0.
            if (cleanOptions.top_p === undefined || cleanOptions.top_p === -1 || cleanOptions.top_p === null) {
                cleanOptions.top_p = 0;
                logger.debug(`Injected top_p=0 into invoke options for ${modelKey}`);
            }
            
            if (cleanOptions.configurable?.top_p === -1) {
                cleanOptions.configurable.top_p = 0;
            }
            
            // [CRITICAL FIX] Always remove temperature for Anthropic when using top_p
            if (cleanOptions.temperature !== undefined) {
                delete cleanOptions.temperature;
                logger.debug(`Removed temperature from invoke options for ${modelKey}`);
            }
            if (cleanOptions.configurable?.temperature !== undefined) {
                delete cleanOptions.configurable.temperature;
            }
            
            // Also force remove from the runnable instance itself one more time before call
            if ((runnableToUse as any).temperature !== undefined) {
                 delete (runnableToUse as any).temperature;
            }

            // Also check if the model's internal config has top_p/temperature
            const modelInternalConfig = (runnableToUse as any)?._defaultConfig;
            if (modelInternalConfig) {
                if (modelInternalConfig.top_p === undefined || modelInternalConfig.top_p === -1) {
                    modelInternalConfig.top_p = 0;
                    logger.debug(`Injected top_p=0 into model internal config for ${modelKey}`);
                }
                // Ensure topP (alias) is handled if present
                if (modelInternalConfig.topP === undefined || modelInternalConfig.topP === -1) {
                     // Some SDK versions might use topP
                     modelInternalConfig.topP = 0;
                }
                
                if (modelInternalConfig.temperature !== undefined) {
                    delete modelInternalConfig.temperature;
                    logger.debug(`Removed temperature from model internal config for ${modelKey}`);
                }
            }
            
            return originalInvoke(input, cleanOptions);
          };
        } else {
            // Remove any legacy wrappers if not needed (for clarity, though not strictly required)
        }

        // Log options passed to invoke
        if (options) {
          logger.debug(`Options passed to invoke for ${modelKey}:`, {
            ...options,
            // Don't log the full options object if it's too large
            keys: Object.keys(options),
          });
        }

        // For models that don't support top_p: -1, ensure it's not set in defaultConfig
        // This prevents LangChain from setting it to -1 by default
        const modelDefaultConfig = (runnableToUse as any)?._defaultConfig;
        if (modelDefaultConfig && (modelDefaultConfig.top_p === -1 || modelDefaultConfig.topP === -1)) {
          logger.info(`Model ${modelKey}: Setting top_p=0 in defaultConfig to prevent API errors.`);
          modelDefaultConfig.top_p = 0;
          if (modelDefaultConfig.topP !== undefined) {
            modelDefaultConfig.topP = 0;
          }
        }

          // LangChain may set top_p: -1 as a default, which causes issues with some models
          let finalOptions = options;
          if (options && (options as any).top_p === -1) {
             logger.warn(`Options for ${modelKey} contain top_p: -1. Removing it to prevent API errors.`);
             finalOptions = { ...options };
             delete (finalOptions as any).top_p;
             delete (finalOptions as any).topP;
             if ((finalOptions as any).configurable) {
               delete (finalOptions as any).configurable.top_p;
               delete (finalOptions as any).configurable.topP;
             }
          }

        const result = await runnableToUse.invoke(
          useProviderMessages(
            sanitizedInput, // Use sanitized input
            this.providerMessages,
            modelConfig.provider,
          ),
          finalOptions,
        );
        
        if (i === 0) {
          logger.info(`[${this.task.toUpperCase()}] ✅ Successfully using model: ${modelKey}`);
        } else {
          logger.info(`[${this.task.toUpperCase()}] ✅ Successfully using FALLBACK model: ${modelKey}`);
        }
        
        await this.modelManager.recordSuccess(modelKey);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(errorMessage);
        
        // Check if it's an authentication error (401 or API key error)
        const isAuthError = errorMessage.includes("401") || 
                           errorMessage.includes("Incorrect API key") ||
                           errorMessage.includes("API key") ||
                           errorMessage.includes("authentication") ||
                           errorMessage.includes("Invalid API key");
        
        // Check if it's a configuration error (invalid parameters)
        const isConfigError = errorMessage.includes("cannot be set to") ||
                             errorMessage.includes("invalid_request_error") ||
                             errorMessage.includes("Invalid parameter");
        
        if (isAuthError) {
          logger.error(
            `Authentication error with ${modelConfig.provider} model ${modelKey}: ${errorMessage}. Please verify your API key in Settings.`,
          );
          // Don't try other models if it's an auth error - the API key is wrong
          throw new Error(
            `Authentication failed for ${modelConfig.provider}. Please verify your API key is correct in Settings. Error: ${errorMessage}`,
          );
        }
        
        // If there are more models/retries configured and it's a recoverable error (timeout, server error), continue
        if (!isConfigError && i < modelConfigs.length - 1) {
             logger.warn(`${modelKey} failed with recoverable error: ${errorMessage}. Retrying with next configuration...`);
             await this.modelManager.recordFailure(modelKey);
             continue; // Try next model/retry in list
        }
       
       // Just throw the error immediately if we can't retry
       logger.error(`Model ${modelKey} failed: ${errorMessage}`);
       // Log full error details
       console.error("FULL ERROR DETAILS:", error);
       throw error; // Throw the original error object, not the recreated one
      }
    }

    // Only reach here if all models failed and we didn't ask the user
    throw new Error(
      `All fallback models exhausted for task ${this.task}. Last error: ${lastError?.message}`,
    );
  }

  bindTools(
    tools: BindToolsInput[],
    kwargs?: Record<string, any>,
  ): ConfigurableModel<RunInput, CallOptions> {
    const boundPrimary =
      this.primaryRunnable.bindTools?.(tools, kwargs) ?? this.primaryRunnable;
    return new FallbackRunnable(
      boundPrimary,
      this.config,
      this.task,
      this.modelManager,
      {
        providerTools: this.providerTools,
        providerMessages: this.providerMessages,
      },
    ) as unknown as ConfigurableModel<RunInput, CallOptions>;
  }

  // @ts-expect-error - types are hard man :/
  withConfig(
    config?: RunnableConfig,
  ): ConfigurableModel<RunInput, CallOptions> {
    const configuredPrimary =
      this.primaryRunnable.withConfig?.(config) ?? this.primaryRunnable;
    return new FallbackRunnable(
      configuredPrimary,
      this.config,
      this.task,
      this.modelManager,
      {
        providerTools: this.providerTools,
        providerMessages: this.providerMessages,
      },
    ) as unknown as ConfigurableModel<RunInput, CallOptions>;
  }

  private getPrimaryModel(): ConfigurableModel {
    let current = this.primaryRunnable;

    // Unwrap any LangChain bindings to get to the actual model
    while (current?.bound) {
      current = current.bound;
    }

    // The unwrapped object should be a chat model with _llmType
    if (current && typeof current._llmType !== "undefined") {
      return current;
    }

    throw new Error(
      "Could not extract primary model from runnable - no _llmType found",
    );
  }

  private extractBoundTools(): ExtractedTools | null {
    let current: any = this.primaryRunnable;

    while (current) {
      if (current._queuedMethodOperations?.bindTools) {
        const bindToolsOp = current._queuedMethodOperations.bindTools;

        if (Array.isArray(bindToolsOp) && bindToolsOp.length > 0) {
          const tools = bindToolsOp[0] as StructuredToolInterface[];
          const toolOptions = bindToolsOp[1] || {};

          return {
            tools: tools,
            kwargs: {
              tool_choice: (toolOptions as Record<string, any>).tool_choice,
              parallel_tool_calls: (toolOptions as Record<string, any>)
                .parallel_tool_calls,
            },
          };
        }
      }
      current = current.bound;
    }

    return null;
  }

  private extractConfig(): Partial<RunnableConfig> | null {
    let current: any = this.primaryRunnable;

    while (current) {
      if (current.config) {
        return current.config;
      }
      current = current.bound;
    }

    return null;
  }

}
