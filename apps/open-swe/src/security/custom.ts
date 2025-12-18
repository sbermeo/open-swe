import { STUDIO_USER_ID } from "./utils.js";
import { LANGGRAPH_USER_PERMISSIONS } from "../constants.js";
import * as bcrypt from "bcrypt";
import { getAllowedTokenHashes as getAllowedTokenHashesFromRedis, setAllowedTokenHashes } from "../utils/redis-state.js";

function bcryptHash(value: string): string {
  // Use 12 salt rounds for reasonable security
  return bcrypt.hashSync(value, 12);
}

function getConfiguredApiTokens(): string[] {
  const single = process.env.API_BEARER_TOKEN || "";
  const many = process.env.API_BEARER_TOKENS || ""; // comma-separated

  const tokens: string[] = [];

  if (single.trim()) {
    tokens.push(single.trim());
  }

  if (many.trim()) {
    for (const t of many.split(",")) {
      const v = t.trim();
      if (v) tokens.push(v);
    }
  }

  return tokens;
}

// Pre-hash configured tokens for constant length comparisons
// Now using Redis instead of in-memory cache, with fallback to in-memory
let cachedAllowedTokenHashes: string[] | null = null;
async function getAllowedTokenHashes(): Promise<string[]> {
  // Try Redis first, but don't fail if Redis is unavailable
  try {
    const cachedHashes = await getAllowedTokenHashesFromRedis();
    if (cachedHashes) {
      // Update in-memory cache as well
      cachedAllowedTokenHashes = cachedHashes;
      return cachedHashes;
    }
  } catch (error) {
    // Redis unavailable, fallback to in-memory cache
  if (cachedAllowedTokenHashes) {
    return cachedAllowedTokenHashes;
    }
  }

  // If not in Redis or Redis unavailable, compute and store
  const tokens = getConfiguredApiTokens();
  const hashes = tokens.map((t) => bcryptHash(t));
  
  // Update in-memory cache
  cachedAllowedTokenHashes = hashes;
  
  // Try to store in Redis, but don't fail if it's unavailable
  try {
    await setAllowedTokenHashes(hashes);
  } catch (error) {
    // Redis unavailable, continue with in-memory cache
  }
  
  return hashes;
}

export async function validateApiBearerToken(token: string) {
  const allowed = await getAllowedTokenHashes();
  if (allowed.length === 0) {
    // Not configured; treat as invalid
    return null;
  }

  // Compare the token against each allowed hash using bcrypt
  const isValid = allowed.some((h) => bcrypt.compareSync(token, h));
  if (isValid) {
    return {
      identity: STUDIO_USER_ID,
      is_authenticated: true,
      display_name: STUDIO_USER_ID,
      metadata: {
        installation_name: "api-key-auth",
      },
      permissions: LANGGRAPH_USER_PERMISSIONS,
    };
  }
  return null;
}
