import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { HomeComposer } from "@/components/home-composer";

export const metadata: Metadata = {
  title: "WebForge — Reliable web data, delivered as an API",
  description:
    "Describe the public data you need. WebForge finds, verifies, and delivers it through a source-backed JSON API.",
};

const workflow = [
  { number: "01", title: "Describe the dataset", body: "Tell WebForge what you need in plain English. We propose a clean schema before any credits are spent." },
  { number: "02", title: "Set the search depth", body: "Choose a focused, balanced, or deep run so vague requests never turn into open-ended scraping bills." },
  { number: "03", title: "Recover visually", body: "When readable HTML fails, WebForge captures the rendered page and extracts the same approved fields from what a person can see." },
  { number: "04", title: "Call your endpoint", body: "Get consistent JSON, source URLs, run history, and refresh controls through the web app or CLI." },
];

const capabilities = [
  { label: "Controlled spend", title: "Useful coverage without runaway credits.", body: "Every depth mode has explicit search, scrape, and record targets. You decide how broad the run should be." },
  { label: "Source-backed", title: "Every record comes with receipts.", body: "Trace data to its original page, including field-level sources when a record combines multiple websites." },
  { label: "Production-minded", title: "Partial results stay honest.", body: "WebForge keeps valid records, reports missing fields, and surfaces failed sources instead of fabricating completeness." },
];

const founders = [
  { name: "Mobin", program: "Electrical & Computer Engineering", school: "University of Toronto", logo: "/brand/university-of-toronto.png", logoWidth: 58, logoHeight: 75, schoolKey: "uoft" },
  { name: "Ethan", program: "Computer Engineering", school: "University of Waterloo", logo: "/brand/university-of-waterloo.svg", logoWidth: 64, logoHeight: 64, schoolKey: "waterloo" },
  { name: "Evan", program: "Computational Mathematics", school: "University of Waterloo", logo: "/brand/university-of-waterloo.svg", logoWidth: 64, logoHeight: 64, schoolKey: "waterloo" },
];

