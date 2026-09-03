CREATE TABLE IF NOT EXISTS public_api_cache (
  cache_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  stale_until INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_api_cache_expiry
  ON public_api_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_public_api_cache_stale_until
  ON public_api_cache(stale_until);
