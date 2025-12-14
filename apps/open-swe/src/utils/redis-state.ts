import { getRedisStore, RedisStore } from "./redis-client.js";
import { TaskPlan } from "@openswe/shared/open-swe/types";
import { createLogger, LogLevel } from "./logger.js";

const logger = createLogger(LogLevel.INFO, "RedisState");

/**
 * Redis key prefixes for different state types
 */
const REDIS_PREFIXES = {
  DOCUMENT_CACHE: "doc_cache:",
  CODEBASE_TREE: "codebase_tree:",
  TASK_PLAN: "task_plan:",
  PROPOSED_PLAN: "proposed_plan:",
  ALLOWED_TOKEN_HASHES: "allowed_token_hashes",
} as const;

/**
 * Get Redis store instance (lazy initialization)
 * Returns null if Redis is unavailable
 */
let redisStore: RedisStore | null = null;
async function getStore(): Promise<RedisStore | null> {
  if (!redisStore) {
    redisStore = await getRedisStore();
  }
  return redisStore;
}

/**
 * Document Cache Operations
 * Stores document content keyed by URL for a given thread/session
 */
export async function getDocumentCache(
  threadId: string,
  url: string,
): Promise<string | null> {
  try {
    const store = await getStore();
    if (!store) {
      return null; // Redis unavailable, fallback to state
    }
    const key = `${REDIS_PREFIXES.DOCUMENT_CACHE}${threadId}:${url}`;
    return await store.get(key);
  } catch (error) {
    logger.warn("Failed to get document cache from Redis, using fallback", { threadId, url, error });
    return null;
  }
}

export async function setDocumentCache(
  threadId: string,
  url: string,
  content: string,
  expirationSeconds: number = 86400, // 24 hours
): Promise<void> {
  try {
    const store = await getStore();
    if (!store) {
      return; // Redis unavailable, skip silently
    }
    const key = `${REDIS_PREFIXES.DOCUMENT_CACHE}${threadId}:${url}`;
    await store.set(key, content, expirationSeconds);
  } catch (error) {
    logger.warn("Failed to set document cache in Redis, continuing without cache", { threadId, url, error });
  }
}

export async function getAllDocumentCache(
  threadId: string,
): Promise<Record<string, string>> {
  try {
    const store = await getStore();
    if (!store) {
      return {}; // Redis unavailable, return empty
    }
    const pattern = `${REDIS_PREFIXES.DOCUMENT_CACHE}${threadId}:*`;
    const keys = await store.keys(pattern);
    const cache: Record<string, string> = {};
    
    for (const key of keys) {
      const url = key.replace(`${REDIS_PREFIXES.DOCUMENT_CACHE}${threadId}:`, "");
      const content = await store.get(key);
      if (content) {
        cache[url] = content;
      }
    }
    
    return cache;
  } catch (error) {
    logger.warn("Failed to get all document cache from Redis, returning empty", { threadId, error });
    return {};
  }
}

export async function setDocumentCacheBatch(
  threadId: string,
  cache: Record<string, string>,
  expirationSeconds: number = 86400,
): Promise<void> {
  try {
    const store = await getStore();
    if (!store) {
      return; // Redis unavailable, skip silently
    }
    const promises = Object.entries(cache).map(([url, content]) => {
      const key = `${REDIS_PREFIXES.DOCUMENT_CACHE}${threadId}:${url}`;
      return store.set(key, content, expirationSeconds);
    });
    await Promise.all(promises);
  } catch (error) {
    logger.warn("Failed to set document cache batch in Redis, continuing without cache", { threadId, error });
  }
}

/**
 * Codebase Tree Operations
 */
export async function getCodebaseTree(threadId: string): Promise<string | null> {
  try {
    const store = await getStore();
    if (!store) {
      return null; // Redis unavailable, fallback to state
    }
    const key = `${REDIS_PREFIXES.CODEBASE_TREE}${threadId}`;
    return await store.get(key);
  } catch (error) {
    logger.warn("Failed to get codebase tree from Redis, using fallback", { threadId, error });
    return null;
  }
}

