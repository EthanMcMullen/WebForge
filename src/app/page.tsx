import type { Metadata } from "next";
import Link from "next/link";
import { HomeComposer } from "@/components/home-composer";
import { BeforeAfter } from "@/components/before-after";

export const metadata: Metadata = {
  title: "WebForge — Point at the web. Get an API.",
  description: "Describe public web data in plain English. WebForge plans fields, extracts records, and serves live JSON.",
};

const examples = [
  {
    label: "Price tracker",
    request: "Track espresso machine prices across three retailers with product name, price, and availability.",
    output: `[
  { "product": "Entry espresso machine", "price": 449.0, "availability": "In stock" },
  { "product": "Compact grinder", "price": 129.0, "availability": "Low stock" }
]`,
    endpoint: "GET /records → 48 rows",
  },
  {
    label: "Event directory",
    request: "List upcoming hackathons with event name, date, and location.",
    output: `[
  { "event": "Harbor Hackathon", "date": "Jun 12", "location": "Boston" },
  { "event": "Civic Data Summit", "date": "Jul 18", "location": "Chicago" }
]`,
    endpoint: "GET /records → 86 rows",
  },
  {
    label: "Menu monitor",
    request: "Monitor new menu items at downtown ramen spots with dish name, price, and dietary tags.",
    output: `[
  { "dish": "Shoyu ramen", "price": 14.5, "tags": "Vegetarian option" },
  { "dish": "Miso eggplant", "price": 11.0, "tags": "Vegan" }
]`,
    endpoint: "GET /records → 412 rows",
  },
];

const steps = [
  { n: "01", title: "Describe", body: "Write what you want in plain English. Pick automatic discovery or paste up to five URLs." },
  { n: "02", title: "Confirm fields", body: "WebForge proposes a schema. You keep only the fields your app needs — extraction never runs before you approve." },
  { n: "03", title: "Call JSON", body: "Get stable records + schema endpoints. Refresh on demand or on a schedule, with run history and sources." },
];

const features = [
  { title: "Guarded discovery", body: "Search candidates are reviewed before scraping. Unsupported, sparse, or off-topic pages are skipped — missing subjects surface as Partial data, not silent gaps.", tag: "Trust", large: true },
  { title: "Evidence-checked prices", body: "Numeric prices must appear next to the matching item in page text. Unrelated recommendation prices are rejected.", tag: "Accuracy", large: false },
  { title: "Source provenance", body: "Every record keeps source_url, per-field sources, run counts, and history. Audit where each value came from.", tag: "Audit", large: false },
  { title: "Bounded runs", body: "Per-run ceilings on searches, scrapes, recovery, and time. Queued in SQLite with cancellation, retries, and scheduled refresh.", tag: "Control", large: false },
  { title: "Combine mode", body: "Merge complementary pages about one item — e.g. specs from Apple plus a benchmark score — into a single record.", tag: "Merge", large: true },
  { title: "Copyable endpoints", body: "GET /records, /schema, and /jobs per API. Stable shapes your frontend can depend on.", tag: "DX", large: false },
];

const trustStats = [
  { k: "5", v: "searches max / run" },
  { k: "5", v: "structured scrapes / run" },
  { k: "4 min", v: "bounded run ceiling" },
  { k: "100%", v: "records carry sources" },
];

const useCases = [
  "Price trackers",
  "Event directories",
  "Menu monitors",
  "Job boards",
  "Restock watchers",
  "Grant deadlines",
  "Rental scans",
  "Benchmark merges",
];

const faqs = [
  { q: "Does extraction run before I approve fields?", a: "No. POST /api/jobs only plans a draft with OpenAI — no Firecrawl call. Extraction queues only after you PATCH /fields and POST /run." },
  { q: "What happens when a page is missing or off-topic?", a: "Candidates are reviewed before scraping. Sparse or mismatched pages are skipped, and incomplete subjects report as Partial — saved records stay available." },
  { q: "How do I read the data?", a: "GET /records for rows, /schema for the confirmed shape, /runs for history. Every record includes source_url, source_urls, and field_sources." },
  { q: "Can I merge two sites into one record?", a: "Yes — turn on Combine sources. Complementary pages about the same entity merge into one record; conflicts keep the first source and appear in the run warning." },
];

