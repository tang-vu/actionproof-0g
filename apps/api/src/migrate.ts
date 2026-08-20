import "./load-local-env.js";

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new TypeError("DATABASE_URL is required for migrations");

const migrationsDirectory = path.resolve(import.meta.dirname, "../migrations");
const files = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
  .sort();
const pool = new Pool({ connectionString, max: 1 });
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock(hashtext('actionproof:migrations'))");
  await client.query(`
    CREATE TABLE IF NOT EXISTS actionproof_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  for (const file of files) {
    const sql = await readFile(path.resolve(migrationsDirectory, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query<{ checksum: string }>(
      "SELECT checksum FROM actionproof_schema_migrations WHERE name = $1",
      [file],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Applied migration ${file} has changed; create a new migration instead`);
      }
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO actionproof_schema_migrations (name, checksum) VALUES ($1, $2)",
        [file, checksum],
      );
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client
    .query("SELECT pg_advisory_unlock(hashtext('actionproof:migrations'))")
    .catch(() => undefined);
  client.release();
  await pool.end();
}
