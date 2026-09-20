import "server-only";
import { planApiJob } from "./planner";
import { countApiRecords, finishRefreshSchedule, getApiJob, getLatestRun, isRunCancelled, listApiRecords, saveApiJob, saveApiJobProgress, saveApiRecords, saveCombinedApiRecord, saveRunSummary } from "./store";
import { cleanSourceUrls, type CreateApiJobData } from "./validation";
import type { ApiJob, ApiRecord, RunSummary, SourceAttempt, SourceCandidate, SourceFailureCode } from "./types";
import { firecrawlProvider, type ExtractionProvider } from "./providers/firecrawl";
import { withVisionFallback } from "./providers/vision";
import { DEFAULT_BLOCKED_DOMAINS, classifySourceError, domainOf, filterCandidates, isBlockedDomain, isFatalFailure } from "./source-support";
import { RUN_LIMITS, canRecover, canSearch, plannedSearchQueries, runLimitsForSearchDepth, withinDeadline } from "./run-budget";
import { recoverSearchQuery, validateRecoveryDecision, type RecoveryInput, type RecoveryDecision } from "./source-recovery";
import { reviewSourceCandidates } from "./source-review";
import { presentRunResult } from "./run-presentation";
import { missingPlannedQueries, prioritizeSearchBatches, type PlannedCandidate, type SearchBatch } from "./discovery-plan";
import { reviewExtractedRecord } from "./record-review";
import { suggestSourceCorrection, validateSourceSuggestion } from "./source-correction";
import { validateRecordQuality } from "./record-quality";
import { addCombinedSource, createCombinedRecord } from "./source-merge";

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
    sources, combineSources: input.combine_sources, recordScope: "single", searchDepth: input.search_depth,
    refreshInterval: input.refresh_interval, error: null, createdAt: now, updatedAt: now,
    blockedDomains: [],
  };
  await saveApiJob(job);
  try {
    const plan = await planApiJob(job.userRequest, Boolean(job.combineSources));
    job.name = input.name || plan.name;
    job.proposedSchema = plan.schema;
    job.combineSources = plan.combineSources;
    job.recordScope = plan.recordScope;
    if (job.sourceStrategy.type === "automatic") job.sourceStrategy.searchQueries = plan.searchQueries;
    job.status = "awaiting_fields";
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Planning failed.";
  }
  job.updatedAt = new Date().toISOString();
  await saveApiJob(job);
  return job;
}

