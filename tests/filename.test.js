"use strict";

const assert = require("node:assert/strict");
require("../filename.js");

const { createEvidenceFilename, normalizeNumber } = globalThis.TestEvidenceFilename;

assert.equal(
  createEvidenceFilename({ prefix: "AC", numbers: [1, 1, 1], timing: "after" }),
  "AC-1-1-1-after.png",
);
assert.equal(
  createEvidenceFilename({ prefix: " TC ", numbers: [2, "3", 4.9], timing: "before" }),
  "TC-2-3-4-before.png",
);
assert.equal(
  createEvidenceFilename({ prefix: "AC", numbers: [1, 2, 3], timing: "result" }),
  "AC-1-2-3-result.png",
);
assert.equal(
  createEvidenceFilename({
    prefix: "AC",
    numbers: [1, 2, 3],
    timing: "result",
    timingEnabled: false,
  }),
  "AC-1-2-3.png",
);
assert.equal(
  createEvidenceFilename({ prefix: "", numbers: [0, -2, "x"], timing: "unexpected" }),
  "AC-1-1-1-before.png",
);
assert.equal(createEvidenceFilename({ prefix: "A/C", numbers: [1, 2, 3], timing: "after" }), "A-C-1-2-3-after.png");
assert.equal(
  createEvidenceFilename({
    prefix: "AC",
    numbers: [1, 2, 3],
    numberEnabled: [true, true, false],
    timing: "after",
  }),
  "AC-1-2-after.png",
);
assert.equal(
  createEvidenceFilename({
    prefix: "AC",
    numbers: [1, 2, 3],
    numberEnabled: [true, false, true],
    timing: "before",
  }),
  "AC-1-before.png",
);
assert.equal(normalizeNumber(8), 8);
assert.equal(normalizeNumber(0), 1);

console.log("filename tests passed");
