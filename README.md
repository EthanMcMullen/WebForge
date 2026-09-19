# WebForge

Describe the public web data you want in plain English. WebForge turns the request into a field schema, discovers or accepts source pages, extracts candidate values from page text and images, checks their evidence, stores records, and serves them as JSON.

**Status:** Working local hackathon MVP. Demo mode runs without service keys. The live Browserbase/OpenAI/Jev path is implemented but cannot be exercised until those keys are configured.

## Run it

Requires Node.js 24 or newer.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Choose **Demo** and click **Forge dataset** to create an illustrative laptop API. Demo records are explicitly marked `sample`; they are not claimed to be scraped or verified.

For live mode, add `OPENAI_API_KEY` and `BROWSERBASE_API_KEY` to `.env.local`. Add `TYPESAFE_API_KEY` to let Jev judge evidence that is not an exact text match. `BROWSERBASE_PROJECT_ID` can be added for accounts that still require it. Restart the dev server after changing environment variables. Never commit `.env.local`.

## Current stack

| Layer | Implementation |
| --- | --- |
| Interface and API | Next.js 16, React 19, TypeScript |
| Request planning | OpenAI Responses API with JSON Schema output; Zod validation |
| Discovery and page browsing | Browserbase via Stagehand 3; DuckDuckGo result pages for source discovery |
| Text and image extraction | Stagehand extraction; OpenAI vision on a product image when a visual field has no text evidence |
| Verification | Exact-text checks plus optional Jev typed `choice` decisions through TypeSafe AI |
| Local database | SQLite using Node's `node:sqlite` |

The database lives in `.data/webforge.sqlite`, which is gitignored. This is a **local MVP**; SQLite on a serverless host is not durable. Use PostgreSQL/Supabase before deploying publicly. Elasticsearch remains optional for a much larger evidence index, not a scraper.

## How live mode works

1. The request becomes up to eight typed fields and search queries.
2. Stagehand discovers up to five public source pages, or uses up to ten supplied URLs.
3. Stagehand extracts one entity per page with a value, supporting quote, and image URL for each field.
4. For visual fields with no text evidence, OpenAI inspects a product image. Uncertain observations stay unverified.
5. Exact text matches can be accepted locally. If Jev is configured, it judges candidate claims against their extracted evidence. Missing, conflicting, and unverified values become `null` in the API. Jev sees text or the vision model's description; it does not see the image itself.
6. Records and field-level evidence are saved in SQLite. Manual refresh keeps previous verified values as `stale` when new evidence fails.

WebForge does not log into sites or bypass their access controls. Use source sites whose terms permit the intended access, and keep the page count small during the hackathon.

## API

```http
GET  /api/config
GET  /api/datasets
POST /api/datasets
GET  /api/datasets/:id
GET  /api/datasets/:id/schema
GET  /api/datasets/:id/records
GET  /api/datasets/:id/records/:recordId/evidence
POST /api/datasets/:id/refresh
```

Create a demo dataset:

```powershell
$body = @{ prompt = 'Create an API that tracks laptop name, price, availability, color, and USB-C support.'; mode = 'demo'; seedUrls = @() } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/datasets -ContentType application/json -Body $body
```

For live mode, set `mode` to `live` and optionally pass public product page URLs in `seedUrls`. If `seedUrls` is empty, WebForge searches for candidate pages.

A records response contains values and a status per field:

```json
{
  "dataset_id": "...",
  "records": [
    {
      "id": "...",
      "source_url": "https://example.com/product",
      "data": { "name": "Example Laptop", "price": 899, "usb_c": null },
      "field_status": { "name": "verified", "price": "verified", "usb_c": "unknown" },
      "updated_at": "2026-09-19T12:00:00Z"
    }
  ]
}
```

## Demo and deployment limits

- Demo mode always shows fictional laptop products. Its values have `sample` status.
- Live integrations have no credentials in this repository, so their success against real sites has not been verified here. Some sites may block automation or hide data behind sign-in.
- Source discovery is intentionally small and can be skipped by supplying known product URLs. A production system needs stronger source ranking, scheduled refresh, rate controls, and monitoring.
- API write routes have no user authentication. Keep this app local until authentication and a durable hosted database are added.
- A failed source refresh preserves the old record as `stale` rather than silently treating it as fresh.

## Check the build

```powershell
npm run lint
npm run build
```

The code is organized under `src/lib` for the pipeline and `src/app/api` for the endpoints. Next.js generates `AGENTS.md` and `CLAUDE.md` when the dev server starts; they point future coding agents to the installed Next.js documentation.
