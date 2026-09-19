"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dataset, DatasetRecord, FieldEvidence, FieldStatus } from "@/lib/types";

type Config = { liveReady: boolean; jevReady: boolean; missing: string[] };

const samplePrompt = "Create an API that tracks laptop name, price, availability, color, and whether it has USB-C ports.";

function formatValue(value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function statusLabel(status: FieldStatus): string {
  return ({ verified: "Verified", unknown: "Unknown", conflicting: "Conflict", unverified: "Needs review", stale: "Stale", sample: "Sample" })[status];
}

export function Workspace() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [records, setRecords] = useState<DatasetRecord[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [prompt, setPrompt] = useState(samplePrompt);
  const [seedUrls, setSeedUrls] = useState("");
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ title: string; items: FieldEvidence[] } | null>(null);

  const selected = useMemo(() => datasets.find((item) => item.id === selectedId) || null, [datasets, selectedId]);

  const loadDatasets = useCallback(async (preferredId?: string) => {
    const response = await fetch("/api/datasets", { cache: "no-store" });
    const result = await response.json() as { datasets: Dataset[] };
    setDatasets(result.datasets);
    setSelectedId((current) => preferredId || current || result.datasets[0]?.id || null);
  }, []);

  useEffect(() => {
    void fetch("/api/datasets", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { datasets: Dataset[] }) => {
        setDatasets(result.datasets);
        setSelectedId(result.datasets[0]?.id || null);
      }).catch(() => setMessage("Could not load datasets."));
    void fetch("/api/config").then((response) => response.json()).then(setConfig).catch(() => {});
  }, [loadDatasets]);

  useEffect(() => {
    if (!selectedId) return;
    void fetch(`/api/datasets/${selectedId}/records`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { records: Array<{ id: string; source_url: string; data: DatasetRecord["data"]; field_status: DatasetRecord["fieldStatus"]; updated_at: string }> }) => {
        setRecords(result.records.map((item) => ({
          id: item.id, datasetId: selectedId, sourceUrl: item.source_url,
          data: item.data, fieldStatus: item.field_status, evidence: [], updatedAt: item.updated_at,
        })));
      }).catch(() => setMessage("Could not load records."));
  }, [selectedId, datasets]);

  async function createDataset() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/datasets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, mode, seedUrls: seedUrls.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }),
      });
      const result = await response.json() as { dataset?: Dataset; error?: string };
      if (!response.ok || !result.dataset) throw new Error(result.error || "Could not create dataset.");
      await loadDatasets(result.dataset.id);
      setMessage(result.dataset.status === "error" ? result.dataset.error : `${result.dataset.name} is ready.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create dataset.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/datasets/${selected.id}/refresh`, { method: "POST" });
      const result = await response.json() as { dataset?: Dataset; error?: string };
      if (!response.ok || !result.dataset) throw new Error(result.error || "Refresh failed.");
      await loadDatasets(selected.id);
      setMessage(result.dataset.status === "error" ? result.dataset.error : "Refresh complete.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  async function showEvidence(record: DatasetRecord) {
    const response = await fetch(`/api/datasets/${record.datasetId}/records/${record.id}/evidence`);
    const result = await response.json() as { evidence: FieldEvidence[] };
    setEvidence({ title: formatValue(record.data.name || record.data.title || "Record evidence"), items: result.evidence });
  }

  async function copyEndpoint(path: string) {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setMessage("Endpoint copied to clipboard.");
  }

  const recordsPath = selected ? `/api/datasets/${selected.id}/records` : "";
  const schemaPath = selected ? `/api/datasets/${selected.id}/schema` : "";
  const evidenceCount = records.reduce((sum, record) => sum + Object.values(record.fieldStatus).filter((status) => status === (selected?.mode === "demo" ? "sample" : "verified")).length, 0);
  const totalCount = records.length * (selected?.fields.length || 0);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">W</div><div><strong>WebForge</strong><span>WEB DATA, REBUILT</span></div></div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <button className="nav-item active" onClick={() => setSelectedId(null)}><span className="nav-icon">＋</span> New dataset</button>
        <div className="sidebar-section-label datasets-label">YOUR DATASETS <span>{datasets.length}</span></div>
        <div className="dataset-list">
          {datasets.length ? datasets.map((item) => (
            <button key={item.id} className={`dataset-item ${selectedId === item.id ? "selected" : ""}`} onClick={() => { setSelectedId(item.id); setMessage(null); }}>
              <span className="dataset-dot" /><span className="dataset-text"><strong>{item.name}</strong><small>{item.mode === "demo" ? "Demo dataset" : "Live dataset"}</small></span>
            </button>
          )) : <p className="sidebar-empty">Your datasets will appear here.</p>}
        </div>
        <div className="sidebar-bottom"><div className={`connection-dot ${config?.liveReady ? "on" : ""}`} /><span>{config?.liveReady ? "Live integrations ready" : "Demo mode available"}</span></div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="breadcrumbs">WORKSPACE <span>/</span> {selected ? selected.name.toUpperCase() : "NEW DATASET"}</div><div className="top-right"><span className="version">MVP · V0.1</span><span className="avatar">WF</span></div></header>
        {message && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage(null)} aria-label="Dismiss">×</button></div>}

        <div className="content">
          <div className="hero-eyebrow"><span className="sparkle">✦</span> INTELLIGENCE FOR THE OPEN WEB</div>
          <h1>Describe the data.<br /><em>Get an API.</em></h1>
          <p className="hero-copy">Turn messy public pages into structured, evidence-backed data your team can actually use.</p>

          <section className="composer panel">
            <div className="panel-heading"><span className="step-number">01</span><div><h2>What data do you need?</h2><p>Write a plain-English request. We’ll build the schema and find the source pages.</p></div></div>
            <label className="input-label" htmlFor="prompt">YOUR REQUEST</label>
            <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder="Create an API that tracks..." />
            <div className="composer-options">
              <div className="mode-group" role="group" aria-label="Dataset mode">
                <button className={mode === "demo" ? "mode active" : "mode"} onClick={() => setMode("demo")}>✦ Demo</button>
                <button className={mode === "live" ? "mode active" : "mode"} onClick={() => setMode("live")}>◉ Live sources</button>
              </div>
              <span className="mode-hint">{mode === "demo" ? "Fictional laptop records, no API keys needed" : config?.liveReady ? "Browserbase + OpenAI connected" : "Add API keys to .env.local first"}</span>
            </div>
            {mode === "live" && <div className="seed-block"><label className="input-label" htmlFor="seedUrls">SOURCE URLS <span>OPTIONAL · ONE PER LINE</span></label><textarea id="seedUrls" rows={2} value={seedUrls} onChange={(event) => setSeedUrls(event.target.value)} placeholder="https://example.com/product-page" /><small>Leave blank to discover sources automatically. Up to 10 public URLs.</small></div>}
            <div className="composer-footer"><span>⟡ Schema → sources → evidence → API</span><button className="primary-button" onClick={createDataset} disabled={busy || prompt.trim().length < 10 || (mode === "live" && !config?.liveReady)}>{busy ? "Working…" : "Forge dataset"}<span>↗</span></button></div>
          </section>

          {selected ? <>
            <section className="overview-grid">
              <div className="metric panel"><span>DATASET</span><strong>{selected.name}</strong><small>{selected.mode === "demo" ? "Illustrative sample data" : `${selected.sourceUrls.length} live sources`}</small></div>
              <div className="metric panel"><span>RECORDS</span><strong>{records.length}</strong><small>Structured objects</small></div>
              <div className="metric panel"><span>{selected.mode === "demo" ? "SAMPLE FIELDS" : "FIELD EVIDENCE"}</span><strong>{evidenceCount}<i>/{totalCount}</i></strong><small>{selected.mode === "demo" ? "Illustrative values" : "Verified values"}</small></div>
              <div className="metric panel"><span>STATUS</span><strong className={`metric-status ${selected.status}`}>{selected.status}</strong><small>Updated {new Date(selected.updatedAt).toLocaleString()}</small></div>
            </section>

            <section className="records-section panel">
              <div className="section-header"><div><div className="section-kicker">02 / STRUCTURED OUTPUT</div><h2>Records</h2><p>Every value has a status. Open a row to inspect its source evidence.</p></div><button className="ghost-button" onClick={refresh} disabled={busy}>{busy ? "Refreshing…" : "↻ Refresh"}</button></div>
              {selected.error && <div className="error-banner">{selected.error}</div>}
              <div className="table-wrap"><table><thead><tr><th>Source</th>{selected.fields.map((field) => <th key={field.key}>{field.label}</th>)}<th>Evidence</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td className="source-cell"><a href={record.sourceUrl} target="_blank" rel="noreferrer">{selected.mode === "demo" ? `Sample ${records.indexOf(record) + 1}` : new URL(record.sourceUrl).hostname}<span>↗</span></a></td>{selected.fields.map((field) => <td key={field.key}><div className="cell-value">{formatValue(record.data[field.key])}</div><span className={`status-pill ${record.fieldStatus[field.key]}`}>{statusLabel(record.fieldStatus[field.key])}</span></td>)}<td><button className="evidence-button" onClick={() => void showEvidence(record)}>View →</button></td></tr>)}</tbody></table>{!records.length && <div className="empty-records">No records yet. Try refreshing or add direct source URLs.</div>}</div>
            </section>

            <section className="api-section panel"><div><div className="section-kicker">03 / READY TO USE</div><h2>Your API is ready</h2><p>Copy an endpoint and request JSON from your app, script, or terminal.</p></div><div className="endpoint-list"><div className="endpoint"><span className="method">GET</span><code>{recordsPath}</code><button onClick={() => void copyEndpoint(recordsPath)}>Copy ↗</button></div><div className="endpoint"><span className="method">GET</span><code>{schemaPath}</code><button onClick={() => void copyEndpoint(schemaPath)}>Copy ↗</button></div></div></section>
          </> : <section className="how-it-works"><div className="how-title">FROM REQUEST TO ENDPOINT <span>↓</span></div><div className="how-grid"><div><span>01</span><strong>Describe</strong><p>Tell us what fields you want in everyday language.</p></div><div><span>02</span><strong>Discover</strong><p>Find public pages and extract from text and images.</p></div><div><span>03</span><strong>Verify</strong><p>Keep evidence and flag missing or uncertain values.</p></div><div><span>04</span><strong>Ship</strong><p>Serve clean JSON from a shareable API endpoint.</p></div></div></section>}
        </div>
      </main>

      {evidence && <div className="drawer-backdrop" onClick={() => setEvidence(null)}><aside className="drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><span className="section-kicker">SOURCE TRACE</span><h2>{evidence.title}</h2></div><button onClick={() => setEvidence(null)} aria-label="Close evidence">×</button></div><div className="drawer-content">{evidence.items.map((item, index) => <div className="evidence-card" key={`${item.field}-${index}`}><div className="evidence-top"><strong>{item.field.replaceAll("_", " ")}</strong><span className={`status-pill ${item.status}`}>{statusLabel(item.status)}</span></div><div className="evidence-value">{formatValue(item.proposedValue)}</div><p>{item.quote || "No supporting quote available."}</p>{item.imageUrl && <a href={item.imageUrl} target="_blank" rel="noreferrer">View source image ↗</a>}<small>{item.reason}</small></div>)}</div></aside></div>}
    </div>
  );
}
