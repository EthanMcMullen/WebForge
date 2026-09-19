import "server-only";
import { planApiJob } from "./planner";
import { countApiRecords, getApiJob, saveApiJob, saveApiRecords, saveRunSummary } from "./store";
import { cleanSourceUrls, type CreateApiJobData } from "./validation";
import type { ApiJob, ApiRecord, RunSummary, SourceCandidate, SourceFailureCode } from "./types";
import { firecrawlProvider, type ExtractionProvider } from "./providers/firecrawl";
import { DEFAULT_BLOCKED_DOMAINS, classifySourceError, domainOf, filterCandidates, isBlockedDomain, isFatalFailure } from "./source-support";
import { RUN_LIMITS, canRecover, canSearch, withinDeadline } from "./run-budget";
import { recoverSearchQuery, validateRecoveryDecision, type RecoveryInput, type RecoveryDecision } from "./source-recovery";

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
  saveApiJob(job);
}
function failureDescription(url: string, code: SourceFailureCode): string {
  return `${url}: ${code.replaceAll("_", " ").toLowerCase()}`;
}
export async function runApiJob(
  id: string,
  provider: ExtractionProvider = firecrawlProvider,
  recovery: (input: RecoveryInput) => Promise<RecoveryDecision> = recoverSearchQuery,
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
  const queue: SourceCandidate[] = [];
  const seen = new Set<string>();
  const queries: string[] = [];
  const failures: Array<{ domain: string; code: SourceFailureCode }> = [];
  const errors: string[] = [];
  let searchIssue = false;
  let stopReason: string | null = null;
  const automatic = job.sourceStrategy.type === "automatic";

  const search = async (query: string) => {
    if (!canSearch(summary.searchCalls, startMs)) {
      stopReason = "Stopped at the search or time limit.";
      return;
    }
    summary.searchCalls++;
    queries.push(query);
    setStatus(job, "discovering");
    try {
      const results = await provider.discover(query, { excludedDomains: [...blocked], limit: 5 });
      const available = RUN_LIMITS.candidates - seen.size;
      const next = filterCandidates(results, [...blocked], seen, available);
      summary.skippedSources += results.length - next.length;
      queue.push(...next);
      if (!next.length) searchIssue = true;
    } catch (error) {
      const code = classifySourceError(error);
      if (isFatalFailure(code)) {
        stopReason = `Firecrawl search stopped: ${code.replaceAll("_", " ").toLowerCase()}.`;
        throw new Error(stopReason);
      }
      searchIssue = true;
    }
  };

  try {
    if (automatic) {
      const query = job.sourceStrategy.searchQueries[0];
      if (query) await search(query);
      else searchIssue = true;
    } else {
      for (const url of job.sources.slice(0, RUN_LIMITS.candidates)) {
        if (!seen.has(url)) { seen.add(url); queue.push({ url }); }
      }
    }
    if (automatic && queue.length) job.sources = queue.map((candidate) => candidate.url);

    while (!stopReason && withinDeadline(startMs)) {
      if (summary.consecutiveFailures >= RUN_LIMITS.consecutiveFailures || summary.totalFailures >= RUN_LIMITS.totalFailures) {
        stopReason = "Stopped after three source failures in this run.";
        break;
      }
      if (summary.scrapeCalls >= RUN_LIMITS.scrapes) {
        stopReason = queue.length ? "Stopped at the three-scrape per-run limit." : null;
        break;
      }
      const candidate = queue.shift();
      if (candidate) {
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
          const data = await provider.extract(candidate.url, job.schema);
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
          summary.consecutiveFailures = 0;
        } catch (error) {
          const code = classifySourceError(error);
          summary.totalFailures++;
          summary.consecutiveFailures++;
          summary.skippedSources++;
          failures.push({ domain: host || "unknown", code });
          errors.push(failureDescription(candidate.url, code));
          if (code === "UNSUPPORTED_SITE" && host) {
            blocked.add(host);
            job.blockedDomains = [...new Set([...(job.blockedDomains || []), host])];
            saveApiJob(job);
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
      await search(safe.query);
      if (queue.length) job.sources = [...new Set([...job.sources, ...queue.map((item) => item.url)])].slice(0, RUN_LIMITS.candidates);
      if (!queue.length && !stopReason) stopReason = "Recovery search found no usable public pages.";
    }

    if (!stopReason && !withinDeadline(startMs)) stopReason = "Stopped at the 90-second run limit.";
    if (!stopReason && summary.savedRecords === 0 && summary.totalFailures) stopReason = "No usable records were extracted.";
    if (!stopReason && summary.savedRecords === 0 && automatic) stopReason = "No public source pages were found.";
  } catch (error) {
    stopReason = error instanceof Error ? error.message : "Run failed.";
  } finally {
    const existingCount = countApiRecords(job.id);
    const hasRecords = existingCount > 0;
    summary.finishedAt = new Date().toISOString();
    const expectedCap = stopReason === "Stopped at the three-scrape per-run limit." &&
      summary.savedRecords > 0 && errors.length === 0;
    summary.outcome = hasRecords ? (stopReason && !expectedCap || errors.length ? "partial_stopped" : "ready") : "failed";
    summary.stopReason = stopReason || (errors.length ? `${errors.length} source(s) skipped or failed.` : null);
    const warning = [expectedCap ? null : summary.stopReason, ...errors.slice(0, 3)].filter(Boolean).join(" ");
    setStatus(job, hasRecords ? "ready" : "failed", warning || (hasRecords ? null : "No usable records were extracted."));
    saveRunSummary(summary);
    job.runSummary = summary;
    runningJobs.delete(id);
  }
  return job;
}
