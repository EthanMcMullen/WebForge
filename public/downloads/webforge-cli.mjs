#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const fullInstall = existsSync(resolve(repositoryRoot, "node_modules/next/dist/bin/next"));
const projectRoot = fullInstall ? repositoryRoot : scriptDirectory;
try { process.loadEnvFile(resolve(projectRoot, ".env.local")); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const terminalStatuses = new Set(["ready", "partial", "failed"]);
const depthChoices = ["focused", "balanced", "deep"];

export function parseCliArgs(argv) {
  const [command = "help", ...tokens] = argv;
  const options = { _: [] };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.startsWith("--")) { options._.push(token); continue; }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replaceAll("-", "_");
    const next = tokens[index + 1];
    const value = inlineValue ?? (next && !next.startsWith("--") ? tokens[++index] : true);
    if (key === "url") options.url = [...(options.url || []), value];
    else options[key] = value;
  }
  return { command, options };
}

export function normalizeBaseUrl(value = "http://localhost:3000") {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("WEBFORGE_BASE_URL must use HTTP or HTTPS.");
  return url.href.replace(/\/$/, "");
}

export function parseFieldSelection(value, available) {
  const requested = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const selected = requested.map((item) => /^\d+$/.test(item) ? available[Number(item) - 1] : item);
  const unique = [...new Set(selected)];
  if (!unique.length || unique.some((field) => !available.includes(field))) {
    throw new Error(`Choose fields by name or number from: ${available.join(", ")}`);
  }
  return unique;
}

function help() {
  return `WebForge CLI

Usage:
${fullInstall ? "  webforge serve\n" : ""}  webforge create [options]
  webforge list [--json]
  webforge status <job-id> [--json]
  webforge records <job-id> [--json]
  webforge run <job-id> [--wait]
  webforge refresh <job-id> [--wait]
  webforge cancel <job-id>

Create options:
  --request "..."            Data request (prompted when omitted)
  --name "..."               Optional API name
  --depth focused|balanced|deep
  --combine                  Combine several sources into one record
  --url https://...          Use a supplied URL; repeat up to five times
  --fields title,date        Fields to confirm; names or 1-based numbers
  --no-run                   Plan and confirm without queuing extraction
  --wait                     Wait for extraction and print records
  --json                     Print machine-readable JSON

Environment:
  WEBFORGE_BASE_URL          Defaults to http://localhost:3000
  WEBFORGE_ACCESS_TOKEN      Sent as a Bearer token when configured

${fullInstall ? "Run from this repository with \"npm run cli -- <command>\" or install the\nlocal command once with \"npm link\", then use \"webforge <command>\"." : "Run this downloaded client with \"node webforge-cli.mjs <command>\"."}`;
}

function output(value, json = false) {
  if (json || typeof value !== "string") console.log(JSON.stringify(value, null, 2));
  else console.log(value);
}

function client() {
  const baseUrl = normalizeBaseUrl(process.env.WEBFORGE_BASE_URL);
  const token = process.env.WEBFORGE_ACCESS_TOKEN?.trim();
  return async (path, init = {}) => {
    const headers = { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers };
    let response;
    try { response = await fetch(`${baseUrl}${path}`, { ...init, headers }); }
    catch { throw new Error(`Could not reach WebForge at ${baseUrl}. Run "webforge serve" first.`); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `WebForge returned HTTP ${response.status}.`);
    return result;
  };
}

async function prompt(question, defaultValue = "") {
  if (!process.stdin.isTTY) throw new Error(`${question} Supply the corresponding command option.`);
  const interface_ = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    return (await interface_.question(`${question}${suffix}: `)).trim() || defaultValue;
  } finally { interface_.close(); }
}