export default function HomePage() {
  return (
    <div className="company-site">
      <header className="company-nav">
        <div className="company-container company-nav-inner">
          <Link className="company-brand" href="/" aria-label="WebForge home">
            <span className="company-brand-mark" aria-hidden="true">WF</span>
            <strong>WebForge</strong>
          </Link>
          <nav aria-label="Primary navigation">
            <a href="#product">Product</a><a href="#platform">Platform</a><a href="#vision">Vision</a><a href="#company">Company</a><Link href="/cli">CLI</Link>
          </nav>
          <div className="company-nav-actions">
            <Link className="company-login" href="/dashboard">Sign in</Link>
            <a className="company-button company-button-small" href="#product">Start building</a>
          </div>
        </div>
      </header>

      <main>
        <section className="company-hero">
          <div className="company-container company-hero-grid">
            <div className="company-hero-copy">
              <div className="company-eyebrow"><span /> Built for teams that need data, not scraping infrastructure</div>
              <h1>The data layer for the <em>open web.</em></h1>
              <p>Turn scattered public websites into a reliable, source-backed API. Describe the records you need; WebForge handles discovery, extraction, and delivery.</p>
              <div className="company-hero-actions">
                <a className="company-button" href="#product">Create your API <span>→</span></a>
                <Link className="company-text-link" href="/cli">Download the CLI <span>↗</span></Link>
              </div>
              <div className="company-hero-note"><span>✓</span> Approve the schema before extraction &nbsp;·&nbsp; No credit card required</div>
            </div>

            <div className="company-product-window" aria-label="WebForge product preview">
              <div className="company-window-bar">
                <div><i /><i /><i /></div><span>api.webforge.dev / courses</span><b>Live</b>
              </div>
              <div className="company-window-body">
                <aside><strong>WebForge</strong><span className="active">Overview</span><span>Records</span><span>Sources</span><span>Runs</span><small>WF</small></aside>
                <div className="company-window-main">
                  <div className="company-window-title">
                    <div><small>API / COURSES</small><h2>Waterloo CS courses</h2></div><button type="button">Run refresh</button>
                  </div>
                  <div className="company-metrics">
                    <div><span>Records</span><strong>48</strong><small>+12 this run</small></div>
                    <div><span>Sources</span><strong>16</strong><small>100% cited</small></div>
                    <div><span>Status</span><strong className="company-status">Healthy</strong><small>Updated 2m ago</small></div>
                  </div>
                  <div className="company-endpoint">
                    <div><span>GET</span><code>/api/jobs/courses/records</code><b>200 OK</b></div>
                    <pre><code>{`[
  {
    "course": "CS 246",
    "prerequisite": "CS 136",
    "source_url": "uwaterloo.ca/..."
  }
]`}</code></pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="company-affiliations" aria-label="Hackathon and founder affiliations">
          <div className="company-container company-affiliations-inner">
            <p>Built at and shaped by students from</p>
            <div className="company-affiliation-list">
              <a className="company-affiliation htn" href="https://hackthenorth.com/" target="_blank" rel="noreferrer"><span className="htn-cube" aria-hidden="true">H</span><strong>Hack the North</strong></a>
              <a className="company-affiliation waterloo" href="https://uwaterloo.ca/" target="_blank" rel="noreferrer"><Image className="company-school-mark" src="/brand/university-of-waterloo.svg" width={44} height={44} alt="" /><strong>University of Waterloo</strong></a>
              <a className="company-affiliation uoft" href="https://www.utoronto.ca/" target="_blank" rel="noreferrer"><Image className="company-school-mark company-school-mark-uoft" src="/brand/university-of-toronto.png" width={44} height={57} alt="" /><strong>University of Toronto</strong></a>
            </div>
          </div>
        </section>

        <section id="product" className="company-builder">
          <div className="company-container">
            <div className="company-section-heading">
              <span>Build your first endpoint</span><h2>Start with a question.<br />Leave with an API.</h2>
              <p>This is the real builder—not a product mockup. Enter the dataset you want and WebForge will propose the fields for your approval.</p>
            </div>
            <div className="company-composer-shell"><HomeComposer /></div>
          </div>
        </section>

        <section id="platform" className="company-platform">
          <div className="company-container">
            <div className="company-section-heading company-section-heading-row">
              <div><span>One workflow, end to end</span><h2>From request to reliable records.</h2></div>
              <p>WebForge turns an ambiguous data request into a bounded, observable pipeline your team can understand.</p>
            </div>
            <ol className="company-workflow">
              {workflow.map((item) => <li key={item.number}><span>{item.number}</span><h3>{item.title}</h3><p>{item.body}</p></li>)}
            </ol>
            <div className="company-capabilities">
              {capabilities.map((item) => <article key={item.label}><span>{item.label}</span><h3>{item.title}</h3><p>{item.body}</p></article>)}
            </div>

            <section id="vision" className="company-visual" aria-labelledby="visual-extraction-title">
              <div className="company-visual-copy">
                <span>Visual data extraction · Fallback layer</span>
                <h2 id="visual-extraction-title">Robust when the HTML fights back.</h2>
                <p>WebForge reads structured HTML first. When obfuscated markup, client-rendered values, or anti-bot HTML makes that result unusable, it captures the rendered page and extracts the approved fields from what is visibly present.</p>
                <div className="company-visual-route" aria-label="Visual extraction fallback sequence">
                  <div><i className="failed" />HTML extraction<strong>Unusable</strong></div>
                  <span aria-hidden="true">→</span>
                  <div><i className="captured" />Rendered page<strong>Captured</strong></div>
                  <span aria-hidden="true">→</span>
                  <div><i className="verified" />Identity + schema<strong>Verified</strong></div>
                </div>
                <small>Automatic fallback · 2 visual recoveries per run · Same validation rules</small>
              </div>

              <div className="company-visual-demo" aria-label="Example of a product page recovered through visual extraction">
                <div className="company-visual-browser">
                  <div className="company-visual-browser-bar"><div><i /><i /><i /></div><span>commerce page / samsung-990-pro</span><b>Rendered</b></div>
                  <div className="company-retail-page">
                    <div className="company-retail-search">Search&nbsp;&nbsp; <strong>SSD</strong></div>
                    <div className="company-retail-product">
                      <div className="company-drive-art"><span>990</span><b>PRO</b><small>2TB</small></div>
                      <div className="company-retail-details"><span>Samsung · Internal solid state drives</span><h3>SSD 990 PRO 2TB NVMe</h3><p>PCIe 4.0 · M.2 2280 · 4.7 rating</p><strong>CAD $545.64</strong><small>In stock</small></div>
                    </div>
                    <div className="company-html-failure"><span>×</span><div><b>Markup extraction failed</b><small>Obfuscated product nodes · price missing</small></div></div>
                    <div className="company-vision-scan" aria-hidden="true"><i /><span>VISION FALLBACK</span></div>
                    <div className="company-vision-target target-title" aria-hidden="true"><span>product</span></div>
                    <div className="company-vision-target target-price" aria-hidden="true"><span>price</span></div>
                    <div className="company-vision-target target-stock" aria-hidden="true"><span>availability</span></div>
                  </div>
                </div>
                <div className="company-visual-result">
                  <div><span>VISUAL RECORD</span><b><i /> recovered</b></div>
                  <pre><code>{`{
  "product": "Samsung SSD 990 PRO",
  "capacity": "2 TB",
  "price_cad": 545.64,
  "availability": "In stock",
  "rating": 4.7,
  "extraction_mode": "vision"
}`}</code></pre>
                  <p><span>5/5</span> requested fields visible and schema-valid</p>
                </div>
              </div>
            </section>
          </div>
        </section>

        <section className="company-cli" aria-labelledby="company-cli-title">
          <div className="company-container company-cli-grid">
            <div>
              <span className="company-kicker">WebForge for the terminal</span><h2 id="company-cli-title">The same data pipeline, without leaving VS Code.</h2>
              <p>Download one dependency-free file to create jobs, choose depth, watch runs, and pull records from your terminal.</p>
              <Link className="company-button company-button-light" href="/cli">Get the CLI <span>→</span></Link>
            </div>
            <div className="company-terminal">
              <div><span>webforge — powershell</span><i>●</i></div>
              <pre><code><b>$</b> node webforge-cli.mjs create --wait{"\n\n"}<span>?</span> What data do you need?{"\n"}<strong>› Waterloo CS courses and prerequisites</strong>{"\n\n"}<span>✓</span> Schema approved: 5 fields{"\n"}<span>✓</span> Balanced search: 12 records{"\n"}<span>✓</span> Endpoint ready{"\n\n"}<em>GET /api/jobs/courses/records</em></code></pre>
            </div>
          </div>
        </section>

        <section id="company" className="company-founders">
          <div className="company-container company-founders-grid">
            <div className="company-founders-copy">
              <span>Meet the founders</span><h2>Built by students who were tired of rebuilding scrapers.</h2>
              <p>WebForge started from a simple frustration: useful public data is everywhere, but turning it into dependable software still takes too much time.</p>
            </div>
            <div className="company-founder-list">
              {founders.map((founder) => <article key={founder.name}><div className={`company-founder-school-logo ${founder.schoolKey}`}><Image src={founder.logo} width={founder.logoWidth} height={founder.logoHeight} alt={`${founder.school} logo`} /></div><div><h3>{founder.name}</h3><p>{founder.program}</p><span>{founder.school}</span></div></article>)}
            </div>
          </div>
        </section>

        <section className="company-final">
          <div className="company-container company-final-inner">
            <div><span>Build with live data</span><h2>Your next product should call an API, not chase a website.</h2></div>
            <div><a className="company-button company-button-light" href="#product">Create your API <span>→</span></a><Link href="/dashboard">Open dashboard</Link></div>
          </div>
        </section>
      </main>

      <footer className="company-footer">
        <div className="company-container">
          <div className="company-footer-top">
            <Link className="company-brand" href="/"><span className="company-brand-mark" aria-hidden="true">WF</span><strong>WebForge</strong></Link>
            <div><Link href="/dashboard">Dashboard</Link><Link href="/cli">CLI</Link><a href="#product">Create API</a></div>
          </div>
          <div className="company-footer-bottom">
            <p>Hack the North and university names indicate event participation and founder affiliations. No institutional endorsement is implied.</p><span>© 2026 WebForge</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
