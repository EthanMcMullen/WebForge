import "server-only";

import { planApiJob } from "./planner";
import { saveApiJob } from "./store";
import { cleanSourceUrls, type CreateApiJobData } from "./validation";
import type { ApiJob } from "./types";

export async function createApiJob(input: CreateApiJobData): Promise<ApiJob> {
  const now = new Date().toISOString();
  const sources = cleanSourceUrls(input.sources);
  if (sources.length !== input.sources.length) {
    throw new Error("Use unique, public HTTP(S) source URLs without credentials or local addresses.");
  }

  const job: ApiJob = {
    id: crypto.randomUUID(),
    name: input.name || "Planning API job",
    userRequest: input.user_request,
    status: "planning",
    schema: {},
    sourceStrategy: {
      type: input.source_strategy.type,
      searchQueries: input.source_strategy.search_queries,
    },
    sources,
    refreshInterval: input.refresh_interval,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  saveApiJob(job);

  try {
    const plan = await planApiJob(job.userRequest); 
    job.name = input.name || plan.name;
    job.schema = plan.schema;
    if (job.sourceStrategy.type === "automatic") {
      job.sourceStrategy.searchQueries = plan.searchQueries;
    }
    job.status = "ready";
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Planning failed.";
  }

  job.updatedAt = new Date().toISOString();
  saveApiJob(job);
  return job;
}
