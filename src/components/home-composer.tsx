"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshScheduleEditor } from "@/components/refresh-schedule-editor";

export const homeIdeas = [
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

const homeQuickStarts = [
  { label: "Price tracker", request: homeIdeas[0] + " with product name, price, and availability." },
  { label: "Event directory", request: homeIdeas[1] + " with event name, date, and location." },
  { label: "Menu monitor", request: homeIdeas[2] + " with dish name, price, and dietary tags." },
];

export function HomeComposer() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [manualRequest, setManualRequest] = useState("");
  const [tookOver, setTookOver] = useState(false);
  const [ideaIdx, setIdeaIdx] = useState(0);
  const [chars, setChars] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [strategy, setStrategy] = useState<"automatic" | "provided_urls">("automatic");
  const [combineSources, setCombineSources] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [refreshInterval, setRefreshInterval] = useState("");
  const [reduced] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const typed = reduced ? homeIdeas[0] : homeIdeas[ideaIdx].slice(0, chars);
  const request = tookOver ? manualRequest : typed;

  useEffect(() => {
    if (tookOver || reduced) return;
    const full = homeIdeas[ideaIdx];
    let delay = deleting ? 14 : 34;
    if (!deleting && chars === full.length) delay = 1600;
    else if (deleting && chars === 0) delay = 350;
    const timer = window.setTimeout(() => {
      if (!deleting && chars === full.length) {
        setDeleting(true);
      } else if (deleting && chars === 0) {
        setDeleting(false);
        setIdeaIdx((i) => (i + 1) % homeIdeas.length);
      } else {
        setChars((c) => c + (deleting ? -1 : 1));
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [chars, deleting, ideaIdx, tookOver, reduced]);

  function submit() {
    const finalRequest = request.trim() || homeIdeas[ideaIdx];
    const params = new URLSearchParams({ request: finalRequest });
    if (name.trim()) params.set("name", name.trim());
    if (strategy !== "automatic") params.set("strategy", strategy);
    if (combineSources) params.set("combine", "1");
    if (sourceText.trim()) params.set("sources", sourceText.trim());
    if (refreshInterval.trim()) params.set("refresh", refreshInterval.trim());
    router.push(`/dashboard?${params.toString()}`);
  }

  return (
    <section className="composer panel site-composer" aria-label="New API">
      <div className="panel-heading">
        <span className="step-number">01</span>
        <div>
          <p className="section-kicker">Create</p>
          <h2>New API</h2>
          <p>Describe the data. WebForge proposes fields before any extraction runs.</p>
        </div>
        <span className="site-live-badge" aria-hidden="true"><span className="site-caret" />{tookOver ? "yours" : `idea ${ideaIdx + 1}/20`}</span>
      </div>
      <label className="input-label" htmlFor="site-job-name">Name<span>Optional</span></label>
      <input
        id="site-job-name"
        className="text-input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Espresso prices"
      />
      <label className="input-label request-label" htmlFor="site-request">Request</label>
      <textarea
        id="site-request"
        value={request}
        rows={4}
        placeholder="What public web data should this hold..."
        aria-describedby="site-typing-status"
        onFocus={() => {
          if (!tookOver) {
            setManualRequest(typed);
            setTookOver(true);
          }
        }}
        onChange={(event) => {
          setTookOver(true);
          setManualRequest(event.target.value);
        }}
      />
      <p id="site-typing-status" className="site-typing-status" aria-live="polite">
        {tookOver
          ? "Your words — submit to forge it in the dashboard."
          : reduced
            ? homeIdeas[0]
            : "Typing ideas — click the box to write your own."}
      </p>

      <div className="composer-options">
        <div className="mode-group" role="group" aria-label="Source strategy">
          <button type="button" className={strategy === "automatic" ? "mode active" : "mode"} onClick={() => setStrategy("automatic")}>Automatic</button>
          <button type="button" className={strategy === "provided_urls" ? "mode active" : "mode"} onClick={() => setStrategy("provided_urls")}>URLs</button>
        </div>
        <p className="mode-hint">{strategy === "automatic" ? "WebForge searches the public web for matching pages." : "You supply up to five public page URLs, one per line."}</p>
      </div>

      {strategy === "provided_urls" && (
        <div className="seed-block">
          <label className="input-label" htmlFor="site-sources">Sources</label>
          <textarea id="site-sources" rows={3} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="One public URL per line" />
        </div>
      )}
      <label className="field-option">
        <input type="checkbox" checked={combineSources} onChange={(event) => setCombineSources(event.target.checked)} />
        <span><strong>Combine sources into one record</strong><small>Use multiple pages for one item, such as Apple specs and an independent benchmark.</small></span>
      </label>
      <RefreshScheduleEditor id="site-interval" value={refreshInterval} onChange={setRefreshInterval} />
      <div className="example-row">
        <span>Try:</span>
        {homeQuickStarts.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              setManualRequest(item.request);
              setTookOver(true);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="composer-footer">
        <span>{request.trim().length}/10 chars minimum</span>
        <button className="primary-button" onClick={submit} disabled={request.trim().length < 10}>
          Propose fields
        </button>
      </div>
    </section>
  );
}
