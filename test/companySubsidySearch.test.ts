import assert from "node:assert/strict";
import test from "node:test";
import { searchSubsidiesForCompany } from "../src/companySubsidySearch";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function companyResponse() {
  return Response.json({
    "hojin-infos": [
      {
        corporate_number: "7010001224615",
        name: "株式会社トレファクテクノロジーズ",
        location: "東京都千代田区",
        employee_number: 16,
        industry: ["情報通信業"],
        certification: [],
        subsidy: [],
      },
    ],
  });
}

test("親会社候補が未検証なら会社別検索を停止する", async () => {
  const requestedHosts: string[] = [];
  globalThis.fetch = async (input) => {
    requestedHosts.push(new URL(String(input)).hostname);
    return companyResponse();
  };

  const result = await searchSubsidiesForCompany(
    {
      corporateNumber: "7010001224615",
      keyword: "AI 開発",
      parentCandidate: { name: "株式会社トレジャー・ファクトリー" },
      acceptingOnly: true,
      sort: "acceptance_end_datetime",
      order: "ASC",
      limit: 5,
    },
    "gbiz-token",
    async () => ({
      status: "needs_verification",
      source: "none",
      riskLevel: "unknown",
      checkedBeforeSubsidyAssessment: true,
      storageAvailable: true,
      verifiedRelations: [],
      parentCandidate: {
        name: "株式会社トレジャー・ファクトリー",
        corporateNumber: null,
      },
      verification: null,
      error: null,
    }),
  );

  assert.deepEqual(requestedHosts, ["api.info.gbiz.go.jp"]);
  assert.equal(result.search, null);
  assert.equal(
    result.recommendationGate.companySpecificRecommendationAllowed,
    false,
  );
});

test("D1で資本関係を確認してからJグランツ候補を検索する", async () => {
  const requestedHosts: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedHosts.push(url.hostname);
    if (url.hostname === "api.info.gbiz.go.jp") return companyResponse();
    return Response.json({
      result: [
        {
          id: "candidate1",
          title: "AI導入支援",
          target_area_search: "東京都",
          target_number_of_employees: "300人以下",
          acceptance_start_datetime: "2020-01-01T00:00:00Z",
          acceptance_end_datetime: "2099-01-01T00:00:00Z",
        },
      ],
    });
  };

  const result = await searchSubsidiesForCompany(
    {
      corporateNumber: "7010001224615",
      keyword: "AI 開発",
      acceptingOnly: true,
      sort: "acceptance_end_datetime",
      order: "ASC",
      limit: 5,
    },
    "gbiz-token",
    async () => ({
      status: "verified",
      source: "d1",
      riskLevel: "high",
      checkedBeforeSubsidyAssessment: true,
      storageAvailable: true,
      verifiedRelations: [],
      parentCandidate: null,
      verification: null,
      error: null,
    }),
  );

  assert.equal(requestedHosts[0], "api.info.gbiz.go.jp");
  assert.ok(requestedHosts.slice(1).every((host) => host === "api.jgrants-portal.go.jp"));
  assert.equal(result.search?.returnedCount, 1);
  assert.equal(
    result.recommendationGate.status,
    "conditional_verified_group_relationship",
  );
});

