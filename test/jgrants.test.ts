import assert from "node:assert/strict";
import test from "node:test";
import { getSubsidyDetail, searchSubsidies } from "../src/jgrants";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("地域制度と全国制度を統合し、重複を除いて返す", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const area = url.searchParams.get("target_area_search");
    const common = {
      id: "common123",
      title: "共通制度",
      target_area_search: "全国",
      target_number_of_employees: "300人以下",
      acceptance_start_datetime: "2020-01-01T00:00:00Z",
      acceptance_end_datetime: "2099-12-31T23:59:59Z",
    };
    const areaOnly = {
      id: "tokyo123",
      title: "東京都制度",
      target_area_search: "東京都",
      target_number_of_employees: "50人以下",
      acceptance_start_datetime: "2020-01-01T00:00:00Z",
      acceptance_end_datetime: "2099-01-01T00:00:00Z",
    };
    return Response.json({
      metadata: { resultset: { count: area === "全国" ? 1 : 2 } },
      result: area === "全国" ? [common] : [common, areaOnly],
    });
  };

  const result = await searchSubsidies({
    keyword: "省エネ",
    targetArea: "東京都",
    employeeCount: 25,
    acceptingOnly: true,
    sort: "acceptance_end_datetime",
    order: "ASC",
    limit: 10,
  });

  assert.equal(result.upstreamCount, 3);
  assert.equal(result.returnedCount, 2);
  assert.deepEqual(
    result.subsidies.map((subsidy) => subsidy.id),
    ["tokyo123", "common123"],
  );
});

test("詳細のHTMLをテキスト化し、Base64文書本体を返さない", async () => {
  globalThis.fetch = async () =>
    Response.json({
      result: [
        {
          id: "detail123",
          title: "詳細制度",
          detail: "<p>設備費&amp;工事費</p><p>対象です。</p>",
          front_subsidy_detail_page_url: "https://example.test/detail123",
          workflow: [],
          application_guidelines: [
            { name: "公募要領.pdf", data: "SGVsbG8=" },
          ],
        },
      ],
    });

  const result = await getSubsidyDetail("detail123");

  assert.equal(result.subsidy.description, "設備費&工事費\n対象です。");
  assert.equal(result.subsidy.documents[0]?.name, "公募要領.pdf");
  assert.equal(result.subsidy.documents[0]?.approximateSizeBytes, 5);
  assert.equal("data" in result.subsidy.documents[0]!, false);
});
