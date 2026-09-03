import assert from "node:assert/strict";
import test from "node:test";
import { GBizInfoApiError, getCompanyProfile } from "../src/gbizinfo";

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
          industry: ["情報通信業"],
          business_items: ["ソフトウェア開発"],
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
