import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  D1SelectionStatisticsRepository,
  estimateSelectionOutlook,
  type SelectionEvidenceInput,
} from "../src/selectionStatistics";

class SqliteD1Adapter {
  constructor(private readonly database: DatabaseSync) {}

  prepare(query: string) {
    const statement = this.database.prepare(query);
    const adapter = {
      bind(...values: unknown[]) {
        return {
          async first<T>() {
            return (statement.get(...values) ?? null) as T | null;
          },
          async all<T>() {
            return { success: true, results: statement.all(...values) as T[] };
          },
          async run() {
            statement.run(...values);
            return { success: true, meta: {} };
          },
        };
      },
    };
    return adapter;
  }
}

test("D1マイグレーションを順番に適用し採択実績と推定値を保存できる", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  for (const name of [
    "0001_initial_schema.sql",
    "0002_public_api_cache.sql",
    "0003_subsidy_research_schema.sql",
  ]) {
    database.exec(readFileSync(resolve(root, "migrations", name), "utf8"));
  }

  const repository = new D1SelectionStatisticsRepository(
    new SqliteD1Adapter(database) as unknown as D1Database,
  );
  const evidence: SelectionEvidenceInput = {
    program: {
      seriesKey: "integration-program",
      canonicalName: "統合テスト補助金",
      institutionName: "テスト庁",
    },
    round: {
      jgrantsSubsidyId: "past-round",
      fiscalYear: 2025,
      roundName: "第1回",
      lastCheckedAt: "2026-09-03",
    },
    counts: {
      applicationsCount: 100,
      selectedCount: 40,
      comparability: "confirmed_same_round_and_scope",
    },
    source: {
      sourceType: "official_result",
      publisher: "テスト庁",
      title: "採択結果",
      url: "https://example.go.jp/result",
      retrievedAt: "2026-09-03T00:00:00Z",
      contentHash: "a".repeat(64),
      reliability: "high",
      role: "both_counts",
    },
    basisSummary: "同じ公募回・同じ対象範囲の公式件数。",
    asOfDate: "2026-09-03",
  };

  const stored = await repository.saveEvidence(evidence);
  assert.equal(stored.status, "stored");
  assert.equal(
    database
      .prepare("SELECT official_rate FROM subsidy_selection_statistics")
      .get()?.official_rate,
    0.4,
  );

  await repository.saveEvidence({
    ...evidence,
    source: {
      ...evidence.source,
      sourceType: "official_budget",
      role: "budget",
      title: "予算資料",
      url: "https://example.go.jp/budget",
      contentHash: "b".repeat(64),
    },
    counts: { comparability: "not_confirmed" },
    basisSummary: "当年度の公式予算資料。",
  });
  assert.equal(
    database
      .prepare("SELECT official_rate FROM subsidy_selection_statistics")
      .get()?.official_rate,
    0.4,
  );

  database
    .prepare(`
      INSERT INTO subsidy_rounds (
        program_id, jgrants_subsidy_id, fiscal_year, round_name, last_checked_at
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .run(stored.programId, "current-round", 2026, "第1回", "2026-09-03");
  const outlook = estimateSelectionOutlook({
    eligibilityStatus: "eligible",
    historicalRates: [
      {
        fiscalYear: 2025,
        roundName: "第1回",
        applicationsCount: 100,
        selectedCount: 40,
        officialRate: 0.4,
        asOfDate: "2026-09-03",
      },
    ],
    programContinuity: "continuing",
  });
  const estimate = await repository.saveEstimateForJgrantsId(
    "current-round",
    outlook,
    "2026-09-03",
  );
  assert.equal(estimate.status, "stored");
  const current = database
    .prepare(`
      SELECT estimated_rate_mid, methodology_version
      FROM subsidy_selection_statistics AS statistic
      INNER JOIN subsidy_rounds AS round ON round.id = statistic.subsidy_round_id
      WHERE round.jgrants_subsidy_id = ?
    `)
    .get("current-round");
  assert.equal(current?.estimated_rate_mid, 0.4);
  assert.equal(current?.methodology_version, "rule_based_v1");

  database.close();
});