export default function HomePage() {
  return (
    <div className="site">
      <header className="site-nav">
        <Link className="site-brand" href="/" aria-label="WebForge home">
          <span className="brand-mark">W</span>
          <span><strong>WebForge</strong><small>Web → API</small></span>
        </Link>
        <nav className="site-links" aria-label="Site">
          <a href="#create">Create</a>
          <a href="#proof">Proof</a>
          <a href="#how">How it works</a>
          <a href="#examples">Examples</a>
          <a href="#features">Features</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="site-nav-cta">
          <a className="ghost-button" href="/dashboard">Open dashboard</a>
          <a className="primary-button site-cta" href="#create">Forge an API</a>
        </div>
      </header>

      <main className="site-main site-main-killer">
        {/* 1 — HERO: one promise, one action */}
        <section className="site-hero-center" aria-label="Intro">
          <p className="section-kicker">-Type one sentence. Get live JSON. -</p>
          <h1>Point at the web.<br /><em>Get an API.</em></h1>
          <div className="fun-line" aria-hidden="true"><span>Public web data, served as live JSON</span></div>
          <p className="landing-sub site-hero-sub">The box below is the real thing — the same New API composer from the dashboard. Watch an idea type itself, then make it yours.</p>
          <ul className="site-trust" aria-label="Run guarantees">
            {trustStats.map((s) => (
              <li key={s.v}><strong>{s.k}</strong><span>{s.v}</span></li>
            ))}
          </ul>
        </section>

        {/* 2 — HERO DEMO: composer + what-you-get rail (Stripe/Linear 2-col hero) */}
        <div id="create" className="site-create-grid">
          <HomeComposer />
          <aside className="site-side-stack" aria-label="What you get">
            <div className="panel site-json-card">
              <div className="demo-filled-head">
                <strong>GET /records → live JSON</strong>
                <span className="status-pill sample">200 OK</span>
              </div>
              <pre className="schema-preview site-json">{`[
  { "product": "Entry espresso machine",
    "price": 449.0, "availability": "In stock",
    "source_url": "retailer-a…/grinder" },
  { "product": "Compact grinder",
    "price": 129.0, "availability": "Low stock",
    "source_url": "retailer-b…/compact" }
]`}</pre>
              <div className="site-demo-row">
                <span>GET /schema</span><span>GET /runs</span><span>field_sources ✓</span>
              </div>
            </div>
            <div className="panel site-guarantee-card">
              <p className="section-kicker">No surprises</p>
              <ul>
                <li><strong>Approve first.</strong> Extraction never runs before you confirm fields.</li>
                <li><strong>Partial, not silent.</strong> Skipped pages surface as Partial data.</li>
                <li><strong>Every value cited.</strong> source_url + per-field sources on each row.</li>
              </ul>
              <a className="ghost-button" href="#proof">See the proof ↓</a>
            </div>
          </aside>
        </div>

        {/* 3 — SOCIAL PROOF directly under hero (highest-lift block) */}
        <section className="site-proof-strip panel" aria-label="Built for">
          <p className="section-kicker">Built for data hunters</p>
          <div className="site-marquee" aria-hidden="true">
            <div className="site-marquee-track">
              {[...useCases, ...useCases].map((u, i) => (
                <span key={`${u}-${i}`}>{u}</span>
              ))}
            </div>
          </div>
        </section>

        {/* 4 — INTERACTIVE PROOF */}
        <div id="proof">
          <BeforeAfter />
        </div>

        {/* 5 — HOW IT WORKS: 3-move timeline */}
        <section id="how" className="site-section panel" aria-label="How it works">
          <p className="section-kicker">How it works</p>
          <h2>From sentence to endpoint in three moves.</h2>
          <div className="how-row site-how">
            {steps.map((step) => (
              <div className="how-step" key={step.n}>
                <span className="step-number">{step.n}</span>
                <div><strong>{step.title}</strong><p>{step.body}</p></div>
              </div>
            ))}
          </div>
          <div className="site-section-cta">
            <a className="primary-button" href="/dashboard">Open the dashboard</a>
            <a className="ghost-button" href="#examples">See examples</a>
          </div>
        </section>

        {/* 6 — FEATURES as BENTO (67% of top SaaS pages pattern) */}
        <section id="features" className="site-section" aria-label="Features">
          <p className="section-kicker">Why WebForge</p>
          <h2>Serious about provenance, bounded by design.</h2>
          <p className="landing-sub">One big promise, supporting proof. Large tiles carry the ideas that close deals; small tiles handle objections.</p>
          <div className="site-bento">
            {features.map((feature) => (
              <div key={feature.title} className={feature.large ? "panel site-bento-card site-bento-large" : "panel site-bento-card"}>
                <span className="site-bento-tag">{feature.tag}</span>
                <strong>{feature.title}</strong>
                <p>{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 7 — EXAMPLES with endpoint proof */}
        <section id="examples" className="site-section panel" aria-label="Examples">
          <p className="section-kicker">Examples</p>
          <h2>Start from a pattern, make it yours.</h2>
          <div className="site-cards">
            {examples.map((example) => (
              <article key={example.label} className="panel site-card">
                <p className="section-kicker">{example.label}</p>
                <p className="site-card-request">“{example.request}”</p>
                <pre className="schema-preview">{example.output}</pre>
                <div className="site-card-foot">
                  <span className="status-pill sample">{example.endpoint}</span>
                  <a className="text-button" href={`/dashboard?request=${encodeURIComponent(example.request)}`}>Use this pattern →</a>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 8 — STATS BAND */}
        <section className="site-stats-band panel" aria-label="Run stats">
          <div><strong>1,284</strong><span>records stored in demo data</span></div>
          <div><strong>9 / 12</strong><span>APIs ready right now</span></div>
          <div><strong>5 + 1</strong><span>planned + recovery searches per run</span></div>
          <div><strong>0</strong><span>extractions before field approval</span></div>
        </section>

        {/* 9 — FAQ (objection handling before final CTA) */}
        <section id="faq" className="site-section panel site-faq" aria-label="FAQ">
          <p className="section-kicker">FAQ</p>
          <h2>Asked before every forge.</h2>
          <div className="site-faq-list">
            {faqs.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 10 — CLOSING CTA (mirrors hero, single action) */}
        <section className="site-cta-panel site-cta-xl panel" aria-label="Get started">
          <div>
            <p className="section-kicker">Ready when you are</p>
            <h2>Your next dataset is one sentence away.</h2>
            <p>Describe it. Approve the fields. Call the JSON. Keep the sources.</p>
          </div>
          <div className="site-section-cta site-cta-actions">
            <a className="primary-button" href="#create">Forge an API</a>
            <a className="ghost-button" href="/dashboard">View dashboard</a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span><strong>WebForge</strong> · Describe data. Get an API.</span>
        <span><a href="/dashboard">Dashboard</a> · <a href="#how">How it works</a> · <a href="#features">Features</a> · <a href="#faq">FAQ</a></span>
      </footer>
    </div>
  );
}
