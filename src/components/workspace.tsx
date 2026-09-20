"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshScheduleEditor } from "@/components/refresh-schedule-editor";
import type { ApiJobResponse, SearchDepth, SourceStrategyType } from "@/lib/types";
import type { WorkspaceHandoff } from "@/lib/workspace-handoff";

type Config = { planner_ready: boolean; extraction_ready: boolean; database_ready: boolean; vision_ready?: boolean; worker_online?: boolean; worker_seen_at?: string | null; missing: string[] };
type ApiRecordResponse = { id: string; job_id: string; source_url: string; source_urls: string[];
  field_sources: Record<string, string>; data: Record<string, string | number | boolean | null>; extracted_at: string };
type RunHistory = { attempts?: Array<{ url: string; query: string | null; stage: string; code: string; title?: string; fieldsPresent?: string[]; fieldsMissing?: string[] }>; id: string; startedAt: string; finishedAt: string | null; trigger: "manual" | "scheduled"; outcome: string; savedRecords: number; identifiedItems?: number; searchCalls: number; scrapeCalls: number; stopReason: string | null; cancelRequested: boolean };

const statusLabels: Record<ApiJobResponse["status"], string> = {
  planning: "Planning",
  awaiting_fields: "Choose fields",
  planned: "Planned",
  queued: "Queued",
  discovering: "Discovering",
  scraping: "Scraping",
  extracting: "Extracting",
  storing: "Storing",
  ready: "Ready",
  partial: "Partial data",
  failed: "Failed",
};

const quickStarts = [
  { label: "Price tracker", request: "Track espresso machine prices across three retailers with product name, price, and availability." },
  { label: "Event directory", request: "List upcoming hackathons with event name, date, and location." },
  { label: "Menu monitor", request: "Monitor new menu items at downtown ramen spots with dish name, price, and dietary tags." },
];

type WorkspaceView = "dashboard" | "new" | "library" | "detail";

const searchDepthOptions: Array<{
  value: SearchDepth;
  label: string;
  range: string;
  combinedRange: string;
  hint: string;
}> = [
  { value: "focused", label: "Focused", range: "About 1–3 records", combinedRange: "Up to 3 source pages", hint: "2 searches · 3 scrapes max" },
  { value: "balanced", label: "Balanced", range: "About 3–6 records", combinedRange: "Up to 6 source pages", hint: "4 searches · 6 scrapes max" },
  { value: "deep", label: "Deep", range: "Up to 12 records", combinedRange: "Up to 12 source pages", hint: "5 searches · 12 scrapes max" },
];

function describeRefreshInterval(minutes: number): string {
  if (minutes % 10_080 === 0) return `every ${minutes / 10_080}w`;
  if (minutes % 1_440 === 0) return `every ${minutes / 1_440}d`;
  if (minutes % 60 === 0) return `every ${minutes / 60}h`;
  return `every ${minutes}m`;
}

