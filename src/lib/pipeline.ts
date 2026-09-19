import "server-only";

import { demoFields, demoRecords } from "./demo";
import { planRequest } from "./planner";
import { discoverSources, extractSources } from "./sources";
import { getDataset, listRecords, replaceRecords, saveDataset } from "./store";
import { cleanSourceUrls } from "./validation";
import { staleRecord, verifyRecord } from "./verify";
import type { Dataset, DatasetRecord } from "./types";

export async function createDataset(prompt: string, mode: Dataset["mode"], seedUrls: string[]): Promise<Dataset> {
  if (mode === "demo" && !/laptop/i.test(prompt)) {
    throw new Error("Demo mode currently supports laptop requests only. Use Live sources for other data.");
  }
  const now = new Date().toISOString();
  const safeUrls = cleanSourceUrls(seedUrls);
  if (safeUrls.length !== seedUrls.length) throw new Error("Use public http(s) source URLs without duplicates or local addresses.");
  const plan = mode === "demo" ? { name: "Laptop product tracker", fields: demoFields, searchQueries: [] } : await planRequest(prompt);
  const dataset: Dataset = {
    id: crypto.randomUUID(), name: plan.name, prompt, mode, status: "refreshing",
    fields: plan.fields, sourceUrls: safeUrls, error: null,
    createdAt: now, updatedAt: now,
  };
  saveDataset(dataset);
  if (mode === "demo") {
    replaceRecords(dataset.id, demoRecords(dataset));
    dataset.status = "ready";
    dataset.updatedAt = new Date().toISOString();
    saveDataset(dataset);
    return dataset;
  }
  await refreshDataset(dataset.id, plan.searchQueries);
  return getDataset(dataset.id)!;
}

export async function refreshDataset(id: string, searchQueries?: string[]): Promise<{ dataset: Dataset; records: DatasetRecord[] }> {
  const dataset = getDataset(id);
  if (!dataset) throw new Error("Dataset not found.");
  dataset.status = "refreshing";
  dataset.error = null;
  dataset.updatedAt = new Date().toISOString();
  saveDataset(dataset);
  const previous = listRecords(id);
  try {
    if (dataset.mode === "demo") {
      const records = demoRecords(dataset);
      replaceRecords(id, records);
    } else {
      let urls = dataset.sourceUrls;
      if (!urls.length) {
        const queries = searchQueries?.length ? searchQueries : (await planRequest(dataset.prompt)).searchQueries;
        urls = await discoverSources({ name: dataset.name, fields: dataset.fields, searchQueries: queries });
        if (!urls.length) throw new Error("No public source pages were found. Add seed URLs and try again.");
        dataset.sourceUrls = urls;
      }
      const { records: proposed, errors } = await extractSources(urls, dataset.fields);
      if (!proposed.length) throw new Error(errors.join("\n") || "No source pages could be extracted.");
      const records = await Promise.all(proposed.map((item) => verifyRecord(dataset, item, previous.find((record) => record.sourceUrl === item.sourceUrl))));
      for (const oldRecord of previous.filter((record) => !proposed.some((item) => item.sourceUrl === record.sourceUrl))) records.push(staleRecord(oldRecord));
      replaceRecords(id, records);
      if (errors.length) dataset.error = `${errors.length} source page(s) could not be refreshed: ${errors.join("; ").slice(0, 500)}`;
    }
    dataset.status = "ready";
  } catch (error) {
    dataset.status = "error";
    dataset.error = error instanceof Error ? error.message : "Refresh failed.";
    if (previous.length) replaceRecords(id, previous.map(staleRecord));
  }
  dataset.updatedAt = new Date().toISOString();
  saveDataset(dataset);
  return { dataset, records: listRecords(id) };
}
