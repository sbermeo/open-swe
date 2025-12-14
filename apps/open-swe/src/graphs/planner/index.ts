import { END, START, StateGraph } from "@langchain/langgraph";
import {
  PlannerGraphState,
  PlannerGraphStateObj,
} from "@openswe/shared/open-swe/planner/types";
import { GraphConfiguration } from "@openswe/shared/open-swe/types";
import {
  generateAction,
  generatePlan,
  interruptProposedPlan,
  prepareGraphState,
  notetaker,
  takeActions,
  determineNeedsContext,
} from "./nodes/index.js";
import { isAIMessage } from "@langchain/core/messages";
import { initializeSandbox } from "../shared/initialize-sandbox.js";
import { diagnoseError } from "../shared/diagnose-error.js";
import { handleModelFallback } from "../shared/handle-model-fallback.js";

function takeActionOrGeneratePlan(
  state: PlannerGraphState,
): "take-plan-actions" | "generate-plan" | "handle-model-fallback" {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];
  
  // Check if the last message is a model selection response (after interrupt)
  if (lastMessage.role === "human") {
    const content = typeof lastMessage.content === "string" 
      ? lastMessage.content 
      : Array.isArray(lastMessage.content)
      ? lastMessage.content.map((c: any) => typeof c === "string" ? c : c.text || "").join("")
      : String(lastMessage.content);
    
    // Check if this looks like a model selection (contains ":" and is a short string)
    if (content.trim().includes(":") && content.trim().split(":").length === 2 && content.trim().length < 100) {
      // Check if there's a model fallback interrupt in the message history
      for (let i = messages.length - 2; i >= 0; i--) {
        const msg = messages[i];
        const metadata = (msg as any).metadata;
        if (metadata?.modelFallback) {
          // This is a model selection response, redirect to handle-model-fallback
          return "handle-model-fallback";
        }
      }
    }
  }
  
  if (isAIMessage(lastMessage) && lastMessage.tool_calls?.length) {
    return "take-plan-actions";
  }

  // If the last message does not have tool calls, continue to generate plan without modifications.
  return "generate-plan";
}

const workflow = new StateGraph(PlannerGraphStateObj, GraphConfiguration)
  .addNode("prepare-graph-state", prepareGraphState, {
    ends: [END, "initialize-sandbox"],
  })
  .addNode("initialize-sandbox", initializeSandbox)
  .addNode("generate-plan-context-action", generateAction)
  .addNode("take-plan-actions", takeActions, {
    ends: ["generate-plan-context-action", "diagnose-error", "generate-plan"],
  })
  .addNode("generate-plan", generatePlan)
  .addNode("notetaker", notetaker)
  .addNode("interrupt-proposed-plan", interruptProposedPlan, {
    ends: [END, "determine-needs-context"],
  })
  .addNode("determine-needs-context", determineNeedsContext, {
    ends: ["generate-plan-context-action", "generate-plan"],
  })
  .addNode("diagnose-error", diagnoseError)
  .addNode("handle-model-fallback", handleModelFallback, {
    ends: ["generate-plan-context-action"],
  })
  .addEdge(START, "prepare-graph-state")
  .addEdge("initialize-sandbox", "generate-plan-context-action")
  .addConditionalEdges(
    "generate-plan-context-action",
    takeActionOrGeneratePlan,
    ["take-plan-actions", "generate-plan", "handle-model-fallback"],
  )
  .addEdge("diagnose-error", "generate-plan-context-action")
  .addEdge("generate-plan", "notetaker")
  .addEdge("notetaker", "interrupt-proposed-plan")
  .addEdge("handle-model-fallback", "generate-plan-context-action");

export const graph = workflow.compile();
graph.name = "Open SWE - Planner";
