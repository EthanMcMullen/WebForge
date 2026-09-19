export const RUN_LIMITS = {
  searches: 6,
  plannedSearches: 5,
  scrapes: 5,
  recoveryCalls: 1,
  consecutiveFailures: 5,
  totalFailures: 5,
  candidates: 8,
  durationMs: 240_000,
} as const;

export function withinDeadline(startedAtMs: number): boolean {
  return Date.now() - startedAtMs < RUN_LIMITS.durationMs;
}

export function canSearch(searchCalls: number, startedAtMs: number): boolean {
  return searchCalls < RUN_LIMITS.searches && withinDeadline(startedAtMs);
}
export function canScrape(scrapeCalls: number, consecutiveFailures: number, totalFailures: number, startedAtMs: number): boolean {
  return scrapeCalls < RUN_LIMITS.scrapes &&
    consecutiveFailures < RUN_LIMITS.consecutiveFailures &&
    totalFailures < RUN_LIMITS.totalFailures && withinDeadline(startedAtMs);
}
export function canRecover(searchCalls: number, scrapeCalls: number, recoveryCalls: number, savedRecords: number, consecutiveFailures: number, totalFailures: number, startedAtMs: number): boolean {
  return recoveryCalls < RUN_LIMITS.recoveryCalls && savedRecords === 0 &&
    canSearch(searchCalls, startedAtMs) &&
    canScrape(scrapeCalls, consecutiveFailures, totalFailures, startedAtMs);
}

export function plannedSearchQueries(queries: string[]): string[] {
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, RUN_LIMITS.plannedSearches);
}
