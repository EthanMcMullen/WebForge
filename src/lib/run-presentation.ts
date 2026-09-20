import type { RunOutcome } from "./types.ts";

export interface RunPresentationInput {
  automatic: boolean;
  hasRecords: boolean;
  savedRecords: number;
  stopReason: string | null;
  errors: string[];
  expectedCap: boolean;
}

export function presentRunResult(input: RunPresentationInput): {
  outcome: RunOutcome;
  stopReason: string | null;
  warning: string | null;
} {
  const recovered = input.automatic && input.savedRecords > 0 && !input.stopReason;
  const reason = input.expectedCap || recovered ? null
    : input.stopReason || (input.errors.length
      ? `${input.errors.length} source(s) skipped or failed.`
      : null);
  const details = recovered ? [] : input.errors.slice(0, 3);
  const warning = recovered ? null : [reason, ...details].filter(Boolean).join(" ") || null;
  const outcome: RunOutcome = !input.hasRecords ? "failed"
    : recovered ? "ready"
    : warning || input.errors.length > 0 ? "partial_stopped" : "ready";
  return { outcome, stopReason: reason, warning };
}
