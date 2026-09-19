export type FieldType = "string" | "number" | "boolean";
export type FieldStatus = "verified" | "unknown" | "conflicting" | "unverified" | "stale" | "sample";
export type EvidenceKind = "text" | "image" | "demo";

export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  visual: boolean;
}

export interface FieldEvidence {
  field: string;
  proposedValue: string | number | boolean | null;
  sourceUrl: string;
  quote: string;
  imageUrl: string | null;
  kind: EvidenceKind;
  confidence: number | null;
  status: FieldStatus;
  reason: string;
  checkedAt: string;
}

export interface Dataset {
  id: string;
  name: string;
  prompt: string;
  mode: "demo" | "live";
  status: "ready" | "refreshing" | "error";
  fields: FieldDefinition[];
  sourceUrls: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetRecord {
  id: string;
  datasetId: string;
  sourceUrl: string;
  data: Record<string, string | number | boolean | null>;
  fieldStatus: Record<string, FieldStatus>;
  evidence: FieldEvidence[];
  updatedAt: string;
}

export interface Plan {
  name: string;
  fields: FieldDefinition[];
  searchQueries: string[];
}

export interface ProposedField {
  key: string;
  value: string | number | boolean | null;
  quote: string;
  imageUrl?: string | null;
  kind: "text" | "image";
  confidence?: number | null;
}

export interface ProposedRecord {
  sourceUrl: string;
  fields: ProposedField[];
}
