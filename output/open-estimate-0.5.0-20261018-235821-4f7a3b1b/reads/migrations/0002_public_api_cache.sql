1: CREATE TABLE IF NOT EXISTS public_api_cache (
2:   cache_key TEXT PRIMARY KEY,
3:   source TEXT NOT NULL,
4:   resource_type TEXT NOT NULL,
5:   payload_json TEXT NOT NULL,
6:   content_hash TEXT NOT NULL,
7:   fetched_at INTEGER NOT NULL,
8:   expires_at INTEGER NOT NULL,
9:   stale_until INTEGER NOT NULL
10: );
11: 
12: CREATE INDEX IF NOT EXISTS idx_public_api_cache_expiry
13:   ON public_api_cache(expires_at);
14: 
15: CREATE INDEX IF NOT EXISTS idx_public_api_cache_stale_until
16:   ON public_api_cache(stale_until);