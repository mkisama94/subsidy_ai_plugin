import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOfficialSelectionRate,
  createResearchSourceHash,
  D1SelectionStatisticsRepository,
  estimateSelectionOutlook,
  recordSelectionEvidence,
  SelectionStatisticsError,
  type SelectionEvidenceInput,
  verifyOfficialResearchSource,
} from "../src/selectionStatistics";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

type PreparedCall = { query: string; bindings: unknown[] };

class FakeD1Database {
  readonly calls: PreparedCall[] = [];
  firstResults: unknown[] = [];
  allResults: unknown[][] = [];

  prepare(query: string) {
    const call: PreparedCall = { query, bindings: [] };
    this.calls.push(call);
    const database = this;
    const statement = {
      bind(...values: unknown[]) {
        call.bindings = values;
        return statement;
      },
      async first<T>() {
        return (database.firstResults.shift() ?? null) as T | null;
      },
      async all<T>() {
        return { success: true, results: (database.allResults.shift() ?? []) as T[] };
      },
      async run() {
        return { success: true, meta: {} };
      },
    };
    return statement;
  }

  asD1Database() {
    return this as unknown as D1Database;
  }
}

test("同一公募回・同一範囲の公式件数だけから採択率を計算する", () => {
  const result = calculateOfficialSelectionRate(
    {
      applicationsCount: 1000,
      selectedCount: 400,
      denominatorLabel: "申請件数",
      numeratorLabel: "採択件数",
      comparability: "confirmed_same_round_and_scope",
    },
    "official_result",
  );

  assert.equal(result.status, "official_rate_available");
  assert.equal(result.officialRate, 0.4);
  assert.equal(result.officialRatePercent, 40);
  assert.match(result.explanation, /申請件数1,000件/u);
});

test("採択件数しかない場合は公式採択率を出さない", () => {
  const result = calculateOfficialSelectionRate(
    {
      selectedCount: 127,
      numeratorLabel: "採択件数",
      comparability: "not_confirmed",
    },
    "official_result",
  );

  assert.equal(result.status, "insufficient_data");
  assert.equal(result.officialRate, null);
  assert.equal(result.selectedCount, 127);
});

test("年度や対象範囲の同一性を確認できなければ割り算しない", () => {
  const result = calculateOfficialSelectionRate(
    {
      applicationsCount: 1000,
      selectedCount: 400,
      comparability: "not_comparable",
    },
    "official_report",
  );

  assert.equal(result.status, "not_comparable");
  assert.equal(result.officialRate, null);
});

test("民間の二次情報を公式採択率として扱わない", () => {
  const result = calculateOfficialSelectionRate(
    {
      applicationsCount: 1000,
      selectedCount: 400,
      comparability: "confirmed_same_round_and_scope",
    },
    "secondary_analysis",
  );

  assert.equal(result.status, "insufficient_data");
  assert.equal(result.officialRate, null);
});

test("採択件数が申請件数を上回る矛盾を拒否する", () => {
  assert.throws(
    () =>
      calculateOfficialSelectionRate(
        {
          applicationsCount: 10,
          selectedCount: 11,
          comparability: "confirmed_same_round_and_scope",
        },
        "official_result",
      ),
    (error: unknown) =>
      error instanceof SelectionStatisticsError && error.code === "invalid_input",
  );
});

test("申請資格が未確定なら採択見通しを計算しない", () => {
  const result = estimateSelectionOutlook({
    eligibilityStatus: "needs_confirmation",
    historicalRates: [
      {
        fiscalYear: 2025,
        roundName: "第1回",
        applicationsCount: 100,
        selectedCount: 40,
        officialRate: 0.4,
        asOfDate: "2026-01-01",
      },
    ],
  });

  assert.equal(result.status, "withheld");
  assert.equal(result.estimatedRateMid, null);
  assert.match(result.reason, /申請資格が確定していない/u);
});

test("過去3回の公式実績を加重平均し公開された変更だけを補正する", () => {
  const result = estimateSelectionOutlook({
    eligibilityStatus: "eligible",
    historicalRates: [
      {
        fiscalYear: 2025,
        roundName: "第3回",
        applicationsCount: 200,
        selectedCount: 80,
        officialRate: 0.4,
        asOfDate: "2026-01-01",
      },
      {
        fiscalYear: 2025,
        roundName: "第2回",
        applicationsCount: 300,
        selectedCount: 90,
        officialRate: 0.3,
        asOfDate: "2025-10-01",
      },
      {
        fiscalYear: 2025,
        roundName: "第1回",
        applicationsCount: 500,
        selectedCount: 150,
        officialRate: 0.3,
        asOfDate: "2025-07-01",
      },
    ],
    budgetChangePercent: 20,
    targetScopeChange: "unchanged",
    programContinuity: "continuing",
  });

  assert.equal(result.status, "estimated");
  if (result.status !== "estimated") return;
  assert.equal(result.historicalWeightedRate, 0.32);
  assert.equal(result.confidence, "high");
  assert.ok(result.estimatedRateLow < result.estimatedRateMid);
  assert.ok(result.estimatedRateMid < result.estimatedRateHigh);
  assert.match(result.reason, /個別企業の採択確率ではありません/u);
});

