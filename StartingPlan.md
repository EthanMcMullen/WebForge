# WebForge implementation plan

## Goal

A user describes the public web data they want in plain English. WebForge turns that request into a schema, finds relevant pages with Firecrawl, asks Firecrawl to extract records into that schema, stores the records, and serves them through a JSON API.

The first implementation will trust Firecrawl's structured extraction. Do not add Jev, a second OpenAI parsing call, an error correction LLM, evidence verification, or a local Qwen model.

## The six layers

| Layer | Responsibility | Implementation |
| --- | --- | --- |
| 1. User input | Collect the plain-English request and optional source URLs | Existing Next.js dashboard |
| 2. Data formatting | Convert the request into a record schema and search queries | Existing OpenAI planner, extended as needed |
| 3. Web discovery | Find actual current URLs when the user did not supply them | Firecrawl Search |
| 4. Extraction | Scrape each URL and return JSON matching the planned schema | Firecrawl Scrape with its `json` format |
| 5. Database | Save jobs, source URLs, and extracted records | Existing SQLite store, extended with records |
| 6. API | Expose the saved schema and records as JSON | Existing job routes plus a new records route |

The original separate "send dirty JSON to another LLM" layer is replaced by Firecrawl's native structured extraction. Firecrawl accepts a schema and returns JSON shaped to it. See the [Firecrawl Scrape documentation](https://docs.firecrawl.dev/features/scrape).

## Current codebase

- [`src/components/workspace.tsx`](src/components/workspace.tsx) already collects a request, allows automatic discovery or supplied URLs, and displays the planned schema. It currently says scraping is inactive.
- [`src/lib/planner.ts`](src/lib/planner.ts) already makes a real OpenAI Responses API call and returns a name, field definitions, and search queries. It adds `source_url` to the schema itself.
- [`src/lib/pipeline.ts`](src/lib/pipeline.ts) currently creates and saves the job, then stops after planning.
- [`src/lib/store.ts`](src/lib/store.ts) has an `api_jobs` table, but no records table.
- The current routes provide `GET/POST /api/jobs`, `GET /api/jobs/:id`, and `GET /api/jobs/:id/schema`. There is no records or refresh route.
- The current `ready` status means "the plan is ready," not "the data API has records." That meaning must change when the extraction pipeline is added.
- `package.json` already includes OpenAI and Zod. Firecrawl is not installed.
- The README refers to `.env.example`, but that file is absent in the current checkout. Create it as part of this work.
- Browserbase and Jev are already absent from this version of the repository. Do not reintroduce them.

## Step-by-step implementation

### 1. Establish the record contract

Add a shared record type in `src/lib/types.ts`, for example:

```ts
type ApiRecord = {
  id: string;
  jobId: string;
  sourceUrl: string;
  data: Record<string, string | number | boolean | null>;
  extractedAt: string;
};
```

Every user-requested field must appear in every record. A field may have `null` when Firecrawl returns no value. `source_url` is added by WebForge from the actual scraped URL; do not ask an LLM to invent it.

For the first MVP, treat **one source page as one record**. Search for pages about individual entities rather than broad list pages. This keeps record identity and refresh behavior predictable.

### 2. Finish the planner's output

