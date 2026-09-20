import type { SourceStrategyType } from "./types";

export type WorkspaceHandoff = {
  request: string;
  name: string;
  strategy: SourceStrategyType;
  combine: boolean;
  sources: string;
  refresh: string;
};

export function parseWorkspaceHandoff(search: string | URLSearchParams): WorkspaceHandoff | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const request = params.get("request")?.trim();
  if (!request) return null;
  return {
    request,
    name: params.get("name")?.slice(0, 120) ?? "",
    strategy: params.get("strategy") === "provided_urls" ? "provided_urls" : "automatic",
    combine: params.get("combine") === "1",
    sources: params.get("sources")?.slice(0, 2000) ?? "",
    refresh: params.get("refresh")?.replace(/[^0-9]/g, "").slice(0, 5) ?? "",
  };
}
