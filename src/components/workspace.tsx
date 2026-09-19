"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiJobResponse, SourceStrategyType } from "@/lib/types";

type Config = { planner_ready: boolean; extraction_ready: boolean; database_ready: boolean; missing: string[] };
type ApiRecordResponse = { id: string; job_id: string; source_url: string; source_urls: string[];
  field_sources: Record<string, string>; data: Record<string, string | number | boolean | null>; extracted_at: string };
type RunHistory = { id: string; startedAt: string; finishedAt: string | null; trigger: "manual" | "scheduled"; outcome: string; savedRecords: number; searchCalls: number; scrapeCalls: number; stopReason: string | null; cancelRequested: boolean };

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

const demoIdeas = [
  "Track espresso machine prices across three retailers",
  "List upcoming hackathons with deadlines and locations",
  "Monitor new menu items at downtown ramen spots",
  "Watch flight prices for NYC to Lisbon in June",
  "Collect remote junior designer jobs posted this week",
  "Track restocks of sold-out mechanical keyboards",
  "List farmers markets with hours and neighborhoods",
  "Follow GPU prices across major PC stores",
  "Gather open grant deadlines for arts nonprofits",
  "Monitor apartment listings under $2,000 near transit",
  "Track vinyl reissues with release dates and labels",
  "List tech conferences with ticket prices and dates",
  "Watch sneaker drops with sizes and release times",
  "Collect coffee roasters with single-origin offerings",
  "Track EV charging station openings by city",
  "Monitor book preorders from indie publishers",
  "List coworking spaces with day-pass prices",
  "Follow trail race registrations with entry fees",
  "Track board game restocks with player counts",
  "Collect bakery specials with pickup windows",
];

const demoPatterns = {
  prices: {
    name: "Price tracker",
    stats: [["Products", "1,284"], ["Stores", "32"], ["Refreshed", "2m"]],
    head: ["Product", "Price", "Availability"],
    rows: [
      ["Golden Delicious, 3 lb bag", "$3.49", "In stock"],
      ["Espresso machine, entry", "$449.00", "In stock"],
      ["Mechanical keyboard, 75%", "$129.00", "Low stock"],
      ["4K monitor, 27 in", "$329.99", "Out of stock"],
    ],
  },
  events: {
    name: "Event directory",
    stats: [["Events", "86"], ["Cities", "19"], ["Refreshed", "14m"]],
    head: ["Event", "Date", "Location"],
    rows: [
      ["Harbor Hackathon", "Jun 12", "Boston"],
      ["Indie Games Expo", "Jul 3", "Austin"],
      ["Civic Data Summit", "Jul 18", "Chicago"],
      ["Night Market Fest", "Aug 2", "Seattle"],
    ],
  },
  menus: {
    name: "Menu monitor",
    stats: [["Dishes", "412"], ["Spots", "27"], ["Refreshed", "1h"]],
    head: ["Dish", "Price", "Tags"],
    rows: [
      ["Shoyu ramen", "$14.50", "Vegetarian option"],
      ["Pork belly bao", "$6.25", "Contains gluten"],
      ["Miso eggplant", "$11.00", "Vegan"],
      ["Yuzu cheesecake", "$7.75", "Vegetarian"],
    ],
  },
};

