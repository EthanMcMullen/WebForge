import type { Metadata } from "next";
import Link from "next/link";
import { HomeComposer } from "@/components/home-composer";

export const metadata: Metadata = {
  title: "WebForge — Turn the public web into an API",
  description: "Describe the public data you need. WebForge finds it, verifies it, and serves sourced JSON.",
};

const stages = [
  { number: "01", title: "Say what you need", body: "Write a plain-English request or point WebForge at known pages. No schema wrestling." },
  { number: "02", title: "Approve the contract", body: "Keep the proposed fields you want. No scrape runs—and no credits are spent—before approval." },
  { number: "03", title: "Ship the endpoint", body: "Call stable JSON with source URLs, run history, and refresh controls already attached." },
];

const specimens = [
  {
    id: "A-01",
    name: "Price watch",
    prompt: "Track espresso machine prices across three retailers.",
    endpoint: "/api/jobs/espresso/records",
    record: { product: "Bambino Plus", price: 499.95, availability: "in_stock", source_url: "retailer.example/p/bambino" },
  },
  {
    id: "B-07",
    name: "Course index",
    prompt: "List Waterloo CS courses, prerequisites, and professors.",
    endpoint: "/api/jobs/courses/records",
    record: { course: "CS 246", prerequisite: "CS 136", professor: "A. Instructor", source_url: "uwaterloo.ca/course/CS246" },
  },
  {
    id: "C-12",
    name: "Event wire",
    prompt: "Find upcoming hackathons with dates and locations.",
    endpoint: "/api/jobs/hackathons/records",
    record: { event: "Build Weekend", date: "2026-10-03", location: "Toronto", source_url: "events.example/build-weekend" },
  },
];

const principles = [
  ["Bounded", "Focused, Balanced, and Deep modes put a hard ceiling on paid search and scrape calls."],
  ["Traceable", "Every row retains its primary source; combined records cite the page behind each field."],
  ["Skeptical", "Candidates and extracted records are checked against the original request before storage."],
  ["Recoverable", "Partial runs keep good records, report missing subjects, and never hide failed sources."],
];

const faqs = [
  ["Does it scrape before I approve fields?", "No. Planning proposes the contract first. Extraction starts only after you confirm the fields and run the job."],
  ["What happens when a source is wrong?", "Off-topic, sparse, private, and unsupported pages are skipped. The run reports partial data instead of quietly inventing completeness."],
  ["Can several pages become one record?", "Yes. Combine mode can join complementary facts about the same entity while preserving per-field provenance."],
];

