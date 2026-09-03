import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSubsidyFitFromDetail,
  type SubsidyDetailSnapshot,
} from "../src/matching";

function createDetail(
  overrides: Partial<SubsidyDetailSnapshot["subsidy"]> = {},
): SubsidyDetailSnapshot {
  return {
    source: {
      name: "Jグランツ（jGrants）",
      apiDocumentationUrl: "https://example.test/jgrants",
    },
    retrievedAt: "2026-09-02T00:00:00.000Z",
    subsidy: {
      id: "sample123",
      title: "省エネ設備導入支援",
      detailUrl: "https://example.test/subsidy/sample123",
      industry: "情報通信業",
      employeeLimit: "300人以下",
      usePurpose: "省エネ・設備投資",
      subsidyRate: "2/3",
      subsidyMaxLimitYen: 10_000_000,
      workflows: [
        {
          targetArea: "東京都",
          targetAreaDetail: null,
          acceptanceStatus: "open",
          acceptanceStart: "2026-09-01T00:00:00Z",
          acceptanceEnd: "2026-10-31T23:59:59Z",
        },
      ],
      ...overrides,
    },
  };
}

test("明示的な一致と要確認事項を分離する", () => {
  const result = evaluateSubsidyFitFromDetail(createDetail(), {
    location: "東京都港区",
    industry: "情報通信業",
    employeeCount: 25,
    businessPlans: ["省エネ設備の導入"],
  });

  assert.equal(result.assessment.status, "needs_confirmation");
  assert.equal(
    result.assessment.statusLabel,
    "申請条件の追加確認が必要です",
  );
  assert.match(result.assessment.summary, /追加確認が必要な項目/u);
  assert.deepEqual(
    result.assessment.matchedConditions.map((condition) => condition.field),
    ["location", "industry", "employee_count", "acceptance_period"],
  );
  assert.ok(
    result.assessment.unconfirmedConditions.some(
      (condition) => condition.field === "official_guidelines",
    ),
  );
});

test("地域または従業員数が不一致なら対象外の可能性を返す", () => {
  const result = evaluateSubsidyFitFromDetail(createDetail(), {
    location: "大阪府大阪市",
    industry: "情報通信業",
    employeeCount: 301,
  });

  assert.equal(result.assessment.status, "potentially_ineligible");
  assert.equal(
    result.assessment.statusLabel,
    "対象外となる可能性があります",
  );
  assert.match(result.assessment.summary, /一致しない可能性/u);
  assert.deepEqual(
    result.assessment.conflictingConditions.map((condition) => condition.field),
    ["location", "employee_count"],
  );
});

test("企業情報が不足している場合は不足項目を返す", () => {
  const result = evaluateSubsidyFitFromDetail(createDetail(), {});

  assert.equal(result.assessment.status, "insufficient_information");
  assert.equal(
    result.assessment.statusLabel,
    "判断に必要な企業情報が不足しています",
  );
  assert.match(result.assessment.summary, /3件不足/u);
  assert.deepEqual(result.assessment.missingProfileFields, [
    "location",
    "industry",
    "employee_count",
  ]);
});

test("複数の従業員数基準は機械的に不適合と断定しない", () => {
  const result = evaluateSubsidyFitFromDetail(
    createDetail({ employeeLimit: "製造業300人以下、小売業50人以下" }),
    {
      location: "東京都",
      industry: "製造業",
      employeeCount: 100,
    },
  );

  assert.equal(result.assessment.status, "needs_confirmation");
  assert.ok(
    result.assessment.unconfirmedConditions.some(
      (condition) => condition.field === "employee_count",
    ),
  );
});

test("対象地域の補足説明は一致判定に使わず要確認として返す", () => {
  const result = evaluateSubsidyFitFromDetail(
    createDetail({
      workflows: [
        {
          targetArea: "東京都",
          targetAreaDetail: "島しょ部を除く",
          acceptanceStatus: "open",
          acceptanceStart: "2026-09-01T00:00:00Z",
          acceptanceEnd: "2026-10-31T23:59:59Z",
        },
      ],
    }),
    {
      location: "東京都八丈町",
      industry: "情報通信業",
      employeeCount: 25,
    },
  );

  assert.equal(result.assessment.status, "needs_confirmation");
  assert.ok(
    result.assessment.unconfirmedConditions.some(
      (condition) => condition.field === "location_detail",
    ),
  );
});
