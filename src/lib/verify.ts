import "server-only";

import type { Dataset, DatasetRecord, FieldDefinition, FieldEvidence, FieldStatus, ProposedField, ProposedRecord } from "./types";

export function normalizeValue(field: FieldDefinition, value: ProposedField["value"]): string | number | boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (field.type === "string") return String(value).trim().slice(0, 300) || null;
  if (field.type === "number") {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "boolean") return value;
  if (/^(yes|true|available|supported)$/i.test(String(value).trim())) return true;
  if (/^(no|false|unavailable|unsupported)$/i.test(String(value).trim())) return false;
  return null;
}

export function hasExactTextEvidence(value: string | number | boolean, quote: string): boolean {
  if (typeof value === "boolean") return false;
  const normalizedQuote = quote.toLowerCase().replace(/[,\s]+/g, " ");
  const normalizedValue = String(value).toLowerCase().replace(/[,\s]+/g, " ");
  return normalizedValue.length > 0 && normalizedQuote.includes(normalizedValue);
}

async function jevSupports(field: FieldDefinition, value: string | number | boolean, proposal: ProposedField): Promise<{ supported: boolean; confidence: number }> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return { supported: false, confidence: 0 };
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: {
        field: field.label,
        claimed_value: value,
        evidence_text: proposal.quote.slice(0, 1000),
        evidence_kind: proposal.kind,
        visual_model_confidence: proposal.confidence ?? null,
      },
      questions: {
        supported: {
          type: "choice",
          instructions: "Does the supplied evidence directly support this exact claimed value? Reject guesses, ambiguous product variants, and unsupported inferences. For image evidence, judge the supplied visual observation; you are not seeing the image itself.",
          criteria: { yes: "Directly supported by the evidence", no: "Missing, ambiguous, or contradicted" },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Jev verification failed (${response.status}).`);
  const result = await response.json() as { answers?: { supported?: { choice?: string; probabilities?: { yes?: number }; confidence?: number } } };
  const answer = result.answers?.supported;
  const probability = typeof answer?.probabilities?.yes === "number" ? answer.probabilities.yes : (answer?.choice === "yes" ? 1 : 0);
  const confidence = typeof answer?.confidence === "number" ? answer.confidence : probability;
  return { supported: answer?.choice === "yes" && probability >= 0.8 && confidence >= 0.75, confidence };
}

async function checkCandidate(field: FieldDefinition, proposal: ProposedField, sourceUrl: string): Promise<FieldEvidence> {
  const checkedAt = new Date().toISOString();
  const value = normalizeValue(field, proposal.value);
  const base = {
    field: field.key, proposedValue: value, sourceUrl,
    quote: proposal.quote.slice(0, 1000), imageUrl: proposal.imageUrl || null,
    kind: proposal.kind, checkedAt,
  } as const;
  if (value === null) return { ...base, confidence: null, status: "unknown", reason: "The page did not provide a usable value." };
  if (!proposal.quote.trim()) return { ...base, confidence: null, status: "unverified", reason: "No supporting evidence was extracted." };
  if (proposal.kind === "image" && (!proposal.imageUrl || (proposal.confidence ?? 0) < 0.85)) {
    return { ...base, confidence: proposal.confidence ?? null, status: "unverified", reason: "The visual observation is too uncertain." };
  }
  if (!process.env.TYPESAFE_API_KEY) {
    if (proposal.kind === "text" && hasExactTextEvidence(value, proposal.quote)) {
      return { ...base, confidence: null, status: "verified", reason: "The value appears verbatim in the extracted page evidence." };
    }
    return { ...base, confidence: proposal.confidence ?? null, status: "unverified", reason: "Jev is not configured and the evidence is not an exact text match." };
  }
  try {
    const result = await jevSupports(field, value, proposal);
    return { ...base, confidence: result.confidence, status: result.supported ? "verified" : "unverified", reason: result.supported ? "Jev judged the evidence supportive." : "Jev judged the evidence insufficient." };
  } catch (error) {
    return { ...base, confidence: null, status: "unverified", reason: error instanceof Error ? error.message : "Jev verification failed." };
  }
}

export async function verifyRecord(dataset: Dataset, proposed: ProposedRecord, previous?: DatasetRecord): Promise<DatasetRecord> {
  const data: DatasetRecord["data"] = {};
  const fieldStatus: DatasetRecord["fieldStatus"] = {};
  const evidence: FieldEvidence[] = [];
  for (const field of dataset.fields) {
    const candidates = proposed.fields.filter((candidate) => candidate.key === field.key).slice(0, 3);
    const checks = await Promise.all(candidates.map((candidate) => checkCandidate(field, candidate, proposed.sourceUrl)));
    evidence.push(...checks);
    const verified = checks.filter((item) => item.status === "verified");
    const distinct = [...new Set(verified.map((item) => JSON.stringify(item.proposedValue)))];
    let status: FieldStatus;
    let value: string | number | boolean | null;
    if (distinct.length > 1) {
      status = "conflicting";
      value = null;
    } else if (verified.length) {
      status = "verified";
      value = verified[0].proposedValue;
    } else if (previous?.fieldStatus[field.key] === "verified" || previous?.fieldStatus[field.key] === "stale") {
      status = "stale";
      value = previous.data[field.key];
    } else {
      status = checks.some((item) => item.status === "unverified") ? "unverified" : "unknown";
      value = null;
    }
    data[field.key] = value;
    fieldStatus[field.key] = status;
    if (!checks.length) evidence.push({
      field: field.key, proposedValue: null, sourceUrl: proposed.sourceUrl, quote: "",
      imageUrl: null, kind: "text", confidence: null, status: "unknown",
      reason: "No evidence found for this field.", checkedAt: new Date().toISOString(),
    });
  }
  return {
    id: previous?.id || crypto.randomUUID(), datasetId: dataset.id,
    sourceUrl: proposed.sourceUrl, data, fieldStatus, evidence,
    updatedAt: new Date().toISOString(),
  };
}

export function staleRecord(record: DatasetRecord): DatasetRecord {
  return {
    ...record,
    fieldStatus: Object.fromEntries(Object.entries(record.fieldStatus).map(([key, status]) => [key, status === "verified" ? "stale" : status])),
  };
}
