# Course Draft Board demo

A dark grey and electric blue dashboard for comparing UBC CPSC 103, CPSC 221, and CPSC 213. It starts with "No data to show." Once the WebForge records endpoint is connected, the Compare view shows bar charts for easiness, interest, usefulness, and number of reviews. Selecting a course opens three large rating rings, its review count, and source links.

## Start

Run node server.mjs from this folder with Node.js 20 or newer (or npm.cmd start in PowerShell). No installation is needed. Open http://localhost:3001. Keep WebForge running at http://localhost:3000.

## Expected WebForge fields

Each course needs its own record. The dashboard reads course_code, easiness, interest, usefulness, number_of_reviews, and source_url. Course codes may contain a space (for example, CPSC 221). The three ratings are treated as scores out of 5; the review count is an integer. The bar and ring lengths use this scale.

## Connect during the demo

Open data/webforge-source.txt, paste the WebForge /api/jobs/{job-id}/records URL below the comment, and save. The page checks every three seconds and populates without restarting either server. Keep the URL file blank until the reveal.

You can also leave the URL file blank and paste the full WebForge response JSON into data/webforge-records.json.

Set PORT to change the demo port. For example, in PowerShell: $env:PORT=3002; npm start.

