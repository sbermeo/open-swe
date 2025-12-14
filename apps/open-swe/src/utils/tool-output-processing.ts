import { GraphConfig, GraphState } from "@openswe/shared/open-swe/types";
import { truncateOutput } from "./truncate-outputs.js";
import { handleMcpDocumentationOutput } from "./mcp-output/index.js";
import { parseUrl } from "./url-parser.js";
import { getDocumentCache, setDocumentCache } from "./redis-state.js";

interface ToolCall {
  name: string;
  args?: Record<string, any>;
}

/**
 * Processes tool call results with appropriate content handling based on tool type.
 * Handles search_document_for, MCP tools, and regular tools with different truncation strategies.
 * Returns a new state object with the updated document cache if the tool is a higher context limit tool.
 */
export async function processToolCallContent(
  toolCall: ToolCall,
  result: string,
  options: {
    higherContextLimitToolNames: string[];
    state: Pick<GraphState, "documentCache">;
    config: GraphConfig;
    threadId?: string;
  },
): Promise<{
  content: string;
  stateUpdates?: Partial<Pick<GraphState, "documentCache">>;
}> {
  const { higherContextLimitToolNames, state, config, threadId } = options;

  if (toolCall.name === "search_document_for") {
    return {
      content: truncateOutput(result, {
        numStartCharacters: 20000,
        numEndCharacters: 20000,
      }),
    };
  } else if (higherContextLimitToolNames.includes(toolCall.name)) {
    const url = toolCall.args?.url || toolCall.args?.uri || toolCall.args?.path;
    const parsedResult = typeof url === "string" ? parseUrl(url) : null;
    const parsedUrl = parsedResult?.success ? parsedResult.url.href : undefined;

    // Check Redis cache first, then fallback to state cache
    let cachedContent: string | null = null;
    if (parsedUrl && threadId) {
      cachedContent = await getDocumentCache(threadId, parsedUrl);
    }
    
    // Fallback to state cache if Redis doesn't have it
    if (!cachedContent && parsedUrl && state.documentCache[parsedUrl]) {
      cachedContent = state.documentCache[parsedUrl];
    }

    if (cachedContent) {
      return {
        content: cachedContent,
      };
    }

    const processedContent = await handleMcpDocumentationOutput(
      result,
      config,
      {
        url: parsedUrl,
      },
    );

    // Store in Redis if we have threadId, otherwise use state cache
    if (parsedUrl) {
      if (threadId) {
        await setDocumentCache(threadId, parsedUrl, result);
      }
      
      // Also update state cache for backward compatibility
      const stateUpdates = {
        documentCache: {
          ...state.documentCache,
          [parsedUrl]: result,
        },
      };

      return {
        content: processedContent,
        stateUpdates,
      };
    }

    return {
      content: processedContent,
    };
  } else {
    return {
      content: truncateOutput(result),
    };
  }
}
