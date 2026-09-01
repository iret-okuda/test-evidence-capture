"use strict";

const assert = require("node:assert/strict");
require("../annotations.js");

const { calculateFrameRect, mapFrameToCrop } = globalThis.TestEvidenceAnnotations;

assert.deepEqual(
  calculateFrameRect(
    { left: 20, top: 30, right: 120, bottom: 80, width: 100, height: 50 },
    300,
    200,
  ),
  { left: 13, top: 23, right: 127, bottom: 87, width: 114, height: 64 },
);

assert.deepEqual(
  calculateFrameRect(
    { left: 2, top: 3, right: 40, bottom: 50, width: 38, height: 47 },
    100,
    80,
  ),
  { left: 0, top: 0, right: 47, bottom: 57, width: 47, height: 57 },
);

assert.deepEqual(
  mapFrameToCrop(
    { left: 13, top: 23, right: 127, bottom: 87 },
    { left: 20, top: 40, width: 240, height: 160, scaleX: 2, scaleY: 2 },
  ),
  {
    left: 6,
    top: 6,
    right: 234,
    bottom: 134,
    width: 228,
    height: 128,
    borderWidthX: 6,
    borderWidthY: 6,
  },
);

assert.equal(
  mapFrameToCrop(
    { left: 200, top: 200, right: 220, bottom: 220 },
    { left: 0, top: 0, width: 100, height: 100, scaleX: 1, scaleY: 1 },
  ),
  null,
);

console.log("annotation tests passed");
