import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3001);
const dataFile = join(root, "data", "webforge-records.json");
const sourceFile = join(root, "data", "webforge-source.txt");
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]]
]);

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

function validateSource(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error("The URL in webforge-source.txt is invalid."); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "3000") {
    throw new Error("The WebForge URL must use http://localhost:3000.");
  }
  if (!/^\/api\/jobs\/[0-9a-f-]{36}\/records$/i.test(url.pathname) || url.search || url.hash) {
    throw new Error("The WebForge URL must end in /api/jobs/{job-id}/records.");
  }
  return url;
}

async function loadCourses() {
  const sourceText = await readFile(sourceFile, "utf8");
  const source = sourceText.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
  if (source) {
    const url = validateSource(source);
    const headers = { Accept: "application/json" };
    if (process.env.WEBFORGE_ACCESS_TOKEN) headers.Authorization = "Bearer " + process.env.WEBFORGE_ACCESS_TOKEN;
    let response;
    try { response = await fetch(url, { headers, signal: AbortSignal.timeout(12000), cache: "no-store" }); }
    catch { throw new Error("Could not reach WebForge at localhost:3000."); }
    let data;
    try { data = await response.json(); }
    catch { throw new Error("WebForge did not return JSON."); }
    if (!response.ok) throw new Error(data.error || data.message || "WebForge request failed.");
    if (!data || !Array.isArray(data.records)) throw new Error("WebForge returned no records array.");
    return data;
  }
  const contents = await readFile(dataFile, "utf8");
  const data = JSON.parse(contents);
  if (Array.isArray(data)) return { status: "imported", count: data.length, records: data };
  if (!data || !Array.isArray(data.records)) throw new Error("webforge-records.json must contain a records array.");
  return data;
}

createServer(async (req, res) => {
  const path = new URL(req.url || "/", "http://localhost:" + port).pathname;
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });
  if (path === "/api/courses") {
    try { return json(res, 200, await loadCourses()); }
    catch (error) { return json(res, 502, { error: error instanceof SyntaxError ? "webforge-records.json is not valid JSON." : error.message || "Could not load course data." }); }
  }
  const file = files.get(path);
  if (!file) return json(res, 404, { error: "Page not found." });
  try {
    const content = await readFile(join(root, file[0]));
    res.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    res.end(content);
  } catch { json(res, 500, { error: "Could not load the page." }); }
}).listen(port, "127.0.0.1", () => {
  console.log("Course Draft Board demo is ready at http://localhost:" + port);
});


