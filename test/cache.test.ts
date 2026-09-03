import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrivateCacheKey,
  type PublicApiCache,
  type PublicApiCacheEntry,
  readThroughPublicCache,
} from "../src/cache";

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

test("秘密鍵付きキャッシュキーは決定的で入力を露出しない", async () => {
  const input = { keyword: "非公開の設備投資計画", targetArea: "東京都" };
  const first = await createPrivateCacheKey("search", input, "secret-a");
  const second = await createPrivateCacheKey("search", input, "secret-a");
  const withAnotherSecret = await createPrivateCacheKey(
    "search",
    input,
    "secret-b",
  );

  assert.equal(first, second);
  assert.notEqual(first, withAnotherSecret);
  assert.equal(first.includes(input.keyword), false);
});

test("初回に取得して保存し、期限内はキャッシュを返す", async () => {
  const cache = new MemoryPublicApiCache();
  let loadCount = 0;
  let now = 1_000;
  const load = async () => ({ value: ++loadCount });
  const options = {
    cache,
    key: "detail:1",
    source: "test",
    resourceType: "detail",
    ttlMs: 1_000,
    staleTtlMs: 5_000,
    load,
    now: () => now,
  };

  const first = await readThroughPublicCache(options);
  now = 1_500;
  const second = await readThroughPublicCache(options);

  assert.equal(first.status, "miss");
  assert.equal(second.status, "hit");
  assert.equal(second.value.value, 1);
  assert.equal(loadCount, 1);
});

test("上流障害時だけ利用期限内の古いキャッシュへフォールバックする", async () => {
  const cache = new MemoryPublicApiCache();
  await cache.put("detail:1", "test", "detail", {
    value: { value: "cached" },
    fetchedAt: 1_000,
    expiresAt: 2_000,
    staleUntil: 5_000,
  });

  const result = await readThroughPublicCache({
    cache,
    key: "detail:1",
    source: "test",
    resourceType: "detail",
    ttlMs: 1_000,
    staleTtlMs: 5_000,
    load: async () => {
      throw new Error("upstream unavailable");
    },
    canUseStale: () => true,
    now: () => 3_000,
  });

  assert.equal(result.status, "stale");
  assert.equal(result.isStale, true);
  assert.deepEqual(result.value, { value: "cached" });
});