const evidence: SelectionEvidenceInput = {
  program: {
    seriesKey: "sample-program",
    canonicalName: "サンプル補助金",
    institutionName: "サンプル庁",
  },
  round: {
    jgrantsSubsidyId: "abc123",
    fiscalYear: 2026,
    roundName: "第1回",
    lastCheckedAt: "2026-09-03",
  },
  counts: {
    applicationsCount: 1000,
    selectedCount: 400,
    comparability: "confirmed_same_round_and_scope",
  },
  source: {
    sourceType: "official_result",
    publisher: "サンプル庁",
    title: "採択結果",
    url: "https://example.go.jp/result",
    retrievedAt: "2026-09-03T00:00:00Z",
    contentHash: "a".repeat(64),
    reliability: "high",
    role: "both_counts",
  },
  basisSummary: "同じ公募回の申請件数と採択件数を使用。",
  asOfDate: "2026-09-03",
};

test("D1未設定でも計算結果を返し保存されていないことを明示する", async () => {
  const result = await recordSelectionEvidence(evidence, null);

  assert.equal(result.calculation.officialRate, 0.4);
  assert.deepEqual(result.persistence, { status: "not_configured" });
  assert.match(result.displayGuidance, /個別企業の採択確率とは/u);
});

test("根拠本文を決定的なハッシュに変換する", async () => {
  const first = await createResearchSourceHash(" 申請100件、採択40件 ");
  const second = await createResearchSourceHash("申請100件、採択40件");

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/u);
  assert.equal(first.includes("申請"), false);
});

test("公的機関の公式ページに根拠文がある場合だけ出典を検証する", async () => {
  globalThis.fetch = async () =>
    new Response(
      "<html><script>申請999件、採択999件</script><table><tr><td>申請100件、</td><td>採択40件でした。</td></tr></table></html>",
      {
      headers: { "content-type": "text/html; charset=utf-8" },
      },
    );

  const result = await verifyOfficialResearchSource(
    "https://www.example.go.jp/results/1",
    "申請100件、採択40件",
  );

  assert.match(result.contentHash, /^[a-f0-9]{64}$/u);
  assert.equal(result.verifiedUrl, "https://www.example.go.jp/results/1");
});

test("HTMLのスクリプト内だけにある根拠文は採用しない", async () => {
  globalThis.fetch = async () =>
    new Response("<script>申請999件、採択999件</script>", {
      headers: { "content-type": "text/html" },
    });

  await assert.rejects(
    () =>
      verifyOfficialResearchSource(
        "https://www.example.go.jp/results",
        "申請999件、採択999件",
      ),
    /根拠文を公式資料内で確認できない/u,
  );
});

test("民間ドメインと公式ページに存在しない根拠文を拒否する", async () => {
  globalThis.fetch = async () =>
    new Response("申請100件、採択40件", {
      headers: { "content-type": "text/html" },
    });

  await assert.rejects(
    () =>
      verifyOfficialResearchSource(
        "https://example.com/results",
        "申請100件、採択40件",
      ),
    (error: unknown) =>
      error instanceof SelectionStatisticsError && error.code === "invalid_input",
  );
  await assert.rejects(
    () =>
      verifyOfficialResearchSource(
        "https://www.example.go.jp/results",
        "申請999件、採択999件",
      ),
    /根拠文を公式資料内で確認できない/u,
  );
});

test("制度・公募回・出典・採択実績を関連付けて保存する", async () => {
  const database = new FakeD1Database();
  database.firstResults.push({ id: 1 }, { id: 2 }, null, { id: 3 }, { id: 4 });
  const repository = new D1SelectionStatisticsRepository(database.asD1Database());

  const result = await repository.saveEvidence(evidence);

  assert.equal(result.status, "stored");
  assert.equal(database.calls.length, 6);
  assert.match(database.calls[0]!.query, /INSERT INTO subsidy_programs/u);
  assert.match(database.calls[1]!.query, /INSERT INTO subsidy_rounds/u);
  assert.match(database.calls[2]!.query, /FROM subsidy_selection_statistics/u);
  assert.match(database.calls[3]!.query, /INSERT INTO research_sources/u);
  assert.match(database.calls[4]!.query, /INSERT INTO subsidy_selection_statistics/u);
  assert.equal(database.calls[4]!.bindings[6], 0.4);
  assert.match(database.calls[5]!.query, /selection_statistic_sources/u);
});

test("算定済みの制度全体見通しと方法論を現在公募回へ保存する", async () => {
  const database = new FakeD1Database();
  database.firstResults.push({ id: 9 });
  const repository = new D1SelectionStatisticsRepository(database.asD1Database());
  const outlook = estimateSelectionOutlook({
    eligibilityStatus: "eligible",
    historicalRates: [
      {
        fiscalYear: 2025,
        roundName: "第1回",
        applicationsCount: 100,
        selectedCount: 40,
        officialRate: 0.4,
        asOfDate: "2026-01-01",
      },
    ],
    programContinuity: "continuing",
  });

  const result = await repository.saveEstimateForJgrantsId(
    "current123",
    outlook,
    "2026-09-03",
  );

  assert.equal(result.status, "stored");
  assert.match(database.calls[0]!.query, /estimated_rate_low/u);
  assert.equal(database.calls[0]!.bindings.at(-1), "current123");
});
