import "server-only";
import { planApiJob } from "./planner";
import { getApiJob, saveApiJob, saveApiRecords } from "./store";
import { cleanSourceUrls, type CreateApiJobData } from "./validation";
import type { ApiJob, ApiRecord } from "./types";
import { firecrawlProvider, type ExtractionProvider } from "./providers/firecrawl";

export async function createApiJob(input: CreateApiJobData): Promise<ApiJob> {
  const now = new Date().toISOString();
  const sources = cleanSourceUrls(input.sources);
  if (sources.length !== input.sources.length) {
    throw new Error("Use unique, public HTTP(S) source URLs without credentials or local addresses.");
  }
  const job: ApiJob = {
    id: crypto.randomUUID(), name: input.name || "Planning API job", userRequest: input.user_request,
    status: "planning", schema: {},
    sourceStrategy: { type: input.source_strategy.type, searchQueries: input.source_strategy.search_queries },
    sources, refreshInterval: input.refresh_interval, error: null, createdAt: now, updatedAt: now,
  };
  saveApiJob(job);
  try {
    const plan = await planApiJob(job.userRequest);
    job.name = input.name || plan.name;
    job.schema = plan.schema;
    if (job.sourceStrategy.type === "automatic") job.sourceStrategy.searchQueries = plan.searchQueries;
    job.status = "planned";
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Planning failed.";
  }
  job.updatedAt = new Date().toISOString();
  saveApiJob(job);
  return job;
}

const runningJobs = new Set<string>();
function setStatus(job: ApiJob, status: ApiJob["status"], error: string | null = null) {
  job.status = status;
  job.error = error;
  job.updatedAt = new Date().toISOString();
  saveApiJob(job);
}
export async function runApiJob(id: string, provider: ExtractionProvider = firecrawlProvider): Promise<ApiJob> {
  const job = getApiJob(id);
  if (!job) throw new Error("API job not found.");
  if (!Object.keys(job.schema).length) throw new Error("This job has no planned schema.");
  if (runningJobs.has(id)) throw new Error("This job is already running.");
  runningJobs.add(id);
  try {
    let sources = job.sources;
    if (job.sourceStrategy.type === "automatic") {
      setStatus(job, "discovering");
      sources = cleanSourceUrls(await provider.discover(job.sourceStrategy.searchQueries));
      if (!sources.length) throw new Error("Firecrawl found no public source URLs for this request.");
      job.sources = sources;
    }
    if (!sources.length) throw new Error("No source URLs are available for this job.");
    const records: ApiRecord[] = [];
    const errors: string[] = [];
    for (const sourceUrl of sources.slice(0, 5)) {
      try {
        setStatus(job, "scraping");
        setStatus(job, "extracting");
        const data = await provider.extract(sourceUrl, job.schema);
        records.push({ id: crypto.randomUUID(), jobId: job.id, sourceUrl, data,
          extractedAt: new Date().toISOString() });
      } catch (error) {
        errors.push(`${sourceUrl}: ${error instanceof Error ? error.message : "Extraction failed."}`);
      }
    }
    if (!records.length) throw new Error(errors.join(" | ") || "No records were extracted.");
    setStatus(job, "storing");
    saveApiRecords(job.id, records);
    setStatus(job, "ready", errors.length ? `${errors.length} source(s) failed; prior records were kept where available. ${errors.join(" | ")}` : null);
  } catch (error) {
    setStatus(job, "failed", error instanceof Error ? error.message : "The run failed.");
  } finally {
    runningJobs.delete(id);
  }
  return job;
}