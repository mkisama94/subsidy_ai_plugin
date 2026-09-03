import assert from "node:assert/strict";
import test from "node:test";
import { inferredFilingDates } from "../src/edinet";

test("EDINETコード一覧の月末日表記から限定検索期間を作る", () => {
  const dates = inferredFilingDates(
    "2月末日",
    new Date("2026-09-03T00:00:00Z"),
  );

  assert.equal(dates.length, 40);
  assert.equal(dates[0], "2026-05-04");
  assert.equal(dates.at(-1), "2026-06-12");
});

test("通常の日付表記と、まだ提出期前の決算期を扱う", () => {
  const dates = inferredFilingDates(
    "3月31日",
    new Date("2026-04-30T00:00:00Z"),
  );

  assert.equal(dates[0], "2025-06-04");
  assert.equal(dates.at(-1), "2025-07-13");
});
