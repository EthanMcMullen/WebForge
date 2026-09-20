export const apiJobStatuses = ["planning", "awaiting_fields", "planned", "queued", "discovering", "scraping", "extracting", "storing", "ready", "partial", "failed"] as const;
export type ApiJobStatus = (typeof apiJobStatuses)[number];
export type ApiFieldType = "string" | "number" | "integer" | "boolean";
export type SourceStrategyType = "automatic" | "provided_urls";
export type SearchDepth = "focused" | "balanced" | "deep";
export type SourceFailureCode = "UNSUPPORTED_SITE" | "ACCESS_BLOCKED" | "NO_STRUCTURED_JSON" | "SCHEMA_MISMATCH" | "IRRELEVANT_RECORD" | "SOURCE_HTTP_ERROR" | "RATE_LIMITED" | "CONFIG_OR_BILLING" | "UNVERIFIED_PRICE" | "MISSING_REQUIRED_FIELD" | "SOURCE_IDENTITY_MISMATCH" | "TRANSIENT";
export type RunOutcome = "queued" | "running" | "ready" | "partial_stopped" | "failed" | "cancelled";
export interface SourceCandidate { url: string; title?: string; description?: string; parentUrl?: string; }
export interface SourceAttempt {
  url: string; query: string | null; stage: "candidate_filter" | "source_review" | "scrape" | "quality_check" | "record_review" | "save";
  code: SourceFailureCode | "FILTERED" | "REJECTED" | "BUDGET" | "SAVED";
  title?: string; fieldsPresent?: string[]; fieldsMissing?: string[];
}
export interface RunSummary {
  id: string; jobId: string; startedAt: string; finishedAt: string | null;
  searchCalls: number; scrapeCalls: number; recoveryCalls: number;
  consecutiveFailures: number; totalFailures: number; savedRecords: number;
  skippedSources: number; identifiedItems?: number; outcome: RunOutcome; stopReason: string | null;
  trigger?: "manual" | "scheduled"; cancelRequested?: boolean; attempts?: SourceAttempt[];
}
export interface ApiFieldSchema { type: ApiFieldType; description?: string; }
export type ApiRecordSchema = Record<string, ApiFieldSchema>;
export interface SourceStrategy { type: SourceStrategyType; searchQueries: string[]; }
export interface ApiJob {
  id: string; name: string; userRequest: string; status: ApiJobStatus;
  schema: ApiRecordSchema; sourceStrategy: SourceStrategy; sources: string[]; combineSources?: boolean; recordScope?: "single" | "collection";
  searchDepth: SearchDepth;
  refreshInterval: number | null; error: string | null; createdAt: string; updatedAt: string; recordCount?: number;
  blockedDomains?: string[]; runSummary?: RunSummary | null;
  nextRefreshAt?: string | null; refreshFailures?: number; refreshPaused?: boolean;
  proposedSchema?: ApiRecordSchema; schemaConfirmedAt?: string | null;
}
export interface ApiJobResponse {
  id: string; name: string; user_request: string; status: ApiJobStatus;
  schema: ApiRecordSchema; source_strategy: { type: SourceStrategyType; search_queries: string[] };
  sources: string[]; combine_sources: boolean; record_scope: "single" | "collection"; search_depth: SearchDepth; refresh_interval: number | null; error: string | null; record_count: number;
  created_at: string; updated_at: string;
  proposed_schema: ApiRecordSchema; schema_confirmed_at: string | null;
  next_refresh_at: string | null; refresh_failures: number; refresh_paused: boolean;
  run_summary: {
    search_calls: number; scrape_calls: number; recovery_calls: number;
    saved_records: number; skipped_sources: number; identified_items: number | null; outcome: RunOutcome; stop_reason: string | null;
    started_at: string; finished_at: string | null; id: string; trigger: "manual" | "scheduled"; cancel_requested: boolean; attempts: SourceAttempt[];
  } | null;
}
export interface ApiPlan { name: string; schema: ApiRecordSchema; searchQueries: string[]; combineSources: boolean; recordScope: "single" | "collection"; }
export type ApiRecordData = Record<string, string | number | boolean | null>;
export interface ApiRecord {
  id: string; jobId: string; sourceUrl: string; data: ApiRecordData; extractedAt: string;
  sourceUrls?: string[]; fieldSources?: Record<string, string>; itemKey?: string | null;
}
export function toApiJobResponse(job: ApiJob): ApiJobResponse {
  const run = job.runSummary;
  return {
    id: job.id, name: job.name, user_request: job.userRequest, status: job.status,
    schema: job.schema,
    source_strategy: { type: job.sourceStrategy.type, search_queries: job.sourceStrategy.searchQueries },
    sources: job.sources, combine_sources: Boolean(job.combineSources), record_scope: job.recordScope || "single", search_depth: job.searchDepth,
    refresh_interval: job.refreshInterval, error: job.error, record_count: job.recordCount ?? 0,
    created_at: job.createdAt, updated_at: job.updatedAt,
    proposed_schema: job.status === "awaiting_fields" ? (job.proposedSchema || {}) : {},
    schema_confirmed_at: job.schemaConfirmedAt || null,
    next_refresh_at: job.nextRefreshAt || null, refresh_failures: job.refreshFailures || 0, refresh_paused: job.refreshPaused || false,
    run_summary: run ? {
      search_calls: run.searchCalls, scrape_calls: run.scrapeCalls, recovery_calls: run.recoveryCalls,
      saved_records: run.savedRecords, skipped_sources: run.skippedSources, identified_items: run.identifiedItems ?? null,
      outcome: run.outcome, stop_reason: run.stopReason,
      started_at: run.startedAt, finished_at: run.finishedAt, id: run.id,
      trigger: run.trigger || "manual", cancel_requested: run.cancelRequested || false, attempts: run.attempts || [],
    } : null,
  };
}
export function toApiRecordResponse(record: ApiRecord) {
  const fieldSources = record.fieldSources && Object.keys(record.fieldSources).length ? record.fieldSources : Object.fromEntries(
    Object.entries(record.data).filter(([key, value]) => key !== "source_url" && value !== null).map(([key]) => [key, record.sourceUrl]));
  return { id: record.id, job_id: record.jobId, source_url: record.sourceUrl,
    source_urls: record.sourceUrls || [record.sourceUrl], field_sources: fieldSources,
    data: record.data, extracted_at: record.extractedAt };
}
