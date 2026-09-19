import assert from "node:assert/strict";
import test from "node:test";
import { selectProposedFields } from "../src/lib/field-selection.ts";

const proposal = {
  name: { type: "string" as const, description: "Product name" },
  price: { type: "number" as const, description: "Price" },
  availability: { type: "boolean" as const, description: "Stock status" },
  source_url: { type: "string" as const, description: "Source" },
};

test("field selection produces only chosen fields and mandatory provenance", () => {
  assert.deepEqual(selectProposedFields(proposal, ["price", "name"]), {
    name: proposal.name, price: proposal.price, source_url: proposal.source_url,
  });
});

test("field selection rejects empty, duplicate, invented, and provenance fields", () => {
  for (const fields of [[], ["price", "price"], ["imaginary"], ["source_url"]]) {
    assert.throws(() => selectProposedFields(proposal, fields));
  }
});