export function Workspace({ initialHandoff = null }: { initialHandoff?: WorkspaceHandoff | null }) {
  const [jobs, setJobs] = useState<ApiJobResponse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>(initialHandoff ? "new" : "dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
  const [apiSettingsJobId, setApiSettingsJobId] = useState<string | null>(null);
  const [accessState, setAccessState] = useState<"checking" | "unlocked" | "locked" | "missing">("checking");
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editInterval, setEditInterval] = useState("");
  const [editRefreshPaused, setEditRefreshPaused] = useState(false);
  const [editSearchDepth, setEditSearchDepth] = useState<SearchDepth>("balanced");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [records, setRecords] = useState<ApiRecordResponse[]>([]);
  const [runs, setRuns] = useState<RunHistory[]>([]);
  const [name, setName] = useState(initialHandoff?.name ?? "");
  const [userRequest, setUserRequest] = useState(initialHandoff?.request ?? "");
  const [strategy, setStrategy] = useState<SourceStrategyType>(initialHandoff?.strategy ?? "automatic");
  const [searchDepth, setSearchDepth] = useState<SearchDepth>("balanced");
  const [combineSources, setCombineSources] = useState(initialHandoff?.combine ?? false);
  const [sourceText, setSourceText] = useState(initialHandoff?.sources ?? "");
  const [refreshInterval, setRefreshInterval] = useState(initialHandoff?.refresh ?? "");
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

  const totals = useMemo(() => {
    const recordTotal = jobs.reduce((sum, job) => sum + (job.record_count || 0), 0);
    const readyTotal = jobs.filter((job) => job.status === "ready").length;
    const activeTotal = jobs.filter((job) => ["queued", "discovering", "scraping", "extracting", "storing"].includes(job.status)).length;
    return { apis: jobs.length, records: recordTotal, ready: readyTotal, active: activeTotal };
  }, [jobs]);

  const recentJobs = useMemo(
    () => [...jobs].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at)).slice(0, 6),
    [jobs],
  );

  const loadJobs = useCallback(async (preferredId?: string) => {
    const response = await fetch("/api/jobs", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load API jobs. Check MongoDB with npm run db:check.");
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
    if (!selectedId || accessState !== "unlocked") return;
    void fetch(`/api/jobs/${selectedId}/runs`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { runs?: RunHistory[] }) => setRuns(result.runs || []))
      .catch(() => setRuns([]));
  }, [selectedId, jobs, accessState]);

  useEffect(() => {
    if (accessState !== "unlocked" || !jobs.some((job) => ["queued", "discovering", "scraping", "extracting", "storing"].includes(job.status))) return;
    const timer = window.setInterval(() => { void loadJobs(); }, 1500);
    return () => window.clearInterval(timer);
  }, [accessState, jobs, loadJobs]);


  useEffect(() => {
    if (accessState !== "unlocked" || !jobs.some((job) => job.status === "queued")) return;
    const timer = window.setInterval(() => {
      void fetch("/api/config", { cache: "no-store" })
        .then((response) => response.ok ? response.json() as Promise<Config> : null)
        .then((next) => { if (next) setConfig(next); });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [accessState, jobs]);

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
        if (!response.ok) throw new Error("Could not load API jobs. Check MongoDB with npm run db:check.");
        return response.json() as Promise<{ jobs: ApiJobResponse[] }>;
      })
      .then((result) => { setJobs(result.jobs); setSelectedId(result.jobs[0]?.id || null); })
      .catch((error: Error) => setMessage(error.message));
    const refreshConfig = () => {
      void fetch("/api/config", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("Could not load configuration.");
          return response.json() as Promise<Config>;
        })
        .then(setConfig)
        .catch(() => setMessage("Could not load configuration."));
    };
    const onVisibilityChange = () => { if (document.visibilityState === "visible") refreshConfig(); };
    refreshConfig();
    window.addEventListener("focus", refreshConfig);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshConfig);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [accessState, loadJobs]);

  // The server already applied the handoff; keep the workspace URL clean afterward.
  useEffect(() => {
    if (!initialHandoff || typeof window === "undefined") return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [initialHandoff]);

  function startQuickStart(request: string) {
    setUserRequest(request);
    setSelectedId(null);
    setMessage(null);
    setView("new");
  }

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
          search_depth: searchDepth,
          sources,
          combine_sources: combineSources,
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
      setMessage("Choose fields, then build.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create API job.");
    } finally {
      setBusy(false);
    }
  }

  async function runJob(jobId: string, action: "run" | "refresh") {
    const response = await fetch(`/api/jobs/${jobId}/${action}`, { method: "POST" });
    const result = await response.json() as { job?: ApiJobResponse; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not queue run.");
    await loadJobs(jobId);
    setMessage("Run queued. Progress will update here automatically.");
  }

  async function cancelRun() {
    if (!selected) return;
    const response = await fetch(`/api/jobs/${selected.id}/cancel`, { method: "POST" });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setMessage(result.error || "Could not cancel run."); return; }
    await loadJobs(selected.id);
    setMessage("Cancellation requested.");
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
    setEditRefreshPaused(selected.refresh_paused);
    setEditSearchDepth(selected.search_depth);
    setDeleteArmed(false);
    setApiSettingsOpen(true);
  }

  async function saveApiSettings() {
    if (!selected || selected.id !== apiSettingsJobId || editName.trim().length < 3) return;
    const targetId = apiSettingsJobId;
    setBusy(true);
    try {
      const scheduleChanged = editInterval !== (selected.refresh_interval ? String(selected.refresh_interval) : "") || editRefreshPaused !== selected.refresh_paused;
      const response = await fetch(`/api/jobs/${targetId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          ...(scheduleChanged ? { refresh_interval: editInterval ? Number(editInterval) : null, refresh_paused: editInterval ? editRefreshPaused : false } : {}),
          search_depth: editSearchDepth,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save API settings.");
      await loadJobs(targetId);
      setApiSettingsOpen(false);
      setMessage("API settings saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save API settings."); }
    finally { setBusy(false); }
  }

  async function setAutomaticRefreshPaused(paused: boolean) {
    if (!selected?.refresh_interval) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_paused: paused }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || `Could not ${paused ? "pause" : "resume"} automatic refresh.`);
      await loadJobs(selected.id);
      setMessage(paused ? "Automatic refresh paused. Manual refresh is still available." : "Automatic refresh resumed and the next run was scheduled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update automatic refresh.");
    } finally {
      setBusy(false);
    }
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

  if (accessState !== "unlocked") return (
    <main className="access-screen"><section className="access-card panel">
      <div className="brand-mark">W</div>
      <h1>{accessState === "checking" ? "Opening workspace" : accessState === "missing" ? "Workspace access needs setup" : "Unlock WebForge"}</h1>
      {accessState === "locked" ? <form onSubmit={(event) => { event.preventDefault(); void unlockWorkspace(); }}>
        <label className="input-label" htmlFor="access-token">Access token</label>
        <input id="access-token" className="text-input" type="password" autoComplete="current-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} />
        {accessMessage && <p role="alert">{accessMessage}</p>}
        <button className="primary-button" type="submit" disabled={!accessToken}>Unlock</button>
      </form> : accessState === "missing" ? <p>Set WEBFORGE_ACCESS_TOKEN and restart.</p> : <p>Checking access...</p>}
    </section></main>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand brand-button" href="/"><div className="brand-mark">W</div><div><strong>WebForge</strong><span>API workbench</span></div></Link>
        <div className="sidebar-section-label">Workspace</div>
        <button className={`nav-item ${view === "dashboard" ? "active" : ""}`} onClick={() => { setSelectedId(null); setView("dashboard"); }}><span className="nav-icon">D</span> Dashboard</button>
        <button className={`nav-item ${view === "library" ? "active" : ""}`} onClick={() => setView("library")}><span className="nav-icon">L</span> Library</button>
        <button className={`nav-item ${view === "new" ? "active" : ""}`} onClick={() => { setSelectedId(null); setView("new"); }}><span className="nav-icon">+</span> New API</button>
        <Link className="nav-item nav-link" href="/cli"><span className="nav-icon">&gt;_</span> CLI Download</Link>
        <div className="sidebar-section-label datasets-label"><span>{jobs.length}</span>APIs</div>
        <div className="dataset-list">
          {jobs.length ? jobs.map((job) => (
            <button key={job.id} className={`dataset-item ${selectedId === job.id && view === "detail" ? "selected" : ""}`} onClick={() => { setSelectedId(job.id); setView("detail"); setMessage(null); }}>
              <span className="dataset-dot" />
              <span className="dataset-text"><strong>{job.name}</strong><small>{statusLabels[job.status]}</small></span>
            </button>
          )) : <p className="sidebar-empty">No APIs yet. Describe data to forge the first one.</p>}
        </div>
        <div className="sidebar-bottom">
          <Link className="settings-link" href="/">← View site</Link>
          <button className="settings-link" onClick={() => setSettingsOpen(true)}><span>Settings</span><b>···</b></button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="breadcrumbs">WebForge<span>/</span>{view === "dashboard" ? "Dashboard" : view === "new" ? "New API" : view === "library" ? "Library" : selected?.name || "Detail"}</div><div className="top-right"><span className="version">dashboard</span><Link className="ghost-button" href="/">Site</Link><button className="avatar" aria-label="Open settings" onClick={() => setSettingsOpen((open) => !open)}>WF</button></div></header>
        {message && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage(null)} aria-label="Dismiss">x</button></div>}
        {settingsOpen && <div className="settings-menu" role="dialog" aria-label="Settings">
          <strong>Settings</strong>
          <div><span>OpenAI planner</span><b className={config?.planner_ready ? "good" : "bad"}>{config?.planner_ready ? "Connected" : "Needs key"}</b></div>
          <div><span>Firecrawl extraction</span><b className={config?.extraction_ready ? "good" : "bad"}>{config?.extraction_ready ? "Connected" : "Needs key"}</b></div>
          <div><span>MongoDB Atlas</span><b className={config?.database_ready ? "good" : "bad"}>{config?.database_ready ? "Configured" : "Needs URI"}</b></div>
          <div><span>Vision fallback</span><b className={config?.vision_ready ? "good" : "bad"}>{config ? (config.vision_ready ? "On" : "Off") : "Checking"}</b></div>
          {accessRequired && <button className="ghost-button" onClick={() => void lockWorkspace()}>Lock workspace</button>}
          <button className="ghost-button" onClick={() => setSettingsOpen(false)}>Close</button>
        </div>}

        <div className="content">
          {view === "dashboard" && <>
            <div className="dashboard-hero">
              <div>
                <p className="hero-eyebrow"><span className="sparkle" aria-hidden="true" />Dashboard</p>
                <h1>All your <em>live data,</em> in one ledger.</h1>
                <p className="hero-copy">Create an API from plain English, watch discovery and extraction run, then call stable JSON. {totals.apis === 0 ? "Start with a quick template below." : `${totals.apis} APIs · ${totals.records.toLocaleString()} records stored.`}</p>
              </div>
              <button className="dashboard-create" onClick={() => { setSelectedId(null); setView("new"); }}>
                <span aria-hidden="true">+</span>
                <span><strong>Forge a new API</strong><small>Describe data → pick fields → get JSON</small></span>
              </button>
            </div>

            <section className="dashboard-stats" aria-label="Workspace totals">
              <div className="stat-card"><span>APIs</span><strong>{totals.apis}</strong><small>{totals.ready} ready</small></div>
              <div className="stat-card"><span>Records stored</span><strong>{totals.records.toLocaleString()}</strong><small>Across all APIs</small></div>
              <div className="stat-card"><span>Runs active</span><strong>{totals.active}</strong><small>{totals.active > 0 ? "Updating now" : "Idle"}</small></div>
            </section>

            <div className="dashboard-grid">
              <section className="dashboard-panel panel" aria-label="Recent APIs">
                <div className="dashboard-heading"><div><p className="section-kicker">Recent</p><h2>Latest APIs</h2></div><button className="text-button" onClick={() => setView("library")}>View library</button></div>
                {recentJobs.length ? (
                  <div className="activity-list">
                    {recentJobs.map((job) => (
                      <button key={job.id} className="activity-item" onClick={() => { setSelectedId(job.id); setView("detail"); setMessage(null); }}>
                        <span className={`activity-dot ${job.status === "ready" ? "ready" : job.status === "failed" ? "failed" : "queued"}`} />
                        <span><strong>{job.name}</strong><small>{statusLabels[job.status]} · {job.record_count} records</small></span>
                        <time>{new Date(job.updated_at).toLocaleDateString()}</time>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="dashboard-empty"><strong>No APIs yet</strong><p>Describe the public web data you want and WebForge will plan fields, extract records, and serve JSON.</p><button className="primary-button" onClick={() => setView("new")}>Forge your first API</button></div>
                )}
              </section>

              <section className="dashboard-panel panel" aria-label="Quick start">
                <div className="dashboard-heading"><div><p className="section-kicker">Quick start</p><h2>Start from a pattern</h2></div></div>
                <div className="template-list">
                  {quickStarts.map((item) => (
                    <button key={item.label} onClick={() => startQuickStart(item.request)}>
                      <span>{item.label.slice(0, 2).toUpperCase()}</span>
                      <span><strong>{item.label}</strong><small>{item.request}</small></span>
                      <b aria-hidden="true">→</b>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </>}

          {view === "library" && <section className="library-panel panel">
            <div className="section-header"><div><p className="section-kicker">Collection</p><h2>Library</h2><p>Every API you have forged, with status and field counts.</p></div><button className="primary-button" onClick={() => { setSelectedId(null); setView("new"); }}>New API</button></div>
            {jobs.length ? <div className="library-list">{jobs.map((job) => <button key={job.id} className="library-item" onClick={() => { setSelectedId(job.id); setView("detail"); }}><span className={`library-status ${job.status}`} /><span><strong>{job.name}</strong><small>{statusLabels[job.status]}, {Object.keys(job.schema).length || Object.keys(job.proposed_schema).length} fields · {job.record_count} records</small></span><time>{new Date(job.updated_at).toLocaleDateString()}</time></button>)}</div> : <div className="empty-state"><strong>No APIs yet</strong><p>Forge one from the dashboard to see it here.</p><button className="primary-button" onClick={() => setView("new")}>New API</button></div>}
          </section>}

          {view === "new" && <section className="composer panel">
            <div className="panel-heading"><span className="step-number">01</span><div><p className="section-kicker">Create</p><h2>New API</h2><p>Describe the data. WebForge proposes fields before any extraction runs.</p></div></div>
            <label className="input-label" htmlFor="job-name">Name<span>Optional</span></label>
            <input id="job-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Espresso prices" />
            <label className="input-label request-label" htmlFor="request">Request</label>
            <textarea id="request" value={userRequest} onChange={(event) => setUserRequest(event.target.value)} rows={4} placeholder="What public web data should this hold..." />

            <div className="composer-options">
              <div className="mode-group" role="group" aria-label="Source strategy">
                <button type="button" className={strategy === "automatic" ? "mode active" : "mode"} onClick={() => setStrategy("automatic")}>Automatic</button>
                <button type="button" className={strategy === "provided_urls" ? "mode active" : "mode"} onClick={() => setStrategy("provided_urls")}>URLs</button>
              </div>
              <p className="mode-hint">{strategy === "automatic" ? "WebForge searches the public web for matching pages." : "You supply up to five public page URLs, one per line."}</p>
            </div>

            {strategy === "automatic" && <div className="depth-block">
              <label className="input-label">Search depth<span>Controls credit use and approximate result count</span></label>
              <div className="depth-options" role="radiogroup" aria-label="Search depth">
                {searchDepthOptions.map((option) => <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={searchDepth === option.value}
                  className={searchDepth === option.value ? "depth-option active" : "depth-option"}
                  onClick={() => setSearchDepth(option.value)}
                >
                  <strong>{option.label}</strong>
                  <span>{combineSources ? option.combinedRange : option.range}</span>
                  <small>{option.hint}</small>
                </button>)}
              </div>
            </div>}

            {strategy === "provided_urls" && <div className="seed-block"><label className="input-label" htmlFor="sources">Sources</label><textarea id="sources" rows={3} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="One public URL per line" /></div>}
            <label className="field-option"><input type="checkbox" checked={combineSources} onChange={(event) => setCombineSources(event.target.checked)} /><span><strong>Combine sources into one record</strong><small>Use multiple pages for one item, such as Apple specs and an independent benchmark.</small></span></label>
            <RefreshScheduleEditor id="interval" value={refreshInterval} onChange={setRefreshInterval} />
            <div className="example-row"><span>Try:</span>{quickStarts.map((item) => <button key={item.label} type="button" onClick={() => setUserRequest(item.request)}>{item.label}</button>)}</div>
            <div className="composer-footer"><button className="primary-button" onClick={createJob} disabled={busy || userRequest.trim().length < 10 || !config?.planner_ready || !config?.database_ready}>{busy ? "Planning..." : "Propose fields"}</button>
              <span>{userRequest.trim().length}/10 chars minimum{!config ? " · Checking service settings..." : !config.database_ready ? " · Add MONGODB_URI to the server and restart WebForge." : !config.planner_ready ? " · Add OPENAI_API_KEY to the server and restart WebForge." : ""}</span></div>
          </section>}

          {view === "detail" && selected && <>
            <section className="detail-hero panel">
              <div className="detail-hero-top"><p className="section-kicker">API</p><strong className={`metric-status ${selected.status}`}>{statusLabels[selected.status]}</strong></div>
              <h2>{selected.name}</h2>
              <figure className="prompt-quote"><figcaption>Prompt</figcaption><blockquote>“{selected.user_request}”</blockquote></figure>
              <div className="detail-meta">
                <span>{selected.source_strategy.type === "automatic" ? "Automatic discovery" : "Provided URLs"}</span>
                <span>{Object.keys(selected.status === "awaiting_fields" ? selected.proposed_schema : selected.schema).length} fields</span>
                <span>{selected.record_count} records</span>
                {selected.source_strategy.type === "automatic" && <span>{selected.search_depth} search</span>}
                <span>{selected.refresh_paused ? "Refresh paused" : selected.refresh_interval ? `Refreshes every ${selected.refresh_interval}m` : "Manual refresh"}</span>
                {selected.combine_sources && <span>Combined record</span>}
              </div>
            </section>

            <section className="refresh-control-panel panel" aria-label="Refresh controls">
              <div className="refresh-control-copy">
                <p className="section-kicker">Refresh</p>
                <div className="refresh-control-title"><h3>{selected.refresh_interval ? "Automatic refresh" : "Manual refresh"}</h3><span className={selected.refresh_interval ? selected.refresh_paused ? "paused" : "active" : "manual"}>{selected.refresh_interval ? selected.refresh_paused ? "Paused" : "Active" : "Manual"}</span></div>
                <p>{selected.refresh_interval
                  ? selected.refresh_paused
                    ? `The ${describeRefreshInterval(selected.refresh_interval)} schedule is paused. You can still refresh manually.`
                    : selected.next_refresh_at
                      ? `${describeRefreshInterval(selected.refresh_interval)} · Next run ${new Date(selected.next_refresh_at).toLocaleString()}`
                      : `${describeRefreshInterval(selected.refresh_interval)} · The next run will be scheduled when the current run finishes.`
                  : "Records change only when you click Refresh now. No scheduled credits are spent."}</p>
                {selected.refresh_interval && !config?.worker_online && <small>Automatic refresh needs the worker. Start <code>npm run worker</code>.</small>}
                {selected.refresh_paused && selected.refresh_failures >= 2 && <small>Paused after two scheduled runs made no usable progress.</small>}
              </div>
              <div className="refresh-control-actions">
                <button className="primary-button" onClick={() => void refreshJob()} disabled={busy || selected.status === "awaiting_fields" || !config?.extraction_ready || ["queued", "discovering", "scraping", "extracting", "storing"].includes(selected.status)}>{busy ? "Working..." : selected.status === "planned" ? "Run now" : "Refresh now"}</button>
                {selected.refresh_interval && <button className="ghost-button" onClick={() => void setAutomaticRefreshPaused(!selected.refresh_paused)} disabled={busy || ["queued", "discovering", "scraping", "extracting", "storing"].includes(selected.status)}>{selected.refresh_paused ? "Resume schedule" : "Pause schedule"}</button>}
                <button className="ghost-button" onClick={openApiSettings} disabled={busy}>Edit schedule</button>
              </div>
            </section>

            {selected.run_summary && <div className="run-summary panel" aria-label="Latest run summary">
              <strong>Latest run{selected.run_summary.outcome === "partial_stopped" ? ", partial data" : ""}</strong>
              <span>{selected.run_summary.saved_records} saved{selected.run_summary.identified_items !== null ? " saved; " + selected.run_summary.identified_items + " candidate items reviewed" : ""}</span>
              <span>{selected.run_summary.skipped_sources} skipped</span>
              <span>{selected.run_summary.search_calls} searches</span>
              <span>{selected.run_summary.scrape_calls} scrapes</span>
              <span>{selected.run_summary.recovery_calls} recovery</span>
              {selected.run_summary.stop_reason && <small>{selected.run_summary.stop_reason}</small>}
            </div>}

            {["queued", "discovering", "scraping", "extracting", "storing"].includes(selected.status) &&
              <div className="run-summary panel"><span>{selected.status === "queued" ? (config?.worker_online ? "Queued for worker" : "Queued — worker offline. Start npm run worker.") : "Running"}{selected.run_summary?.cancel_requested ? " — cancellation requested" : ""}</span><button className="ghost-button" onClick={() => void cancelRun()} disabled={Boolean(selected.run_summary?.cancel_requested)}>{selected.run_summary?.cancel_requested ? "Cancelling" : "Cancel"}</button></div>}

            {selected.error && <div className="error-banner job-error">{selected.error}</div>}

            {selected.status === "awaiting_fields" && <section className="field-review panel">
              <p className="section-kicker">Review</p>
              <h2>Choose fields</h2>
              <p>Confirm what belongs in the JSON. Extraction starts only after you build.</p>
              {selected.combine_sources && <p className="empty-records">These fields will be combined into one record from multiple pages about the same item.</p>}
              {selected.source_strategy.type === "automatic" && <div className="planned-searches"><h3>Planned searches</h3><p>Review these before starting Firecrawl.</p><ol>{selected.source_strategy.search_queries.map((query) => <li key={query}>{query}</li>)}</ol></div>}
              <div className="field-options">
                {Object.entries(selected.proposed_schema).filter(([key]) => key !== "source_url").map(([key, field]) => (
                  <label className="field-option" key={key}>
                    <input type="checkbox" checked={selectedFields.includes(key)}
                      onChange={(event) => setFieldSelections((choices) => ({
                        ...choices,
                        [selected.id]: event.target.checked
                          ? [...selectedFields, key] : selectedFields.filter((item) => item !== key),
                      }))} />
                    <span><strong>{key}</strong><small>{field.description || field.type}</small></span>
                  </label>
                ))}
                <div className="field-option fixed"><span><strong>source_url</strong><small>Primary source. Combined records also include source_urls and field_sources.</small></span></div>
              </div>
              <pre className="schema-preview" aria-label="Selected JSON schema preview">{JSON.stringify(previewSchema, null, 2)}</pre>
              <div className="field-review-footer">
                <span>{selectedFields.length} selected</span>
                <button className="primary-button" onClick={() => void confirmFields()} disabled={busy || selectedFields.length === 0}>
                  {busy ? "Building..." : "Build API"}
                </button>
              </div>
            </section>}

            {selected.status !== "awaiting_fields" && <>
            <section className="records-section panel">
              <div className="section-header"><div><p className="section-kicker">Contract</p><h2>Schema</h2></div></div>
              {selected.combine_sources && <p className="empty-records">One record combines fields from multiple URLs. Each populated field links to its source in the records API.</p>}
              <div className="table-wrap"><table><thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead><tbody>{Object.entries(selected.schema).map(([key, field]) => <tr key={key}><td><code>{key}</code></td><td><span className="status-pill sample">{field.type}</span></td><td>{field.description || "-"}</td></tr>)}</tbody></table></div>
            </section>

            <section className="records-section panel">
              <div className="section-header"><div><p className="section-kicker">Data</p><h2>Records</h2><p>{records.length ? `${records.length} row${records.length === 1 ? "" : "s"} · one row per record` : "No rows yet — run the API to fill this table."}</p></div><button className="ghost-button" onClick={() => void refreshJob()} disabled={busy || !config?.extraction_ready || ["queued", "discovering", "scraping", "extracting", "storing"].includes(selected.status)}>{busy ? "Queuing..." : selected.status === "planned" ? "Run now" : "Refresh now"}</button></div>
              {records.length ? <div className="table-wrap"><table className="records-table"><thead><tr><th className="row-num">#</th>{Object.keys(selected.schema).map((key) => <th key={key}>{key}</th>)}{selected.combine_sources && <th>Sources</th>}<th>Extracted</th></tr></thead><tbody>{records.map((record, rowIndex) => <tr key={record.id}><td className="row-num">{rowIndex + 1}</td>{Object.keys(selected.schema).map((key) => {
                const value = record.data[key];
                if (key === "source_url") return <td key={key}>{value ? <a href={String(value)} target="_blank" rel="noreferrer">Source ↗</a> : <span className="null-cell">null</span>}</td>;
                if (value === null || value === undefined || value === "") return <td key={key}><span className="null-cell">null</span></td>;
                return <td key={key} title={record.field_sources?.[key] ? `From ${record.field_sources[key]}` : String(value)}>{String(value)}</td>;
              })}{selected.combine_sources && <td>{(record.source_urls || [record.source_url]).map((url, index) => <span key={url}><a href={url} target="_blank" rel="noreferrer">{index + 1}</a>{index + 1 < (record.source_urls || [record.source_url]).length ? ", " : ""}</span>)}</td>}<td className="extracted-cell">{new Date(record.extracted_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <p className="empty-records">No records yet.</p>}
            </section>

            <section className="records-section panel"><div className="section-header"><div><p className="section-kicker">Provenance</p><h2>Runs</h2></div></div>
              {selected.sources.length > 0 && <ul className="source-list">{selected.sources.map((source) => <li key={source}><a href={source} target="_blank" rel="noreferrer">{source}</a></li>)}</ul>}
              {runs.length ? <div className="table-wrap"><table><thead><tr><th>Started</th><th>Trigger</th><th>Outcome</th><th>Saved</th><th>Searches, scrapes</th><th>Details</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{new Date(run.startedAt).toLocaleString()}</td><td>{run.trigger}</td><td>{run.outcome}</td><td>{run.savedRecords}</td><td>{run.searchCalls}, {run.scrapeCalls}</td><td>{run.stopReason || "—"}{Boolean(run.attempts?.length) && <details><summary>Source attempts ({run.attempts?.length})</summary><ul>{run.attempts?.map((attempt, index) => <li key={run.id + index}><strong>{attempt.code}</strong> at {attempt.stage}: {attempt.url.startsWith("http") ? <a href={attempt.url} target="_blank" rel="noreferrer">{attempt.title || attempt.url}</a> : attempt.url}{attempt.fieldsMissing?.length ? " · missing " + attempt.fieldsMissing.join(", ") : ""}</li>)}</ul></details>}</td></tr>)}</tbody></table></div> : <p className="empty-records">No runs yet.</p>}
            </section>

            <section className="api-section panel"><div><p className="section-kicker">Integrate</p><h2>Endpoints</h2><p>Stable JSON for your app. Records update on refresh.</p></div><div className="endpoint-list"><div className="endpoint"><span className="method">GET</span><code>{recordsPath}</code><button onClick={() => void copyEndpoint(recordsPath)}>Copy</button></div><div className="endpoint"><span className="method">GET</span><code>{jobPath}</code><button onClick={() => void copyEndpoint(jobPath)}>Copy</button></div><div className="endpoint"><span className="method">GET</span><code>{schemaPath}</code><button onClick={() => void copyEndpoint(schemaPath)}>Copy</button></div></div></section>
            </>}
            <section className="api-settings panel"><div><h2>Settings</h2><p>Rename, change refresh, or delete this API.</p></div><button className="ghost-button" onClick={openApiSettings}>Open</button></section>
            {apiSettingsOpen && apiSettingsJobId === selected.id && <section className="api-settings-editor panel" role="dialog" aria-modal="true" aria-label="API settings">
              <div className="settings-editor-heading"><div><p className="section-kicker">Edit</p><h2>{selected.name}</h2></div><button onClick={() => setApiSettingsOpen(false)} aria-label="Close API settings">x</button></div>
              <label className="input-label" htmlFor="api-name">API name</label>
              <input id="api-name" className="text-input" value={editName} onChange={(event) => setEditName(event.target.value)} />
              {selected.source_strategy.type === "automatic" && <>
                <label className="input-label settings-interval-label" htmlFor="api-search-depth">Search depth<span>Applies to future runs</span></label>
                <select id="api-search-depth" className="text-input" value={editSearchDepth} onChange={(event) => setEditSearchDepth(event.target.value as SearchDepth)}>
                  {searchDepthOptions.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.hint}</option>)}
                </select>
              </>}
              <RefreshScheduleEditor id="api-interval" value={editInterval} onChange={(value) => { setEditInterval(value); setEditRefreshPaused(false); }} />
              <div className="settings-editor-actions"><button className="ghost-button" onClick={() => {
                setName(selected.name + " revised");
                setUserRequest(selected.user_request);
                setStrategy(selected.source_strategy.type);
                setCombineSources(selected.combine_sources);
                setSourceText(selected.source_strategy.type === "provided_urls" ? selected.sources.join("\n") : "");
                setRefreshInterval(selected.refresh_interval === null ? "" : String(selected.refresh_interval));
                setSearchDepth(selected.search_depth);
                setApiSettingsOpen(false);
                setView("new");
                setMessage("Review the request, then propose fresh fields and searches. The existing API remains available.");
              }}>Replan as new API</button><button className="primary-button" onClick={() => void saveApiSettings()} disabled={busy || editName.trim().length < 3}>Save changes</button><button className={`danger-button ${deleteArmed ? "armed" : ""}`} onClick={() => deleteArmed ? void removeApi() : setDeleteArmed(true)} disabled={busy}>{deleteArmed ? "Confirm delete" : "Delete"}</button></div>
            </section>}          </>}
        </div>
      </main>
    </div>
  );
}
