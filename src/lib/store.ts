import "server-only";
import { MongoClient, type Collection, type Db } from "mongodb";
import { selectProposedFields } from "./field-selection";
import type { ApiJob, ApiJobStatus, ApiRecord, RunOutcome, RunSummary, SearchDepth } from "./types";

type JobDocument = ApiJob & { nextRefreshAt: string | null; refreshFailures: number; refreshPaused: boolean };
type RunDocument = RunSummary & { leaseUntil: string | null; cancelRequested: boolean; trigger: "manual" | "scheduled" };
type Collections = { client: MongoClient; jobs: Collection<JobDocument>; runs: Collection<RunDocument>; records: Collection<ApiRecord>; runtime: Collection<{ id: string; seenAt: string }> };

let connection: Promise<Collections> | undefined;
function collections(): Promise<Collections> {
  if (!connection) {
    connection = (async () => {
      const uri = process.env.MONGODB_URI?.trim();
      if (!uri) throw new Error("MONGODB_URI is not configured.");
      let client: MongoClient | undefined;
      try {
        client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
        await client.connect();
        const db: Db = client.db(process.env.MONGODB_DB_NAME?.trim() || "webforge");
        const jobs = db.collection<JobDocument>("api_jobs");
        const runs = db.collection<RunDocument>("api_job_runs");
        const records = db.collection<ApiRecord>("api_records");
        const runtime = db.collection<{ id: string; seenAt: string }>("runtime");
        try { await records.dropIndex("jobId_1_sourceUrl_1"); } catch (error) {
          if (!(error instanceof Error) || !/index not found|ns not found/i.test(error.message)) throw error;
        }
        await Promise.all([
          jobs.createIndex({ id: 1 }, { unique: true }),
          jobs.createIndex({ updatedAt: -1 }),
          runs.createIndex({ id: 1 }, { unique: true }),
          runs.createIndex({ jobId: 1, startedAt: -1 }),
          runs.createIndex({ jobId: 1 }, { unique: true, name: "one_active_run_per_job",
            partialFilterExpression: { $or: [{ outcome: "queued" }, { outcome: "running" }] } }),
          records.createIndex({ id: 1 }, { unique: true }),
          records.createIndex({ jobId: 1, sourceUrl: 1, itemKey: 1 }, { unique: true }),
          records.createIndex({ jobId: 1, itemKey: 1 }, { unique: true, partialFilterExpression: { itemKey: { $type: "string" } } }),
          records.createIndex({ jobId: 1, extractedAt: -1 }),
        ]);
        return { client, jobs, runs, records, runtime };
      } catch {
        await client?.close();
        throw new Error("Could not connect to MongoDB Atlas. Check MONGODB_URI, database user, and Atlas Network Access.");
      }
    })().catch((error) => { connection = undefined; throw error; });
  }
  return connection;
}

export async function markWorkerSeen(): Promise<void> {
  const { runtime } = await collections();
  await runtime.updateOne({ id: "worker" }, { $set: { seenAt: new Date().toISOString() } }, { upsert: true });
}
export async function workerLastSeenAt(): Promise<string | null> {
  const { runtime } = await collections();
  return (await runtime.findOne({ id: "worker" }))?.seenAt || null;
}

