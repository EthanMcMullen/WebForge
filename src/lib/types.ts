export const apiJobStatuses = ["planning", "planned", "discovering", "scraping", "extracting", "storing", "ready", "failed"] as const;
export type ApiJobStatus = (typeof apiJobStatuses)[number];
export type ApiFieldType = "string" | "number" | "integer" | "boolean";
export type SourceStrategyType = "automatic" | "provided_urls";
export type SourceFailureCode = "UNSUPPORTED_SITE" | "ACCESS_BLOCKED" | "NO_STRUCTURED_JSON" | "SCHEMA_MISMATCH" | "SOURCE_HTTP_ERROR" | "RATE_LIMITED" | "CONFIG_OR_BILLING" | "TRANSIENT";
export type RunOutcome = "ready" | "partial_stopped" | "failed";
export interface SourceCandidate { url: string; title?: string; description?: string; }
export interface RunSummary {
  id: string; jobId: string; startedAt: string; finishedAt: string | null;
  searchCalls: number; scrapeCalls: number; recoveryCalls: number;
  consecutiveFailures: number; totalFailures: number; savedRecords: number;
  skippedSources: number; outcome: RunOutcome; stopReason: string | null;
}
export interface ApiFieldSchema { type: ApiFieldType; description?: string; }
export type ApiRecordSchema = Record<string, ApiFieldSchema>;
export interface SourceStrategy { type: SourceStrategyType; searchQueries: string[]; }
export interface ApiJob {
  id: string; name: string; userRequest: string; status: ApiJobStatus;
  schema: ApiRecordSchema; sourceStrategy: SourceStrategy; sources: string[];
  refreshInterval: number | null; error: string | null; createdAt: string; updatedAt: string;
  blockedDomains?: string[]; runSummary?: RunSummary | null;
}
export interface ApiJobResponse {
  id: string; name: string; user_request: string; status: ApiJobStatus;
  schema: ApiRecordSchema; source_strategy: { type: SourceStrategyType; search_queries: string[] };
  sources: string[]; refresh_interval: number | null; error: string | null;
  created_at: string; updated_at: string; run_summary: {
    search_calls: number; scrape_calls: number; recovery_calls: number;
    saved_records: number; skipped_sources: number; outcome: RunOutcome; stop_reason: string | null;
    started_at: string; finished_at: string | null;
  } | null;
}
export interface ApiPlan { name: string; schema: ApiRecordSchema; searchQueries: string[]; }
export type ApiRecordData = Record<string, string | number | boolean | null>;
export interface ApiRecord {
  id: string; jobId: string; sourceUrl: string; data: ApiRecordData; extractedAt: string;
}
export function toApiJobResponse(job: ApiJob): ApiJobResponse {
  const run = job.runSummary;
  return {
    id: job.id, name: job.name, user_request: job.userRequest, status: job.status,
    schema: job.schema,
    source_strategy: { type: job.sourceStrategy.type, search_queries: job.sourceStrategy.searchQueries },
    sources: job.sources, refresh_interval: job.refreshInterval, error: job.error,
    created_at: job.createdAt, updated_at: job.updatedAt,
    run_summary: run ? {
      search_calls: run.searchCalls, scrape_calls: run.scrapeCalls, recovery_calls: run.recoveryCalls,
      saved_records: run.savedRecords, skipped_sources: run.skippedSources,
      outcome: run.outcome, stop_reason: run.stopReason,
      started_at: run.startedAt, finished_at: run.finishedAt,
    } : null,
  };
}
export function toApiRecordResponse(record: ApiRecord) {
  return { id: record.id, job_id: record.jobId, source_url: record.sourceUrl,
    data: record.data, extracted_at: record.extractedAt };
}
