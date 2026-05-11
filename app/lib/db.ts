import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "usage.db");

declare global {
  // eslint-disable-next-line no-var
  var __agentSdkDemoDb: Database.Database | undefined;
}

function open(): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      model TEXT NOT NULL,
      cost_usd REAL NOT NULL,
      num_turns INTEGER NOT NULL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return instance;
}

export const db: Database.Database = globalThis.__agentSdkDemoDb ?? open();
if (process.env.NODE_ENV !== "production") {
  globalThis.__agentSdkDemoDb = db;
}

export type Run = {
  id: number;
  filename: string;
  model: string;
  cost_usd: number;
  num_turns: number;
  duration_ms: number | null;
  created_at: string;
};

export function insertRun(row: {
  filename: string;
  model: string;
  cost_usd: number;
  num_turns: number;
  duration_ms?: number | null;
}) {
  return db
    .prepare(
      `INSERT INTO runs (filename, model, cost_usd, num_turns, duration_ms)
       VALUES (@filename, @model, @cost_usd, @num_turns, @duration_ms)`,
    )
    .run({
      filename: row.filename,
      model: row.model,
      cost_usd: row.cost_usd,
      num_turns: row.num_turns,
      duration_ms: row.duration_ms ?? null,
    });
}

export function getTotals(): { count: number; total_usd: number } {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(cost_usd), 0) AS total_usd FROM runs`,
    )
    .get() as { count: number; total_usd: number };
  return r;
}

export function getRecent(limit = 10): Run[] {
  return db
    .prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT ?`)
    .all(limit) as Run[];
}

export function clearAll() {
  db.prepare(`DELETE FROM runs`).run();
}