async function enrichedJob(job: JobDocument | null): Promise<ApiJob | null> {
  if (!job) return null;
  const [runSummary, recordCount] = await Promise.all([getLatestRun(job.id), countApiRecords(job.id)]);
  return { ...job, searchDepth: job.searchDepth || "balanced", runSummary, recordCount };
}
export async function getLatestRun(jobId: string): Promise<RunSummary | null> {
  const { runs } = await collections();
  const run = await runs.findOne({ jobId }, { sort: { startedAt: -1, id: -1 } });
  return run ? { ...run, cancelRequested: run.cancelRequested || false } : null;
}
export async function saveRunSummary(run: RunSummary): Promise<void> {
  const { runs } = await collections();
  const { cancelRequested, ...rest } = run;
  await runs.updateOne({ id: run.id }, { $set: rest, $setOnInsert: { cancelRequested: Boolean(cancelRequested), leaseUntil: null } }, { upsert: true });
}
export async function listApiJobs(): Promise<ApiJob[]> {
  const { jobs } = await collections();
  const rows = await jobs.find().sort({ updatedAt: -1 }).toArray();
  return (await Promise.all(rows.map(enrichedJob))) as ApiJob[];
}
export async function getApiJob(id: string): Promise<ApiJob | null> {
  const { jobs } = await collections();
  return enrichedJob(await jobs.findOne({ id }));
}
export async function saveApiJob(job: ApiJob): Promise<void> {
  const { jobs } = await collections();
  const base = { ...job };
  delete base.recordCount;
  delete base.runSummary;
  delete base.nextRefreshAt;
  delete base.refreshFailures;
  delete base.refreshPaused;
  await jobs.updateOne({ id: job.id }, {
    $set: base,
    $setOnInsert: { nextRefreshAt: job.nextRefreshAt ?? null, refreshFailures: job.refreshFailures ?? 0, refreshPaused: job.refreshPaused ?? false },
  }, { upsert: true });
}
export async function saveApiJobProgress(job: ApiJob): Promise<void> {
  const { jobs } = await collections();
  const result = await jobs.updateOne({ id: job.id }, { $set: {
    status: job.status, error: job.error, updatedAt: job.updatedAt,
    sources: job.sources, blockedDomains: job.blockedDomains || [],
  } });
  if (!result.matchedCount) throw new Error("API job was deleted while a run was in progress.");
}
export async function listApiJobRuns(jobId: string): Promise<RunSummary[]> {
  const { runs } = await collections();
  return runs.find({ jobId }).sort({ startedAt: -1, id: -1 }).toArray();
}
export async function enqueueApiRun(jobId: string, trigger: "manual" | "scheduled" = "manual"): Promise<ApiJob> {
  const { jobs, runs } = await collections();
  const job = await jobs.findOne({ id: jobId });
  if (!job) throw new Error("API job not found.");
  if (!job.schemaConfirmedAt || !Object.keys(job.schema).length) throw new Error("Confirm fields before running.");
  const now = new Date().toISOString();
  const run: RunDocument = { id: crypto.randomUUID(), jobId, startedAt: now, finishedAt: null,
    searchCalls: 0, scrapeCalls: 0, recoveryCalls: 0, visionAttempts: 0, visionRecoveries: 0,
    consecutiveFailures: 0, totalFailures: 0,
    savedRecords: 0, skippedSources: 0, outcome: "queued", stopReason: null, trigger,
    cancelRequested: false, leaseUntil: null };
  try { await runs.insertOne(run); }
  catch (error) {
    if (error instanceof Error && /E11000/.test(error.message)) throw new Error("This API already has a queued or running job.");
    throw error;
  }
  try {
    const updated = await jobs.updateOne({ id: jobId }, { $set: { status: "queued" as ApiJobStatus, error: null, updatedAt: now } });
    if (!updated.matchedCount) throw new Error("API job not found.");
  } catch (error) {
    await runs.deleteOne({ id: run.id });
    throw error;
  }
  return (await getApiJob(jobId))!;
}
export async function requestRunCancellation(jobId: string): Promise<ApiJob> {
  const { jobs, runs } = await collections();
  const run = await runs.findOne({ jobId, outcome: { $in: ["queued", "running"] } }, { sort: { startedAt: -1, id: -1 } });
  if (!run) throw new Error("No active run to cancel.");
  await runs.updateOne({ id: run.id }, { $set: { cancelRequested: true } });
  if (run.outcome === "queued") {
    const now = new Date().toISOString();
    const result = await runs.updateOne({ id: run.id, outcome: "queued" }, { $set: {
      outcome: "cancelled", finishedAt: now, stopReason: "Cancelled before starting.", leaseUntil: null,
    } });
    if (result.modifiedCount) {
      const count = await countApiRecords(jobId);
      await jobs.updateOne({ id: jobId }, { $set: { status: count ? "partial" : "planned", error: "Run cancelled.", updatedAt: now } });
      await finishRefreshSchedule(jobId, run.trigger || "manual", "cancelled", 0);
    }
  }
  return (await getApiJob(jobId))!;
}
export async function isRunCancelled(runId: string): Promise<boolean> {
  const { runs } = await collections();
  const run = await runs.findOne({ id: runId }, { projection: { cancelRequested: 1 } });
  return !run || Boolean(run.cancelRequested);
}
export async function claimNextRun(): Promise<{ id: string; jobId: string; trigger: "manual" | "scheduled" } | null> {
  const { runs } = await collections();
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + 6 * 60_000).toISOString();
  const run = await runs.findOneAndUpdate({ $or: [
    { outcome: "queued" }, { outcome: "running", leaseUntil: { $lt: now } },
  ] }, { $set: { outcome: "running", leaseUntil: lease } }, { sort: { startedAt: 1 }, returnDocument: "after" });
  return run ? { id: run.id, jobId: run.jobId, trigger: run.trigger || "manual" } : null;
}
export async function enqueueDueRefreshes(): Promise<number> {
  const { jobs, runs } = await collections();
  const due = await jobs.find({ refreshInterval: { $ne: null }, refreshPaused: { $ne: true },
    schemaConfirmedAt: { $ne: null }, nextRefreshAt: { $lte: new Date().toISOString(), $ne: null },
    status: { $nin: ["planning", "awaiting_fields", "queued", "discovering", "scraping", "extracting", "storing"] },
  }, { projection: { id: 1 } }).toArray();
  let queued = 0;
  for (const job of due) {
    if (await runs.findOne({ jobId: job.id, outcome: { $in: ["queued", "running"] } })) continue;
    try { await enqueueApiRun(job.id, "scheduled"); queued++; } catch { /* another worker won */ }
  }
  return queued;
}
export async function finishRefreshSchedule(jobId: string, trigger: "manual" | "scheduled", outcome: RunOutcome, savedRecords = 0): Promise<void> {
  const { jobs } = await collections();
  const job = await jobs.findOne({ id: jobId });
  if (!job) return;
  const failures = trigger === "scheduled" ? (outcome !== "cancelled" && savedRecords === 0
    ? (job.refreshFailures || 0) + 1 : 0) : job.refreshFailures || 0;
  const paused = failures >= 2;
  const next = job.refreshInterval && !paused ? new Date(Date.now() + job.refreshInterval * 60_000).toISOString() : null;
  await jobs.updateOne({ id: jobId }, { $set: { nextRefreshAt: next, refreshFailures: failures, refreshPaused: paused } });
}
export async function confirmApiJobFields(jobId: string, selectedFields: string[]): Promise<ApiJob> {
  const { jobs } = await collections();
  const job = await jobs.findOne({ id: jobId });
  if (!job) throw new Error("API job not found.");
  if (job.status !== "awaiting_fields" || job.schemaConfirmedAt) throw new Error("Field selection is closed for this job.");
  if (await countApiRecords(jobId)) throw new Error("Fields cannot change after records have been saved.");
  const schema = selectProposedFields(job.proposedSchema || {}, selectedFields);
  const now = new Date().toISOString();
  const next = job.refreshInterval ? new Date(Date.now() + job.refreshInterval * 60_000).toISOString() : null;
  const updated = await jobs.updateOne({ id: jobId, status: "awaiting_fields", schemaConfirmedAt: null }, { $set: {
    schema, schemaConfirmedAt: now, status: "planned", error: null, updatedAt: now, nextRefreshAt: next,
  } });
  if (!updated.matchedCount) throw new Error("Field selection is closed for this job.");
  return (await getApiJob(jobId))!;
}
export async function countApiRecords(jobId: string): Promise<number> {
  const { records } = await collections();
  return records.countDocuments({ jobId });
}
export async function listApiRecords(jobId: string): Promise<ApiRecord[]> {
  const { records } = await collections();
  return records.find({ jobId }).sort({ extractedAt: -1, sourceUrl: 1 }).toArray();
}
export async function saveApiRecords(jobId: string, recordsToSave: ApiRecord[]): Promise<void> {
  if (!recordsToSave.length) return;
  if (recordsToSave.some((record) => record.jobId !== jobId)) throw new Error("Record belongs to a different job.");
  const { records } = await collections();
  await records.bulkWrite(recordsToSave.map((record) => ({ updateOne: {
    filter: record.itemKey ? { jobId, itemKey: record.itemKey } : { jobId, sourceUrl: record.sourceUrl, itemKey: null },
    update: { $set: { sourceUrl: record.sourceUrl, data: record.data, extractedAt: record.extractedAt, sourceUrls: record.sourceUrls || [record.sourceUrl],
      fieldSources: record.fieldSources || {} }, $setOnInsert: { id: record.id, jobId, itemKey: record.itemKey ?? null } },
    upsert: true,
  } })));
}
export async function saveCombinedApiRecord(jobId: string, record: ApiRecord): Promise<void> {
  if (record.jobId !== jobId) throw new Error("Record belongs to a different job.");
  const { client, records } = await collections();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await records.deleteMany({ jobId }, { session });
      await records.insertOne({ ...record, sourceUrls: record.sourceUrls || [record.sourceUrl], fieldSources: record.fieldSources || {} }, { session });
    });
  } finally { await session.endSession(); }
}
const activeStatuses: ApiJobStatus[] = ["planning", "queued", "discovering", "scraping", "extracting", "storing"];
export async function updateApiJobSettings(jobId: string, input: { name?: string; refreshInterval?: number | null; refreshPaused?: boolean; searchDepth?: SearchDepth }): Promise<ApiJob> {
  const { jobs } = await collections();
  const job = await jobs.findOne({ id: jobId });
  if (!job) throw new Error("API job not found.");
  const now = new Date().toISOString();
  const interval = input.refreshInterval === undefined ? job.refreshInterval : input.refreshInterval;
  if (input.refreshPaused && !interval) throw new Error("Set an automatic refresh interval before pausing it.");
  const scheduleChanged = input.refreshInterval !== undefined || input.refreshPaused !== undefined;
  const paused = !interval ? false : input.refreshPaused ?? (input.refreshInterval !== undefined ? false : Boolean(job.refreshPaused));
  const next = scheduleChanged
    ? interval && !paused ? new Date(Date.now() + interval * 60_000).toISOString() : null
    : job.nextRefreshAt || null;
  const failures = input.refreshInterval !== undefined || input.refreshPaused === false
    ? 0
    : job.refreshFailures || 0;
  const updated = await jobs.updateOne({ id: jobId, status: { $nin: activeStatuses } }, { $set: {
    name: input.name ?? job.name, searchDepth: input.searchDepth ?? job.searchDepth ?? "balanced",
    refreshInterval: interval, nextRefreshAt: next,
    refreshPaused: paused, refreshFailures: failures, updatedAt: now,
  } });
  if (!updated.matchedCount) throw new Error("This API is running. Wait for the run to finish before changing settings.");
  return (await getApiJob(jobId))!;
}
export async function deleteApiJob(jobId: string): Promise<boolean> {
  const { client, jobs, runs, records } = await collections();
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const deleted = await jobs.findOneAndDelete({ id: jobId, status: { $nin: activeStatuses } }, { session });
      if (!deleted) {
        if (await jobs.findOne({ id: jobId }, { session })) throw new Error("This API is running. Wait for the run to finish before deleting it.");
        return false;
      }
      await runs.deleteMany({ jobId }, { session });
      await records.deleteMany({ jobId }, { session });
      return true;
    }) ?? false;
  } finally { await session.endSession(); }
}

/** For isolated integration tests and graceful process shutdown. */
export async function closeMongoStore(): Promise<void> {
  if (!connection) return;
  const { client } = await connection;
  connection = undefined;
  await client.close();
}
