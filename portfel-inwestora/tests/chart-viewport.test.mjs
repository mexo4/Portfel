import assert from "node:assert/strict";
import test from "node:test";
import {
  filterChartPointsByRange,
  getChartRangeViewport,
  getSupportedChartRangePresets,
  normalizeChartRangePreset,
  panChartViewport,
  zoomChartViewport,
} from "../src/lib/chart-viewport.ts";

const points = Array.from({ length: 13 }, (_, index) => ({
  date: `2026-01-${String(index + 1).padStart(2, "0")}`,
}));

test("normalizes the legacy persisted range names", () => {
  assert.equal(normalizeChartRangePreset("1Q"), "3M");
  assert.equal(normalizeChartRangePreset("ALL"), "MAX");
  assert.equal(normalizeChartRangePreset("6M"), "6M");
  assert.equal(normalizeChartRangePreset("unknown"), null);
});

test("only exposes ranges represented by the history", () => {
  assert.deepEqual(getSupportedChartRangePresets(points), ["1D", "5D", "1W", "YTD", "MAX"]);
  assert.deepEqual(filterChartPointsByRange(points, "5D").map((point) => point.date), [
    "2026-01-08",
    "2026-01-09",
    "2026-01-10",
    "2026-01-11",
    "2026-01-12",
    "2026-01-13",
  ]);
  assert.deepEqual(getChartRangeViewport(points, "5D"), {
    startIndex: 7,
    endIndex: 12,
  });
});

test("zooms around the pointer anchor and returns to the base viewport", () => {
  assert.deepEqual(
    zoomChartViewport({
      viewport: null,
      pointCount: 100,
      factor: 0.5,
      anchorRatio: 0.8,
    }),
    { startIndex: 40, endIndex: 89 }
  );

  assert.equal(
    zoomChartViewport({
      viewport: { startIndex: 40, endIndex: 89 },
      pointCount: 100,
      factor: 4,
      anchorRatio: 0.5,
    }),
    null
  );
});

test("pans without altering the size of a zoomed viewport", () => {
  assert.deepEqual(
    panChartViewport({
      viewport: { startIndex: 40, endIndex: 59 },
      pointCount: 100,
      deltaPoints: -12,
    }),
    { startIndex: 28, endIndex: 47 }
  );
  assert.equal(
    panChartViewport({
      viewport: null,
      pointCount: 100,
      deltaPoints: 10,
    }),
    null
  );
});

test("uses the selected range as the initial viewport while preserving earlier history for pan", () => {
  const longHistory = [
    { date: "2024-01-10" },
    { date: "2025-01-12" },
    { date: "2025-01-13" },
    { date: "2026-01-13" },
  ];
  const selectedRangeViewport = getChartRangeViewport(longHistory, "1Y");

  assert.deepEqual(selectedRangeViewport, { startIndex: 2, endIndex: 3 });
  assert.deepEqual(
    panChartViewport({
      viewport: selectedRangeViewport,
      pointCount: longHistory.length,
      deltaPoints: -1,
    }),
    { startIndex: 1, endIndex: 2 }
  );
});