async function waitForJob(request, id, json) {
  const timeoutMs = 360_000;
  const startedAt = Date.now();
  let priorStatus = "";
  while (Date.now() - startedAt < timeoutMs) {
    const { job } = await request(`/api/jobs/${encodeURIComponent(id)}`);
    if (!json && job.status !== priorStatus) console.log(`Status: ${job.status}`);
    priorStatus = job.status;
    if (terminalStatuses.has(job.status)) return job;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  throw new Error("Timed out after six minutes while waiting for the job.");
}

function printJobs(jobs) {
  if (!jobs.length) { console.log("No API jobs found."); return; }
  console.table(jobs.map((job) => ({ id: job.id, status: job.status, depth: job.search_depth, records: job.record_count, name: job.name })));
}

function printJob(job) {
  console.log(`${job.name} (${job.id})`);
  console.log(`Status: ${job.status} | Depth: ${job.search_depth} | Records: ${job.record_count}`);
  if (job.error) console.log(`Warning: ${job.error}`);
  if (job.run_summary) console.log(`Latest run: ${job.run_summary.search_calls} searches, ${job.run_summary.scrape_calls} scrapes, ${job.run_summary.saved_records} saved`);
}

async function create(request, options) {
  const json = Boolean(options.json);
  const userRequest = options.request || await prompt("What public web data should this API collect?");
  const urls = (options.url || []).map(String);
  let depth = String(options.depth || "").toLowerCase();
  if (!depth && !urls.length) depth = await prompt("Search depth (focused, balanced, deep)", "balanced");
  depth ||= "balanced";
  if (!depthChoices.includes(depth)) throw new Error("--depth must be focused, balanced, or deep.");
  const body = {
    ...(options.name ? { name: String(options.name) } : {}),
    user_request: String(userRequest),
    source_strategy: { type: urls.length ? "provided_urls" : "automatic", search_queries: [] },
    sources: urls,
    combine_sources: Boolean(options.combine),
    search_depth: depth,
    refresh_interval: null,
  };
  const planned = await request("/api/jobs", { method: "POST", body: JSON.stringify(body) });
  const job = planned.job;
  if (job.status === "failed") throw new Error(job.error || "Planning failed.");
  const available = Object.keys(job.proposed_schema).filter((field) => field !== "source_url");
  if (!available.length) throw new Error("The planner did not propose any selectable fields.");
  if (!json) {
    console.log(`\nProposed fields for ${job.name}:`);
    available.forEach((field, index) => console.log(`  ${index + 1}. ${field} — ${job.proposed_schema[field].description || job.proposed_schema[field].type}`));
  }
  const selectionValue = options.fields || (process.stdin.isTTY ? await prompt("Fields (comma-separated names or numbers)", available.join(",")) : available.join(","));
  const selectedFields = parseFieldSelection(selectionValue, available);
  const confirmed = await request(`/api/jobs/${encodeURIComponent(job.id)}/fields`, {
    method: "PATCH", body: JSON.stringify({ selected_fields: selectedFields }),
  });
  if (options.no_run) { output(confirmed, json); return; }
  await request(`/api/jobs/${encodeURIComponent(job.id)}/run`, { method: "POST" });
  if (!options.wait) {
    if (json) output({ job_id: job.id, status: "queued" }, true);
    else console.log(`\nQueued ${job.id}. Use "webforge status ${job.id}" or add --wait next time.`);
    return;
  }
  const finished = await waitForJob(request, job.id, json);
  const records = await request(`/api/jobs/${encodeURIComponent(job.id)}/records`);
  output(json ? { job: finished, ...records } : records, json);
}

async function mutate(request, command, id, options) {
  const result = await request(`/api/jobs/${encodeURIComponent(id)}/${command}`, { method: "POST" });
  if (options.wait && command !== "cancel") {
    const job = await waitForJob(request, id, Boolean(options.json));
    const records = await request(`/api/jobs/${encodeURIComponent(id)}/records`);
    output(options.json ? { job, ...records } : records, Boolean(options.json));
  } else output(result, Boolean(options.json));
}

async function serve() {
  const children = [];
  const launch = (args) => {
    const child = spawn(process.execPath, args, { cwd: projectRoot, env: process.env, stdio: "inherit" });
    children.push(child);
    return child;
  };
  const baseUrl = normalizeBaseUrl(process.env.WEBFORGE_BASE_URL);
  const localUrl = new URL(baseUrl);
  if (!['localhost', '127.0.0.1'].includes(localUrl.hostname) || localUrl.pathname !== "/") {
    throw new Error("webforge serve requires WEBFORGE_BASE_URL to use localhost without a path.");
  }
  const port = localUrl.port || "3000";
  const web = launch([resolve(projectRoot, "node_modules/next/dist/bin/next"), "dev", "-p", port]);
  const shutdown = () => { for (const child of children) if (!child.killed) child.kill("SIGTERM"); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  web.once("exit", shutdown);
  let ready = false;
  for (let attempts = 0; attempts < 60; attempts++) {
    if (web.exitCode !== null) throw new Error("The WebForge server stopped before it became ready.");
    try { const response = await fetch(baseUrl); if (response.ok) { ready = true; break; } } catch { /* keep waiting */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  if (!ready) { shutdown(); throw new Error(`WebForge did not become ready at ${baseUrl}.`); }
  const worker = launch(["--env-file-if-exists=.env.local", resolve(projectRoot, "scripts/worker.mjs")]);
  worker.once("exit", shutdown);
  console.log(`\nWebForge CLI services are running at ${baseUrl}. Press Ctrl+C to stop.\n`);
  await Promise.all(children.map((child) => new Promise((resolvePromise) => child.once("exit", resolvePromise))));
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseCliArgs(argv);
  if (["help", "--help", "-h"].includes(command)) { console.log(help()); return; }
  if (command === "serve") {
    if (!fullInstall) throw new Error("The standalone client connects to a running WebForge service. Use the full repository edition to run serve.");
    await serve(); return;
  }
  const request = client();
  const id = options._[0];
  if (command === "create") return create(request, options);
  if (command === "list") {
    const result = await request("/api/jobs");
    return options.json ? output(result, true) : printJobs(result.jobs);
  }
  if (!id) throw new Error(`${command} requires a job ID.`);
  if (command === "status") {
    const result = await request(`/api/jobs/${encodeURIComponent(id)}`);
    return options.json ? output(result, true) : printJob(result.job);
  }
  if (command === "records") {
    const result = await request(`/api/jobs/${encodeURIComponent(id)}/records`);
    return output(result, Boolean(options.json));
  }
  if (["run", "refresh", "cancel"].includes(command)) return mutate(request, command, id, options);
  throw new Error(`Unknown command "${command}". Run "webforge help".`);
}

const entrypoint = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (entrypoint) main().catch((error) => { console.error(`Error: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
