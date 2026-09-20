import type { ApiPlan } from "./types";

const explicitCollection = /\b(?:all|every|different|various|multiple|several)\b.{0,100}\b(?:classes|courses|machines|products|models|items|articles|events|stores|restaurants|people|companies|buildings|landmarks)\b|\b(?:list|compare)\b.{0,100}\b(?:classes|courses|machines|products|models|items|articles|events|stores|restaurants|people|companies|buildings|landmarks)\b/i;
const placeholder = /\b(?:xyz|abc123|placeholder|example\.com|sample model|model example)\b|[<\[]\s*(?:product|model|item|name)\s*[>\]]/i;

export function recordScopeForRequest(request: string, plannedScope: ApiPlan["recordScope"]): ApiPlan["recordScope"] {
  return explicitCollection.test(request) ? "collection" : plannedScope;
}

export function invalidPlanReason(plan: Pick<ApiPlan, "searchQueries">): string | null {
  if (plan.searchQueries.some((query) => placeholder.test(query))) return "Search queries contain an example or placeholder item.";
  if (new Set(plan.searchQueries.map((query) => query.trim().toLowerCase())).size !== plan.searchQueries.length) {
    return "Search queries repeat the same search.";
  }
  return null;
}
