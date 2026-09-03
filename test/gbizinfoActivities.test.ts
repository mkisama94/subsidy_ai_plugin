import assert from "node:assert/strict";
import test from "node:test";
import { GBizInfoApiError } from "../src/gbizinfo";
import { getCompanyActivities } from "../src/gbizinfoActivities";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("検索件数11を特許10件と補助金1件として取得する", async () => {
  const requestedPaths: string[] = [];
  const requestedTokens: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requestedPaths.push(url.pathname);
    requestedTokens.push(
      new Headers(init?.headers).get("X-hojinInfo-api-token") ?? "",
    );
    if (url.pathname === "/hojin/v2/hojin") {
      return Response.json({
        "hojin-infos": [
          {
            corporate_number: "3010001205734",
            number_of_activity: "11",
          },
        ],
      });
    }
    if (url.pathname.endsWith("/patent")) {
      return Response.json({
        "hojin-infos": [
          {
            corporate_number: "3010001205734",
            patent: Array.from({ length: 10 }, (_, index) => ({
              patent_type: index < 3 ? "特許" : "商標",
              registration_number: `P-${index + 1}`,
              title: `知的財産${index + 1}`,
              application_date: `2026-01-${String(index + 1).padStart(2, "0")}`,
              "meta-data": { created: "ignored" },
            })),
          },
        ],
      });
    }
    if (url.pathname.endsWith("/subsidy")) {
      return Response.json({
        "hojin-infos": [
          {
            corporate_number: "3010001205734",
            subsidy: [
              {
                title: "事業再構築補助金",
                amount: "20000000",
                government_departments: "中小企業庁",
              },
            ],
          },
        ],
      });
    }
    return Response.json({
      "hojin-infos": [
        {
          corporate_number: "3010001205734",
          certification: [],
        },
      ],
    });
  };

  const result = await getCompanyActivities(
    "3010001205734",
    "secret-token",
    ["certification", "patent", "subsidy"],
    20,
  );

  assert.deepEqual(new Set(requestedPaths), new Set([
    "/hojin/v2/hojin",
    "/hojin/v2/hojin/3010001205734/certification",
    "/hojin/v2/hojin/3010001205734/patent",
    "/hojin/v2/hojin/3010001205734/subsidy",
  ]));
  assert.equal(requestedTokens.every((token) => token === "secret-token"), true);
  assert.equal(result.reportedActivityCount, 11);
  assert.equal(result.activities.patent?.totalCount, 10);
  assert.equal(result.activities.subsidy?.totalCount, 1);
  assert.equal(result.activities.certification?.totalCount, 0);
  assert.equal(result.retrievedTopLevelItemCount, 11);
  assert.equal(result.countComparison.status, "matched");
  assert.equal(result.countComparison.difference, 0);
  assert.equal(result.partial, false);
  assert.equal(
    JSON.stringify(result).includes("secret-token"),
    false,
  );
  const patent = result.activities.patent?.items[0] as Record<string, unknown>;
  assert.equal(patent.patentType, "商標");
  assert.equal("meta-data" in patent, false);
});

test("各種類の上限を適用しつつ切り捨て前の件数を返す", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/hojin/v2/hojin") {
      return Response.json({
        "hojin-infos": [
          {
            corporate_number: "3010001205734",
            number_of_activity: "3",
          },
        ],
      });
    }
    return Response.json({
      "hojin-infos": [
        {
          corporate_number: "3010001205734",
          patent: [
            { title: "A", application_date: "2024-01-01" },
            { title: "B", application_date: "2026-01-01" },
            { title: "C", application_date: "2025-01-01" },
          ],
        },
      ],
    });
  };

  const result = await getCompanyActivities(
    "3010001205734",
    "token",
    ["patent"],
    2,
  );

  assert.equal(result.activities.patent?.totalCount, 3);
  assert.equal(result.activities.patent?.returnedCount, 2);
  assert.equal(result.activities.patent?.hasMore, true);
  assert.deepEqual(
    result.activities.patent?.items.map(
      (item) => (item as Record<string, unknown>).title,
    ),
    ["B", "C"],
  );
});

test("一部の活動APIが失敗しても取得済み結果を返す", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/hojin/v2/hojin") {
      return Response.json({
        "hojin-infos": [
          {
            corporate_number: "3010001205734",
            number_of_activity: "1",
          },
        ],
      });
    }
    if (url.pathname.endsWith("/patent")) {
      return new Response(null, { status: 503 });
    }
    return Response.json({
      "hojin-infos": [
        {
          corporate_number: "3010001205734",
          subsidy: [{ title: "取得済み補助金" }],
        },
      ],
    });
  };

  const result = await getCompanyActivities(
    "3010001205734",
    "token",
    ["patent", "subsidy"],
  );

  assert.equal(result.activities.subsidy?.totalCount, 1);
  assert.equal(result.activities.patent, undefined);
  assert.equal(result.errors[0]?.type, "patent");
  assert.equal(result.errors[0]?.error.code, "upstream_error");
  assert.equal(result.partial, true);
});

test("APIトークン未設定では活動APIを呼び出さない", async () => {
  globalThis.fetch = async () => {
    throw new Error("fetch must not be called");
  };

  await assert.rejects(
    () =>
      getCompanyActivities(
        "3010001205734",
        undefined,
        ["patent"],
      ),
    (error: unknown) =>
      error instanceof GBizInfoApiError &&
      error.code === "configuration_error",
  );
});

test("既定で8種類すべての専用APIを取得する", async () => {
  const responseFields: Record<string, string> = {
    certification: "certification",
    commendation: "commendation",
    corporation: "corporation-info",
    finance: "finance",
    patent: "patent",
    procurement: "procurement",
    subsidy: "subsidy",
    workplace: "workplace_info",
  };
  const requestedTypes: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/hojin/v2/hojin") {
      return Response.json({
        "hojin-infos": [
          {
            corporate_number: "3010001205734",
            number_of_activity: "8",
          },
        ],
      });
    }
    const type = url.pathname.split("/").at(-1) ?? "";
    requestedTypes.push(type);
    const field = responseFields[type];
    const value =
      type === "finance"
        ? { fiscal_year_cover_page: "2026", "meta-data": { ignored: true } }
        : type === "workplace"
          ? { base_infos: { average_age: "35" } }
          : [{ title: type }];
    return Response.json({
      "hojin-infos": [
        {
          corporate_number: "3010001205734",
          [field]: value,
        },
      ],
    });
  };

  const result = await getCompanyActivities(
    "3010001205734",
    "token",
  );

  assert.deepEqual(new Set(requestedTypes), new Set(Object.keys(responseFields)));
  assert.equal(result.selectedTypes.length, 8);
  assert.equal(result.retrievedTopLevelItemCount, 8);
  assert.equal(result.countComparison.status, "matched");
  assert.equal(result.activities.corporation?.totalCount, 1);
  assert.equal(result.activities.finance?.totalCount, 1);
  assert.equal(result.activities.workplace?.totalCount, 1);
  const finance = result.activities.finance?.items[0] as Record<
    string,
    unknown
  >;
  assert.equal(finance.fiscalYearCoverPage, "2026");
  assert.equal("meta-data" in finance, false);
});