export async function setCodebaseTree(
  threadId: string,
  tree: string,
  expirationSeconds: number = 86400, // 24 hours
): Promise<void> {
  try {
    const store = await getStore();
    if (!store) {
      return; // Redis unavailable, skip silently
    }
    const key = `${REDIS_PREFIXES.CODEBASE_TREE}${threadId}`;
    await store.set(key, tree, expirationSeconds);
  } catch (error) {
    logger.warn("Failed to set codebase tree in Redis, continuing without cache", { threadId, error });
  }
}

/**
 * Task Plan Operations
 */
export async function getTaskPlan(threadId: string): Promise<TaskPlan | null> {
  try {
    const store = await getStore();
    if (!store) {
      return null; // Redis unavailable, fallback to state
    }
    const key = `${REDIS_PREFIXES.TASK_PLAN}${threadId}`;
    return await store.getJSON<TaskPlan>(key);
  } catch (error) {
    logger.warn("Failed to get task plan from Redis, using fallback", { threadId, error });
    return null;
  }
}

export async function setTaskPlan(
  threadId: string,
  taskPlan: TaskPlan,
  expirationSeconds: number = 86400 * 7, // 7 days
): Promise<void> {
  try {
    const store = await getStore();
    if (!store) {
      return; // Redis unavailable, skip silently
    }
    const key = `${REDIS_PREFIXES.TASK_PLAN}${threadId}`;
    await store.setJSON(key, taskPlan, expirationSeconds);
  } catch (error) {
    logger.warn("Failed to set task plan in Redis, continuing without cache", { threadId, error });
  }
}

/**
 * Proposed Plan Operations (for Planner)
 */
export async function getProposedPlan(threadId: string): Promise<string[] | null> {
  try {
    const store = await getStore();
    if (!store) {
      return null; // Redis unavailable, fallback to state
    }
    const key = `${REDIS_PREFIXES.PROPOSED_PLAN}${threadId}`;
    return await store.getJSON<string[]>(key);
  } catch (error) {
    logger.warn("Failed to get proposed plan from Redis, using fallback", { threadId, error });
    return null;
  }
}

export async function setProposedPlan(
  threadId: string,
  proposedPlan: string[],
  expirationSeconds: number = 86400, // 24 hours
): Promise<void> {
  try {
    const store = await getStore();
    if (!store) {
      return; // Redis unavailable, skip silently
    }
    const key = `${REDIS_PREFIXES.PROPOSED_PLAN}${threadId}`;
    await store.setJSON(key, proposedPlan, expirationSeconds);
  } catch (error) {
    logger.warn("Failed to set proposed plan in Redis, continuing without cache", { threadId, error });
  }
}

/**
 * Allowed Token Hashes Operations (for security)
 */
export async function getAllowedTokenHashes(): Promise<string[] | null> {
  try {
    const store = await getStore();
    if (!store) {
      return null; // Redis unavailable, fallback to in-memory
    }
    const key = REDIS_PREFIXES.ALLOWED_TOKEN_HASHES;
    return await store.getJSON<string[]>(key);
  } catch (error) {
    logger.warn("Failed to get allowed token hashes from Redis, using fallback", { error });
    return null;
  }
}

export async function setAllowedTokenHashes(
  hashes: string[],
  expirationSeconds: number = 86400, // 24 hours
): Promise<void> {
  try {
    const store = await getStore();
    if (!store) {
      return; // Redis unavailable, skip silently
    }
    const key = REDIS_PREFIXES.ALLOWED_TOKEN_HASHES;
    await store.setJSON(key, hashes, expirationSeconds);
  } catch (error) {
    logger.warn("Failed to set allowed token hashes in Redis, continuing without cache", { error });
  }
}

/**
 * Cleanup operations - delete all keys for a thread
 */
export async function cleanupThreadData(threadId: string): Promise<void> {
  try {
    const store = await getStore();
    if (!store) {
      return; // Redis unavailable, skip silently
    }
    const patterns = [
      `${REDIS_PREFIXES.DOCUMENT_CACHE}${threadId}:*`,
      `${REDIS_PREFIXES.CODEBASE_TREE}${threadId}`,
      `${REDIS_PREFIXES.TASK_PLAN}${threadId}`,
      `${REDIS_PREFIXES.PROPOSED_PLAN}${threadId}`,
    ];
    
    for (const pattern of patterns) {
      await store.deletePattern(pattern);
    }
  } catch (error) {
    logger.warn("Failed to cleanup thread data from Redis", { threadId, error });
  }
}

