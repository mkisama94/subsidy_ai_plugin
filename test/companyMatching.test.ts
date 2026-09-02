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
  assert.deepEqual(
    result.assessment.assessment.matchedConditions.map(
      (condition) => condition.field,
    ),
    ["location", "industry", "employee_count", "acceptance_period"],
  );
});
