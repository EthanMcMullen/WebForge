"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiJobResponse, SourceStrategyType } from "@/lib/types";

type Config = { planner_ready: boolean; extraction_ready: boolean; missing: string[] };
type ApiRecordResponse = { id: string; job_id: string; source_url: string; data: Record<string, string | number | boolean | null>; extracted_at: string };

const statusLabels: Record<ApiJobResponse["status"], string> = {
  planning: "Planning",
  awaiting_fields: "Choose fields",
  planned: "Planned",
  discovering: "Discovering",
  scraping: "Scraping",
  extracting: "Extracting",
  storing: "Storing",
  ready: "Ready",
  failed: "Failed",
};

export function Workspace() {
  const [jobs, setJobs] = useState<ApiJobResponse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [records, setRecords] = useState<ApiRecordResponse[]>([]);
  const [name, setName] = useState("");
  const [userRequest, setUserRequest] = useState("");
  const [strategy, setStrategy] = useState<SourceStrategyType>("automatic");
  const [sourceText, setSourceText] = useState("");
  const [refreshInterval, setRefreshInterval] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldSelections, setFieldSelections] = useState<Record<string, string[]>>({});

  const selected = useMemo(
    () => jobs.find((job) => job.id === selectedId) || null,
    [jobs, selectedId],
  );

  const selectedFields = selected?.status === "awaiting_fields"
    ? fieldSelections[selected.id] ?? Object.keys(selected.proposed_schema).filter((key) => key !== "source_url")
    : [];

  const previewSchema = selected?.status === "awaiting_fields"
    ? Object.fromEntries(Object.entries(selected.proposed_schema)
      .filter(([key]) => key === "source_url" || selectedFields.includes(key)))
    : null;

  const loadJobs = useCallback(async (preferredId?: string) => {
    const response = await fetch("/api/jobs", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load API jobs.");
    const result = await response.json() as { jobs: ApiJobResponse[] };
    setJobs(result.jobs);
    setSelectedId((current) => preferredId || current || result.jobs[0]?.id || null);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void fetch(`/api/jobs/${selectedId}/records`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { records?: ApiRecordResponse[] }) => setRecords(result.records || []))
      .catch(() => setRecords([]));
  }, [selectedId, jobs]);

  useEffect(() => {
    void fetch("/api/jobs", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load API jobs.");
        return response.json() as Promise<{ jobs: ApiJobResponse[] }>;
      })
      .then((result) => {
        setJobs(result.jobs);
        setSelectedId(result.jobs[0]?.id || null);
      })
      .catch((error: Error) => setMessage(error.message));
    void fetch("/api/config")
      .then((response) => response.json())
      .then((result: Config) => setConfig(result))
      .catch(() => setMessage("Could not load configuration."));
  }, [loadJobs]);

  async function createJob() {
    setBusy(true);
    setMessage(null);
    try {
      const sources = sourceText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(name.trim() ? { name: name.trim() } : {}),
          user_request: userRequest,
          source_strategy: { type: strategy, search_queries: [] },
          sources,
          refresh_interval: refreshInterval ? Number(refreshInterval) : null,
        }),
      });
      const result = await response.json() as { job?: ApiJobResponse; error?: string };
      if (!response.ok || !result.job) throw new Error(result.error || "Could not create API job.");
      await loadJobs(result.job.id);
      if (result.job.status === "failed") {
        setMessage(result.job.error || "Planning failed.");
        return;
      }
      setMessage("Choose the fields below, then confirm to build the API.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create API job.");
    } finally {
      setBusy(false);
    }
  }

  async function runJob(jobId: string, action: "run" | "refresh") {
    const progress = window.setInterval(() => { void loadJobs(jobId); }, 1500);
    try {
      const response = await fetch(`/api/jobs/${jobId}/${action}`, { method: "POST" });
      const result = await response.json() as { job?: ApiJobResponse; error?: string };
      await loadJobs(jobId);
      setMessage(result.job?.error || result.error || (response.ok ? "API records are ready." : "Extraction failed."));
    } finally { window.clearInterval(progress); }
  }

  async function confirmFields() {
    if (!selected || selected.status !== "awaiting_fields" || selectedFields.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const jobId = selected.id;
      const response = await fetch(`/api/jobs/${jobId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_fields: selectedFields }),
      });
      const result = await response.json() as { job?: ApiJobResponse; error?: string };
      if (!response.ok || !result.job) throw new Error(result.error || "Could not confirm fields.");
      await loadJobs(jobId);
      if (!config?.extraction_ready) {
        setMessage("Fields saved. Add FIRECRAWL_API_KEY, then click Run now.");
        return;
      }
      await runJob(jobId, "run");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not build the API.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshJob() {
    if (!selected || selected.status === "awaiting_fields") return;
    setBusy(true);
    setMessage(null);
    try {
      await runJob(selected.id, selected.status === "planned" ? "run" : "refresh");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyEndpoint(path: string) {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setMessage("Endpoint copied to clipboard.");
  }

  const jobPath = selected ? `/api/jobs/${selected.id}` : "";
  const schemaPath = selected ? `/api/jobs/${selected.id}/schema` : "";
  const recordsPath = selected ? `/api/jobs/${selected.id}/records` : "";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">W</div><div><strong>WebForge</strong><span>API JOBS</span></div></div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <button className="nav-item active" onClick={() => setSelectedId(null)}><span className="nav-icon">ï¼‹</span> New API job</button>
        <div className="sidebar-section-label datasets-label">API JOBS <span>{jobs.length}</span></div>
        <div className="dataset-list">
          {jobs.length ? jobs.map((job) => (
            <button key={job.id} className={`dataset-item ${selectedId === job.id ? "selected" : ""}`} onClick={() => { setSelectedId(job.id); setMessage(null); }}>
              <span className="dataset-dot" />
              <span className="dataset-text"><strong>{job.name}</strong><small>{statusLabels[job.status]}</small></span>
            </button>
          )) : <p className="sidebar-empty">Your API jobs will appear here.</p>}
        </div>
        <div className="sidebar-bottom"><div className={`connection-dot ${config?.planner_ready ? "on" : ""}`} /><span>{config?.planner_ready && config?.extraction_ready ? "OpenAI + Firecrawl ready" : `${config?.missing.join(", ") || "Keys"} required`}</span></div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="breadcrumbs">API JOBS <span>/</span> {selected ? selected.name.toUpperCase() : "NEW"}</div><div className="top-right"><span className="version">LIVE API</span><span className="avatar">WF</span></div></header>
        {message && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage(null)} aria-label="Dismiss">Ã—</button></div>}

        <div className="content">
          <div className="hero-eyebrow"><span className="sparkle">âœ¦</span> NATURAL LANGUAGE TO API</div>
          <h1>Describe the data.<br /><em>Get a live API.</em></h1>
          <p className="hero-copy">Describe public web data in plain English. WebForge plans the fields, finds sources, extracts records, and serves them as JSON.</p>

          <section className="composer panel">
            <div className="panel-heading"><span className="step-number">01</span><div><h2>Plan an API job</h2><p>OpenAI proposes fields first. You choose which data to include before extraction begins.</p></div></div>
            <label className="input-label" htmlFor="job-name">NAME <span>OPTIONAL</span></label>
            <input id="job-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Generated automatically when omitted" />
            <label className="input-label request-label" htmlFor="request">USER REQUEST</label>
            <textarea id="request" value={userRequest} onChange={(event) => setUserRequest(event.target.value)} rows={4} placeholder="Describe the public web data your API should containâ€¦" />

            <div className="composer-options">
              <div className="mode-group" role="group" aria-label="Source strategy">
                <button type="button" className={strategy === "automatic" ? "mode active" : "mode"} onClick={() => setStrategy("automatic")}>Automatic discovery</button>
                <button type="button" className={strategy === "provided_urls" ? "mode active" : "mode"} onClick={() => setStrategy("provided_urls")}>Provided URLs</button>
              </div>
              <span className="mode-hint">Automatic discovery tries up to three pages per run, with one bounded recovery search. You can provide up to five URLs; each run tries at most three.</span>
            </div>

            {strategy === "provided_urls" && <div className="seed-block"><label className="input-label" htmlFor="sources">SOURCES <span>ONE PUBLIC URL PER LINE</span></label><textarea id="sources" rows={3} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="https://example.com/source" /></div>}
            <div className="interval-row"><label className="input-label" htmlFor="interval">REFRESH INTERVAL <span>MINUTES Â· OPTIONAL Â· MANUAL REFRESH IN MVP</span></label><input id="interval" className="text-input interval-input" type="number" min="15" value={refreshInterval} onChange={(event) => setRefreshInterval(event.target.value)} placeholder="Manual" /></div>
            <div className="composer-footer"><span>Request â†’ plan â†’ Firecrawl â†’ records â†’ API</span><button className="primary-button" onClick={createJob} disabled={busy || userRequest.trim().length < 10 || !config?.planner_ready}>{busy ? "Planningâ€¦" : "Propose fields"}<span>â†—</span></button></div>
          </section>

          {selected && <>
            <section className="overview-grid">
              <div className="metric panel"><span>JOB</span><strong>{selected.name}</strong><small>{selected.id}</small></div>
              <div className="metric panel"><span>STATUS</span><strong className={`metric-status ${selected.status}`}>{statusLabels[selected.status]}</strong><small>Updated {new Date(selected.updated_at).toLocaleString()}</small></div>
              <div className="metric panel"><span>SCHEMA FIELDS</span><strong>{Object.keys(selected.status === "awaiting_fields" ? selected.proposed_schema : selected.schema).length}</strong><small>{selected.status === "awaiting_fields" ? "Awaiting your selection" : `${records.length} records stored`}</small></div>
              <div className="metric panel"><span>REFRESH</span><strong>{selected.refresh_interval ? `${selected.refresh_interval}m` : "Manual"}</strong><small>{selected.source_strategy.type.replaceAll("_", " ")} Â· manual run</small></div>
            </section>

            {selected.run_summary && <div className="run-summary panel" aria-label="Latest run summary">
              <strong>Latest run</strong>
              <span>{selected.run_summary.saved_records} saved</span>
              <span>{selected.run_summary.skipped_sources} skipped</span>
              <span>{selected.run_summary.search_calls} searches</span>
              <span>{selected.run_summary.scrape_calls} scrapes</span>
              <span>{selected.run_summary.recovery_calls} recovery decisions</span>
              {selected.run_summary.stop_reason && <small>{selected.run_summary.stop_reason}</small>}
            </div>}

            {selected.error && <div className="error-banner job-error">{selected.error}</div>}

            {selected.status === "awaiting_fields" && <section className="field-review panel">
              <div className="section-kicker">02 / REVIEW FIELDS</div>
              <h2>Choose your API fields</h2>
              <p>OpenAI proposed these data fields. Select what each record should contain before Firecrawl runs.</p>
              <div className="field-options">
                {Object.entries(selected.proposed_schema).filter(([key]) => key !== "source_url").map(([key, field]) => (
                  <label className="field-option" key={key}>
                    <input type="checkbox" checked={selectedFields.includes(key)}
                      onChange={(event) => setFieldSelections((choices) => ({
                        ...choices,
                        [selected.id]: event.target.checked
                          ? [...selectedFields, key] : selectedFields.filter((item) => item !== key),
                      }))} />
                    <span><strong>{key}</strong><small>{field.type} - {field.description || "No description"}</small></span>
                  </label>
                ))}
                <div className="field-option fixed"><span><strong>source_url</strong><small>Always included so each record links to its source.</small></span></div>
              </div>
              <div className="input-label">JSON SCHEMA PREVIEW</div>
              <pre className="schema-preview" aria-label="Selected JSON schema preview">{JSON.stringify(previewSchema, null, 2)}</pre>
              <div className="field-review-footer">
                <span>{selectedFields.length} data field{selectedFields.length === 1 ? "" : "s"} selected</span>
                <button className="primary-button" onClick={() => void confirmFields()} disabled={busy || selectedFields.length === 0}>
                  {busy ? "Building API..." : "Confirm fields and build API"}
                </button>
              </div>
            </section>}

            {selected.status !== "awaiting_fields" && <>
            <section className="records-section panel">
              <div className="section-header"><div><div className="section-kicker">02 / JOB DEFINITION</div><h2>Record schema</h2><p>Firecrawl extracts these fields from each source page.</p></div></div>
              <div className="table-wrap"><table><thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead><tbody>{Object.entries(selected.schema).map(([key, field]) => <tr key={key}><td><code>{key}</code></td><td><span className="status-pill sample">{field.type}</span></td><td>{field.description || "â€”"}</td></tr>)}</tbody></table></div>
            </section>

            <section className="records-section panel">
              <div className="section-header"><div><div className="section-kicker">03 / LIVE DATA</div><h2>Records</h2><p>One record per source page. Missing values appear as null.</p></div><button className="ghost-button" onClick={() => void refreshJob()} disabled={busy || !config?.extraction_ready}>{busy ? "Running..." : selected.status === "planned" ? "Run now" : "Refresh now"}</button></div>
              {records.length ? <div className="table-wrap"><table><thead><tr>{Object.keys(selected.schema).map((key) => <th key={key}>{key}</th>)}<th>Extracted</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}>{Object.keys(selected.schema).map((key) => <td key={key}>{key === "source_url" ? <a href={record.source_url} target="_blank" rel="noreferrer">Source â†—</a> : record.data[key] === null || record.data[key] === undefined ? "null" : String(record.data[key])}</td>)}<td>{new Date(record.extracted_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="empty-records">No records yet. Run or refresh this job after configuring Firecrawl.</p>}
            </section>

            <section className="api-section panel"><div><div className="section-kicker">04 / API</div><h2>API endpoints</h2><p>Copy the records URL to use the extracted JSON.</p></div><div className="endpoint-list"><div className="endpoint"><span className="method">GET</span><code>{recordsPath}</code><button onClick={() => void copyEndpoint(recordsPath)}>Copy â†—</button></div><div className="endpoint"><span className="method">GET</span><code>{jobPath}</code><button onClick={() => void copyEndpoint(jobPath)}>Copy â†—</button></div><div className="endpoint"><span className="method">GET</span><code>{schemaPath}</code><button onClick={() => void copyEndpoint(schemaPath)}>Copy â†—</button></div></div></section>
            </>}
          </>}
        </div>
      </main>
    </div>
  );
}
