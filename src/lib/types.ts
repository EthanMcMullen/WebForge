export const apiJobStatuses = ["planning", "planned", "discovering", "scraping", "extracting", "storing", "ready", "failed"] as const;
export type ApiJobStatus = (typeof apiJobStatuses)[number];
export type ApiFieldType = "string" | "number" | "integer" | "boolean";
export type SourceStrategyType = "automatic" | "provided_urls";
export interface ApiFieldSchema { type: ApiFieldType; description?: string; }
export type ApiRecordSchema = Record<string, ApiFieldSchema>;
export interface SourceStrategy { type: SourceStrategyType; searchQueries: string[]; }
export interface ApiJob {
  id: string; name: string; userRequest: string; status: ApiJobStatus;
  schema: ApiRecordSchema; sourceStrategy: SourceStrategy; sources: string[];
  refreshInterval: number | null; error: string | null; createdAt: string; updatedAt: string;
}
export interface ApiJobResponse {
  id: string; name: string; user_request: string; status: ApiJobStatus;
  schema: ApiRecordSchema; source_strategy: { type: SourceStrategyType; search_queries: string[] };
  sources: string[]; refresh_interval: number | null; error: string | null;
  created_at: string; updated_at: string;
}
export interface ApiPlan { name: string; schema: ApiRecordSchema; searchQueries: string[]; }
export type ApiRecordData = Record<string, string | number | boolean | null>;
export interface ApiRecord {
  id: string; jobId: string; sourceUrl: string; data: ApiRecordData; extractedAt: string;
}
export function toApiJobResponse(job: ApiJob): ApiJobResponse {
  return {
    id: job.id, name: job.name, user_request: job.userRequest, status: job.status,
    schema: job.schema,
    source_strategy: { type: job.sourceStrategy.type, search_queries: job.sourceStrategy.searchQueries },
    sources: job.sources, refresh_interval: job.refreshInterval, error: job.error,
    created_at: job.createdAt, updated_at: job.updatedAt,
  };
}
export function toApiRecordResponse(record: ApiRecord) {
  return { id: record.id, job_id: record.jobId, source_url: record.sourceUrl,
    data: record.data, extracted_at: record.extractedAt };
}