Keep the existing OpenAI Responses API call and strict JSON output in `planner.ts`. It already follows the right basic pattern for a machine-readable plan. See the [OpenAI Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

Make its instructions explicit:

- Define what one record represents.
- Return only fields needed for the user's requested API.
- Produce focused search queries.
- If the user named a website, include it in the search query, such as `site:example.com`.
- Do not invent exact product or article URLs. Firecrawl Search supplies real URLs.
- Continue to reserve `source_url` for WebForge to populate.
- Keep the model configurable through `OPENAI_MODEL`. A cheaper model can be tested for planning after the full path works.

The existing `provided_urls` strategy should still run the planner for the schema, then skip discovery and use the supplied URLs.

### 3. Add Firecrawl discovery

Install the current Firecrawl Node SDK and create a server-only client module, for example `src/lib/firecrawl.ts`. The current Firecrawl docs show the `firecrawl` package and `Firecrawl` client. See the [Firecrawl Node SDK](https://docs.firecrawl.dev/sdks/node).

For an automatic job:

1. Take the planner's search queries.
2. Call Firecrawl Search for each query.
3. Read the web results and collect their actual URLs.
4. Normalize and deduplicate URLs using the existing URL helper.
5. Cap the first run at roughly five URLs so the demo has bounded time and cost.
6. Save the selected URLs on the job.

For a `provided_urls` job, use those URLs directly.

Firecrawl's Search API returns web results with URLs; the full extraction should happen in the subsequent Scrape call. See the [Firecrawl Search documentation](https://docs.firecrawl.dev/features/search).

### 4. Add a replaceable extraction interface

Create one internal function contract, such as:

```ts
interface RecordExtractor {
  extract(url: string, schema: ApiRecordSchema): Promise<ApiRecord["data"]>;
}
```

Implement `FirecrawlStructuredExtractor` first. It should:

1. Convert the planned field definitions into a JSON Schema for Firecrawl.
2. Exclude `source_url` from the Firecrawl schema.
3. Include clear field descriptions from the planner.
4. Ask Firecrawl to scrape the URL with `formats: [{ type: "json", schema, prompt }]`.
5. Read the returned `json` value and page metadata.
6. Attach the actual source URL and extraction time in WebForge code.
7. Return one record.

The extraction prompt should say to fill only fields in the schema and use `null` when the page has no value. It should not request explanations, confidence scores, or verification decisions.

Firecrawl allows a schema and an optional prompt on its `json` scrape format. See [Firecrawl structured extraction](https://docs.firecrawl.dev/features/scrape).

Keep the interface independent of Firecrawl response types. Later, an `OllamaQwenExtractor` can implement the same interface by asking Firecrawl for markdown and sending that markdown to local Qwen. The database, API, dashboard, and pipeline would then use the same record shape.

### 5. Add only technical boundary checks

Before saving, check that Firecrawl returned an object with the planned field names and usable JSON types. Add a missing planned key as `null`; reject a response that cannot be represented as a record. Check that the Firecrawl request succeeded and that the target page itself loaded successfully, because those are separate statuses in Firecrawl's response. See [Firecrawl response status guidance](https://docs.firecrawl.dev/features/scrape).

Do not add a second model call, source fact checking, quote matching, confidence scoring, or a retry because a field is `null`. In this version, Firecrawl's extracted value is accepted as the data value.

A failed page scrape is an operational failure. Record the failed URL in the job error or run summary; continue processing other URLs. If every page fails, mark the run failed.

### 6. Extend SQLite

Add an `api_records` table in `store.ts` with at least:

```text
id
job_id
source_url
data_json
extracted_at
```

Use a unique constraint on `(job_id, source_url)` for the one-record-per-page MVP. Add store functions to list records and replace or upsert records for a job.

Save each successful record only after Firecrawl extraction has returned a usable JSON object. Keep the latest successful records if a later refresh fails; show the job's refresh error separately. No field-level verification status is needed.

### 7. Connect the pipeline and job states

Separate planning from running:

1. `POST /api/jobs` creates and plans the job, then returns its ID.
2. Add a `planned` status for a job whose schema exists but whose records have not been extracted.
3. Add `POST /api/jobs/:id/run` to perform discovery, extraction, and storage.
4. Update status through `discovering`, `scraping` or `extracting`, `storing`, then `ready`.
5. Define `ready` to mean the job has finished a run and its records endpoint is usable.
6. Use `failed` when planning fails or the run produces no records.

Existing jobs marked `ready` by the planning-only implementation need to be treated as `planned` if they have never produced records.

For the hackathon, run a small bounded batch with a timeout and limited concurrency. Do not silently launch an unlimited crawl.

### 8. Add the records API and manual refresh

Add:

```http
GET  /api/jobs/:id/records
POST /api/jobs/:id/run
POST /api/jobs/:id/refresh
```

`GET /records` should read SQLite and return the saved records without calling OpenAI or Firecrawl. A response could be:

```json
{
  "job_id": "uuid",
  "status": "ready",
  "records": [
    {
      "id": "uuid",
      "source_url": "https://example.com/item",
      "data": {
        "name": "Example item",
        "price": 899,
        "usb_c": null,
        "source_url": "https://example.com/item"
      },
      "extracted_at": "2026-09-19T12:00:00.000Z"
    }
  ]
}
```

Manual refresh should rerun Firecrawl against the job's sources. For automatic jobs, it may also repeat discovery with the saved search queries. It should update stored records when the run succeeds.

The existing `refresh_interval` is currently just stored data. Do not present it as an active schedule until a scheduler or worker actually uses it. Manual refresh is sufficient for the first complete MVP.

### 9. Update the dashboard

In `workspace.tsx`:

- Change the creation flow so the user can plan a job and then run it, preferably with one visible "Create API" action that performs both steps.
- Show discovery/extraction progress from the job status.
- Display the extracted records in a table using the job's dynamic schema.
- Show the real source URL for each record.
- Add a manual Refresh button.
- Add a copyable `/api/jobs/:id/records` endpoint.
- Remove text claiming scraping is inactive once it works.
- Keep errors visible when some pages fail.

Do not add fictional fallback data. If the services are unavailable, show the actual configuration or run error.

### 10. Configuration and documentation

Create `.env.example` containing:

```text
OPENAI_API_KEY=
OPENAI_MODEL=
FIRECRAWL_API_KEY=
WEBFORGE_DB_PATH=
```

Keep secrets server-side and out of Git. Update `/api/config` to report whether both the planner and Firecrawl are configured. Update README setup instructions, architecture, endpoint list, current limitations, and the manual refresh behavior.

### 11. Verify the completed flow

Add meaningful tests for:

- planner output mapped to a Firecrawl extraction schema;
- URL deduplication and source limits;
- a mocked Firecrawl Search response leading to selected URLs;
- a mocked Firecrawl JSON response being saved and returned by `/records`;
- a partial scrape failure leaving successful records available;
- refresh updating a stored record.

Run `npm test`, `npm run lint`, and `npm run build`.

With real keys configured, perform one live smoke test using a known public page and supplied URL first. Then test automatic discovery. Report clearly if a live test could not be performed because keys or credits were unavailable.

## Completion criteria

The implementation is complete when a user can submit a new plain-English request, WebForge plans its schema with OpenAI, Firecrawl finds or uses real URLs and extracts records into that schema, records persist after restarting the app, and `GET /api/jobs/:id/records` returns those real saved records. The dashboard must show those records and allow a manual refresh.

## Later extension: local Qwen

After the Firecrawl version works, add an `OllamaQwenExtractor` behind the same `RecordExtractor` interface:

```text
Firecrawl raw markdown -> local Qwen -> same ApiRecord shape
```

Make the provider selectable with an environment variable. Do not build or download Qwen as part of the first Firecrawl implementation.

The original image-only attribute idea also remains a later extension. The current planner explicitly excludes image and OCR fields, and this first implementation should make no promise that Firecrawl's JSON mode can determine details visible only in product images.
