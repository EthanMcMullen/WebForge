import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "WebForge CLI — Download",
  description: "Download the standalone WebForge command-line client for the VS Code terminal.",
};

const commands = [
  ["Create interactively", "node webforge-cli.mjs create --wait"],
  ["Choose a depth", 'node webforge-cli.mjs create --request "List recent battery recycling articles" --depth balanced --wait'],
  ["List APIs", "node webforge-cli.mjs list"],
  ["Export records", "node webforge-cli.mjs records <job-id> --json"],
  ["Refresh now", "node webforge-cli.mjs refresh <job-id> --wait"],
  ["Schedule hourly", "node webforge-cli.mjs schedule <job-id> --every 60"],
  ["Return to manual", "node webforge-cli.mjs schedule <job-id> --manual"],
];

export default function CliDownloadPage() {
  return <main className="cli-page">
    <nav className="cli-nav" aria-label="CLI page navigation">
      <Link href="/" className="cli-brand"><span className="brand-mark">W</span><strong>WebForge</strong></Link>
      <Link href="/">Back to workspace</Link>
    </nav>

    <section className="cli-hero">
      <div>
        <p className="hero-eyebrow"><span className="sparkle" />Command-line client</p>
        <h1>Web data,<br /><em>from your terminal.</em></h1>
        <p>Download one dependency-free Node file. Run it in the VS Code terminal and connect to your local or hosted WebForge service.</p>
        <div className="cli-actions">
          <a className="primary-button cli-download" href="/downloads/webforge-cli.mjs" download>Download webforge-cli.mjs</a>
          <a className="ghost-button" href="/downloads/webforge-cli.mjs">View source</a>
        </div>
        <small>Requires Node.js 24 or newer · No separate npm install</small>
      </div>
      <pre className="cli-terminal" aria-label="CLI example"><code><span>$</span> node webforge-cli.mjs create --wait{"\n"}{"\n"}Search depth (focused, balanced, deep) [balanced]:{"\n"}Proposed fields for Course directory:{"\n"}  1. course_code{"\n"}  2. professor_name{"\n"}  3. professor_rating{"\n"}{"\n"}<b>Status: ready</b></code></pre>
    </section>

    <section className="cli-grid" aria-label="CLI setup">
      <article className="panel cli-card"><span className="step-number">01</span><h2>Download</h2><p>Save the client anywhere—your project folder, Downloads, or a tools directory.</p><code>webforge-cli.mjs</code></article>
      <article className="panel cli-card"><span className="step-number">02</span><h2>Connect</h2><p>Local WebForge uses port 3000 automatically. For another server, set its URL first.</p><pre><code>$env:WEBFORGE_BASE_URL={"\"https://webforge.example\""}</code></pre></article>
      <article className="panel cli-card"><span className="step-number">03</span><h2>Authenticate</h2><p>If the workspace is protected, provide the same shared access token.</p><pre><code>$env:WEBFORGE_ACCESS_TOKEN={"\"your-token\""}</code></pre></article>
    </section>

    <section className="panel cli-reference">
      <div className="section-header"><div><span className="step-number">04</span><h2>Run it in VS Code</h2></div></div>
      <div className="cli-command-list">{commands.map(([label, command]) => <div key={label}><strong>{label}</strong><code>{command}</code></div>)}</div>
    </section>

    <section className="cli-note panel">
      <div><h2>Client versus full edition</h2><p>The download is a small remote client: it creates jobs, selects fields, queues runs, waits, and reads records. It does not contain your API keys or start the Next.js server. To host WebForge itself, use the full repository and run <code>npm run cli -- serve</code>.</p></div>
      <Link className="ghost-button" href="/">Open workspace</Link>
    </section>
  </main>;
}
