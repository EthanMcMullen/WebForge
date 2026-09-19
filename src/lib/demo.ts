import type { Dataset, DatasetRecord, FieldDefinition, FieldEvidence } from "./types";

export const demoFields: FieldDefinition[] = [
  { key: "name", label: "Name", type: "string", visual: false },
  { key: "price", label: "Price (USD)", type: "number", visual: false },
  { key: "availability", label: "Availability", type: "string", visual: false },
  { key: "color", label: "Color", type: "string", visual: true },
  { key: "usb_c", label: "USB-C", type: "boolean", visual: true },
];

const examples = [
  { name: "Aster 14", price: 899, availability: "In stock", color: "Silver", usb_c: true },
  { name: "Northbook Air", price: 1099, availability: "In stock", color: "Midnight", usb_c: true },
  { name: "Summit Pro 13", price: 749, availability: "Out of stock", color: "Graphite", usb_c: null },
];

export function demoRecords(dataset: Dataset): DatasetRecord[] {
  const now = new Date().toISOString();
  return examples.map((item, index) => {
    const sourceUrl = `https://example.com/demo/laptop-${index + 1}`;
    const data = { ...item };
    const fieldStatus = Object.fromEntries(demoFields.map((field) => [field.key, data[field.key as keyof typeof data] === null ? "unknown" : "sample"])) as DatasetRecord["fieldStatus"];
    const evidence: FieldEvidence[] = demoFields.map((field) => ({
      field: field.key,
      proposedValue: data[field.key as keyof typeof data],
      sourceUrl,
      quote: data[field.key as keyof typeof data] === null ? "No clear source evidence" : `Sample catalog lists ${field.label.toLowerCase()} as ${String(data[field.key as keyof typeof data])}.`,
      imageUrl: null,
      kind: "demo",
      confidence: null,
      status: fieldStatus[field.key],
      reason: "Illustrative demo data; no live website was queried.",
      checkedAt: now,
    }));
    return { id: crypto.randomUUID(), datasetId: dataset.id, sourceUrl, data, fieldStatus, evidence, updatedAt: now };
  });
}
