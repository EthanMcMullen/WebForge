import { z } from "zod";
import type { SourceFailureCode } from "./types.ts";

export type RecoveryInput = {
  userRequest: string;
  priorQueries: string[];
  failureCodes: Array<{ domain: string; code: SourceFailureCode }>;
  excludedDomains: string[];
  successfulRecordCount: number;
};
export type RecoveryDecision = { action: "search_again" | "stop"; query: string | null };
const recoverySchema = z.object({
  action: z.enum(["search_again", "stop"]),
  query: z.string().nullable(),
}).strict();
export function validateRecoveryDecision(raw: unknown, input: RecoveryInput): RecoveryDecision {
  const parsed = recoverySchema.safeParse(raw);
  if (!parsed.success || parsed.data.action === "stop") return { action: "stop", query: null };
  const query = parsed.data.query?.trim();
  if (!query || query.length < 3 || query.length > 160 || /https?:\/\/|www\.|localhost|127\.0\.0\.1/i.test(query)) {
    return { action: "stop", query: null };
  }
  if (input.priorQueries.some((previous) => previous.trim().toLowerCase() === query.toLowerCase())) {
    return { action: "stop", query: null };
  }
  if (input.excludedDomains.some((domain) => query.toLowerCase().includes(domain.toLowerCase()))) {
    return { action: "stop", query: null };
  }
  return { action: "search_again", query };
}
