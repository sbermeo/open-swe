import { createClient, RedisClientType } from "redis";
import { createLogger, LogLevel } from "./logger.js";

const logger = createLogger(LogLevel.INFO, "RedisClient");

let redisClient: RedisClientType | null = null;

/**
 * Get or create Redis client instance
 * Returns null if Redis is unavailable (doesn't throw)
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  try {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  
  redisClient = createClient({
    url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            logger.warn("Redis connection failed after 3 retries, will use fallback");
            return false; // Stop reconnecting
          }
          return Math.min(retries * 100, 3000);
        },
        connectTimeout: 2000, // 2 second timeout
      },
  });

  redisClient.on("error", (err) => {
    logger.error("Redis Client Error", err);
  });

  redisClient.on("connect", () => {
    logger.info("Redis Client Connected");
  });

  redisClient.on("ready", () => {
    logger.info("Redis Client Ready");
  });

  redisClient.on("reconnecting", () => {
    logger.info("Redis Client Reconnecting");
  });

  if (!redisClient.isOpen) {
      await Promise.race([
        redisClient.connect(),
        new Promise<void>((_, reject) => 
          setTimeout(() => reject(new Error("Redis connection timeout")), 2000)
        )
      ]);
  }

  return redisClient;
  } catch (error) {
    logger.warn("Redis unavailable, using fallback to in-memory storage", { error });
    redisClient = null;
    return null;
  }
}

/**
 * Close Redis client connection
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
    logger.info("Redis Client Closed");
  }
}

/**
 * Redis helper functions for common operations
 */
export class RedisStore {
  private client: RedisClientType | null;

  constructor(client: RedisClientType | null) {
    this.client = client;
  }
  
  private checkClient(): boolean {
    return this.client !== null && this.client !== undefined && this.client.isOpen;
  }

  /**
   * Set a key-value pair with optional expiration (in seconds)
   */
  async set(
    key: string,
    value: string,
    expirationSeconds?: number,
  ): Promise<void> {
    if (!this.checkClient()) {
      return; // Redis unavailable, skip silently
    }
    if (expirationSeconds) {
      await this.client!.setEx(key, expirationSeconds, value);
    } else {
      await this.client!.set(key, value);
    }
  }

  /**
   * Get a value by key
   */
  async get(key: string): Promise<string | null> {
    if (!this.checkClient()) {
      return null; // Redis unavailable
    }
    return await this.client!.get(key);
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<void> {
    if (!this.checkClient()) {
      return; // Redis unavailable, skip silently
    }
    await this.client!.del(key);
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.checkClient()) {
      return false; // Redis unavailable
    }
    const result = await this.client!.exists(key);
    return result === 1;
  }

  /**
   * Set a JSON object
   */
  async setJSON<T>(key: string, value: T, expirationSeconds?: number): Promise<void> {
    const jsonString = JSON.stringify(value);
    await this.set(key, jsonString, expirationSeconds);
  }

  /**
   * Get a JSON object
   */
  async getJSON<T>(key: string): Promise<T | null> {
    const jsonString = await this.get(key);
    if (!jsonString) {
      return null;
    }
    try {
      return JSON.parse(jsonString) as T;
    } catch (error) {
      logger.error(`Failed to parse JSON for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Get all keys matching a pattern
   */
  async keys(pattern: string): Promise<string[]> {
    if (!this.checkClient()) {
      return []; // Redis unavailable
    }
    return await this.client!.keys(pattern);
  }

  /**
   * Delete all keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<void> {
    if (!this.checkClient()) {
      return; // Redis unavailable, skip silently
    }
    const keys = await this.keys(pattern);
    if (keys.length > 0) {
      await this.client!.del(keys);
    }
  }

  /**
   * Set expiration on a key
   */
  async expire(key: string, seconds: number): Promise<void> {
    if (!this.checkClient()) {
      return; // Redis unavailable, skip silently
    }
    await this.client!.expire(key, seconds);
  }

  /**
   * Get time to live for a key
   */
  async ttl(key: string): Promise<number> {
    if (!this.checkClient()) {
      return -1; // Redis unavailable
    }
    return await this.client!.ttl(key);
  }
}

/**
 * Get RedisStore instance
 * Returns null if Redis is unavailable
 */
export async function getRedisStore(): Promise<RedisStore | null> {
  const client = await getRedisClient();
  if (!client) {
    return null;
  }
  return new RedisStore(client);
}

