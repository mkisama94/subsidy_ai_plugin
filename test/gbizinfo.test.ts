import assert from "node:assert/strict";
import test from "node:test";
import {
  GBizInfoApiError,
  getCompanyProfile,
  searchCompanies,
} from "../src/gbizinfo";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("法人番号から企業基本情報と活動情報を正規化する", async () => {
  let requestedUrl = "";
  let requestedToken = "";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedToken =
      new Headers(init?.headers).get("X-hojinInfo-api-token") ?? "";
    return Response.json({
      "hojin-infos": [
        {
          corporate_number: "8000012010038",
          name: "サンプル法人",
          location: "東京都千代田区",
          capital_stock: 10000000,
          employee_number: 25,
          industry: ["G"],
          business_items: ["ソフトウェア開発"],
          qualification_grade: "、、C、、",
          status: "-",
          company_url: "not-a-url",
          certification: [
            {
              title: "認定B",
              government_departments: "経済産業省",
              date_of_approval: "2025-04-01",
            },
            {
              title: "認定A",
              government_departments: "経済産業省",
              date_of_approval: "2026-04-01",
            },
          ],
          subsidy: [
            {
              title: "支援制度A",
              amount: "1000000",
              date_of_approval: "2026-05-01",
            },
          ],
        },
      ],
    });
  };

  const result = await getCompanyProfile("8000012010038", "secret-token", 1);

  assert.equal(requestedToken, "secret-token");
  assert.equal(new URL(requestedUrl).pathname, "/hojin/v2/hojin/8000012010038");
  assert.equal(requestedUrl.endsWith("/"), false);
  assert.equal(result.company.name, "サンプル法人");
  assert.equal(result.company.employeeNumber, 25);
  assert.deepEqual(result.company.industries, ["情報通信業"]);
  assert.deepEqual(result.company.industryCodes, ["G"]);
  assert.equal(result.company.qualificationGrade, "C");
  assert.equal(result.company.status, null);
  assert.equal(result.company.statusAvailability, "not_provided");
  assert.equal(result.company.companyUrl, null);
  assert.match(result.statusPolicy, /断定できません/);
  assert.equal(result.activities.certificationCount, 2);
  assert.equal(result.activities.certifications[0]?.title, "認定A");
  assert.equal(result.activities.returnedCertificationCount, 1);
  assert.equal(result.activities.hasMore, true);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
});

test("APIトークン未設定では外部通信せず設定エラーを返す", async () => {
  globalThis.fetch = async () => {
    throw new Error("fetch must not be called");
  };

  await assert.rejects(
    () => getCompanyProfile("8000012010038", undefined),
    (error: unknown) =>
      error instanceof GBizInfoApiError && error.code === "configuration_error",
  );
});

test("13桁でない法人番号を拒否する", async () => {
  await assert.rejects(
    () => getCompanyProfile("1234", "secret-token"),
    (error: unknown) =>
      error instanceof GBizInfoApiError && error.code === "invalid_request",
  );
});

test("法人が見つからない場合はnot_foundを返す", async () => {
  globalThis.fetch = async () => Response.json({ "hojin-infos": [] });

  await assert.rejects(
    () => getCompanyProfile("8000012010038", "secret-token"),
    (error: unknown) =>
      error instanceof GBizInfoApiError && error.code === "not_found",
  );
});

test("法人名検索で複数候補を自動決定せず返す", async () => {
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json({
      "hojin-infos": [
        {
          corporate_number: "1111111111111",
          name: "株式会社サンプル",
          location: "東京都千代田区",
          status: "-",
          number_of_activity: "3",
        },
        {
          corporate_number: "2222222222222",
          name: "株式会社サンプル",
          location: "大阪府大阪市",
          status: "閉鎖",
          number_of_activity: "0",
        },
      ],
    });
  };

  const result = await searchCompanies(
    {
      name: "株式会社サンプル",
      prefecture: "東京都",
      city: "千代田区",
      limit: 5,
    },
    "secret-token",
  );

  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/hojin/v2/hojin");
  assert.equal(url.searchParams.get("name"), "株式会社サンプル");
  assert.equal(url.searchParams.get("prefecture"), "東京都");
  assert.equal(url.searchParams.get("city"), "千代田区");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(result.selectionStatus, "ambiguous");
  assert.equal(result.requiresSelection, true);
  assert.equal(result.returnedCount, 2);
  assert.equal(result.candidates[0]?.status, null);
  assert.equal(
    result.candidates[0]?.statusAvailability,
    "not_provided",
  );
  assert.equal(result.candidates[0]?.activityCount, 3);
  assert.equal(result.candidates[1]?.statusAvailability, "provided");
  assert.equal(result.mayHaveMore, false);
  assert.match(result.nextStep, /自動決定せず/);
});

test("法人名検索が0件でもエラーにせず再検索方法を返す", async () => {
  globalThis.fetch = async () => Response.json({ "hojin-infos": [] });

  const result = await searchCompanies({ name: "存在しない法人" }, "token");

  assert.equal(result.selectionStatus, "no_match");
  assert.equal(result.requiresSelection, false);
  assert.deepEqual(result.candidates, []);
  assert.match(result.nextStep, /再検索/);
});

test("法人名検索が1件なら詳細取得への次手を示す", async () => {
  globalThis.fetch = async () =>
    Response.json({
      "hojin-infos": [
        {
          corporate_number: "3333333333333",
          name: "唯一株式会社",
          location: "埼玉県越谷市",
        },
      ],
    });

  const result = await searchCompanies({ name: "唯一株式会社" }, "token");

  assert.equal(result.selectionStatus, "unique");
  assert.equal(result.requiresSelection, false);
  assert.match(result.nextStep, /get_company_profile/);
});

test("返却件数が上限と一致すると続き候補の可能性を明示する", async () => {
  globalThis.fetch = async () =>
    Response.json({
      "hojin-infos": [
        {
          corporate_number: "4444444444444",
          name: "同名株式会社",
          location: "東京都港区",
        },
        {
          corporate_number: "5555555555555",
          name: "同名株式会社",
          location: "東京都渋谷区",
        },
      ],
    });

  const result = await searchCompanies(
    { name: "同名株式会社", limit: 2 },
    "token",
  );

  assert.equal(result.mayHaveMore, true);
  assert.match(result.resultScope, /次ページ/);
  assert.match(result.nextStep, /先頭ページ/);
  assert.match(result.statusPolicy, /登記中・存続中とは断定せず/);
});

test("上限1件で1件返っても唯一候補とは断定しない", async () => {
  globalThis.fetch = async () =>
    Response.json({
      "hojin-infos": [
        {
          corporate_number: "6666666666666",
          name: "候補株式会社",
          location: "東京都中央区",
        },
      ],
    });

  const result = await searchCompanies(
    { name: "候補株式会社", limit: 1 },
    "token",
  );

  assert.equal(result.mayHaveMore, true);
  assert.equal(result.selectionStatus, "ambiguous");
  assert.equal(result.requiresSelection, true);
});
