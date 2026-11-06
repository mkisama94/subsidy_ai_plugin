ALTER TABLE public_fact_versions ADD COLUMN expired_at INTEGER;
CREATE INDEX public_versions_retention ON public_fact_versions(expired_at,observed_at);
