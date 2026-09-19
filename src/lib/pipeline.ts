import "server-only";
import { planApiJob } from "./planner";
import { countApiRecords, getApiJob, saveApiJob, saveApiJobProgress, saveApiRecords, saveRunSummary } from "./store";
import { cleanSourceUrls, type CreateApiJobData } from "./validation";
import type { ApiJob, ApiRecord, RunSummary, SourceCandidate, SourceFailureCode } from "./types";
import { firecrawlProvider, type ExtractionProvider } from "./providers/firecrawl";
import { DEFAULT_BLOCKED_DOMAINS, classifySourceError, domainOf, filterCandidates, isBlockedDomain, isFatalFailure } from "./source-support";
import { RUN_LIMITS, canRecover, canSearch, plannedSearchQueries, withinDeadline } from "./run-budget";
import { recoverSearchQuery, validateRecoveryDecision, type RecoveryInput, type RecoveryDecision } from "./source-recovery";
import { reviewSourceCandidates } from "./source-review";
import { presentRunResult } from "./run-presentation";
import { missingPlannedQueries, prioritizeSearchBatches, type PlannedCandidate, type SearchBatch } from "./discovery-plan";

export async function createApiJob(input: CreateApiJobData): Promise<ApiJob> {
  const now = new Date().toISOString();
  const sources = cleanSourceUrls(input.sources);
  if (sources.length !== input.sources.length) {
    throw new Error("Use unique, public HTTP(S) source URLs without credentials or local addresses.");
  }
  const job: ApiJob = {
    id: crypto.randomUUID(), name: input.name || "Planning API job", userRequest: input.user_request,
    status: "planning", schema: {}, proposedSchema: {}, schemaConfirmedAt: null,
    sourceStrategy: { type: input.source_strategy.type, searchQueries: input.source_strategy.search_queries },
    sources, refreshInterval: input.refresh_interval, error: null, createdAt: now, updatedAt: now,
    blockedDomains: [],
  };
  saveApiJob(job);
  try {
    const plan = await planApiJob(job.userRequest);
    job.name = input.name || plan.name;
    job.proposedSchema = plan.schema;
    if (job.sourceStrategy.type === "automatic") job.sourceStrategy.searchQueries = plan.searchQueries;
    job.status = "awaiting_fields";
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
  saveApiJobProgress(job);
}
function failureDescription(url: string, code: SourceFailureCode): string {
  return `${url}: ${code.replaceAll("_", " ").toLowerCase()}`;
}
export async function runApiJob(
  id: string,
  provider: ExtractionProvider = firecrawlProvider,
  recovery: (input: RecoveryInput) => Promise<RecoveryDecision> = recoverSearchQuery,
  reviewSources: (request: string, candidates: SourceCandidate[], query?: string) => Promise<SourceCandidate[]> = reviewSourceCandidates,
): Promise<ApiJob> {
  const job = getApiJob(id);
  if (!job) throw new Error("API job not found.");
  if (!job.schemaConfirmedAt) throw new Error("Confirm the proposed fields before running Firecrawl.");
  if (!Object.keys(job.schema).length) throw new Error("This job has no confirmed schema.");
  if (runningJobs.has(id)) throw new Error("This job is already running.");
  runningJobs.add(id);
  const startMs = Date.now();
  const summary: RunSummary = {
    id: crypto.randomUUID(), jobId: id, startedAt: new Date(startMs).toISOString(), finishedAt: null,
    searchCalls: 0, scrapeCalls: 0, recoveryCalls: 0, consecutiveFailures: 0,
    totalFailures: 0, savedRecords: 0, skippedSources: 0, outcome: "failed", stopReason: null,
  };
  const blocked = new Set([...DEFAULT_BLOCKED_DOMAINS, ...(job.blockedDomains || [])]);
  const queue: PlannedCandidate[] = [];
  const planned = job.sourceStrategy.type === "automatic" ? plannedSearchQueries(job.sourceStrategy.searchQueries) : [];
  const completedQueries = new Set<string>();
  const seen = new Set<string>();
  const queries: string[] = [];
  const failures: Array<{ domain: string; code: SourceFailureCode }> = [];
  const errors: string[] = [];
  let searchIssue = false;
  let stopReason: string | null = null;
  const automatic = job.sourceStrategy.type === "automatic";

  const search = async (query: string): Promise<SourceCandidate[]> => {
    if (!canSearch(summary.searchCalls, startMs)) {
      stopReason = "Stopped at the search or time limit.";
      return [];
    }
    summary.searchCalls++;
    queries.push(query);
    setStatus(job, "discovering");
    try {
      const results = await provider.discover(query, { excludedDomains: [...blocked], limit: 5 });
      const next = filterCandidates(results, [...blocked], new Set(seen), 5);
      let reviewed: SourceCandidate[];
      try {
        reviewed = await reviewSources(job.userRequest, next, query);
        const allowed = new Set(next.map((item) => item.url));
        if (new Set(reviewed.map((item) => item.url)).size !== reviewed.length ||
            reviewed.some((item) => !allowed.has(item.url))) {
          throw new Error("Source review selected an unknown or duplicate URL.");
        }
      } catch {
        stopReason = "Could not verify source relevance.";
        throw new Error(stopReason);
      }
      summary.skippedSources += Math.max(0, results.length - reviewed.length);
      for (const candidate of reviewed) seen.add(candidate.url);
      if (!reviewed.length) searchIssue = true;
      return reviewed;
    } catch (error) {
      if (stopReason === "Could not verify source relevance.") throw error;
      const code = classifySourceError(error);
      if (isFatalFailure(code)) {
        stopReason = `Firecrawl search stopped: ${code.replaceAll("_", " ").toLowerCase()}.`;
        throw new Error(stopReason);
      }
      searchIssue = true;
      return [];
    }
  };

  try {
    if (automatic) {
      const batches: SearchBatch[] = [];
      if (!planned.length) searchIssue = true;
      for (const query of planned) {
        batches.push({ query, candidates: await search(query) });
        if (stopReason) break;
      }
      queue.push(...prioritizeSearchBatches(batches, RUN_LIMITS.candidates));
      summary.skippedSources += Math.max(0, batches.reduce((sum, batch) => sum + batch.candidates.length, 0) - queue.length);
    } else {
      for (const url of job.sources.slice(0, RUN_LIMITS.candidates)) {
        if (!seen.has(url)) { seen.add(url); queue.push({ url, plannedQuery: null }); }
      }
    }
    if (automatic && queue.length) job.sources = queue.map((candidate) => candidate.url);

    while (!stopReason && withinDeadline(startMs)) {
      if (automatic && planned.length > 1 && missingPlannedQueries(planned, completedQueries).length === 0) break;
      if (summary.consecutiveFailures >= RUN_LIMITS.consecutiveFailures || summary.totalFailures >= RUN_LIMITS.totalFailures) {
        stopReason = "Stopped after five source failures in this run.";
        break;
      }
      if (summary.scrapeCalls >= RUN_LIMITS.scrapes) {
        stopReason = queue.length ? `Stopped at the ${RUN_LIMITS.scrapes}-scrape per-run limit.` : null;
        break;
      }
      const candidate = queue.shift();
      if (candidate) {
        if (automatic && planned.length > 1 && candidate.plannedQuery && completedQueries.has(candidate.plannedQuery)) {
          summary.skippedSources++;
          continue;
        }
        const host = domainOf(candidate.url);
        if (host && isBlockedDomain(host, [...blocked])) {
          summary.skippedSources++;
          if (!automatic) errors.push(failureDescription(candidate.url, "UNSUPPORTED_SITE"));
          continue;
        }
        summary.scrapeCalls++;
        setStatus(job, "scraping");
        try {
          setStatus(job, "extracting");
          const data = await provider.extract(candidate.url, job.schema, candidate.title, job.userRequest);
          if (Object.entries(data).every(([key, value]) => key === "source_url" || value === null)) {
            throw new Error("Firecrawl returned no usable fields.");
          }
          const record: ApiRecord = {
            id: crypto.randomUUID(), jobId: job.id, sourceUrl: candidate.url, data,
            extractedAt: new Date().toISOString(),
          };
          setStatus(job, "storing");
          saveApiRecords(job.id, [record]);
          summary.savedRecords++;
          if (candidate.plannedQuery) completedQueries.add(candidate.plannedQuery);
          summary.consecutiveFailures = 0;
        } catch (error) {
          const code = classifySourceError(error);
          summary.totalFailures++;
          summary.consecutiveFailures++;
          summary.skippedSources++;
          failures.push({ domain: host || "unknown", code });
          const canTryListing = code === "UNVERIFIED_PRICE" && candidate.parentUrl && !seen.has(candidate.parentUrl);
          if (canTryListing && candidate.parentUrl) {
            seen.add(candidate.parentUrl);
            queue.unshift({ url: candidate.parentUrl, title: candidate.title, plannedQuery: candidate.plannedQuery });
            summary.skippedSources = Math.max(0, summary.skippedSources - 1);
            job.sources = [...new Set([...job.sources, candidate.parentUrl])].slice(0, RUN_LIMITS.candidates);
          } else {
            errors.push(failureDescription(candidate.url, code));
          }
          if (code === "UNSUPPORTED_SITE" && host) {
            blocked.add(host);
            job.blockedDomains = [...new Set([...(job.blockedDomains || []), host])];
            saveApiJobProgress(job);
          }
          if (isFatalFailure(code)) {
            stopReason = `Firecrawl stopped: ${code.replaceAll("_", " ").toLowerCase()}.`;
            break;
          }
        }
        continue;
      }

      if (!automatic || !(failures.length || searchIssue) ||
          !canRecover(summary.searchCalls, summary.scrapeCalls, summary.recoveryCalls,
            summary.savedRecords, summary.consecutiveFailures, summary.totalFailures, startMs)) break;
      summary.recoveryCalls++;
      let decision: RecoveryDecision = { action: "stop", query: null };
      try {
        decision = await recovery({
          userRequest: job.userRequest,
          priorQueries: queries,
          failureCodes: failures,
          excludedDomains: [...blocked],
          successfulRecordCount: summary.savedRecords,
        });
      } catch {
        stopReason = "Recovery decision failed.";
        break;
      }
      if (decision.action !== "search_again" || !decision.query) {
        stopReason = "Recovery found no better public source query.";
        break;
      }
      // Validate injected recovery providers too, not only the OpenAI implementation.
      const safe = validateRecoveryDecision(decision, {
        userRequest: job.userRequest, priorQueries: queries, failureCodes: failures,
        excludedDomains: [...blocked], successfulRecordCount: summary.savedRecords,
      });
      if (safe.action !== "search_again" || !safe.query) {
        stopReason = "Recovery returned an invalid query.";
        break;
      }
      const recovered = await search(safe.query);
      queue.push(...recovered.map((candidate) => ({ ...candidate, plannedQuery: planned.length === 1 ? planned[0] : null })));
      if (queue.length) job.sources = [...new Set([...job.sources, ...queue.map((item) => item.url)])].slice(0, RUN_LIMITS.candidates);
      if (!queue.length && !stopReason) stopReason = "Recovery search found no usable public pages.";
    }

    if (!stopReason && !withinDeadline(startMs)) stopReason = "Stopped at the four-minute run limit.";
    if (!stopReason && summary.savedRecords === 0 && summary.totalFailures) stopReason = "No usable records were extracted.";
    if (!stopReason && summary.savedRecords === 0 && automatic) stopReason = "No public source pages were found.";
    const missing = missingPlannedQueries(planned, completedQueries);
    if (automatic && summary.savedRecords > 0 && missing.length) {
      const coverage = `No record was updated for ${missing.length} of ${planned.length} planned searches: ${missing.map((query) => query.slice(0, 80)).join("; ")}.`;
      stopReason = stopReason ? `${stopReason} ${coverage}` : coverage;
    }
  } catch (error) {
    stopReason = error instanceof Error ? error.message : "Run failed.";
  } finally {
    const existingCount = countApiRecords(job.id);
    job.recordCount = existingCount;
    const hasRecords = existingCount > 0;
    summary.finishedAt = new Date().toISOString();
    const expectedCap = stopReason === `Stopped at the ${RUN_LIMITS.scrapes}-scrape per-run limit.` &&
      summary.savedRecords > 0 && errors.length === 0;
    const presentation = presentRunResult({
      automatic, hasRecords, savedRecords: summary.savedRecords, stopReason, errors, expectedCap,
    });
    summary.outcome = presentation.outcome;
    summary.stopReason = presentation.stopReason;
    setStatus(job, !hasRecords ? "failed" : presentation.outcome === "partial_stopped" ? "partial" : "ready",
      presentation.warning || (hasRecords ? null : "No usable records were extracted."));
    saveRunSummary(summary);
    job.runSummary = summary;
    runningJobs.delete(id);
  }
  return job;
}
