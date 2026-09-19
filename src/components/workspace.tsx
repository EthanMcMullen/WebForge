"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiJobResponse, SourceStrategyType } from "@/lib/types";

type Config = { planner_ready: boolean; missing: string[] };

const statusLabels: Record<ApiJobResponse["status"], string> = {
  planning: "Planning",
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
  const [name, setName] = useState("");
  const [userRequest, setUserRequest] = useState("");
  const [strategy, setStrategy] = useState<SourceStrategyType>("automatic");
  const [sourceText, setSourceText] = useState("");
  const [refreshInterval, setRefreshInterval] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => jobs.find((job) => job.id === selectedId) || null,
    [jobs, selectedId],
  );

  const loadJobs = useCallback(async (preferredId?: string) => {
    const response = await fetch("/api/jobs", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load API jobs.");
    const result = await response.json() as { jobs: ApiJobResponse[] };
    setJobs(result.jobs);
    setSelectedId((current) => preferredId || current || result.jobs[0]?.id || null);
  }, []);

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
      setMessage(result.job.status === "failed" ? result.job.error : "API job planned successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create API job.");
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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">W</div><div><strong>WebForge</strong><span>API JOBS</span></div></div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <button className="nav-item active" onClick={() => setSelectedId(null)}><span className="nav-icon">＋</span> New API job</button>
        <div className="sidebar-section-label datasets-label">API JOBS <span>{jobs.length}</span></div>
        <div className="dataset-list">
          {jobs.length ? jobs.map((job) => (
            <button key={job.id} className={`dataset-item ${selectedId === job.id ? "selected" : ""}`} onClick={() => { setSelectedId(job.id); setMessage(null); }}>
              <span className="dataset-dot" />
              <span className="dataset-text"><strong>{job.name}</strong><small>{statusLabels[job.status]}</small></span>
            </button>
          )) : <p className="sidebar-empty">Your live API jobs will appear here.</p>}
        </div>
        <div className="sidebar-bottom"><div className={`connection-dot ${config?.planner_ready ? "on" : ""}`} /><span>{config?.planner_ready ? "Live planner ready" : "OpenAI key required"}</span></div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="breadcrumbs">API JOBS <span>/</span> {selected ? selected.name.toUpperCase() : "NEW"}</div><div className="top-right"><span className="version">LIVE PLANNING</span><span className="avatar">WF</span></div></header>
        {message && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage(null)} aria-label="Dismiss">×</button></div>}

        <div className="content">
          <div className="hero-eyebrow"><span className="sparkle">✦</span> NATURAL LANGUAGE TO API</div>
          <h1>Describe the data.<br /><em>Define the API job.</em></h1>
          <p className="hero-copy">Every request is planned live into a validated schema and stored as the central job that later discovery, scraping, extraction, and refresh stages will use.</p>

          <section className="composer panel">
            <div className="panel-heading"><span className="step-number">01</span><div><h2>Create an API job</h2><p>No sample data or fixed templates. Each schema is planned from this request.</p></div></div>
            <label className="input-label" htmlFor="job-name">NAME <span>OPTIONAL</span></label>
            <input id="job-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Generated automatically when omitted" />
            <label className="input-label request-label" htmlFor="request">USER REQUEST</label>
            <textarea id="request" value={userRequest} onChange={(event) => setUserRequest(event.target.value)} rows={4} placeholder="Describe the public web data your API should contain…" />

            <div className="composer-options">
              <div className="mode-group" role="group" aria-label="Source strategy">
                <button type="button" className={strategy === "automatic" ? "mode active" : "mode"} onClick={() => setStrategy("automatic")}>Automatic discovery</button>
                <button type="button" className={strategy === "provided_urls" ? "mode active" : "mode"} onClick={() => setStrategy("provided_urls")}>Provided URLs</button>
              </div>
              <span className="mode-hint">Stored on the job; scraping is intentionally not active yet.</span>
            </div>

            {strategy === "provided_urls" && <div className="seed-block"><label className="input-label" htmlFor="sources">SOURCES <span>ONE PUBLIC URL PER LINE</span></label><textarea id="sources" rows={3} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="https://example.com/source" /></div>}
            <div className="interval-row"><label className="input-label" htmlFor="interval">REFRESH INTERVAL <span>MINUTES · OPTIONAL</span></label><input id="interval" className="text-input interval-input" type="number" min="15" value={refreshInterval} onChange={(event) => setRefreshInterval(event.target.value)} placeholder="Manual" /></div>
            <div className="composer-footer"><span>Request → live plan → validated schema → stored API job</span><button className="primary-button" onClick={createJob} disabled={busy || userRequest.trim().length < 10 || !config?.planner_ready}>{busy ? "Planning…" : "Plan API job"}<span>↗</span></button></div>
          </section>

          {selected && <>
            <section className="overview-grid">
              <div className="metric panel"><span>JOB</span><strong>{selected.name}</strong><small>{selected.id}</small></div>
              <div className="metric panel"><span>STATUS</span><strong className={`metric-status ${selected.status}`}>{statusLabels[selected.status]}</strong><small>Updated {new Date(selected.updated_at).toLocaleString()}</small></div>
              <div className="metric panel"><span>SCHEMA FIELDS</span><strong>{Object.keys(selected.schema).length}</strong><small>Validated fields</small></div>
              <div className="metric panel"><span>REFRESH</span><strong>{selected.refresh_interval ? `${selected.refresh_interval}m` : "Manual"}</strong><small>{selected.source_strategy.type.replaceAll("_", " ")}</small></div>
            </section>

            {selected.error && <div className="error-banner job-error">{selected.error}</div>}

            <section className="records-section panel">
              <div className="section-header"><div><div className="section-kicker">02 / JOB DEFINITION</div><h2>Record schema</h2><p>Every future extracted record must satisfy this schema.</p></div></div>
              <div className="table-wrap"><table><thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead><tbody>{Object.entries(selected.schema).map(([key, field]) => <tr key={key}><td><code>{key}</code></td><td><span className="status-pill sample">{field.type}</span></td><td>{field.description || "—"}</td></tr>)}</tbody></table></div>
            </section>

            <section className="api-section panel"><div><div className="section-kicker">03 / API JOB</div><h2>Job endpoints</h2><p>The record endpoint will be added with the extraction stage.</p></div><div className="endpoint-list"><div className="endpoint"><span className="method">GET</span><code>{jobPath}</code><button onClick={() => void copyEndpoint(jobPath)}>Copy ↗</button></div><div className="endpoint"><span className="method">GET</span><code>{schemaPath}</code><button onClick={() => void copyEndpoint(schemaPath)}>Copy ↗</button></div></div></section>
          </>}
        </div>
      </main>
    </div>
  );
}
