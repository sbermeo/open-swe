import { Command } from "@langchain/langgraph";
import { ActionRequest, HumanResponse } from "@langchain/langgraph/prebuilt";
import { GraphConfig, GraphUpdate } from "@openswe/shared/open-swe/types";
import { PlannerGraphState } from "@openswe/shared/open-swe/planner/types";
import { GraphState } from "@openswe/shared/open-swe/types";
import { createLogger, LogLevel } from "../../utils/logger.js";
import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import { getMessageContentString } from "@openswe/shared/messages";
import { isHumanMessage } from "@langchain/core/messages";

const logger = createLogger(LogLevel.INFO, "HandleModelFallback");

/**
 * Handle model fallback selection from user
 * This node processes the user's model selection and updates the config
 */
export async function handleModelFallback(
  state: PlannerGraphState | GraphState,
  config: GraphConfig,
): Promise<Command> {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  
  // Extract model selection from message
  // The user should respond with the model name like "anthropic:claude-sonnet-4-0"
  let selectedModel: string | undefined;
  let task: LLMTask = LLMTask.PLANNER;
  
  // Try to get task from previous messages metadata
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const metadata = (msg as any).metadata;
    if (metadata?.modelFallback?.task) {
      task = metadata.modelFallback.task;
      break;
    }
  }
  
  if (isHumanMessage(lastMessage)) {
    const content = getMessageContentString(lastMessage.content);
    selectedModel = content.trim();
  }
  
  if (!selectedModel) {
    throw new Error("No model selected by user. Please provide a model name like 'anthropic:claude-sonnet-4-0'");
  }

  // Validate model format (should be provider:model-name)
  if (!selectedModel.includes(":")) {
    throw new Error(`Invalid model format: ${selectedModel}. Expected format: provider:model-name (e.g., 'anthropic:claude-sonnet-4-0')`);
  }
  
  logger.info("User selected fallback model", {
    selectedModel,
    task,
  });

  // Update config with selected model
  const taskKey = `${task}ModelName` as keyof GraphConfig["configurable"];
  
  // Return command to continue with updated config
  return new Command({
    goto: "generate-action",
    update: {
      messages: [
        {
          role: "assistant",
          content: `✅ Cambiando al modelo ${selectedModel} y continuando...`,
        } as any,
      ],
    } as GraphUpdate,
    // Eliminar este bloque:
    // config: {
    //   configurable: {
    //     [taskKey]: selectedModel,
    //   },
    // },
  });
}

