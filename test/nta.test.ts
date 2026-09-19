import assert from "node:assert/strict";
import test from "node:test";
import { getCorporateIdentity, searchCorporateIdentities, NtaApiError, NTA_NOTICE } from "../src/nta";

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
const id = "aB34567890123";
const number = "8040001999013";
function record(overrides: Record<number, string> = {}) {
  const fields = ["1", number, "11", "0", "2017-05-09", "2017-05-09", "株式会社商号変更後", "", "301", "千葉県", "千葉市中央区", "蘇我５丁目９番１号", "", "12", "101", "2600822", "", "", "", "", "", "", "2015-10-05", "1", "", "", "", "", "", "0"];
  for (const [i, v] of Object.entries(overrides)) fields[Number(i)] = v;
  return fields.map(v => '"' + v.replaceAll('"', '""') + '"').join(",");
}
const csv = (row = record(), header = "2017-05-10,1,1,1") => header + "\r\n" + row + (row ? "\r\n" : "");
test("国税庁仕様の30列CSVから最新法人情報と出典を返す", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://api.houjin-bangou.nta.go.jp/4/num");
    assert.equal(url.searchParams.get("id"), id);
    assert.equal(url.searchParams.get("number"), number);
    assert.equal(url.searchParams.get("type"), "02");
    assert.equal(url.searchParams.get("history"), "0");
    assert.equal(init?.redirect, "manual");
    return new Response("\uFEFF" + csv(record({ 6: '株式会社Ａ,"Ｂ"\nＣ', 28: "サンプル" })));
  };
  const result = await getCorporateIdentity(number, id);
  assert.equal(result.corporation.name, '株式会社Ａ,"Ｂ"\nＣ');
  assert.equal(result.corporation.location, "千葉県千葉市中央区蘇我５丁目９番１号");
  assert.equal(result.corporation.kana, "サンプル");
  assert.equal(result.corporation.status, "no_closure_information");
  assert.equal(result.notice, NTA_NOTICE);
  assert.ok(!JSON.stringify(result).includes(id));
});
test("閉鎖・承継・国外所在地・検索対象除外を保持する", async () => {
  globalThis.fetch = async () => new Response(csv(record({ 16: "米国", 18: "2020-01-01", 19: "11", 20: "5111101000006", 29: "1" })));
  const { corporation: c } = await getCorporateIdentity(number, id);
  assert.equal(c.status, "closed");
  assert.equal(c.closeCause, "11");
  assert.equal(c.successorCorporateNumber, "5111101000006");
  assert.equal(c.addressOutside, "米国");
  assert.equal(c.excludedFromSearch, true);
});
test("名称の全角化・所在地コード・分割番号を送り次ページを表示する", async () => {
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/4/name");
    assert.equal(url.searchParams.get("name"), "株式会社ＡＢＣ１２３");
    assert.equal(url.searchParams.get("address"), "13101");
    assert.equal(url.searchParams.get("divide"), "2");
    assert.equal(url.searchParams.get("mode"), "2");
    assert.equal(url.searchParams.get("close"), "1");
    return new Response(csv(record(), "2017-05-10,1001,2,3"));
  };
  const result = await searchCorporateIdentities({ name: "株式会社ABC123", addressCode: "13101", page: 2 }, id);
  assert.equal(result.nextPage, 3);
  assert.equal(result.mayHaveMore, true);
});
test("該当なしは検索で空配列、番号照会でnot_found", async () => {
  globalThis.fetch = async () => new Response(csv("", "2017-05-10,0,1,1"));
  assert.deepEqual((await searchCorporateIdentities({ name: "該当なし" }, id)).corporations, []);
  await assert.rejects(getCorporateIdentity(number, id), { code: "not_found" });
});
test("未設定・不正入力では通信しない", async () => {
  globalThis.fetch = async () => { assert.fail("must not fetch"); };
  await assert.rejects(getCorporateIdentity(number), { code: "configuration_error" });
  await assert.rejects(getCorporateIdentity("123", id), { code: "invalid_request" });
  for (const input of [{ name: "" }, { name: "会社", page: 0 }, { name: "会社", addressCode: "48" }]) {
    await assert.rejects(searchCorporateIdentities(input, id), { code: "invalid_request" });
  }
});
test("壊れたCSV、件数矛盾、別法人、過去情報を拒否する", async () => {
  for (const body of ["<html>error</html>", csv('"unterminated'), csv(record(), "2017-05-10,2,1,1"), csv(record({ 1: "5111101000006" })), csv(record({ 23: "0" }))]) {
    globalThis.fetch = async () => new Response(body);
    await assert.rejects(getCorporateIdentity(number, id), { code: "invalid_response" });
  }
});
test("HTTP障害を分類し上流本文と例外からIDを漏らさない", async () => {
  for (const [status, code] of [[400, "invalid_request"], [403, "authentication_error"], [429, "rate_limited"], [503, "upstream_error"]] as const) {
    globalThis.fetch = async () => new Response(id, { status });
    await assert.rejects(getCorporateIdentity(number, id), (e: unknown) => e instanceof NtaApiError && e.code === code && !e.message.includes(id));
  }
  globalThis.fetch = async () => { throw new Error("https://api.example/?id=" + id); };
  await assert.rejects(getCorporateIdentity(number, id), (e: unknown) => e instanceof NtaApiError && e.code === "upstream_error" && !e.message.includes(id));
});

test("本文受信中のタイムアウトも分類する", async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", () => controller.signal);
  globalThis.fetch = async () => {
    const response = new Response("");
    response.text = async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    };
    return response;
  };
  await assert.rejects(getCorporateIdentity(number, id), { code: "timeout" });
});

test("転送先へIDを送信せず、Locationや上流本文も返さない", async () => {
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    assert.equal(init?.redirect, "manual");
    return new Response(id, { status: 302, headers: { Location: `https://example.com/?id=${id}` } });
  };
  await assert.rejects(getCorporateIdentity(number, id), (error: unknown) =>
    error instanceof NtaApiError && error.code === "upstream_error" &&
    !error.message.includes(id) && !error.message.includes("example.com"));
  assert.equal(calls, 1);
});
