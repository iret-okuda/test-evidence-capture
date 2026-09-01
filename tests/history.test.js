"use strict";

const assert = require("node:assert/strict");
require("../history.js");

const { hasValidSelectors, normalizeAnnotationIndexes, normalizeRecords, addRecord } =
  globalThis.TestEvidenceHistory;

function record(id) {
  return {
    id,
    pageKey: "https://example.test/page",
    filename: `${id}.png`,
    selectors: [`[data-testid="item-${id}"]`],
    bounds: { left: 1, top: 2, right: 30, bottom: 40 },
  };
}

assert.equal(hasValidSelectors(record("1")), true);
assert.equal(hasValidSelectors({ ...record("1"), selectors: [] }), false);
assert.equal(hasValidSelectors({ ...record("1"), selectors: ["   "] }), false);
assert.deepEqual(normalizeAnnotationIndexes([2, 0, 2, -1, 5, 1.5], 3), [0, 2]);
assert.deepEqual(normalizeRecords([record("1"), null, { bad: true }]), [
  { ...record("1"), annotationIndexes: [] },
]);
assert.deepEqual(normalizeRecords([{ ...record("old"), selectors: undefined }]), []);
assert.deepEqual(
  normalizeRecords([{ ...record("marked"), annotationIndexes: [0, 4, 0] }])[0]
    .annotationIndexes,
  [0],
);
const records = [record("1"), record("2"), record("3"), record("4"), record("5")];
assert.deepEqual(addRecord(records, record("6"), 5).map((item) => item.id), ["6", "1", "2", "3", "4"]);

console.log("history tests passed");