export default function HomePage() {
  return (
    <div className="forge-site">
      <header className="forge-nav">
        <Link className="forge-wordmark" href="/" aria-label="WebForge home"><span>WF</span><strong>WEBFORGE</strong></Link>
        <div className="forge-nav-status" aria-label="System status"><i /> BUILDING PUBLIC DATA INFRASTRUCTURE</div>
        <nav aria-label="Primary navigation">
          <a href="#workbench">Workbench</a><a href="#method">Method</a><a href="#specimens">Specimens</a><Link href="/cli">CLI</Link>
        </nav>
        <Link className="forge-nav-button" href="/dashboard">OPEN APP <span>↗</span></Link>
      </header>

      <main>
        <section className="forge-hero" aria-labelledby="forge-title">
          <div className="forge-hero-copy">
            <p className="forge-overline"><span>HACKATHON BUILD / 2026</span><span>PUBLIC WEB → CLEAN JSON</span></p>
            <h1 id="forge-title">The web is<br />not a database.<br /><em>We make it behave.</em></h1>
            <div className="forge-hero-bottom">
              <p>Describe the public data you need. WebForge finds the right pages, extracts the fields you approve, and gives your project an endpoint before demo time.</p>
              <a className="forge-arrow-link" href="#workbench">BUILD YOUR API <span>↓</span></a>
            </div>
          </div>

          <aside className="forge-console" aria-label="Example WebForge run">
            <div className="forge-console-bar"><span>RUN_0042.LOG</span><span>LIVE</span></div>
            <div className="forge-console-body">
              <p><b>00:00</b> request received</p><p><b>00:01</b> schema proposed <mark>5 fields</mark></p>
              <p><b>00:03</b> operator approved</p><p><b>00:05</b> searching public web <mark>4 queries</mark></p>
              <p><b>00:11</b> sources reviewed <mark>8 accepted</mark></p><p><b>00:19</b> records stored <mark>6 rows</mark></p>
            </div>
            <div className="forge-console-result"><span>GET</span><code>/api/jobs/0042/records</code><strong>200</strong></div>
            <div className="forge-console-foot"><span>SEARCH 4/4</span><span>SCRAPE 6/6</span><span>SOURCED 100%</span></div>
          </aside>
        </section>

        <div className="forge-tape" aria-hidden="true"><div>
          <span>SCHEMA FIRST</span><i>◆</i><span>NO SILENT GAPS</span><i>◆</i><span>FIELD-LEVEL SOURCES</span><i>◆</i><span>BOUNDED CREDIT USE</span><i>◆</i>
          <span>SCHEMA FIRST</span><i>◆</i><span>NO SILENT GAPS</span><i>◆</i><span>FIELD-LEVEL SOURCES</span><i>◆</i><span>BOUNDED CREDIT USE</span><i>◆</i>
        </div></div>

        <section id="workbench" className="forge-workbench" aria-labelledby="workbench-title">
          <header className="forge-section-head">
            <div><span>01 / WORKBENCH</span><span>REAL INPUT — NOT A MOCKUP</span></div>
            <h2 id="workbench-title">Make the endpoint<br />you wish existed.</h2>
          </header>
          <HomeComposer />
          <div className="forge-output-strip">
            <div className="forge-output-label"><span>OUTPUT PREVIEW</span><strong>GET /records</strong><small>application/json</small></div>
            <pre><code>{JSON.stringify([
              { course: "CS 246", professor: "A. Instructor", rating: 4.7 },
              { course: "CS 341", professor: "B. Instructor", rating: 4.4 },
            ], null, 2)}</code></pre>
            <div className="forge-output-proof"><p><b>✓</b> source_url on every row</p><p><b>✓</b> schema endpoint included</p><p><b>✓</b> refresh without replanning</p></div>
          </div>
        </section>

        <section id="method" className="forge-method" aria-labelledby="method-title">
          <header className="forge-section-head forge-section-head-dark">
            <div><span>02 / METHOD</span><span>THREE MOVES</span></div><h2 id="method-title">From sentence to<br />software primitive.</h2>
          </header>
          <ol>{stages.map((stage) => <li key={stage.number}><span>{stage.number}</span><h3>{stage.title}</h3><p>{stage.body}</p></li>)}</ol>
        </section>

        <section id="specimens" className="forge-specimens" aria-labelledby="specimens-title">
          <header className="forge-section-head">
            <div><span>03 / SPECIMENS</span><span>REQUEST → RECORD</span></div><h2 id="specimens-title">Three things you could<br />ship this weekend.</h2>
          </header>
          <div className="forge-specimen-list">
            {specimens.map((specimen) => <article key={specimen.id}>
              <div className="forge-specimen-meta"><span>{specimen.id}</span><strong>{specimen.name}</strong></div>
              <blockquote>“{specimen.prompt}”</blockquote><pre><code>{JSON.stringify(specimen.record, null, 2)}</code></pre>
              <div className="forge-specimen-action"><code>GET {specimen.endpoint}</code><Link href={`/dashboard?request=${encodeURIComponent(specimen.prompt)}`}>USE THIS BRIEF →</Link></div>
            </article>)}
          </div>
        </section>

        <section className="forge-principles" aria-labelledby="principles-title">
          <div className="forge-principles-intro"><span>04 / RULES OF THE FORGE</span><h2 id="principles-title">Useful data<br />has receipts.</h2><p>A fast demo is good. A fast demo that can explain every value is better.</p></div>
          <dl>{principles.map(([term, description], index) => <div key={term}><dt><span>0{index + 1}</span>{term}</dt><dd>{description}</dd></div>)}</dl>
        </section>

        <section className="forge-cli" aria-labelledby="cli-title">
          <div className="forge-cli-copy"><p>05 / TERMINAL EDITION</p><h2 id="cli-title">Stay in the flow.</h2><span>One dependency-free file. Same jobs, records, depth controls, and sources as the web app.</span><Link href="/cli">DOWNLOAD CLI →</Link></div>
          <pre aria-label="WebForge CLI example"><code><b>$</b> node webforge-cli.mjs create --wait{"\n"}{"\n"}<i>?</i> What data do you need?{"\n"}<strong>› Upcoming climate-tech grants</strong>{"\n"}{"\n"}<i>✓</i> 6 fields approved{"\n"}<i>✓</i> 12 records stored{"\n"}<i>✓</i> API ready</code></pre>
        </section>

        <section className="forge-faq" aria-labelledby="faq-title">
          <div><span>06 / STRAIGHT ANSWERS</span><h2 id="faq-title">Before you forge.</h2></div>
          <div>{faqs.map(([question, answer], index) => <details key={question} open={index === 0}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div>
        </section>

        <section className="forge-final" aria-label="Get started"><span>YOUR IDEA NEEDS DATA.</span><h2>Stop hunting pages.<br /><em>Start calling an API.</em></h2><div><a href="#workbench">FORGE IT NOW ↓</a><Link href="/dashboard">OPEN DASHBOARD ↗</Link></div></section>
      </main>

      <footer className="forge-footer">
        <Link className="forge-wordmark" href="/"><span>WF</span><strong>WEBFORGE</strong></Link><p>Public web data with a paper trail.</p>
        <div><Link href="/dashboard">APP</Link><Link href="/cli">CLI</Link><a href="#workbench">CREATE</a></div><small>BUILD 2026.09</small>
      </footer>
    </div>
  );
}
