import assert from "node:assert/strict";
import test from "node:test";
import { assessDeemedLargeEnterpriseEligibility } from "../src/deemedLargeEnterprise";

const source = {
  sourceUrl: "https://example.go.jp/guideline.pdf",
  sourceTitle: "公式公募要領",
  sourceSection: "申請対象外となる事業者",
  checkedAt: "2026-09-03",
};

test("単一大企業の100%保有が制度基準に該当すれば対象外可能性を返す", () => {
  const result = assessDeemedLargeEnterpriseEligibility(
    "subsidy123",
    {
      treatment: "excluded",
      singleLargeOwnerThresholdPercent: 50,
      ...source,
    },
    { singleLargeOwnerPercent: 100 },
  );

  assert.equal(result.assessment.status, "likely_excluded");
  assert.equal(
    result.assessment.statusLabel,
    "みなし大企業として対象外となる可能性が高いです",
  );
  assert.match(result.assessment.matchedRules[0]!.message, /50%以上/u);
});

test("公式資料がみなし大企業を認める制度では資本関係だけで除外しない", () => {
  const result = assessDeemedLargeEnterpriseEligibility(
    "subsidy123",
    { treatment: "allowed", ...source },
    { singleLargeOwnerPercent: 100 },
  );

  assert.equal(result.assessment.status, "allowed_by_program");
  assert.equal(
    result.assessment.statusLabel,
    "みなし大企業であることだけでは対象外になりません",
  );
  assert.match(result.assessment.summary, /その他の申請要件/u);
});

test("公開情報で役員兼務を確認できなければ推定せず追加確認とする", () => {
  const result = assessDeemedLargeEnterpriseEligibility(
    "subsidy123",
    {
      treatment: "excluded",
      singleLargeOwnerThresholdPercent: 50,
      officerOverlapThresholdPercent: 50,
      ...source,
    },
    { singleLargeOwnerPercent: 10 },
  );

  assert.equal(result.assessment.status, "needs_confirmation");
  assert.deepEqual(
    result.assessment.missingInformation.map((item) => item.field),
    ["officer_overlap"],
  );
});

test("すべての入力済み基準を下回る場合も申請資格を保証しない", () => {
  const result = assessDeemedLargeEnterpriseEligibility(
    "subsidy123",
    {
      treatment: "excluded",
      singleLargeOwnerThresholdPercent: 50,
      multipleLargeOwnersThresholdPercent: 66.67,
      officerOverlapThresholdPercent: 50,
      indirectOwnershipIncluded: true,
      highIncomeRuleIncluded: true,
      ...source,
    },
    {
      singleLargeOwnerPercent: 10,
      multipleLargeOwnersPercent: 20,
      officerOverlapPercent: 0,
      indirectlyControlledByLargeEnterprise: false,
      highIncomeRuleApplies: false,
    },
  );

  assert.equal(result.assessment.status, "no_exclusion_identified");
  assert.match(result.assessment.summary, /申請要件は別途確認/u);
  assert.match(result.caution, /申請資格を保証しない/u);
});

test("公式資料に扱いがなければ制度実施機関への確認で停止する", () => {
  const result = assessDeemedLargeEnterpriseEligibility(
    "subsidy123",
    { treatment: "not_stated", ...source },
    { singleLargeOwnerPercent: 100 },
  );

  assert.equal(result.assessment.status, "needs_confirmation");
  assert.equal(result.assessment.missingInformation[0]!.field, "program_rule");
});

test("条件付き制度は条件の確認結果を分けて扱う", () => {
  const unknown = assessDeemedLargeEnterpriseEligibility(
    "subsidy123",
    { treatment: "conditional", ...source },
    {},
  );
  const allowed = assessDeemedLargeEnterpriseEligibility(
    "subsidy123",
    { treatment: "conditional", ...source },
    { conditionalRequirementMet: true },
  );

  assert.equal(unknown.assessment.status, "needs_confirmation");
  assert.equal(allowed.assessment.status, "allowed_by_program");
});
