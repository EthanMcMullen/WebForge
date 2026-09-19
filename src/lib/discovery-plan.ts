import type { SourceCandidate } from "./types.ts";

export type PlannedCandidate = SourceCandidate & { plannedQuery: string | null };
export type SearchBatch = { query: string; candidates: SourceCandidate[] };

/** Give every planned subject its best result before trying any fallback page. */
export function prioritizeSearchBatches(batches: SearchBatch[], limit: number): PlannedCandidate[] {
  const ordered: PlannedCandidate[] = [];
  const maxDepth = Math.max(0, ...batches.map((batch) => batch.candidates.length));
  for (let depth = 0; depth < maxDepth && ordered.length < limit; depth++) {
    for (const batch of batches) {
      const candidate = batch.candidates[depth];
      if (candidate) ordered.push({ ...candidate, plannedQuery: batch.query });
      if (ordered.length >= limit) break;
    }
  }
  return ordered;
}

export function missingPlannedQueries(queries: string[], completed: Set<string>): string[] {
  return queries.filter((query) => !completed.has(query));
}
