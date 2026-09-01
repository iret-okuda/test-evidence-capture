(function exposeHistory(global) {
  "use strict";

  function hasValidSelectors(record) {
    return (
      Array.isArray(record?.selectors) &&
      record.selectors.length > 0 &&
      record.selectors.every(
        (selector) => typeof selector === "string" && selector.trim().length > 0,
      )
    );
  }

  function normalizeRecords(value, limit = 5) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((record) => {
        return (
          record &&
          typeof record.id === "string" &&
          typeof record.pageKey === "string" &&
          typeof record.filename === "string" &&
          hasValidSelectors(record) &&
          record.bounds &&
          [record.bounds.left, record.bounds.top, record.bounds.right, record.bounds.bottom].every(
            Number.isFinite,
          )
        );
      })
      .map((record) => ({
        ...record,
        annotationIndexes: normalizeAnnotationIndexes(
          record.annotationIndexes,
          record.selectors.length,
        ),
      }))
      .slice(0, limit);
  }

  function normalizeAnnotationIndexes(value, selectorCount) {
    if (!Array.isArray(value) || !Number.isInteger(selectorCount) || selectorCount <= 0) {
      return [];
    }
    return [
      ...new Set(
        value.filter(
          (index) => Number.isInteger(index) && index >= 0 && index < selectorCount,
        ),
      ),
    ].sort((left, right) => left - right);
  }

  function addRecord(value, record, limit = 5) {
    return normalizeRecords([record, ...normalizeRecords(value, limit)], limit);
  }

  global.TestEvidenceHistory = Object.freeze({
    hasValidSelectors,
    normalizeAnnotationIndexes,
    normalizeRecords,
    addRecord,
  });
})(globalThis);
