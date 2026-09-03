export type PublicApiCacheEntry<T> = {
  value: T;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
};

export interface PublicApiCache {
  get<T>(key: string): Promise<PublicApiCacheEntry<T> | null>;
  put<T>(
    key: string,
    source: string,
    resourceType: string,
    entry: PublicApiCacheEntry<T>,
  ): Promise<void>;
}

type CacheRow = {
  payload_json: string;
  fetched_at: number;
  expires_at: number;
  stale_until: number;
};

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function createPrivateCacheKey(
  namespace: string,
  value: unknown,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${namespace}:${bytesToHex(new Uint8Array(signature))}`;
}

export class D1PublicApiCache implements PublicApiCache {
  constructor(private readonly database: D1Database) {}

  async get<T>(key: string): Promise<PublicApiCacheEntry<T> | null> {
    const row = await this.database
      .prepare(
        `SELECT payload_json, fetched_at, expires_at, stale_until
         FROM public_api_cache
         WHERE cache_key = ?1`,
      )
      .bind(key)
      .first<CacheRow>();
    if (!row) return null;

    try {
      return {
        value: JSON.parse(row.payload_json) as T,
        fetchedAt: row.fetched_at,
        expiresAt: row.expires_at,
        staleUntil: row.stale_until,
      };
    } catch {
      return null;
    }
  }

  async put<T>(
    key: string,
    source: string,
    resourceType: string,
    entry: PublicApiCacheEntry<T>,
  ): Promise<void> {
    const payloadJson = JSON.stringify(entry.value);
    const contentHash = await sha256(payloadJson);
    await this.database
      .prepare(
        `INSERT INTO public_api_cache (
           cache_key, source, resource_type, payload_json, content_hash,
           fetched_at, expires_at, stale_until
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(cache_key) DO UPDATE SET
           source = excluded.source,
           resource_type = excluded.resource_type,
           payload_json = excluded.payload_json,
           content_hash = excluded.content_hash,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at,
           stale_until = excluded.stale_until`,
      )
      .bind(
        key,
        source,
        resourceType,
        payloadJson,
        contentHash,
        entry.fetchedAt,
        entry.expiresAt,
        entry.staleUntil,
      )
      .run();

    try {
      await this.database
        .prepare(
          `DELETE FROM public_api_cache
           WHERE cache_key IN (
             SELECT cache_key
             FROM public_api_cache
             WHERE stale_until < ?1
             LIMIT 100
           )`,
        )
        .bind(entry.fetchedAt)
        .run();
    } catch {
      // Expired rows can be removed on a later write without affecting this result.
    }
  }
}

export type CacheReadStatus = "hit" | "miss" | "stale" | "bypass";

export type CacheReadResult<T> = {
  value: T;
  status: CacheReadStatus;
  expiresAt: number | null;
  isStale: boolean;
};

export async function readThroughPublicCache<T>(options: {
  cache?: PublicApiCache;
  key?: string;
  source: string;
  resourceType: string;
  ttlMs: number;
  staleTtlMs: number;
  load: () => Promise<T>;
  canUseStale?: (error: unknown) => boolean;
  now?: () => number;
}): Promise<CacheReadResult<T>> {
  const now = options.now ?? Date.now;
  if (!options.cache || !options.key) {
    return {
      value: await options.load(),
      status: "bypass",
      expiresAt: null,
      isStale: false,
    };
  }

  let cached: PublicApiCacheEntry<T> | null = null;
  try {
    cached = await options.cache.get<T>(options.key);
  } catch {
    // A cache outage must not turn a public API lookup into an application outage.
  }

  const checkedAt = now();
  if (cached && cached.expiresAt > checkedAt) {
    return {
      value: cached.value,
      status: "hit",
      expiresAt: cached.expiresAt,
      isStale: false,
    };
  }

  try {
    const value = await options.load();
    const fetchedAt = now();
    const entry: PublicApiCacheEntry<T> = {
      value,
      fetchedAt,
      expiresAt: fetchedAt + options.ttlMs,
      staleUntil: fetchedAt + options.staleTtlMs,
    };
    try {
      await options.cache.put(
        options.key,
        options.source,
        options.resourceType,
        entry,
      );
    } catch {
      // Returning fresh official data is more important than populating the cache.
    }
    return {
      value,
      status: "miss",
      expiresAt: entry.expiresAt,
      isStale: false,
    };
  } catch (error) {
    if (
      cached &&
      cached.staleUntil > checkedAt &&
      (options.canUseStale?.(error) ?? false)
    ) {
      return {
        value: cached.value,
        status: "stale",
        expiresAt: cached.expiresAt,
        isStale: true,
      };
    }
    throw error;
  }
}
