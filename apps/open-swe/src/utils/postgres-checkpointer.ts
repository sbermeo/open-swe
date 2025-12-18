import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import { createLogger, LogLevel } from "./logger.js";

const logger = createLogger(LogLevel.INFO, "PostgresCheckpointer");

const databaseUrl = process.env.DATABASE_URL || "postgresql://openswe:openswepassword@localhost:5432/openswe_db";

export const pool = new Pool({
  connectionString: databaseUrl,
});

export const checkpointer = new PostgresSaver(pool);

// Ensure tables exist on startup
checkpointer.setup().catch((error) => {
  logger.error("Failed to setup Postgres checkpointer on init", { error });
});

export async function ensurePostgresCheckpointer() {
  try {
    await checkpointer.setup();
    logger.info("Postgres checkpointer setup completed");
  } catch (error) {
    logger.error("Failed to setup Postgres checkpointer", { error });
    // Don't throw here to avoid crashing if DB is momentarily unavailable, 
    // but graph operations might fail until it is up.
  }
}
