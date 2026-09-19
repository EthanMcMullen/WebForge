import { isIP } from "node:net";
import { z } from "zod";
import { apiJobStatuses } from "./types.ts";

export const ApiFieldSchemaInput = z.object({
  type: z.enum(["string", "number", "integer", "boolean"]),
  description: z.string().trim().min(1).max(300).optional(),
}).strict();

export const ApiRecordSchemaInput = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/),
  ApiFieldSchemaInput,
).refine((schema) => Object.keys(schema).length >= 1, "Schema must contain at least one field.")
  .refine((schema) => Object.keys(schema).length <= 20, "Schema cannot contain more than 20 fields.");

export const SourceStrategyInput = z.object({
  type: z.enum(["automatic", "provided_urls"]).default("automatic"),
  search_queries: z.array(z.string().trim().min(3).max(200)).max(5).default([]),
}).strict();

export const CreateApiJobInput = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  user_request: z.string().trim().min(10).max(2000),
  source_strategy: SourceStrategyInput.default({ type: "automatic", search_queries: [] }),
  sources: z.array(z.string().url()).max(5).default([]),
  refresh_interval: z.number().int().min(15).max(525_600).nullable().default(null),
}).strict().superRefine((input, context) => {
  if (input.source_strategy.type === "provided_urls" && input.sources.length === 0) {
    context.addIssue({ code: "custom", path: ["sources"], message: "At least one source is required when using provided_urls." });
  }
});

export type CreateApiJobData = z.infer<typeof CreateApiJobInput>;

export const ConfirmApiJobFieldsInput = z.object({
  selected_fields: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1).max(19),
}).strict();

export const UpdateApiJobStatusInput = z.object({
  status: z.enum(apiJobStatuses),
  error: z.string().trim().max(1000).nullable().optional(),
}).strict();

export function normalizePublicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isIP(host)) return null;
    if (host.length > 253 || url.href.length > 2048) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function cleanSourceUrls(values: string[]): string[] {
  return [...new Set(values.map(normalizePublicUrl).filter((url): url is string => Boolean(url)))].slice(0, 20);
}

export const UpdateApiJobInput = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  refresh_interval: z.number().int().min(15).max(525_600).nullable().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, "Provide at least one setting to update.");