import assert from "node:assert/strict";
import test from "node:test";
import type {
  PublicApiCache,
  PublicApiCacheEntry,
} from "../src/cache";
import { getSubsidyDetail, searchSubsidies } from "../src/jgrants";

const originalFetch = globalThis.fetch;

class MemoryPublicApiCache implements PublicApiCache {
  readonly entries = new Map<string, PublicApiCacheEntry<unknown>>();

  async get<T>(key: string): Promise<PublicApiCacheEntry<T> | null> {
    return (this.entries.get(key) as PublicApiCacheEntry<T> | undefined) ?? null;
  }

  async put<T>(
    key: string,
    _source: string,
    _resourceType: string,
    entry: PublicApiCacheEntry<T>,
  ): Promise<void> {
    this.entries.set(key, entry as PublicApiCacheEntry<unknown>);
  }
}

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

test("検索結果を再利用し、検索条件をキャッシュ本文やキーへ保存しない", async () => {
  const cache = new MemoryPublicApiCache();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({
      metadata: { resultset: { count: 1 } },
      result: [
        {
          id: "cached123",
          title: "公開制度",
          acceptance_start_datetime: "2020-01-01T00:00:00Z",
          acceptance_end_datetime: "2099-12-31T23:59:59Z",
        },
      ],
    });
  };
  const input = {
    keyword: "社外秘の設備投資計画",
    acceptingOnly: true,
    sort: "acceptance_end_datetime" as const,
    order: "ASC" as const,
    limit: 10,
  };
  const cacheOptions = {
    cache,
    searchCacheKeySecret: "test-cache-key-secret",
    now: () => 1_000,
  };

  const first = await searchSubsidies(input, cacheOptions);
  const second = await searchSubsidies(input, cacheOptions);

  assert.equal(first.cache.status, "miss");
  assert.equal(second.cache.status, "hit");
  assert.equal(fetchCount, 1);
  assert.equal(cache.entries.size, 1);
  const [[key, entry]] = [...cache.entries.entries()];
  assert.equal(key.includes(input.keyword), false);
  assert.equal(JSON.stringify(entry.value).includes(input.keyword), false);
  assert.equal("query" in (entry.value as object), false);
  assert.equal(second.query.keyword, input.keyword);
});

test("補助金詳細は公開ID単位でキャッシュする", async () => {
  const cache = new MemoryPublicApiCache();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ result: [{ id: "detail456", title: "詳細制度" }] });
  };
  const cacheOptions = { cache, now: () => 1_000 };

  const first = await getSubsidyDetail("detail456", cacheOptions);
  const second = await getSubsidyDetail("detail456", cacheOptions);

  assert.equal(first.cache.status, "miss");
  assert.equal(second.cache.status, "hit");
  assert.equal(fetchCount, 1);
  assert.equal(cache.entries.has("jgrants:detail:v1:detail456"), true);
});

test("秘密鍵がなければ検索条件をD1へ保存せずキャッシュを迂回する", async () => {
  const cache = new MemoryPublicApiCache();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ result: [] });
  };
  const input = {
    keyword: "未公開計画",
    acceptingOnly: true,
    sort: "created_date" as const,
    order: "DESC" as const,
    limit: 10,
  };

  const first = await searchSubsidies(input, { cache });
  const second = await searchSubsidies(input, { cache });

  assert.equal(first.cache.status, "bypass");
  assert.equal(second.cache.status, "bypass");
  assert.equal(fetchCount, 2);
  assert.equal(cache.entries.size, 0);
});

test("Jグランツ停止時は利用期限内の詳細キャッシュを古い情報と明示して返す", async () => {
  const cache = new MemoryPublicApiCache();
  let now = 1_000;
  globalThis.fetch = async () =>
    Response.json({ result: [{ id: "stale123", title: "保存済み制度" }] });
  await getSubsidyDetail("stale123", { cache, now: () => now });

  now += 7 * 60 * 60 * 1000;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  const result = await getSubsidyDetail("stale123", {
    cache,
    now: () => now,
  });

  assert.equal(result.cache.status, "stale");
  assert.equal(result.cache.isStale, true);
  assert.equal(result.subsidy.title, "保存済み制度");
});
