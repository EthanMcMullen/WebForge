import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ApiJob, ApiJobStatus, ApiRecord, ApiRecordData, ApiRecordSchema, SourceStrategy } from "./types";

const dbPath = process.env.WEBFORGE_DB_PATH || join(process.cwd(), ".data", "webforge.sqlite");
declare global { var webforgeDatabase: DatabaseSync | undefined; }
function database(): DatabaseSync {
  if (!globalThis.webforgeDatabase) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS api_jobs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, user_request TEXT NOT NULL,
        status TEXT NOT NULL, schema_json TEXT NOT NULL, source_strategy_json TEXT NOT NULL,
        sources_json TEXT NOT NULL, refresh_interval INTEGER, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS api_jobs_updated_idx ON api_jobs(updated_at DESC);
      CREATE TABLE IF NOT EXISTS api_records (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES api_jobs(id) ON DELETE CASCADE,
        source_url TEXT NOT NULL, data_json TEXT NOT NULL, extracted_at TEXT NOT NULL,
        UNIQUE(job_id, source_url)
      );
      CREATE INDEX IF NOT EXISTS api_records_job_idx ON api_records(job_id, extracted_at DESC);
    `);
    db.exec("UPDATE api_jobs SET status = 'planned' WHERE status = 'ready' AND NOT EXISTS (SELECT 1 FROM api_records WHERE api_records.job_id = api_jobs.id)");
    globalThis.webforgeDatabase = db;
  }
  return globalThis.webforgeDatabase;
}
type ApiJobRow = {
  id: string; name: string; user_request: string; status: ApiJobStatus;
  schema_json: string; source_strategy_json: string; sources_json: string;
  refresh_interval: number | null; error: string | null; created_at: string; updated_at: string;
};
function mapApiJob(row: ApiJobRow): ApiJob {
  return {
    id: row.id, name: row.name, userRequest: row.user_request, status: row.status,
    schema: JSON.parse(row.schema_json) as ApiRecordSchema,
    sourceStrategy: JSON.parse(row.source_strategy_json) as SourceStrategy,
    sources: JSON.parse(row.sources_json) as string[], refreshInterval: row.refresh_interval,
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export function listApiJobs(): ApiJob[] {
  return (database().prepare("SELECT * FROM api_jobs ORDER BY updated_at DESC").all() as ApiJobRow[]).map(mapApiJob);
}
export function getApiJob(id: string): ApiJob | null {
  const row = database().prepare("SELECT * FROM api_jobs WHERE id = ?").get(id) as ApiJobRow | undefined;
  return row ? mapApiJob(row) : null;
}
export function saveApiJob(job: ApiJob): void {
  database().prepare(`
    INSERT INTO api_jobs (id, name, user_request, status, schema_json, source_strategy_json,
      sources_json, refresh_interval, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, user_request = excluded.user_request, status = excluded.status,
      schema_json = excluded.schema_json, source_strategy_json = excluded.source_strategy_json,
      sources_json = excluded.sources_json, refresh_interval = excluded.refresh_interval,
      error = excluded.error, updated_at = excluded.updated_at
  `).run(job.id, job.name, job.userRequest, job.status, JSON.stringify(job.schema),
    JSON.stringify(job.sourceStrategy), JSON.stringify(job.sources), job.refreshInterval,
    job.error, job.createdAt, job.updatedAt);
}
type ApiRecordRow = { id: string; job_id: string; source_url: string; data_json: string; extracted_at: string };
export function listApiRecords(jobId: string): ApiRecord[] {
  const rows = database().prepare("SELECT * FROM api_records WHERE job_id = ? ORDER BY extracted_at DESC, source_url ASC").all(jobId) as ApiRecordRow[];
  return rows.map((row) => ({
    id: row.id, jobId: row.job_id, sourceUrl: row.source_url,
    data: JSON.parse(row.data_json) as ApiRecordData, extractedAt: row.extracted_at,
  }));
}
export function saveApiRecords(jobId: string, records: ApiRecord[]): void {
  const db = database();
  const statement = db.prepare(`
    INSERT INTO api_records (id, job_id, source_url, data_json, extracted_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(job_id, source_url) DO UPDATE SET
      data_json = excluded.data_json, extracted_at = excluded.extracted_at
  `);
  db.exec("BEGIN");
  try {
    for (const record of records) {
      if (record.jobId !== jobId) throw new Error("Record belongs to a different job.");
      statement.run(record.id, jobId, record.sourceUrl, JSON.stringify(record.data), record.extractedAt);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}