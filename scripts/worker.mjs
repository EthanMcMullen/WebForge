const endpoint = new URL("/api/internal/worker", process.env.WEBFORGE_BASE_URL || "http://localhost:3000");
const token = process.env.WEBFORGE_WORKER_TOKEN;
if (!token) throw new Error("Set WEBFORGE_WORKER_TOKEN in .env.local before starting the worker.");

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

while (!stopping) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(310_000),
    });
    if (!response.ok) throw new Error(`Worker tick returned HTTP ${response.status}`);
    const result = await response.json();
    if (result.ran) console.log(`Run ${result.job_id}: ${result.outcome}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
