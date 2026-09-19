import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ApiJob, ApiJobStatus, ApiRecord, ApiRecordData, ApiRecordSchema, RunOutcome, RunSummary, SourceStrategy } from "./types";
import { selectProposedFields } from "./field-selection";

const dbPath = process.env.WEBFORGE_DB_PATH || join(process.cwd(), ".data", "webforge.sqlite");
declare global { var webforgeDatabase: DatabaseSync | undefined; var webforgeSchemaReady: boolean | undefined; var webforgeSchemaVersion: number | undefined; }
function database(): DatabaseSync {
  if (!globalThis.webforgeDatabase) {
    mkdirSync(dirname(dbPath), { recursive: true });
    globalThis.webforgeDatabase = new DatabaseSync(dbPath);
  }
  const db = globalThis.webforgeDatabase;
  if (!globalThis.webforgeSchemaReady) {
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
      CREATE TABLE IF NOT EXISTS api_job_runs (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES api_jobs(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL, finished_at TEXT,
        search_calls INTEGER NOT NULL, scrape_calls INTEGER NOT NULL, recovery_calls INTEGER NOT NULL,
        consecutive_failures INTEGER NOT NULL, total_failures INTEGER NOT NULL,
        saved_records INTEGER NOT NULL, skipped_sources INTEGER NOT NULL,
        outcome TEXT NOT NULL, stop_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS api_job_runs_job_idx ON api_job_runs(job_id, started_at DESC);
    `);
    const columns = db.prepare("PRAGMA table_info(api_jobs)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "blocked_domains_json")) {
      db.exec("ALTER TABLE api_jobs ADD COLUMN blocked_domains_json TEXT NOT NULL DEFAULT '[]'");
    }
    db.exec("UPDATE api_jobs SET status = 'planned' WHERE status = 'ready' AND NOT EXISTS (SELECT 1 FROM api_records WHERE api_records.job_id = api_jobs.id)");
    globalThis.webforgeSchemaReady = true;
  }
  if (!globalThis.webforgeSchemaVersion || globalThis.webforgeSchemaVersion < 2) {
    const columns = db.prepare("PRAGMA table_info(api_jobs)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "proposed_schema_json")) {
      db.exec("ALTER TABLE api_jobs ADD COLUMN proposed_schema_json TEXT NOT NULL DEFAULT '{}'");
    }
    if (!columns.some((column) => column.name === "schema_confirmed_at")) {
      db.exec("ALTER TABLE api_jobs ADD COLUMN schema_confirmed_at TEXT");
    }
    db.exec("UPDATE api_jobs SET proposed_schema_json = schema_json, schema_confirmed_at = updated_at WHERE proposed_schema_json = '{}' AND schema_json <> '{}'");
    globalThis.webforgeSchemaVersion = 2;
  }
  if (!globalThis.webforgeSchemaVersion || globalThis.webforgeSchemaVersion < 3) {
    const jobColumns = db.prepare("PRAGMA table_info(api_jobs)").all() as Array<{ name: string }>;
    if (!jobColumns.some((column) => column.name === "next_refresh_at")) db.exec("ALTER TABLE api_jobs ADD COLUMN next_refresh_at TEXT");
    if (!jobColumns.some((column) => column.name === "refresh_failures")) db.exec("ALTER TABLE api_jobs ADD COLUMN refresh_failures INTEGER NOT NULL DEFAULT 0");
    if (!jobColumns.some((column) => column.name === "refresh_paused")) db.exec("ALTER TABLE api_jobs ADD COLUMN refresh_paused INTEGER NOT NULL DEFAULT 0");
    const runColumns = db.prepare("PRAGMA table_info(api_job_runs)").all() as Array<{ name: string }>;
    if (!runColumns.some((column) => column.name === "trigger")) db.exec("ALTER TABLE api_job_runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual'");
    if (!runColumns.some((column) => column.name === "cancel_requested")) db.exec("ALTER TABLE api_job_runs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0");
    if (!runColumns.some((column) => column.name === "lease_until")) db.exec("ALTER TABLE api_job_runs ADD COLUMN lease_until TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS api_job_runs_claim_idx ON api_job_runs(outcome, lease_until, started_at)");
    db.exec("UPDATE api_jobs SET next_refresh_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || refresh_interval || ' minutes') WHERE refresh_interval IS NOT NULL AND next_refresh_at IS NULL AND schema_confirmed_at IS NOT NULL");
    globalThis.webforgeSchemaVersion = 3;
  }
  if (!globalThis.webforgeSchemaVersion || globalThis.webforgeSchemaVersion < 4) {
    const jobColumns = db.prepare("PRAGMA table_info(api_jobs)").all() as Array<{ name: string }>;
    if (!jobColumns.some((column) => column.name === "combine_sources")) db.exec("ALTER TABLE api_jobs ADD COLUMN combine_sources INTEGER NOT NULL DEFAULT 0");
    const recordColumns = db.prepare("PRAGMA table_info(api_records)").all() as Array<{ name: string }>;
    if (!recordColumns.some((column) => column.name === "source_urls_json")) db.exec("ALTER TABLE api_records ADD COLUMN source_urls_json TEXT");
    if (!recordColumns.some((column) => column.name === "field_sources_json")) db.exec("ALTER TABLE api_records ADD COLUMN field_sources_json TEXT");
    globalThis.webforgeSchemaVersion = 4;
  }
  return db;
}
type ApiJobRow = {
  id: string; name: string; user_request: string; status: ApiJobStatus;
  schema_json: string; source_strategy_json: string; sources_json: string;
  refresh_interval: number | null; error: string | null; created_at: string; updated_at: string;
  blocked_domains_json: string; proposed_schema_json: string; schema_confirmed_at: string | null;
  next_refresh_at: string | null; refresh_failures: number; refresh_paused: number;
  combine_sources: number;
};
type RunRow = {
  id: string; job_id: string; started_at: string; finished_at: string | null;
  search_calls: number; scrape_calls: number; recovery_calls: number;
  consecutive_failures: number; total_failures: number; saved_records: number;
  skipped_sources: number; outcome: RunOutcome; stop_reason: string | null;
  trigger: "manual" | "scheduled"; cancel_requested: number; lease_until: string | null;
};
function mapRun(row: RunRow): RunSummary {
  return {
    id: row.id, jobId: row.job_id, startedAt: row.started_at, finishedAt: row.finished_at,
    searchCalls: row.search_calls, scrapeCalls: row.scrape_calls, recoveryCalls: row.recovery_calls,
    consecutiveFailures: row.consecutive_failures, totalFailures: row.total_failures,
    savedRecords: row.saved_records, skippedSources: row.skipped_sources,
    outcome: row.outcome, stopReason: row.stop_reason, trigger: row.trigger, cancelRequested: Boolean(row.cancel_requested),
  };
}
export function getLatestRun(jobId: string): RunSummary | null {
  const row = database().prepare("SELECT * FROM api_job_runs WHERE job_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1").get(jobId) as RunRow | undefined;
  return row ? mapRun(row) : null;
}
export function saveRunSummary(run: RunSummary): void {
  database().prepare(`INSERT INTO api_job_runs (
    id, job_id, started_at, finished_at, search_calls, scrape_calls, recovery_calls,
    consecutive_failures, total_failures, saved_records, skipped_sources, outcome, stop_reason, trigger
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET finished_at = excluded.finished_at,
    search_calls = excluded.search_calls, scrape_calls = excluded.scrape_calls,
    recovery_calls = excluded.recovery_calls, consecutive_failures = excluded.consecutive_failures,
    total_failures = excluded.total_failures, saved_records = excluded.saved_records,
    skipped_sources = excluded.skipped_sources, outcome = excluded.outcome, stop_reason = excluded.stop_reason`).run(
    run.id, run.jobId, run.startedAt, run.finishedAt,
    run.searchCalls, run.scrapeCalls, run.recoveryCalls,
    run.consecutiveFailures, run.totalFailures, run.savedRecords, run.skippedSources,
    run.outcome, run.stopReason, run.trigger || "manual",
  );
}
function mapApiJob(row: ApiJobRow): ApiJob {
  return {
    id: row.id, name: row.name, userRequest: row.user_request, status: row.status,
    schema: JSON.parse(row.schema_json) as ApiRecordSchema,
    combineSources: Boolean(row.combine_sources),
    sourceStrategy: JSON.parse(row.source_strategy_json) as SourceStrategy,
    sources: JSON.parse(row.sources_json) as string[], refreshInterval: row.refresh_interval,
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
    blockedDomains: JSON.parse(row.blocked_domains_json) as string[],
    proposedSchema: JSON.parse(row.proposed_schema_json) as ApiRecordSchema,
    schemaConfirmedAt: row.schema_confirmed_at,
    runSummary: getLatestRun(row.id), recordCount: countApiRecords(row.id),
    nextRefreshAt: row.next_refresh_at, refreshFailures: row.refresh_failures, refreshPaused: Boolean(row.refresh_paused),
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
      sources_json, refresh_interval, error, created_at, updated_at, blocked_domains_json,
      proposed_schema_json, schema_confirmed_at, combine_sources)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, user_request = excluded.user_request, status = excluded.status,
      schema_json = excluded.schema_json, source_strategy_json = excluded.source_strategy_json,
      sources_json = excluded.sources_json, refresh_interval = excluded.refresh_interval,
      error = excluded.error, updated_at = excluded.updated_at,
      blocked_domains_json = excluded.blocked_domains_json,
      proposed_schema_json = excluded.proposed_schema_json,
      schema_confirmed_at = excluded.schema_confirmed_at,
      combine_sources = excluded.combine_sources
  `).run(job.id, job.name, job.userRequest, job.status, JSON.stringify(job.schema),
    JSON.stringify(job.sourceStrategy), JSON.stringify(job.sources), job.refreshInterval,
    job.error, job.createdAt, job.updatedAt, JSON.stringify(job.blockedDomains || []),
    JSON.stringify(job.proposedSchema || job.schema), job.schemaConfirmedAt || null, job.combineSources ? 1 : 0);
}
export function saveApiJobProgress(job: ApiJob): void {
  const result = database().prepare(`UPDATE api_jobs SET status = ?, error = ?, updated_at = ?,
    sources_json = ?, blocked_domains_json = ? WHERE id = ?`)
    .run(job.status, job.error, job.updatedAt, JSON.stringify(job.sources), JSON.stringify(job.blockedDomains || []), job.id);
  if (!result.changes) throw new Error("API job was deleted while a run was in progress.");
}

export function listApiJobRuns(jobId: string): RunSummary[] {
  return (database().prepare("SELECT * FROM api_job_runs WHERE job_id = ? ORDER BY started_at DESC, rowid DESC").all(jobId) as RunRow[]).map(mapRun);
}

export function enqueueApiRun(jobId: string, trigger: "manual" | "scheduled" = "manual"): ApiJob {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const job = db.prepare("SELECT * FROM api_jobs WHERE id = ?").get(jobId) as ApiJobRow | undefined;
    if (!job) throw new Error("API job not found.");
    if (!job.schema_confirmed_at || job.schema_json === "{}") throw new Error("Confirm fields before running.");
    const active = db.prepare("SELECT id FROM api_job_runs WHERE job_id = ? AND outcome IN ('queued', 'running') LIMIT 1").get(jobId);
    if (active) throw new Error("This API already has a queued or running job.");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO api_job_runs (id, job_id, started_at, finished_at, search_calls, scrape_calls, recovery_calls,
      consecutive_failures, total_failures, saved_records, skipped_sources, outcome, stop_reason, trigger)
      VALUES (?, ?, ?, NULL, 0, 0, 0, 0, 0, 0, 0, 'queued', NULL, ?)`).run(crypto.randomUUID(), jobId, now, trigger);
    db.prepare("UPDATE api_jobs SET status = 'queued', error = NULL, updated_at = ? WHERE id = ?").run(now, jobId);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getApiJob(jobId)!;
}

export function requestRunCancellation(jobId: string): ApiJob {
  const db = database();
  const run = getLatestRun(jobId);
  if (!run || !["queued", "running"].includes(run.outcome)) throw new Error("No active run to cancel.");
  db.prepare("UPDATE api_job_runs SET cancel_requested = 1 WHERE id = ?").run(run.id);
  if (run.outcome === "queued") {
    const now = new Date().toISOString();
    db.prepare("UPDATE api_job_runs SET outcome = 'cancelled', finished_at = ?, stop_reason = 'Cancelled before starting.' WHERE id = ?").run(now, run.id);
    const count = countApiRecords(jobId);
    db.prepare("UPDATE api_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(count ? "partial" : "planned", "Run cancelled.", now, jobId);
  }
  return getApiJob(jobId)!;
}

export function isRunCancelled(runId: string): boolean {
  const row = database().prepare("SELECT cancel_requested FROM api_job_runs WHERE id = ?").get(runId) as { cancel_requested: number } | undefined;
  return !row || Boolean(row.cancel_requested);
}

export function claimNextRun(): { id: string; jobId: string; trigger: "manual" | "scheduled" } | null {
  const db = database();
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(`SELECT id, job_id, trigger FROM api_job_runs WHERE outcome = 'queued' OR
      (outcome = 'running' AND lease_until < ?) ORDER BY started_at LIMIT 1`).get(now) as
      { id: string; job_id: string; trigger: "manual" | "scheduled" } | undefined;
    if (!row) { db.exec("COMMIT"); return null; }
    const lease = new Date(Date.now() + 6 * 60_000).toISOString();
    db.prepare("UPDATE api_job_runs SET outcome = 'running', lease_until = ? WHERE id = ?").run(lease, row.id);
    db.exec("COMMIT");
    return { id: row.id, jobId: row.job_id, trigger: row.trigger };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function enqueueDueRefreshes(): number {
  const db = database();
  const rows = db.prepare(`SELECT id FROM api_jobs WHERE refresh_interval IS NOT NULL AND refresh_paused = 0
    AND schema_confirmed_at IS NOT NULL AND next_refresh_at <= ? AND status NOT IN ('planning', 'awaiting_fields', 'queued', 'discovering', 'scraping', 'extracting', 'storing')
    AND NOT EXISTS (SELECT 1 FROM api_job_runs WHERE job_id = api_jobs.id AND outcome IN ('queued', 'running'))`).all(new Date().toISOString()) as Array<{ id: string }>;
  let queued = 0;
  for (const row of rows) { try { enqueueApiRun(row.id, "scheduled"); queued++; } catch { /* another worker claimed it */ } }
  return queued;
}

export function finishRefreshSchedule(jobId: string, trigger: "manual" | "scheduled", outcome: RunOutcome, savedRecords = 0): void {
  const db = database();
  const job = getApiJob(jobId);
  if (!job) return;
  const failures = trigger === "scheduled" ? (outcome !== "cancelled" && savedRecords === 0
    ? (job.refreshFailures || 0) + 1 : 0) : job.refreshFailures || 0;
  const paused = failures >= 2;
  const next = job.refreshInterval && !paused ? new Date(Date.now() + job.refreshInterval * 60_000).toISOString() : null;
  db.prepare("UPDATE api_jobs SET next_refresh_at = ?, refresh_failures = ?, refresh_paused = ? WHERE id = ?")
    .run(next, failures, paused ? 1 : 0, jobId);
}
export function confirmApiJobFields(jobId: string, selectedFields: string[]): ApiJob {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM api_jobs WHERE id = ?").get(jobId) as ApiJobRow | undefined;
    if (!row) throw new Error("API job not found.");
    if (row.status !== "awaiting_fields" || row.schema_confirmed_at) {
      throw new Error("Field selection is closed for this job.");
    }
    const recordCount = db.prepare("SELECT COUNT(*) AS count FROM api_records WHERE job_id = ?").get(jobId) as { count: number };
    if (recordCount.count) throw new Error("Fields cannot change after records have been saved.");
    const proposal = JSON.parse(row.proposed_schema_json) as ApiRecordSchema;
    const schema = selectProposedFields(proposal, selectedFields);
    const now = new Date().toISOString();
    const next = row.refresh_interval ? new Date(Date.now() + row.refresh_interval * 60_000).toISOString() : null;
    db.prepare("UPDATE api_jobs SET schema_json = ?, schema_confirmed_at = ?, status = 'planned', error = NULL, updated_at = ?, next_refresh_at = ? WHERE id = ?")
      .run(JSON.stringify(schema), now, now, next, jobId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const job = getApiJob(jobId);
  if (!job) throw new Error("API job not found.");
  return job;
}
type ApiRecordRow = { id: string; job_id: string; source_url: string; data_json: string; extracted_at: string;
  source_urls_json: string | null; field_sources_json: string | null };
export function countApiRecords(jobId: string): number {
  const row = database().prepare("SELECT COUNT(*) AS count FROM api_records WHERE job_id = ?").get(jobId) as { count: number };
  return row.count;
}
export function listApiRecords(jobId: string): ApiRecord[] {
  const rows = database().prepare("SELECT * FROM api_records WHERE job_id = ? ORDER BY extracted_at DESC, source_url ASC").all(jobId) as ApiRecordRow[];
  return rows.map((row) => ({
    id: row.id, jobId: row.job_id, sourceUrl: row.source_url,
    data: JSON.parse(row.data_json) as ApiRecordData, extractedAt: row.extracted_at,
    sourceUrls: row.source_urls_json ? JSON.parse(row.source_urls_json) as string[] : [row.source_url],
    fieldSources: row.field_sources_json ? JSON.parse(row.field_sources_json) as Record<string, string> : undefined,
  }));
}
export function saveApiRecords(jobId: string, records: ApiRecord[]): void {
  const db = database();
  const statement = db.prepare(`
    INSERT INTO api_records (id, job_id, source_url, data_json, extracted_at, source_urls_json, field_sources_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id, source_url) DO UPDATE SET
      data_json = excluded.data_json, extracted_at = excluded.extracted_at,
      source_urls_json = excluded.source_urls_json, field_sources_json = excluded.field_sources_json
  `);
  db.exec("BEGIN");
  try {
    for (const record of records) {
      if (record.jobId !== jobId) throw new Error("Record belongs to a different job.");
      statement.run(record.id, jobId, record.sourceUrl, JSON.stringify(record.data), record.extractedAt,
        JSON.stringify(record.sourceUrls || [record.sourceUrl]), JSON.stringify(record.fieldSources || {}));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Combined jobs expose exactly one current record, even when the primary URL changes on refresh. */
export function saveCombinedApiRecord(jobId: string, record: ApiRecord): void {
  if (record.jobId !== jobId) throw new Error("Record belongs to a different job.");
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM api_records WHERE job_id = ?").run(jobId);
    db.prepare(`INSERT INTO api_records (id, job_id, source_url, data_json, extracted_at, source_urls_json, field_sources_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(record.id, jobId, record.sourceUrl, JSON.stringify(record.data), record.extractedAt,
      JSON.stringify(record.sourceUrls || [record.sourceUrl]), JSON.stringify(record.fieldSources || {}));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

const activeStatuses = ["planning", "queued", "discovering", "scraping", "extracting", "storing"];
const activeSql = activeStatuses.map(() => "?").join(", ");

export function updateApiJobSettings(jobId: string, input: { name?: string; refreshInterval?: number | null }): ApiJob {
  const job = getApiJob(jobId);
  if (!job) throw new Error("API job not found.");
  const now = new Date().toISOString();
  const interval = input.refreshInterval === undefined ? job.refreshInterval : input.refreshInterval;
  const next = interval ? new Date(Date.now() + interval * 60_000).toISOString() : null;
  const result = database().prepare(`UPDATE api_jobs SET name = ?, refresh_interval = ?, next_refresh_at = ?, refresh_paused = 0, refresh_failures = 0, updated_at = ?
    WHERE id = ? AND status NOT IN (${activeSql})`)
    .run(input.name ?? job.name, interval, next, now, jobId, ...activeStatuses);
  if (!result.changes) throw new Error("This API is running. Wait for the run to finish before changing settings.");
  const updated = getApiJob(jobId);
  if (!updated) throw new Error("API job not found.");
  return updated;
}

export function deleteApiJob(jobId: string): boolean {
  const result = database().prepare(`DELETE FROM api_jobs WHERE id = ? AND status NOT IN (${activeSql})`)
    .run(jobId, ...activeStatuses);
  if (result.changes) return true;
  if (getApiJob(jobId)) throw new Error("This API is running. Wait for the run to finish before deleting it.");
  return false;
}
