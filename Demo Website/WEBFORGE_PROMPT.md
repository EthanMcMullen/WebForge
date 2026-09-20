# UBC WebForge schema for this demo

The dashboard is ready for an API containing one record for each of these UBC courses:

- CPSC 103
- CPSC 221
- CPSC 213

Use the source URLs from your current WebForge job. Keep the three courses as separate records and do not combine sources into one record. Confirm these exact field names:

- course_code (string): e.g. CPSC 221
- easiness (number): average easiness rating score
- interest (number): average interest rating score
- usefulness (number): average usefulness rating score
- number_of_reviews (integer): total reviews for the course
- source_url (string): primary public source URL

The dashboard currently plots rating scores out of 5 and compares review counts separately. Verify that your source uses this rating scale. The API URL goes in data/webforge-source.txt during the demo.

