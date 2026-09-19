import type { SourceCandidate } from "./types.ts";

export function selectReviewedCandidates(candidates: SourceCandidate[], raw: unknown): SourceCandidate[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Source review returned no decision.");
  }
  const indices = (raw as { indices?: unknown }).indices;
  if (!Array.isArray(indices) || indices.length > candidates.length ||
      !indices.every((index) => Number.isInteger(index) && index >= 0 && index < candidates.length) ||
      new Set(indices).size !== indices.length) {
    throw new Error("Source review returned invalid candidate indices.");
  }
  return indices.map((index: number) => candidates[index]);
}
