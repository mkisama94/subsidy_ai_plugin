import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSubsidyFitForCompany } from "../src/companyMatching";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("gBizINFOの企業情報をJグランツの適合度判定へ自動投入する", async () => {
  const requestedHosts: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedHosts.push(url.hostname);
    if (url.hostname === "api.info.gbiz.go.jp") {
      return Response.json({
        "hojin-infos": [
          {
            corporate_number: "8000012010038",
            name: "サンプル法人",
            location: "東京都千代田区",
            capital_stock: 10000000,
            employee_number: 25,
            industry: ["情報通信業"],
            certification: [],
            subsidy: [],
          },
        ],
      });
    }
    return Response.json({
      result: [
        {
          id: "detail123",
          title: "省エネ設備導入支援",
          industry: "情報通信業",
          target_number_of_employees: "300人以下",
          front_subsidy_detail_page_url: "https://example.test/detail123",
          workflow: [
            {
              target_area_search: "東京都",
              acceptance_start_datetime: "2026-01-01T00:00:00Z",
              acceptance_end_datetime: "2099-12-31T23:59:59Z",
            },
          ],
        },
      ],
    });
  };

  const result = await evaluateSubsidyFitForCompany(
    "detail123",
    "8000012010038",
    "secret-token",
    ["省エネ設備の導入"],
  );

  assert.deepEqual(requestedHosts, [
    "api.info.gbiz.go.jp",
    "api.jgrants-portal.go.jp",
  ]);
  assert.equal(result.company.name, "サンプル法人");
  assert.equal(result.assessment.companyProfile.location, "東京都千代田区");
  assert.equal(result.assessment.companyProfile.industry, "情報通信業");
  assert.equal(result.assessment.companyProfile.employeeCount, 25);
  assert.equal(result.profileResolution.fields.location.source, "gbizinfo");
  assert.equal(result.profileResolution.fields.industry.source, "gbizinfo");
  assert.deepEqual(result.profileResolution.conflictFields, []);
  assert.equal(result.profileResolution.requiresUserConfirmation, false);
  assert.deepEqual(
    result.assessment.assessment.matchedConditions.map(
      (condition) => condition.field,
    ),
    ["location", "industry", "employee_count", "acceptance_period"],
  );
});

test("gBizINFOの欠損を利用者入力で補い、矛盾と出典を明示する", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.info.gbiz.go.jp") {
      return Response.json({
        "hojin-infos": [
          {
            corporate_number: "3010001205734",
            name: "小規模サンプル株式会社",
            location: "東京都千代田区",
            industry: [],
            certification: [],
            subsidy: [],
          },
        ],
      });
    }
    return Response.json({
      result: [
        {
          id: "detail456",
          title: "中小企業DX支援",
          industry: "情報通信業",
          target_number_of_employees: "50人以下",
          front_subsidy_detail_page_url: "https://example.test/detail456",
          workflow: [
            {
              target_area_search: "埼玉県",
              acceptance_start_datetime: "2026-01-01T00:00:00Z",
              acceptance_end_datetime: "2099-12-31T23:59:59Z",
            },
          ],
        },
      ],
    });
  };

  const result = await evaluateSubsidyFitForCompany(
    "detail456",
    "3010001205734",
    "secret-token",
    ["業務システムの刷新"],
    {
      location: "埼玉県越谷市",
      industry: "情報通信業",
      employeeCount: 7,
      capitalYen: 3_000_000,
    },
  );

  assert.equal(
    result.assessment.companyProfile.location,
    "埼玉県越谷市",
  );
  assert.equal(result.assessment.companyProfile.industry, "情報通信業");
  assert.equal(result.assessment.companyProfile.employeeCount, 7);
  assert.equal(result.assessment.companyProfile.capitalYen, 3_000_000);
  assert.equal(
    result.profileResolution.fields.location.source,
    "user_provided",
  );
  assert.equal(result.profileResolution.fields.location.conflict, true);
  assert.equal(
    result.profileResolution.fields.industry.source,
    "user_provided",
  );
  assert.equal(
    result.profileResolution.fields.employeeCount.source,
    "user_provided",
  );
  assert.deepEqual(result.profileResolution.conflictFields, ["location"]);
  assert.deepEqual(result.profileResolution.missingFields, []);
  assert.equal(result.profileResolution.requiresUserConfirmation, true);
  assert.equal(
    result.profileResolution.businessPlans.source,
    "user_provided",
  );
});

test("gBizINFOにも利用者入力にもない項目をmissingとして返す", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.info.gbiz.go.jp") {
      return Response.json({
        "hojin-infos": [
          {
            corporate_number: "3010001205734",
            name: "小規模サンプル株式会社",
            location: "埼玉県越谷市",
            certification: [],
            subsidy: [],
          },
        ],
      });
    }
    return Response.json({
      result: [
        {
          id: "detail789",
          title: "設備投資支援",
          workflow: [],
        },
      ],
    });
  };

  const result = await evaluateSubsidyFitForCompany(
    "detail789",
    "3010001205734",
    "secret-token",
  );

  assert.deepEqual(result.profileResolution.missingFields, [
    "industry",
    "employeeCount",
    "capitalYen",
  ]);
  assert.equal(result.profileResolution.businessPlans.source, "missing");
});

test("都道府県・市区町村だけの入力は詳細住所と矛盾させない", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.info.gbiz.go.jp") {
      return Response.json({
        "hojin-infos": [
          {
            corporate_number: "3010001205734",
            name: "小規模サンプル株式会社",
            location: "東京都千代田区神田鍛冶町3丁目7番地21",
            certification: [],
            subsidy: [],
          },
        ],
      });
    }
    return Response.json({
      result: [
        {
          id: "detail999",
          title: "東京都中小企業支援",
          workflow: [{ target_area_search: "東京都" }],
        },
      ],
    });
  };

  const result = await evaluateSubsidyFitForCompany(
    "detail999",
    "3010001205734",
    "secret-token",
    undefined,
    { location: "東京都千代田区" },
  );

  assert.equal(
    result.profileResolution.fields.location.relationship,
    "compatible",
  );
  assert.equal(result.profileResolution.fields.location.conflict, false);
  assert.deepEqual(result.profileResolution.conflictFields, []);
  assert.equal(result.profileResolution.requiresUserConfirmation, false);
});
