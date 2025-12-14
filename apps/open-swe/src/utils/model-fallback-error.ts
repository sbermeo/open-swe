import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import { ModelLoadConfig } from "./llms/model-manager.js";

/**
 * Error thrown when a model fails and user should choose a fallback model
 */
export class ModelFallbackInterruptError extends Error {
  public readonly failedModel: string;
  public readonly failedModelConfig: ModelLoadConfig;
  public readonly errorMessage: string;
  public readonly availableModels: ModelLoadConfig[];
  public readonly task: LLMTask;

  constructor(
    failedModel: string,
    failedModelConfig: ModelLoadConfig,
    errorMessage: string,
    availableModels: ModelLoadConfig[],
    task: LLMTask,
  ) {
    super(
      `Model ${failedModel} failed: ${errorMessage}. Please choose an alternative model.`,
    );
    this.name = "ModelFallbackInterruptError";
    this.failedModel = failedModel;
    this.failedModelConfig = failedModelConfig;
    this.errorMessage = errorMessage;
    this.availableModels = availableModels;
    this.task = task;
  }
}

