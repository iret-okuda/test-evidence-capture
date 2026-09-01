"use strict";

const assert = require("node:assert/strict");
require("../bounds.js");

const { calculateBounds, calculateCrop, calculateScrollPositions, calculatePseudoElementRect } =
  globalThis.TestEvidenceBounds;

function elementWithRect(rect) {
  return { getBoundingClientRect: () => rect };
}

{
  const bounds = calculateBounds(
    [
      elementWithRect({ left: 20, top: 30, right: 120, bottom: 80, width: 100, height: 50 }),
      elementWithRect({ left: 150, top: 100, right: 260, bottom: 180, width: 110, height: 80 }),
    ],
    300,
    200,
    8,
  );
  assert.deepEqual(bounds, {
    left: 12,
    top: 22,
    right: 268,
    bottom: 188,
    width: 256,
    height: 166,
  });
}

{
  const bounds = calculateBounds(
    [elementWithRect({ left: -5, top: 2, right: 98, bottom: 99, width: 103, height: 97 })],
    100,
    100,
    8,
  );
  assert.deepEqual(bounds, {
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
    width: 100,
    height: 100,
  });
}

{
  const crop = calculateCrop(
    { left: 12.25, top: 20.25, right: 50.25, bottom: 60.25 },
    200,
    200,
    100,
    100,
  );
  assert.deepEqual(crop, {
    left: 24,
    top: 40,
    right: 101,
    bottom: 121,
    width: 77,
    height: 81,
    scaleX: 2,
    scaleY: 2,
  });
}

{
  const crop = calculateCrop(
    { left: 10, top: 10, right: 30, bottom: 30 },
    150,
    200,
    100,
    100,
  );
  assert.equal(crop.scaleX, 1.5);
  assert.equal(crop.scaleY, 2);
  assert.deepEqual(
    { left: crop.left, top: crop.top, right: crop.right, bottom: crop.bottom },
    { left: 15, top: 20, right: 45, bottom: 60 },
  );
}

{
  const bounds = calculateBounds(
    [elementWithRect({ left: 120, top: 10, right: 150, bottom: 30, width: 30, height: 20 })],
    100,
    100,
    8,
  );
  assert.equal(bounds, null);
}

assert.deepEqual(calculateScrollPositions(120, 500, 800, 2200, 100), [100]);
assert.deepEqual(calculateScrollPositions(100, 1900, 800, 2200, 500), [100, 900, 1700]);
assert.deepEqual(calculateScrollPositions(2500, 2900, 800, 2200, 0), [2200]);
assert.deepEqual(calculateScrollPositions(10, 10, 800, 2200, 0), []);

{
  const rect = calculatePseudoElementRect(
    { left: 100, top: 200, width: 20, height: 20 },
    {
      width: "100px",
      height: "30px",
      boxSizing: "border-box",
      left: "10px",
      right: "auto",
      top: "auto",
      bottom: "28px",
      marginLeft: "0px",
      marginRight: "0px",
      marginTop: "0px",
      marginBottom: "0px",
      borderLeftWidth: "0px",
      borderRightWidth: "0px",
      borderTopWidth: "0px",
      borderBottomWidth: "0px",
      transform: "matrix(1, 0, 0, 1, -50, 0)",
      transformOrigin: "50px 15px",
    },
  );
  assert.deepEqual(rect, {
    left: 60,
    top: 162,
    right: 160,
    bottom: 192,
    width: 100,
    height: 30,
  });
}

{
  const rect = calculatePseudoElementRect(
    { left: 50, top: 80, width: 40, height: 20 },
    {
      width: "60px",
      height: "20px",
      boxSizing: "border-box",
      left: "50%",
      right: "auto",
      top: "auto",
      bottom: "calc(100% + 8px)",
      marginLeft: "0px",
      marginRight: "0px",
      marginTop: "0px",
      marginBottom: "0px",
      transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -30, 0, 0, 1)",
      transformOrigin: "30px 10px",
    },
  );
  assert.deepEqual(rect, {
    left: 40,
    top: 52,
    right: 100,
    bottom: 72,
    width: 60,
    height: 20,
  });
}

console.log("bounds tests passed");
