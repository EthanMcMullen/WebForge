import type { SearchDepth } from "./types.ts";

export interface RunLimits {
  searches: number;
  plannedSearches: number;
  scrapes: number;
  recoveryCalls: number;
  consecutiveFailures: number;
  totalFailures: number;
  candidates: number;
  durationMs: number;
}

export const RUN_LIMITS: RunLimits = {
  searches: 6,
  plannedSearches: 5,
  scrapes: 12,
  recoveryCalls: 1,
  consecutiveFailures: 5,
  totalFailures: 5,
  candidates: 12,
  durationMs: 240_000,
};

export const SEARCH_DEPTH_LIMITS: Record<SearchDepth, Pick<RunLimits, "searches" | "plannedSearches" | "scrapes" | "candidates">> = {
  focused: { searches: 3, plannedSearches: 2, scrapes: 3, candidates: 3 },
  balanced: { searches: 5, plannedSearches: 4, scrapes: 6, candidates: 6 },
  deep: { searches: 6, plannedSearches: 5, scrapes: 12, candidates: 12 },
};

export function runLimitsForSearchDepth(depth: SearchDepth): RunLimits {
  return { ...RUN_LIMITS, ...SEARCH_DEPTH_LIMITS[depth] };
}

export function withinDeadline(startedAtMs: number): boolean {
  return Date.now() - startedAtMs < RUN_LIMITS.durationMs;
}

export function canSearch(searchCalls: number, startedAtMs: number, limits: RunLimits = RUN_LIMITS): boolean {
  return searchCalls < limits.searches && withinDeadline(startedAtMs);
}
export function canScrape(scrapeCalls: number, consecutiveFailures: number, totalFailures: number, startedAtMs: number, limits: RunLimits = RUN_LIMITS): boolean {
  return scrapeCalls < limits.scrapes &&
    consecutiveFailures < limits.consecutiveFailures &&
    totalFailures < limits.totalFailures && withinDeadline(startedAtMs);
}
export function canRecover(searchCalls: number, scrapeCalls: number, recoveryCalls: number, savedRecords: number, consecutiveFailures: number, totalFailures: number, startedAtMs: number, limits: RunLimits = RUN_LIMITS): boolean {
  return recoveryCalls < limits.recoveryCalls && savedRecords === 0 &&
    canSearch(searchCalls, startedAtMs, limits) &&
    canScrape(scrapeCalls, consecutiveFailures, totalFailures, startedAtMs, limits);
}

export function plannedSearchQueries(queries: string[], limit = RUN_LIMITS.plannedSearches): string[] {
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, limit);
}