type DemoKey = keyof typeof demoPatterns;

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
  const [runs, setRuns] = useState<RunHistory[]>([]);
  const [name, setName] = useState("");
  const [userRequest, setUserRequest] = useState("");
  const [strategy, setStrategy] = useState<SourceStrategyType>("automatic");
  const [combineSources, setCombineSources] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [refreshInterval, setRefreshInterval] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldSelections, setFieldSelections] = useState<Record<string, string[]>>({});
  const [heroRequest, setHeroRequest] = useState("");
  const [ideaIndex, setIdeaIndex] = useState(0);
  const [demoPattern, setDemoPattern] = useState<DemoKey | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [prefersReduced] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

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
  useEffect(() => {
    if (view !== "home" || prefersReduced || heroRequest) return;
    const timer = window.setInterval(() => {
      setIdeaIndex((index) => (index + 1) % demoIdeas.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [view, heroRequest, prefersReduced]);

  function forgeFromLanding() {
    setUserRequest(heroRequest.trim() || demoIdeas[ideaIndex]);
    setHeroRequest("");
    setView("new");
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
        <button className="brand brand-button" onClick={() => { setSelectedId(null); setView("home"); }}><div className="brand-mark">W</div><div><strong>WebForge</strong></div></button>
        <button className={`nav-item ${view === "home" ? "active" : ""}`} onClick={() => { setSelectedId(null); setView("home"); }}><span className="nav-icon">H</span> Home</button>
        <button className={`nav-item ${view === "library" ? "active" : ""}`} onClick={() => setView("library")}><span className="nav-icon">L</span> Library</button>
        <button className={`nav-item ${view === "new" ? "active" : ""}`} onClick={() => { setSelectedId(null); setView("new"); }}><span className="nav-icon">+</span> New API</button>
        <div className="dataset-list">
          {jobs.length ? jobs.map((job) => (
            <button key={job.id} className={`dataset-item ${selectedId === job.id && view === "detail" ? "selected" : ""}`} onClick={() => { setSelectedId(job.id); setView("detail"); setMessage(null); }}>
              <span className="dataset-dot" />
              <span className="dataset-text"><strong>{job.name}</strong><small>{statusLabels[job.status]}</small></span>
            </button>
          )) : <p className="sidebar-empty">No jobs yet.</p>}
        </div>
        <button className="sidebar-bottom settings-link" onClick={() => setSettingsOpen(true)}><span>Settings</span></button>
      </aside>

      <main className="main">
        <header className="topbar"><div className="top-right"><button className="avatar" aria-label="Open settings" onClick={() => setSettingsOpen((open) => !open)}>WF</button></div></header>
        {message && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage(null)} aria-label="Dismiss">x</button></div>}
        {settingsOpen && <div className="settings-menu" role="dialog" aria-label="Settings">
          <strong>Settings</strong>
          <div><span>OpenAI planner</span><b className={config?.planner_ready ? "good" : "bad"}>{config?.planner_ready ? "Connected" : "Needs key"}</b></div>
          <div><span>Firecrawl extraction</span><b className={config?.extraction_ready ? "good" : "bad"}>{config?.extraction_ready ? "Connected" : "Needs key"}</b></div>
          <div><span>MongoDB Atlas</span><b className={config?.database_ready ? "good" : "bad"}>{config?.database_ready ? "Configured" : "Needs URI"}</b></div>
          {accessRequired && <button className="ghost-button" onClick={() => void lockWorkspace()}>Lock workspace</button>}
          <button className="ghost-button" onClick={() => setSettingsOpen(false)}>Close</button>
        </div>}

        <div className="content">
          {view === "home" ? <>
            <h1>Point at the web.<br /><em>Get an API.</em></h1>
            <p className="landing-sub">Type what you want. WebForge plans the fields, reads the pages, and serves live JSON.</p>
            <section className="demo-composer panel" aria-label="Describe data">
              <textarea value={heroRequest} onChange={(event) => setHeroRequest(event.target.value)} rows={3} placeholder={demoIdeas[ideaIndex]} aria-label="Describe the data you want" />
              <div className="demo-composer-footer">
                <button className="ghost-button" onClick={() => setHeroRequest(demoIdeas[Math.floor(Math.random() * demoIdeas.length)])}>Surprise me</button>
                <button className="primary-button" onClick={forgeFromLanding}>Forge API</button>
              </div>
            </section>
            <div className="chip-row" role="group" aria-label="Demo patterns">
              {(Object.keys(demoPatterns) as DemoKey[]).map((key) => (
                <button key={key} className="demo-chip" draggable onDragStart={(event) => event.dataTransfer.setData("text/webforge-pattern", key)} onClick={() => setDemoPattern(key)}>{demoPatterns[key].name}</button>
              ))}
            </div>
            <section className={"dropzone panel" + (dragOver ? " over" : "")} onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); const key = event.dataTransfer.getData("text/webforge-pattern"); if (key === "prices" || key === "events" || key === "menus") setDemoPattern(key); setDragOver(false); }} aria-label="Live demo dashboard" aria-live="polite">
              {demoPattern ? (
                <div className="demo-live" key={demoPattern}>
                  <div className="demo-filled-head"><strong>{demoPatterns[demoPattern].name}</strong><button className="text-button" onClick={() => setDemoPattern(null)}>Clear</button></div>
                  <div className="demo-stats">{demoPatterns[demoPattern].stats.map(([label, value]) => <div className="demo-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
                  <div className="table-wrap"><table><thead><tr>{demoPatterns[demoPattern].head.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{demoPatterns[demoPattern].rows.map((row) => <tr key={row.join("|")}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
                </div>
              ) : (
                <p className="drop-empty">Drag a pattern here, or tap one. The dashboard fills itself.</p>
              )}
            </section>
            <section className="how-row panel" aria-label="How it works">
              <div className="how-step"><span className="step-number">1</span><p>Describe the data in plain words.</p></div>
              <div className="how-step"><span className="step-number">2</span><p>WebForge finds sources and extracts records.</p></div>
              <div className="how-step"><span className="step-number">3</span><p>Call your JSON. Set a refresh, or don&apos;t.</p></div>
            </section>
          </> : view === "new" ? <><h1>Describe the data.<br /><em>Get a live API.</em></h1></> : null}
          {view === "library" && <section className="library-panel panel">
            <div className="section-header"><div><h2>Library</h2></div><button className="primary-button" onClick={() => { setSelectedId(null); setView("new"); }}>New API</button></div>
            {jobs.length ? <div className="library-list">{jobs.map((job) => <button key={job.id} className="library-item" onClick={() => { setSelectedId(job.id); setView("detail"); }}><span className={`library-status ${job.status}`} /><div><strong>{job.name}</strong><small>{statusLabels[job.status]}, {Object.keys(job.schema).length || Object.keys(job.proposed_schema).length} fields</small></div><time>{new Date(job.updated_at).toLocaleDateString()}</time></button>)}</div> : <div className="empty-state"><strong>No APIs yet</strong><button className="primary-button" onClick={() => setView("new")}>New API</button></div>}
          </section>}

          {view === "new" && <section className="composer panel">
            <div className="panel-heading"><span className="step-number">01</span><div><h2>New API</h2></div></div>
            <label className="input-label" htmlFor="job-name">Name</label>
            <input id="job-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
            <label className="input-label request-label" htmlFor="request">Request</label>
            <textarea id="request" value={userRequest} onChange={(event) => setUserRequest(event.target.value)} rows={4} placeholder="What public web data should this hold..." />

            <div className="composer-options">
              <div className="mode-group" role="group" aria-label="Source strategy">
                <button type="button" className={strategy === "automatic" ? "mode active" : "mode"} onClick={() => setStrategy("automatic")}>Automatic</button>
                <button type="button" className={strategy === "provided_urls" ? "mode active" : "mode"} onClick={() => setStrategy("provided_urls")}>URLs</button>
              </div>
            </div>

            {strategy === "provided_urls" && <div className="seed-block"><label className="input-label" htmlFor="sources">Sources</label><textarea id="sources" rows={3} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="One public URL per line" /></div>}
            <label className="field-option"><input type="checkbox" checked={combineSources} onChange={(event) => setCombineSources(event.target.checked)} /><span><strong>Combine sources into one record</strong><small>Use multiple pages for one item, such as Apple specs and an independent benchmark.</small></span></label>
            <div className="interval-row"><label className="input-label" htmlFor="interval">Refresh</label><input id="interval" className="text-input interval-input" type="number" min="15" value={refreshInterval} onChange={(event) => setRefreshInterval(event.target.value)} placeholder="Manual" /></div>
            <div className="composer-footer"><button className="primary-button" onClick={createJob} disabled={busy || userRequest.trim().length < 10 || !config?.planner_ready || !config?.database_ready}>{busy ? "Planning..." : "Propose fields"}</button></div>
          </section>}

          {view === "detail" && selected && <>
            <section className="overview-grid">
              <div className="metric panel"><span>Job</span><strong>{selected.name}</strong></div>
              <div className="metric panel"><span>Status</span><strong className={`metric-status ${selected.status}`}>{statusLabels[selected.status]}</strong></div>
              <div className="metric panel"><span>Fields</span><strong>{Object.keys(selected.status === "awaiting_fields" ? selected.proposed_schema : selected.schema).length}</strong></div>
              <div className="metric panel"><span>Refresh</span><strong>{selected.refresh_paused ? "Paused" : selected.refresh_interval ? `${selected.refresh_interval}m` : "Manual"}</strong>{selected.refresh_paused && <small>Paused. Save settings to resume.</small>}</div>
            </section>

            {selected.run_summary && <div className="run-summary panel" aria-label="Latest run summary">
              <strong>Latest run{selected.run_summary.outcome === "partial_stopped" ? ", partial data" : ""}</strong>
              <span>{selected.run_summary.saved_records} saved</span>
              <span>{selected.run_summary.skipped_sources} skipped</span>
              <span>{selected.run_summary.search_calls} searches</span>
              <span>{selected.run_summary.scrape_calls} scrapes</span>
              <span>{selected.run_summary.recovery_calls} recovery</span>
              {selected.run_summary.stop_reason && <small>{selected.run_summary.stop_reason}</small>}
            </div>}

            {["queued", "discovering", "scraping", "extracting", "storing"].includes(selected.status) &&
              <div className="run-summary panel"><span>Running</span><button className="ghost-button" onClick={() => void cancelRun()} disabled={Boolean(selected.run_summary?.cancel_requested)}>{selected.run_summary?.cancel_requested ? "Cancelling" : "Cancel"}</button></div>}

            {selected.error && <div className="error-banner job-error">{selected.error}</div>}

            {selected.status === "awaiting_fields" && <section className="field-review panel">
              <h2>Fields</h2>
              {selected.combine_sources && <p className="empty-records">These fields will be combined into one record from multiple pages about the same item.</p>}
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
              <div className="section-header"><div><h2>Schema</h2></div></div>
              {selected.combine_sources && <p className="empty-records">One record combines fields from multiple URLs. Each populated field links to its source in the records API.</p>}
              <div className="table-wrap"><table><thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead><tbody>{Object.entries(selected.schema).map(([key, field]) => <tr key={key}><td><code>{key}</code></td><td><span className="status-pill sample">{field.type}</span></td><td>{field.description || "-"}</td></tr>)}</tbody></table></div>
            </section>

            <section className="records-section panel">
              <div className="section-header"><div><h2>Records</h2></div><button className="ghost-button" onClick={() => void refreshJob()} disabled={busy || !config?.extraction_ready || ["queued", "discovering", "scraping", "extracting", "storing"].includes(selected.status)}>{busy ? "Queuing..." : selected.status === "planned" ? "Run now" : "Refresh now"}</button></div>
              {records.length ? <div className="table-wrap"><table><thead><tr>{Object.keys(selected.schema).map((key) => <th key={key}>{key}</th>)}{selected.combine_sources && <th>Sources</th>}<th>Extracted</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}>{Object.keys(selected.schema).map((key) => <td key={key} title={record.field_sources?.[key] || undefined}>{key === "source_url" ? <a href={record.source_url} target="_blank" rel="noreferrer">Source</a> : record.data[key] === null || record.data[key] === undefined ? "null" : String(record.data[key])}</td>)}{selected.combine_sources && <td>{(record.source_urls || [record.source_url]).map((url, index) => <span key={url}><a href={url} target="_blank" rel="noreferrer">{index + 1}</a>{index + 1 < (record.source_urls || [record.source_url]).length ? ", " : ""}</span>)}</td>}<td>{new Date(record.extracted_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="empty-records">No records yet.</p>}
            </section>

            <section className="records-section panel"><div className="section-header"><div><h2>Runs</h2></div></div>
              {selected.sources.length > 0 && <ul className="source-list">{selected.sources.map((source) => <li key={source}><a href={source} target="_blank" rel="noreferrer">{source}</a></li>)}</ul>}
              {runs.length ? <div className="table-wrap"><table><thead><tr><th>Started</th><th>Trigger</th><th>Outcome</th><th>Saved</th><th>Searches, scrapes</th><th>Details</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{new Date(run.startedAt).toLocaleString()}</td><td>{run.trigger}</td><td>{run.outcome}</td><td>{run.savedRecords}</td><td>{run.searchCalls}, {run.scrapeCalls}</td><td>{run.stopReason || "—"}</td></tr>)}</tbody></table></div> : <p className="empty-records">No runs yet.</p>}
            </section>

            <section className="api-section panel"><div><h2>Endpoints</h2></div><div className="endpoint-list"><div className="endpoint"><span className="method">GET</span><code>{recordsPath}</code><button onClick={() => void copyEndpoint(recordsPath)}>Copy</button></div><div className="endpoint"><span className="method">GET</span><code>{jobPath}</code><button onClick={() => void copyEndpoint(jobPath)}>Copy</button></div><div className="endpoint"><span className="method">GET</span><code>{schemaPath}</code><button onClick={() => void copyEndpoint(schemaPath)}>Copy</button></div></div></section>
            </>}
            <section className="api-settings panel"><div><h2>Settings</h2></div><button className="ghost-button" onClick={openApiSettings}>Open</button></section>
            {apiSettingsOpen && apiSettingsJobId === selected.id && <section className="api-settings-editor panel" role="dialog" aria-modal="true" aria-label="API settings"><div className="settings-editor-heading"><div><h2>{selected.name}</h2></div><button onClick={() => setApiSettingsOpen(false)} aria-label="Close API settings">x</button></div><label className="input-label" htmlFor="api-name">API name</label><input id="api-name" className="text-input" value={editName} onChange={(event) => setEditName(event.target.value)} /><label className="input-label settings-interval-label" htmlFor="api-interval">Refresh</label><input id="api-interval" className="text-input interval-input" type="number" min="15" value={editInterval} onChange={(event) => setEditInterval(event.target.value)} placeholder="Manual" /><div className="settings-editor-actions"><button className="primary-button" onClick={() => void saveApiSettings()} disabled={busy || editName.trim().length < 3}>Save changes</button><button className={`danger-button ${deleteArmed ? "armed" : ""}`} onClick={() => deleteArmed ? void removeApi() : setDeleteArmed(true)} disabled={busy}>{deleteArmed ? "Confirm delete" : "Delete"}</button></div></section>}          </>}
        </div>
      </main>
    </div>
  );
}
