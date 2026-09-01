(function exposeFilename(global) {
  "use strict";

  function createEvidenceFilename({ prefix, numbers, numberEnabled, timing, timingEnabled }) {
    const safePrefix = sanitizePart(prefix, "AC");
    const safeNumbers = [normalizeNumber(numbers?.[0])];
    const secondEnabled = numberEnabled?.[1] !== false;
    const thirdEnabled = secondEnabled && numberEnabled?.[2] !== false;
    if (secondEnabled) {
      safeNumbers.push(normalizeNumber(numbers?.[1]));
    }
    if (thirdEnabled) {
      safeNumbers.push(normalizeNumber(numbers?.[2]));
    }
    const safeTiming = ["before", "after", "result"].includes(timing) ? timing : "before";
    const timingSuffix = timingEnabled === false ? "" : `-${safeTiming}`;

    return `${safePrefix}-${safeNumbers.join("-")}${timingSuffix}.png`;
  }

  function normalizeNumber(value) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number >= 1 ? number : 1;
  }

  function sanitizePart(value, fallback) {
    const sanitized = String(value ?? "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");
    return sanitized || fallback;
  }

  global.TestEvidenceFilename = Object.freeze({ createEvidenceFilename, normalizeNumber });
})(globalThis);
