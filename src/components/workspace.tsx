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

type WorkspaceView = "home" | "new" | "library" | "detail";

export function Workspace() {
  const [jobs, setJobs] = useState<ApiJobResponse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
  const [apiSettingsJobId, setApiSettingsJobId] = useState<string | null>(null);
  const [accessState, setAccessState] = useState<"checking" | "unlocked" | "locked" | "missing">("checking");
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editInterval, setEditInterval] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
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
    setSelectedId((current) => {
      const candidate = preferredId || current;
      return result.jobs.some((job) => job.id === candidate) ? candidate : result.jobs[0]?.id || null;
    });
  }, []);

  useEffect(() => {
    if (!selectedId || accessState !== "unlocked") return;
    void fetch(`/api/jobs/${selectedId}/records`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { records?: ApiRecordResponse[] }) => setRecords(result.records || []))
      .catch(() => setRecords([]));
  }, [selectedId, jobs, accessState]);


  useEffect(() => {
    void fetch("/api/access", { cache: "no-store" })
      .then((response) => response.json())
      .then((state: { required: boolean; configured: boolean; authenticated: boolean }) => {
        setAccessRequired(state.required);
        setAccessState(state.authenticated ? "unlocked" : state.configured ? "locked" : "missing");
      })
      .catch(() => setAccessState("missing"));
  }, []);

  useEffect(() => {
    if (accessState !== "unlocked") return;
    void fetch("/api/jobs", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load API jobs.");
        return response.json() as Promise<{ jobs: ApiJobResponse[] }>;
      })
      .then((result) => { setJobs(result.jobs); setSelectedId(result.jobs[0]?.id || null); })
      .catch((error: Error) => setMessage(error.message));
    void fetch("/api/config")
      .then((response) => response.json())
      .then((result: Config) => setConfig(result))
      .catch(() => setMessage("Could not load configuration."));
  }, [accessState, loadJobs]);

  async function unlockWorkspace() {
    setAccessMessage(null);
    const response = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: accessToken }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setAccessMessage(result.error || "Could not unlock WebForge."); return; }
    setAccessToken("");
    setAccessState("unlocked");
  }

  async function lockWorkspace() {
    await fetch("/api/access", { method: "DELETE" });
    setJobs([]); setRecords([]); setConfig(null); setSelectedId(null); setSettingsOpen(false);
    setAccessState("locked");
  }

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
      setView("detail");
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

  function openApiSettings() {
    if (!selected) return;
    setApiSettingsJobId(selected.id);
    setEditName(selected.name);
    setEditInterval(selected.refresh_interval ? String(selected.refresh_interval) : "");
    setDeleteArmed(false);
    setApiSettingsOpen(true);
  }

  async function saveApiSettings() {
    if (!selected || selected.id !== apiSettingsJobId || editName.trim().length < 3) return;
    const targetId = apiSettingsJobId;
    setBusy(true);
    try {
      const response = await fetch(`/api/jobs/${targetId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), refresh_interval: editInterval ? Number(editInterval) : null }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save API settings.");
      await loadJobs(targetId);
      setApiSettingsOpen(false);
      setMessage("API settings saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save API settings."); }
    finally { setBusy(false); }
  }

  async function removeApi() {
    if (!selected || selected.id !== apiSettingsJobId || !deleteArmed) return;
    const targetId = apiSettingsJobId;
    setBusy(true);
    try {
      const response = await fetch(`/api/jobs/${targetId}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not delete API.");
      setApiSettingsOpen(false);
      setSelectedId(null);
      await loadJobs();
      setView("library");
      setMessage("API deleted.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete API."); }
    finally { setBusy(false); }
  }
  async function copyEndpoint(path: string) {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setMessage("Endpoint copied to clipboard.");
  }

  const jobPath = selected ? `/api/jobs/${selected.id}` : "";
  const schemaPath = selected ? `/api/jobs/${selected.id}/schema` : "";
  const recordsPath = selected ? `/api/jobs/${selected.id}/records` : "";
  const readyJobs = jobs.filter((job) => job.status === "ready");
  const storedRecords = jobs.reduce((total, job) => total + job.record_count, 0);
  const latestJob = jobs[0] || null;
  const screenTitle = view === "home" ? "HOME" : view === "new" ? "NEW API" : view === "library" ? "API LIBRARY" : selected?.name.toUpperCase() || "API DETAIL";

  if (accessState !== "unlocked") return (
    <main className="access-screen"><section className="access-card panel">
      <div className="brand-mark">W</div><div className="section-kicker">WEBFORGE WORKSPACE</div>
      <h1>{accessState === "checking" ? "Opening workspace" : accessState === "missing" ? "Workspace access needs setup" : "Unlock WebForge"}</h1>
      {accessState === "locked" ? <form onSubmit={(event) => { event.preventDefault(); void unlockWorkspace(); }}>
        <p>Enter the access token configured on this server.</p>
        <label className="input-label" htmlFor="access-token">ACCESS TOKEN</label>
        <input id="access-token" className="text-input" type="password" autoComplete="current-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} />
        {accessMessage && <p role="alert">{accessMessage}</p>}
        <button className="primary-button" type="submit" disabled={!accessToken}>Unlock workspace</button>
      </form> : accessState === "missing" ? <p>Set WEBFORGE_ACCESS_TOKEN on the server and restart WebForge.</p> : <p>Checking access...</p>}
    </section></main>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <button className="brand brand-button" onClick={() => { setSelectedId(null); setView("home"); }}><div className="brand-mark">W</div><div><strong>WebForge</strong><span>API PLATFORM</span></div></button>
        <div className="sidebar-section-label">WORKSPACE</div>
        <button className={`nav-item ${view === "home" ? "active" : ""}`} onClick={() => { setSelectedId(null); setView("home"); }}><span className="nav-icon">H</span> Home</button>
        <button className={`nav-item ${view === "library" ? "active" : ""}`} onClick={() => setView("library")}><span className="nav-icon">L</span> API library</button>
        <button className="nav-item active" onClick={() => { setSelectedId(null); setView("new"); }}><span className="nav-icon">+</span> New API job</button>
        <div className="sidebar-section-label datasets-label">API JOBS <span>{jobs.length}</span></div>
        <div className="dataset-list">
          {jobs.length ? jobs.map((job) => (
            <button key={job.id} className={`dataset-item ${selectedId === job.id && view === "detail" ? "selected" : ""}`} onClick={() => { setSelectedId(job.id); setView("detail"); setMessage(null); }}>
              <span className="dataset-dot" />
              <span className="dataset-text"><strong>{job.name}</strong><small>{statusLabels[job.status]}</small></span>
            </button>
          )) : <p className="sidebar-empty">Your API jobs will appear here.</p>}
        </div>
        <button className="sidebar-bottom settings-link" onClick={() => setSettingsOpen(true)}><span>Workspace settings</span><b>›</b></button>
      </aside>

      <main className="main">
        <header className="topbar"><div className="breadcrumbs">WEBFORGE <span>/</span> {screenTitle}</div><div className="top-right"><span className="version">LIVE API</span><button className="avatar" aria-label="Open settings" onClick={() => setSettingsOpen((open) => !open)}>WF</button></div></header>
        {message && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage(null)} aria-label="Dismiss">x</button></div>}
        {settingsOpen && <div className="settings-menu" role="dialog" aria-label="Workspace settings">
          <strong>Workspace settings</strong>
          <p>Connection status and account controls.</p>
          <div><span>OpenAI planner</span><b className={config?.planner_ready ? "good" : "bad"}>{config?.planner_ready ? "Connected" : "Needs key"}</b></div>
          <div><span>Firecrawl extraction</span><b className={config?.extraction_ready ? "good" : "bad"}>{config?.extraction_ready ? "Connected" : "Needs key"}</b></div>
          {accessRequired && <button className="ghost-button" onClick={() => void lockWorkspace()}>Lock workspace</button>}
          <button className="ghost-button" onClick={() => setSettingsOpen(false)}>Close settings</button>
        </div>}

        <div className="content">
          {view === "home" ? <>
            <div className="dashboard-hero"><div><div className="hero-eyebrow"><span className="sparkle">*</span> WEBFORGE WORKSPACE</div><h1>Your web data,<br /><em>ready to build with.</em></h1><p className="hero-copy">Create APIs from public websites, keep an eye on their latest runs, and ship the JSON your project needs.</p></div><button className="dashboard-create" onClick={() => setView("new")}><span>+</span><div><strong>Create an API</strong><small>Start from a plain-English request</small></div></button></div>
            <section className="dashboard-stats" aria-label="Workspace summary"><div className="stat-card panel"><span>ACTIVE APIS</span><strong>{jobs.length}</strong><small>{readyJobs.length} ready to use</small></div><div className="stat-card panel"><span>RECORDS CAPTURED</span><strong>{storedRecords}</strong><small>Stored across all APIs</small></div><div className="stat-card panel"><span>LAST UPDATED</span><strong>{latestJob ? new Date(latestJob.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "--"}</strong><small>{latestJob ? latestJob.name : "No APIs yet"}</small></div><div className="stat-card accent panel"><span>QUICK START</span><strong>New API</strong><button onClick={() => setView("new")}>Describe your data <span>&gt;</span></button></div></section>
            <section className="dashboard-grid"><div className="dashboard-panel panel"><div className="dashboard-heading"><div><div className="section-kicker">RECENT ACTIVITY</div><h2>What happened recently</h2></div><button className="text-button" onClick={() => setView("library")}>View library</button></div>{jobs.length ? <div className="activity-list">{jobs.slice(0, 4).map((job) => <button className="activity-item" key={job.id} onClick={() => { setSelectedId(job.id); setView("detail"); }}><span className={`activity-dot ${job.status}`} /><div><strong>{job.name}</strong><small>{statusLabels[job.status]}{job.run_summary ? ` / ${job.run_summary.saved_records} record${job.run_summary.saved_records === 1 ? "" : "s"} saved` : ""}</small></div><time>{new Date(job.updated_at).toLocaleDateString()}</time></button>)}</div> : <div className="dashboard-empty"><strong>Your activity will appear here.</strong><p>Create an API and WebForge will show its discovery and extraction results here.</p></div>}</div><div className="dashboard-panel panel"><div className="dashboard-heading"><div><div className="section-kicker">STARTER IDEAS</div><h2>Build something useful</h2></div></div><div className="template-list"><button onClick={() => { setUserRequest("Track product name, price, availability, and unit price for Golden Delicious apples at Walmart."); setView("new"); }}><span>01</span><div><strong>Product price tracker</strong><small>Prices and availability from retailers</small></div><b>&gt;</b></button><button onClick={() => { setUserRequest("Create an API for upcoming hackathons with name, location, application deadline, event dates, and official URL."); setView("new"); }}><span>02</span><div><strong>Event directory</strong><small>Dates, locations, and deadlines</small></div><b>&gt;</b></button><button onClick={() => { setUserRequest("Create an API for restaurant menus with restaurant name, item name, price, dietary tags, and source URL."); setView("new"); }}><span>03</span><div><strong>Menu monitor</strong><small>Items, prices, and dietary information</small></div><b>&gt;</b></button></div></div></section>
          </> : view === "new" ? <><div className="hero-eyebrow"><span className="sparkle">*</span> NATURAL LANGUAGE TO API</div><h1>Describe the data.<br /><em>Get a live API.</em></h1><p className="hero-copy">Describe public web data in plain English. WebForge plans the fields, finds sources, extracts records, and serves them as JSON.</p></> : null}
          {view === "library" && <section className="library-panel panel">
            <div className="section-header"><div><div className="section-kicker">API LIBRARY</div><h2>Your APIs</h2><p>Choose an API to see its data, history, controls, and endpoints.</p></div><button className="primary-button" onClick={() => { setSelectedId(null); setView("new"); }}>New API</button></div>
            {jobs.length ? <div className="library-list">{jobs.map((job) => <button key={job.id} className="library-item" onClick={() => { setSelectedId(job.id); setView("detail"); }}><span className={`library-status ${job.status}`} /><div><strong>{job.name}</strong><small>{statusLabels[job.status]} / {Object.keys(job.schema).length || Object.keys(job.proposed_schema).length} fields</small></div><time>{new Date(job.updated_at).toLocaleDateString()}</time><b>View</b></button>)}</div> : <div className="empty-state"><strong>No APIs yet</strong><p>Create your first API from a simple request.</p><button className="primary-button" onClick={() => setView("new")}>Create an API</button></div>}
          </section>}

          {view === "new" && <section className="composer panel">
            <div className="panel-heading"><span className="step-number">01</span><div><h2>Plan an API job</h2><p>OpenAI proposes fields first. You choose which data to include before extraction begins.</p></div></div>
            <label className="input-label" htmlFor="job-name">NAME <span>OPTIONAL</span></label>
            <input id="job-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Generated automatically when omitted" />
            <label className="input-label request-label" htmlFor="request">USER REQUEST</label>
            <textarea id="request" value={userRequest} onChange={(event) => setUserRequest(event.target.value)} rows={4} placeholder="Describe the public web data your API should contain..." />

            <div className="composer-options">
              <div className="mode-group" role="group" aria-label="Source strategy">
                <button type="button" className={strategy === "automatic" ? "mode active" : "mode"} onClick={() => setStrategy("automatic")}>Automatic discovery</button>
                <button type="button" className={strategy === "provided_urls" ? "mode active" : "mode"} onClick={() => setStrategy("provided_urls")}>Provided URLs</button>
              </div>
              <span className="mode-hint">Automatic discovery runs up to three planned searches, reviews source matches, and tries up to five pages per run, with one bounded recovery search. You can provide up to five URLs; each run tries at most five.</span>
            </div>

            {strategy === "provided_urls" && <div className="seed-block"><label className="input-label" htmlFor="sources">SOURCES <span>ONE PUBLIC URL PER LINE</span></label><textarea id="sources" rows={3} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="https://example.com/source" /></div>}
            <div className="interval-row"><label className="input-label" htmlFor="interval">REFRESH INTERVAL <span>MINUTES / OPTIONAL / MANUAL REFRESH IN MVP</span></label><input id="interval" className="text-input interval-input" type="number" min="15" value={refreshInterval} onChange={(event) => setRefreshInterval(event.target.value)} placeholder="Manual" /></div>
            <div className="composer-footer"><span>Request / plan / Firecrawl / records / API</span><button className="primary-button" onClick={createJob} disabled={busy || userRequest.trim().length < 10 || !config?.planner_ready}>{busy ? "Planning..." : "Propose fields"}<span aria-hidden="true">&gt;</span></button></div>
          </section>}

          {view === "detail" && selected && <>
            <section className="overview-grid">
              <div className="metric panel"><span>JOB</span><strong>{selected.name}</strong><small>{selected.id}</small></div>
              <div className="metric panel"><span>STATUS</span><strong className={`metric-status ${selected.status}`}>{statusLabels[selected.status]}</strong><small>Updated {new Date(selected.updated_at).toLocaleString()}</small></div>
              <div className="metric panel"><span>SCHEMA FIELDS</span><strong>{Object.keys(selected.status === "awaiting_fields" ? selected.proposed_schema : selected.schema).length}</strong><small>{selected.status === "awaiting_fields" ? "Awaiting your selection" : `${records.length} records stored`}</small></div>
              <div className="metric panel"><span>REFRESH</span><strong>{selected.refresh_interval ? `${selected.refresh_interval}m` : "Manual"}</strong><small>{selected.source_strategy.type.replaceAll("_", " ")} / manual run</small></div>
            </section>

            {selected.run_summary && <div className="run-summary panel" aria-label="Latest run summary">
              <strong>Latest run{selected.run_summary.outcome === "partial_stopped" ? " / Partial data" : ""}</strong>
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
              <div className="table-wrap"><table><thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead><tbody>{Object.entries(selected.schema).map(([key, field]) => <tr key={key}><td><code>{key}</code></td><td><span className="status-pill sample">{field.type}</span></td><td>{field.description || "-"}</td></tr>)}</tbody></table></div>
            </section>

            <section className="records-section panel">
              <div className="section-header"><div><div className="section-kicker">03 / LIVE DATA</div><h2>Records</h2><p>One record per source page. Missing values appear as null.</p></div><button className="ghost-button" onClick={() => void refreshJob()} disabled={busy || !config?.extraction_ready}>{busy ? "Running..." : selected.status === "planned" ? "Run now" : "Refresh now"}</button></div>
              {records.length ? <div className="table-wrap"><table><thead><tr>{Object.keys(selected.schema).map((key) => <th key={key}>{key}</th>)}<th>Extracted</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}>{Object.keys(selected.schema).map((key) => <td key={key}>{key === "source_url" ? <a href={record.source_url} target="_blank" rel="noreferrer">Source</a> : record.data[key] === null || record.data[key] === undefined ? "null" : String(record.data[key])}</td>)}<td>{new Date(record.extracted_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="empty-records">No records yet. Run or refresh this job after configuring Firecrawl.</p>}
            </section>

            <section className="api-section panel"><div><div className="section-kicker">04 / API</div><h2>API endpoints</h2><p>Copy the records URL to use the extracted JSON.</p></div><div className="endpoint-list"><div className="endpoint"><span className="method">GET</span><code>{recordsPath}</code><button onClick={() => void copyEndpoint(recordsPath)}>Copy</button></div><div className="endpoint"><span className="method">GET</span><code>{jobPath}</code><button onClick={() => void copyEndpoint(jobPath)}>Copy</button></div><div className="endpoint"><span className="method">GET</span><code>{schemaPath}</code><button onClick={() => void copyEndpoint(schemaPath)}>Copy</button></div></div></section>
            </>}
            <section className="api-settings panel"><div><div className="section-kicker">05 / API SETTINGS</div><h2>Manage this API</h2><p>Rename it, set its refresh interval, or remove it from this workspace.</p></div><button className="ghost-button" onClick={openApiSettings}>Open settings</button></section>
            {apiSettingsOpen && apiSettingsJobId === selected.id && <section className="api-settings-editor panel" role="dialog" aria-modal="true" aria-label="API settings"><div className="settings-editor-heading"><div><div className="section-kicker">API SETTINGS</div><h2>{selected.name}</h2></div><button onClick={() => setApiSettingsOpen(false)} aria-label="Close API settings">x</button></div><label className="input-label" htmlFor="api-name">API NAME</label><input id="api-name" className="text-input" value={editName} onChange={(event) => setEditName(event.target.value)} /><label className="input-label settings-interval-label" htmlFor="api-interval">REFRESH INTERVAL <span>MINUTES / LEAVE BLANK FOR MANUAL</span></label><input id="api-interval" className="text-input interval-input" type="number" min="15" value={editInterval} onChange={(event) => setEditInterval(event.target.value)} placeholder="Manual" /><div className="settings-editor-actions"><button className="primary-button" onClick={() => void saveApiSettings()} disabled={busy || editName.trim().length < 3}>Save changes</button><button className={`danger-button ${deleteArmed ? "armed" : ""}`} onClick={() => deleteArmed ? void removeApi() : setDeleteArmed(true)} disabled={busy}>{deleteArmed ? "Click again to permanently delete" : "Delete API"}</button></div></section>}          </>}
        </div>
      </main>
    </div>
  );
}
