-- Public official information only. Collection is independent of serving.
CREATE TABLE discovery_sources (
  id TEXT PRIMARY KEY, config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  revision INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL CHECK(status IN ('approved','paused')),
  next_refresh_at INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
  last_success_at INTEGER, last_attempt_at INTEGER, last_error TEXT,
  failures INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX discovery_sources_due ON discovery_sources(status,next_refresh_at);
CREATE TABLE discovery_fetch_runs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES discovery_sources(id),
  source_revision INTEGER NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','not_modified','failed','superseded')),
  error_code TEXT, count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE discovery_source_records (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES discovery_sources(id),
  url TEXT NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  mime_type TEXT NOT NULL, byte_length INTEGER NOT NULL CHECK(byte_length>0),
  retrieved_at INTEGER NOT NULL, last_verified_at INTEGER NOT NULL,
  etag TEXT, last_modified TEXT, extractor_version TEXT NOT NULL,
  UNIQUE(source_id,url,content_hash)
);
CREATE INDEX discovery_records_url ON discovery_source_records(source_id,url,last_verified_at);
CREATE TABLE discovery_candidates (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES discovery_sources(id),
  course_key TEXT NOT NULL, program_id INTEGER REFERENCES subsidy_programs(id),
  round_id INTEGER REFERENCES subsidy_rounds(id), jgrants_id TEXT,
  created_at INTEGER NOT NULL, UNIQUE(source_id,course_key)
);
CREATE UNIQUE INDEX discovery_confirmed_jgrants ON discovery_candidates(jgrants_id) WHERE jgrants_id IS NOT NULL;
CREATE TABLE discovery_candidate_versions (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id),
  run_id TEXT NOT NULL REFERENCES discovery_fetch_runs(id), source_revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), content_hash TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK(review_status IN ('pending','validated','rejected')),
  review_note TEXT, reviewed_at INTEGER, created_at INTEGER NOT NULL,
  UNIQUE(candidate_id,content_hash,source_revision)
);
CREATE INDEX discovery_versions_candidate ON discovery_candidate_versions(candidate_id,created_at);
CREATE TABLE discovery_evidence (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES discovery_candidate_versions(id),
  record_id TEXT NOT NULL REFERENCES discovery_source_records(id),
  field_path TEXT NOT NULL, locator TEXT NOT NULL, excerpt TEXT NOT NULL CHECK(length(excerpt)<=1000),
  verification TEXT NOT NULL CHECK(verification IN ('extracted','reviewed'))
);
CREATE TABLE discovery_aliases (
  candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id),
  term TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('alias','purpose')),
  PRIMARY KEY(candidate_id,term,kind)
);
CREATE INDEX discovery_alias_term ON discovery_aliases(term);
CREATE TABLE discovery_releases (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, note TEXT NOT NULL);
CREATE TABLE discovery_release_items (
  release_id TEXT NOT NULL REFERENCES discovery_releases(id),
  candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id),
  version_id TEXT NOT NULL REFERENCES discovery_candidate_versions(id),
  PRIMARY KEY(release_id,candidate_id)
);
CREATE TABLE discovery_active_release (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), release_id TEXT REFERENCES discovery_releases(id)
);
INSERT INTO discovery_active_release(singleton,release_id) VALUES(1,NULL);
-- Mutable observations are separate from immutable published versions.
CREATE TABLE discovery_document_jobs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES discovery_sources(id),
  source_revision INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','queued','processing','ready','needs_review','failed')),
  record_id TEXT REFERENCES discovery_source_records(id),
  fragments_json TEXT CHECK(fragments_json IS NULL OR json_valid(fragments_json)),
  next_refresh_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_seen_at INTEGER NOT NULL,
  UNIQUE(source_id,source_revision,url)
);
CREATE INDEX discovery_jobs_due ON discovery_document_jobs(next_refresh_at,status);
CREATE TABLE discovery_host_budget (
  hostname TEXT PRIMARY KEY, day TEXT NOT NULL, requests INTEGER NOT NULL,
  lease_token TEXT, lease_until INTEGER NOT NULL, next_at INTEGER NOT NULL
);
CREATE TABLE discovery_robots (
  hostname TEXT PRIMARY KEY, body TEXT NOT NULL, checked_at INTEGER NOT NULL
);
CREATE TABLE discovery_ai_budget (day TEXT PRIMARY KEY, calls INTEGER NOT NULL CHECK(calls>=0));
-- Do not overwrite a version after it has been included in any release.
CREATE TRIGGER discovery_immutable_payload BEFORE UPDATE OF payload_json,content_hash,source_revision ON discovery_candidate_versions
WHEN EXISTS(SELECT 1 FROM discovery_release_items WHERE version_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'published_version_is_immutable'); END;
