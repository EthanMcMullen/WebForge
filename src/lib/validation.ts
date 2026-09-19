import { isIP } from "node:net";
import { z } from "zod";

export const CreateDatasetInput = z.object({
  prompt: z.string().trim().min(10).max(1000),
  mode: z.enum(["demo", "live"]).default("demo"),
  seedUrls: z.array(z.string().url()).max(10).default([]),
});

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
  return [...new Set(values.map(normalizePublicUrl).filter((url): url is string => Boolean(url)))].slice(0, 10);
}
