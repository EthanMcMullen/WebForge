# WebForge

Describe the data you want from the public web in plain English. Prompt to API discovers relevant pages, extracts facts from page text and images, checks the evidence, and publishes a refreshable JSON API.

> **Status:** Hack the North project plan. The implementation has not started yet.

## Example

> Create an API that tracks laptop name, price, availability, color, and USB-C support.

The system turns this request into a typed schema, finds candidate product and specification pages, extracts each field, and stores accepted values with their source URLs. A value without sufficient evidence is returned as `null` with an explanation rather than guessed.

## Planned stack

| Layer | Technology | Role |
| --- | --- | --- |
| Interface | Next.js, React, TypeScript | Plain-English request form, dataset preview, evidence view, and copyable API URL. A CLI can be added later. |
| Request planning | OpenAI API with structured output, Zod | Convert the request into a field schema and search queries; validate types before processing. |
| Discovery and browsing | Browserbase Search/Fetch, Browserbase sessions with Stagehand | Find pages, retrieve straightforward content, and navigate pages that require a real browser. |
| Text and image extraction | Stagehand plus an OpenAI vision-capable model | Extract values from rendered text and inspect product images or screenshots when a field needs visual evidence. |
| Verification | Jev (TypeSafe AI) plus deterministic checks | Decide whether supplied evidence supports each proposed value; check types, units, source identity, and conflicts in code. |
| Storage | PostgreSQL (Supabase) | Persist datasets, records, source snapshots, field evidence, and refresh history. |
| API and hosting | Next.js API routes, Vercel | Serve dataset-specific JSON endpoints and run the web app. |

Elasticsearch is an optional extension for searching large collections of scraped evidence. It is an index and retrieval layer, not the page scraper.

## Pipeline

```text
Plain-English request
  -> typed schema and search plan
  -> source discovery
  -> Browserbase page retrieval / navigation
  -> text and image extraction
  -> Jev and code-based field checks
  -> PostgreSQL
  -> dataset API and refresh UI
```

Every field should carry a proposed value, source URL, supporting text or image reference, retrieval timestamp, verification status, and reason. Jev receives the extracted claim and evidence as input; it does not browse the web or inspect images itself.

## Hackathon MVP

1. Accept one plain-English request for laptop product data.
2. Discover or accept seed URLs for 5–10 products across at least two sites.
3. Extract name, price, availability, color, and USB-C support from text and, where useful, images.
4. Publish only supported values; mark missing or conflicting fields as `unknown` or `conflicting`.
5. Store records and field-level evidence.
6. Serve a live `GET /api/datasets/:id/records` endpoint and a schema endpoint.
7. Allow a manual refresh and show what changed.

## Proposed API

```http
POST /api/datasets
GET  /api/datasets/:id/schema
GET  /api/datasets/:id/records
GET  /api/datasets/:id/records/:recordId/evidence
POST /api/datasets/:id/refresh
```

Example record:

```json
{
  "id": "laptop-123",
  "data": {
    "name": "Example Laptop",
    "price": 899.99,
    "availability": "in_stock",
    "color": "silver",
    "usb_c": null
  },
  "field_status": {
    "usb_c": "unknown"
  },
  "updated_at": "2026-09-19T12:00:00Z"
}
```

## Build order

1. Verify access to Browserbase, OpenAI, Jev, and the database.
2. Make one product page produce a typed record with evidence.
3. Add field verification and unknown/conflict handling.
4. Persist records and serve the API.
5. Add discovery, more pages, image inspection, and refresh.
6. Rehearse a complete live demo with a saved dataset as a fallback.

## Design principles

- Preserve the exact source and evidence for each value.
- Keep prices tied to currency, seller, and product variant.
- Treat low-confidence visual guesses as unknown.
- Do not overwrite a verified value after a failed refresh; mark it stale.
- Respect target sites' access rules and rate limits.

## Setup

Setup instructions and environment-variable names will be added as implementation begins. Do not commit API keys or other credentials.