const runningJobs = new Set<string>();
async function setStatus(job: ApiJob, status: ApiJob["status"], error: string | null = null): Promise<void> {
  job.status = status;
  job.error = error;
  job.updatedAt = new Date().toISOString();
  await saveApiJobProgress(job);
}
function failureDescription(url: string, code: SourceFailureCode): string {
  return `${url}: ${code.replaceAll("_", " ").toLowerCase()}`;
}
export async function runApiJob(
  id: string,
  provider: ExtractionProvider = firecrawlProvider,
  recovery: (input: RecoveryInput) => Promise<RecoveryDecision> = recoverSearchQuery,
  reviewSources: (request: string, candidates: SourceCandidate[], query?: string, combineSources?: boolean, collection?: boolean) => Promise<SourceCandidate[]> = reviewSourceCandidates,
  queuedRun?: { id: string; trigger: "manual" | "scheduled" },
  reviewRecord: (request: string, data: ApiRecord["data"], sourceUrl: string, title?: string, plannedQuery?: string | null, identity?: string | null,
    combineSources?: boolean, priorIdentity?: string | null, priorData?: ApiRecord["data"] | null, collection?: boolean) => Promise<boolean> = reviewExtractedRecord,
  suggestCorrection: (request: string, queries: string[]) => Promise<string | null> = suggestSourceCorrection,
): Promise<ApiJob> {
  const job = await getApiJob(id);
  if (!job) throw new Error("API job not found.");
  if (!job.schemaConfirmedAt) throw new Error("Confirm the proposed fields before running Firecrawl.");
  if (!Object.keys(job.schema).length) throw new Error("This job has no confirmed schema.");
  if (runningJobs.has(id)) throw new Error("This job is already running.");
  runningJobs.add(id);
  const startMs = Date.now();
  const resumed = queuedRun ? await getLatestRun(id) : null;
  const previous = resumed?.id === queuedRun?.id ? resumed : null;
  const summary: RunSummary = {
    id: queuedRun?.id || crypto.randomUUID(), jobId: id, startedAt: previous?.startedAt || new Date(startMs).toISOString(), finishedAt: null,
    searchCalls: previous?.searchCalls || 0, scrapeCalls: previous?.scrapeCalls || 0,
    recoveryCalls: previous?.recoveryCalls || 0, consecutiveFailures: previous?.consecutiveFailures || 0,
    totalFailures: previous?.totalFailures || 0, savedRecords: previous?.savedRecords || 0,
    skippedSources: previous?.skippedSources || 0, outcome: "running", stopReason: null,
    trigger: queuedRun?.trigger || "manual", attempts: previous?.attempts || [],
  };
  try { await saveRunSummary(summary); }
  catch (error) { runningJobs.delete(id); throw error; }
  const attempt = (entry: SourceAttempt) => {
    let safeUrl = entry.url.slice(0, 500);
    if (!safeUrl.startsWith("search:")) {
      try {
        const parsed = new URL(safeUrl);
        parsed.username = ""; parsed.password = ""; parsed.search = ""; parsed.hash = "";
        safeUrl = parsed.toString();
      } catch { safeUrl = "unavailable source URL"; }
    }
    if ((summary.attempts?.length || 0) < 60) summary.attempts!.push({
      ...entry, url: safeUrl, title: entry.title?.slice(0, 160),
      query: entry.query?.slice(0, 200) || null,
    });
  };
  const cancelled = async () => queuedRun ? isRunCancelled(queuedRun.id) : false;
  const blocked = new Set([...DEFAULT_BLOCKED_DOMAINS, ...(job.blockedDomains || [])]);
  const queue: PlannedCandidate[] = [];
  const automatic = job.sourceStrategy.type === "automatic";
  const limits = runLimitsForSearchDepth(automatic ? job.searchDepth : "deep");
  const planned = automatic ? plannedSearchQueries(job.sourceStrategy.searchQueries, limits.plannedSearches) : [];
  const completedQueries = new Set<string>();
  const identifiedItemKeys = new Set<string>();
  const savedItemKeys = new Set<string>();
  const seen = new Set<string>();
  const queries: string[] = [];
  const failures: Array<{ domain: string; code: SourceFailureCode }> = [];
  const errors: string[] = [];
  let searchIssue = false;
  let stopReason: string | null = null;
  const combined = job.combineSources ? createCombinedRecord(job.schema) : null;
  let combinedIdentity: string | null = null;
  let completeCombinedRun = false;
  // Vision fallback budget: at most `limits.visionFallbacks` screenshot reads
  // per run. The extra screenshot scrape is counted in `scrapeCalls`.
  let visionRemaining = limits.visionFallbacks;
  let visionRecoveries = 0;
  const extracting = withVisionFallback(provider, {
    requestAttempt: () => {
      if (visionRemaining <= 0) return false;
      if (summary.scrapeCalls >= limits.scrapes) return false;
      if (!withinDeadline(startMs)) return false;
      visionRemaining--;
      return true;
    },
  });

  const search = async (query: string): Promise<SourceCandidate[]> => {
    if (await cancelled()) { stopReason = "Run cancelled."; return []; }
    if (!canSearch(summary.searchCalls, startMs, limits)) {
      stopReason = "Stopped at the search or time limit.";
      return [];
    }
    summary.searchCalls++;
    await saveRunSummary(summary);
    queries.push(query);
    await setStatus(job, "discovering");
    try {
      const results = await provider.discover(query, { excludedDomains: [...blocked], limit: 5 });
      const next = filterCandidates(results, [...blocked], new Set(seen), 5, job.recordScope === "collection");
      const candidates = new Set(next.map((item) => item.url));
      for (const result of results) if (!candidates.has(result.url)) {
        attempt({ url: result.url, query, stage: "candidate_filter", code: "FILTERED", title: result.title });
      }
      let reviewed: SourceCandidate[];
      try {
        reviewed = await reviewSources(job.userRequest, next, query, Boolean(combined), job.recordScope === "collection");
        const allowed = new Set(next.map((item) => item.url));
        if (new Set(reviewed.map((item) => item.url)).size !== reviewed.length ||
            reviewed.some((item) => !allowed.has(item.url))) {
          throw new Error("Source review selected an unknown or duplicate URL.");
        }
      } catch {
        stopReason = "Could not verify source relevance.";
        throw new Error(stopReason);
      }
      const accepted = new Set(reviewed.map((item) => item.url));
      for (const candidate of next) if (!accepted.has(candidate.url)) {
        attempt({ url: candidate.url, query, stage: "source_review", code: "REJECTED", title: candidate.title });
      }
      summary.skippedSources += results.filter((result) => !candidates.has(result.url)).length +
        next.filter((candidate) => !accepted.has(candidate.url)).length;
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
      attempt({ url: "search:" + query, query, stage: "candidate_filter", code });
      return [];
    }
  };

  try {
    if (automatic) {
      const batches: SearchBatch[] = [];
      if (!planned.length) searchIssue = true;
      for (const query of planned) {
        if (await cancelled()) { stopReason = "Run cancelled."; break; }
        batches.push({ query, candidates: await search(query) });
        if (stopReason) break;
      }
      queue.push(...prioritizeSearchBatches(batches, limits.candidates));
      const queuedUrls = new Set(queue.map((item) => item.url));
      for (const batch of batches) for (const candidate of batch.candidates) if (!queuedUrls.has(candidate.url)) {
        attempt({ url: candidate.url, query: batch.query, stage: "candidate_filter", code: "BUDGET", title: candidate.title });
      }
      summary.skippedSources += Math.max(0, batches.reduce((sum, batch) => sum + batch.candidates.length, 0) - queue.length);
    } else {
      for (const url of job.sources.slice(0, limits.candidates)) {
        if (!seen.has(url)) { seen.add(url); queue.push({ url, plannedQuery: null }); }
      }
    }
    if (automatic && queue.length) job.sources = queue.map((candidate) => candidate.url);

    while (!stopReason && withinDeadline(startMs)) {
      if (await cancelled()) { stopReason = "Run cancelled."; break; }
      if (combined && Object.values(combined.data).every((value) => value !== null)) break;
      if (summary.consecutiveFailures >= RUN_LIMITS.consecutiveFailures || summary.totalFailures >= RUN_LIMITS.totalFailures) {
        stopReason = "Stopped after five source failures in this run.";
        break;
      }
      if (summary.scrapeCalls >= limits.scrapes) {
        stopReason = queue.length ? `Stopped at the ${limits.scrapes}-scrape ${job.searchDepth} search-depth limit.` : null;
        break;
      }
      const candidate = queue.shift();
      if (candidate) {
        const host = domainOf(candidate.url);
        if (host && isBlockedDomain(host, [...blocked])) {
          summary.skippedSources++;
          attempt({ url: candidate.url, query: candidate.plannedQuery, stage: "candidate_filter", code: "UNSUPPORTED_SITE", title: candidate.title });
          if (!automatic) errors.push(failureDescription(candidate.url, "UNSUPPORTED_SITE"));
          continue;
        }
        summary.scrapeCalls++;
        await saveRunSummary(summary);
        await setStatus(job, "scraping");
        try {
          await setStatus(job, "extracting");
          if (job.recordScope === "collection" && !job.schema.price && provider.extractCollection) {
            const rows = await provider.extractCollection(candidate.url, job.schema, job.userRequest, candidate.title);
            const pageKeys = new Set<string>();
            let savedOnPage = 0;
            for (const row of rows) {
              const { data, identity } = row;
              const keyField = Object.keys(job.schema).find((key) =>
                /(?:^|_)(?:code|name|title|id)$/.test(key) && typeof data[key] === "string" && String(data[key]).trim());
              if (!keyField) throw new Error("Collection item has no identifying field.");
              const itemKey = String(data[keyField]).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 180);
              if (pageKeys.has(itemKey)) continue;
              pageKeys.add(itemKey);
              identifiedItemKeys.add(itemKey);
              summary.identifiedItems = identifiedItemKeys.size;
              validateRecordQuality({ request: job.userRequest, schema: job.schema, data,
                sourceUrl: candidate.url, sourceTitle: row.sourceTitle, canonicalUrl: row.canonicalUrl });
              if (!await reviewRecord(job.userRequest, data, candidate.url, candidate.title, candidate.plannedQuery, identity,
                false, null, null, true)) {
                attempt({ url: candidate.url, query: candidate.plannedQuery, stage: "record_review", code: "IRRELEVANT_RECORD",
                  title: candidate.title, fieldsPresent: [keyField] });
                continue;
              }
              if (await cancelled()) { stopReason = "Run cancelled."; break; }
              await setStatus(job, "storing");
              await saveApiRecords(job.id, [{ id: crypto.randomUUID(), jobId: job.id, sourceUrl: candidate.url,
                itemKey, data, extractedAt: new Date().toISOString() }]);
              savedOnPage++;
              if (!savedItemKeys.has(itemKey)) { savedItemKeys.add(itemKey); summary.savedRecords++; }
              attempt({ url: candidate.url, query: candidate.plannedQuery, stage: "save", code: "SAVED",
                title: candidate.title, fieldsPresent: Object.keys(data).filter((key) => key !== "source_url" && data[key] !== null),
                fieldsMissing: Object.keys(data).filter((key) => key !== "source_url" && data[key] === null) });
            }
            if (!savedOnPage && !stopReason) throw new Error("Firecrawl returned no usable fields.");
            if (candidate.plannedQuery && savedOnPage) completedQueries.add(candidate.plannedQuery);
            summary.consecutiveFailures = 0;
            await saveRunSummary(summary);
            continue;
          }
          const extracted = await extracting.extract(candidate.url, job.schema, candidate.title, job.userRequest, Boolean(combined));
          const { data, identity } = extracted;
          if (extracted.viaVision) {
            visionRecoveries++;
            summary.scrapeCalls++;
            await saveRunSummary(summary);
          }
          if (await cancelled()) { stopReason = "Run cancelled."; break; }
          validateRecordQuality({ request: job.userRequest, schema: job.schema, data,
            sourceUrl: candidate.url, sourceTitle: extracted.sourceTitle, canonicalUrl: extracted.canonicalUrl,
            allowMissingPrice: Boolean(combined) });
          if (!await reviewRecord(job.userRequest, data, candidate.url, candidate.title, candidate.plannedQuery, identity,
            Boolean(combined), combinedIdentity, combined?.data)) {
            throw new Error("Record does not match the request.");
          }
          if (await cancelled()) { stopReason = "Run cancelled."; break; }
          if (Object.entries(data).every(([key, value]) => key === "source_url" || value === null)) {
            throw new Error("Firecrawl returned no usable fields.");
          }
          if (combined) {
            const added = addCombinedSource(combined, data, candidate.url);
            if (!added) throw new Error("Source supplied no new fields for the combined record.");
            combinedIdentity ||= identity;
          } else {
            const record: ApiRecord = {
              id: crypto.randomUUID(), jobId: job.id, sourceUrl: candidate.url, data,
              extractedAt: new Date().toISOString(),
            };
            await setStatus(job, "storing");
            await saveApiRecords(job.id, [record]);
            summary.savedRecords++;
          }
          attempt({ url: candidate.url, query: candidate.plannedQuery, stage: "save", code: "SAVED",
            title: candidate.title, fieldsPresent: Object.keys(data).filter((key) => key !== "source_url" && data[key] !== null),
            fieldsMissing: Object.keys(data).filter((key) => key !== "source_url" && data[key] === null) });
          if (candidate.plannedQuery) completedQueries.add(candidate.plannedQuery);
          summary.consecutiveFailures = 0;
          await saveRunSummary(summary);
        } catch (error) {
          const code = classifySourceError(error);
          summary.totalFailures++;
          summary.consecutiveFailures++;
          summary.skippedSources++;
          await saveRunSummary(summary);
          failures.push({ domain: host || "unknown", code });
          attempt({ url: candidate.url, query: candidate.plannedQuery, stage: code === "IRRELEVANT_RECORD" ? "record_review" :
            code === "MISSING_REQUIRED_FIELD" || code === "UNVERIFIED_PRICE" || code === "SOURCE_IDENTITY_MISMATCH" ? "quality_check" : "scrape",
            code, title: candidate.title });
          const canTryListing = code === "UNVERIFIED_PRICE" && candidate.parentUrl && !seen.has(candidate.parentUrl);
          if (canTryListing && candidate.parentUrl) {
            seen.add(candidate.parentUrl);
            queue.unshift({ url: candidate.parentUrl, title: candidate.title, plannedQuery: candidate.plannedQuery });
            summary.skippedSources = Math.max(0, summary.skippedSources - 1);
            job.sources = [...new Set([...job.sources, candidate.parentUrl])].slice(0, limits.candidates);
          } else {
            errors.push(failureDescription(candidate.url, code));
          }
          if (code === "UNSUPPORTED_SITE" && host) {
            blocked.add(host);
            job.blockedDomains = [...new Set([...(job.blockedDomains || []), host])];
            await saveApiJobProgress(job);
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
            missingPlannedQueries(planned, completedQueries).length ? 0 : (combined ? combined.sourceUrls.length : summary.savedRecords),
            summary.consecutiveFailures, summary.totalFailures, startMs, limits)) break;
      summary.recoveryCalls++;
      await saveRunSummary(summary);
      let decision: RecoveryDecision = { action: "stop", query: null };
      try {
        decision = await recovery({
          userRequest: job.userRequest,
          priorQueries: queries,
          failureCodes: failures,
          excludedDomains: [...blocked],
          successfulRecordCount: combined ? combined.sourceUrls.length : summary.savedRecords,
        });
      } catch {
        stopReason = "Recovery decision failed.";
        break;
      }
      if (decision.action !== "search_again" || !decision.query) {
        stopReason = failures.length ? "No better public source was found after " +
          failures[failures.length - 1].code.replaceAll("_", " ").toLowerCase() + "." :
          "Recovery found no better public source query.";
        break;
      }
      // Validate injected recovery providers too, not only the OpenAI implementation.
      const safe = validateRecoveryDecision(decision, {
        userRequest: job.userRequest, priorQueries: queries, failureCodes: failures,
        excludedDomains: [...blocked], successfulRecordCount: combined ? combined.sourceUrls.length : summary.savedRecords,
      });
      if (safe.action !== "search_again" || !safe.query) {
        stopReason = "Recovery returned an invalid query.";
        break;
      }
      const recovered = await search(safe.query);
      const missingQuery = missingPlannedQueries(planned, completedQueries)[0] || null;
      queue.push(...recovered.map((candidate) => ({ ...candidate, plannedQuery: missingQuery })));
      if (queue.length) job.sources = [...new Set([...job.sources, ...queue.map((item) => item.url)])].slice(0, limits.candidates);
      if (!queue.length && !stopReason) stopReason = "Recovery search found no usable public pages.";
    }

    if (!stopReason && !withinDeadline(startMs)) stopReason = "Stopped at the four-minute run limit.";
    if (await cancelled()) stopReason = "Run cancelled.";
    if (combined && combined.sourceUrls.length && !(await cancelled())) {
      const primary = combined.sourceUrls[0];
      try {
        validateRecordQuality({ request: job.userRequest, schema: job.schema, data: combined.data, sourceUrl: primary });
        const missingFields = Object.entries(combined.data).filter(([key, value]) => key !== "source_url" && value === null).map(([key]) => key);
        const previous = (await listApiRecords(job.id))[0];
        const lostFields = previous ? Object.entries(previous.data)
          .filter(([key, value]) => key !== "source_url" && value !== null && combined.data[key] === null).map(([key]) => key) : [];
        if (lostFields.length) {
          const detail = `Kept the previous record because this refresh could not verify ${lostFields.join(", ")}.`;
          stopReason = stopReason ? `${stopReason} ${detail}` : detail;
        } else {
          const record: ApiRecord = { id: job.id, jobId: job.id, sourceUrl: primary, data: combined.data,
            sourceUrls: combined.sourceUrls, fieldSources: combined.fieldSources, extractedAt: new Date().toISOString() };
          await setStatus(job, "storing");
          await saveCombinedApiRecord(job.id, record);
          summary.savedRecords = 1;
        }
        completeCombinedRun = missingFields.length === 0 && combined.conflicts.length === 0 && !lostFields.length;
        if (missingFields.length) {
          const detail = `Missing fields across sources: ${missingFields.join(", ")}.`;
          stopReason = stopReason ? `${stopReason} ${detail}` : detail;
        }
        if (combined.conflicts.length) {
          const detail = `Sources disagree on ${combined.conflicts.join(", ")}; retained the first verified value.`;
          stopReason = stopReason ? `${stopReason} ${detail}` : detail;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Could not save the combined record.";
        stopReason = stopReason ? `${stopReason} ${detail}` : detail;
      }
    }
    if (!stopReason && summary.savedRecords === 0 && summary.totalFailures) stopReason = "No usable records were extracted.";
    if (!stopReason && summary.savedRecords === 0 && automatic) stopReason = "No public source pages were found.";
    if (automatic && summary.savedRecords === 0 && searchIssue && summary.scrapeCalls === 0 &&
        !stopReason?.includes("billing") && !stopReason?.includes("rate limited") && !(await cancelled())) {
      try {
        const suggestion = validateSourceSuggestion(await suggestCorrection(job.userRequest, queries), job.userRequest);
        if (suggestion) stopReason = `No matching public source pages were found. Did you mean ${suggestion}? Edit the request and create a new API to use that source.`;
      } catch { /* retain the clear discovery failure */ }
    }
    if (await cancelled()) stopReason = "Run cancelled.";
    const missing = missingPlannedQueries(planned, completedQueries);
    if (visionRecoveries > 0 && stopReason) {
      stopReason = `${stopReason} Vision fallback recovered ${visionRecoveries} record${visionRecoveries === 1 ? "" : "s"} from page screenshots.`;
    }
    if (automatic && summary.savedRecords > 0 && missing.length) {
      const coverage = `No record was updated for ${missing.length} of ${planned.length} planned searches: ${missing.map((query) => query.slice(0, 80)).join("; ")}.`;
      stopReason = stopReason ? `${stopReason} ${coverage}` : coverage;
    }
  } catch (error) {
    stopReason = error instanceof Error ? error.message : "Run failed.";
  } finally {
    try {
      const existingCount = await countApiRecords(job.id);
      job.recordCount = existingCount;
      const hasRecords = existingCount > 0;
      summary.finishedAt = new Date().toISOString();
      const expectedCap = stopReason === `Stopped at the ${limits.scrapes}-scrape ${job.searchDepth} search-depth limit.` &&
        summary.savedRecords > 0 && errors.length === 0;
      const presentation = presentRunResult({
        automatic, hasRecords, savedRecords: summary.savedRecords, stopReason, errors, expectedCap,
      });
      summary.outcome = stopReason === "Run cancelled." ? "cancelled" : presentation.outcome;
      summary.stopReason = stopReason === "Run cancelled." ? stopReason : presentation.stopReason;
      await setStatus(job, !hasRecords ? "failed" : summary.outcome === "ready" ? "ready" : "partial",
        summary.outcome === "cancelled" ? "Run cancelled." : presentation.warning || (hasRecords ? null : "No usable records were extracted."));
      await saveRunSummary(summary);
      await finishRefreshSchedule(id, summary.trigger || "manual", summary.outcome,
        combined && !completeCombinedRun ? 0 : summary.savedRecords);
      job.runSummary = summary;
    } finally { runningJobs.delete(id); }
  }
  return job;
}
