import "server-only";

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Dataset, DatasetRecord } from "./types";

const dbPath = process.env.WEBFORGE_DB_PATH || join(process.cwd(), ".data", "webforge.sqlite");

declare global {
  // Reuse the handle during Next.js hot reloads.
  var webforgeDatabase: DatabaseSync | undefined;
}

function database(): DatabaseSync {
  if (!globalThis.webforgeDatabase) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        source_urls_json TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
        source_url TEXT NOT NULL,
        data_json TEXT NOT NULL,
        field_status_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(dataset_id, source_url)
      );
      CREATE INDEX IF NOT EXISTS records_dataset_idx ON records(dataset_id);
    `);
    db.exec("PRAGMA foreign_keys = ON;");
    globalThis.webforgeDatabase = db;
  }
  return globalThis.webforgeDatabase;
}

type DatasetRow = {
  id: string; name: string; prompt: string; mode: Dataset["mode"];
  status: Dataset["status"]; fields_json: string; source_urls_json: string;
  error: string | null; created_at: string; updated_at: string;
};

type RecordRow = {
  id: string; dataset_id: string; source_url: string; data_json: string;
  field_status_json: string; evidence_json: string; updated_at: string;
};

function mapDataset(row: DatasetRow): Dataset {
  return {
    id: row.id, name: row.name, prompt: row.prompt, mode: row.mode,
    status: row.status, fields: JSON.parse(row.fields_json),
    sourceUrls: JSON.parse(row.source_urls_json), error: row.error,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapRecord(row: RecordRow): DatasetRecord {
  return {
    id: row.id, datasetId: row.dataset_id, sourceUrl: row.source_url,
    data: JSON.parse(row.data_json), fieldStatus: JSON.parse(row.field_status_json),
    evidence: JSON.parse(row.evidence_json), updatedAt: row.updated_at,
  };
}

export function listDatasets(): Dataset[] {
  return (database().prepare("SELECT * FROM datasets ORDER BY updated_at DESC").all() as DatasetRow[]).map(mapDataset);
}

export function getDataset(id: string): Dataset | null {
  const row = database().prepare("SELECT * FROM datasets WHERE id = ?").get(id) as DatasetRow | undefined;
  return row ? mapDataset(row) : null;
}

export function saveDataset(item: Dataset): void {
  database().prepare(`
    INSERT INTO datasets (id,name,prompt,mode,status,fields_json,source_urls_json,error,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, status=excluded.status, fields_json=excluded.fields_json,
      source_urls_json=excluded.source_urls_json, error=excluded.error, updated_at=excluded.updated_at
  `).run(item.id, item.name, item.prompt, item.mode, item.status, JSON.stringify(item.fields),
    JSON.stringify(item.sourceUrls), item.error, item.createdAt, item.updatedAt);
}

export function listRecords(datasetId: string): DatasetRecord[] {
  return (database().prepare("SELECT * FROM records WHERE dataset_id = ? ORDER BY source_url").all(datasetId) as RecordRow[]).map(mapRecord);
}

export function getRecord(datasetId: string, recordId: string): DatasetRecord | null {
  const row = database().prepare("SELECT * FROM records WHERE dataset_id = ? AND id = ?").get(datasetId, recordId) as RecordRow | undefined;
  return row ? mapRecord(row) : null;
}

export function replaceRecords(datasetId: string, records: DatasetRecord[]): void {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM records WHERE dataset_id = ?").run(datasetId);
    const statement = db.prepare(`
      INSERT INTO records (id,dataset_id,source_url,data_json,field_status_json,evidence_json,updated_at)
      VALUES (?,?,?,?,?,?,?)
    `);
    for (const record of records) {
      statement.run(record.id, record.datasetId, record.sourceUrl, JSON.stringify(record.data),
        JSON.stringify(record.fieldStatus), JSON.stringify(record.evidence), record.updatedAt);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
