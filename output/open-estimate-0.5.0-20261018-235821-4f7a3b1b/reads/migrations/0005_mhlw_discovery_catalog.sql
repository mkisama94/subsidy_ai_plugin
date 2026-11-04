1: -- Public official information only. Collection is independent of serving.
2: CREATE TABLE discovery_sources (
3:   id TEXT PRIMARY KEY, config_json TEXT NOT NULL CHECK(json_valid(config_json)),
4:   revision INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL CHECK(status IN ('approved','paused')),
5:   next_refresh_at INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
6:   last_success_at INTEGER, last_attempt_at INTEGER, last_error TEXT,
7:   failures INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
8: );
9: CREATE INDEX discovery_sources_due ON discovery_sources(status,next_refresh_at);
10: CREATE TABLE discovery_fetch_runs (
11:   id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES discovery_sources(id),
12:   source_revision INTEGER NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,
13:   status TEXT NOT NULL CHECK(status IN ('running','succeeded','not_modified','failed','superseded')),
14:   error_code TEXT, count INTEGER NOT NULL DEFAULT 0
15: );
16: CREATE TABLE discovery_source_records (
17:   id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES discovery_sources(id),
18:   url TEXT NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
19:   mime_type TEXT NOT NULL, byte_length INTEGER NOT NULL CHECK(byte_length>0),
20:   retrieved_at INTEGER NOT NULL, last_verified_at INTEGER NOT NULL,
21:   etag TEXT, last_modified TEXT, extractor_version TEXT NOT NULL,
22:   UNIQUE(source_id,url,content_hash)
23: );
24: CREATE INDEX discovery_records_url ON discovery_source_records(source_id,url,last_verified_at);
25: CREATE TABLE discovery_candidates (
26:   id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES discovery_sources(id),
27:   course_key TEXT NOT NULL, program_id INTEGER REFERENCES subsidy_programs(id),
28:   round_id INTEGER REFERENCES subsidy_rounds(id), jgrants_id TEXT,
29:   created_at INTEGER NOT NULL, UNIQUE(source_id,course_key)
30: );
31: CREATE UNIQUE INDEX discovery_confirmed_jgrants ON discovery_candidates(jgrants_id) WHERE jgrants_id IS NOT NULL;
32: CREATE TABLE discovery_candidate_versions (
33:   id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id),
34:   run_id TEXT NOT NULL REFERENCES discovery_fetch_runs(id), source_revision INTEGER NOT NULL,
35:   payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), content_hash TEXT NOT NULL,
36:   review_status TEXT NOT NULL CHECK(review_status IN ('pending','validated','rejected')),
37:   review_note TEXT, reviewed_at INTEGER, created_at INTEGER NOT NULL,
38:   UNIQUE(candidate_id,content_hash,source_revision)
39: );
40: CREATE INDEX discovery_versions_candidate ON discovery_candidate_versions(candidate_id,created_at);
41: CREATE TABLE discovery_evidence (
42:   id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES discovery_candidate_versions(id),
43:   record_id TEXT NOT NULL REFERENCES discovery_source_records(id),
44:   field_path TEXT NOT NULL, locator TEXT NOT NULL, excerpt TEXT NOT NULL CHECK(length(excerpt)<=1000),
45:   verification TEXT NOT NULL CHECK(verification IN ('extracted','reviewed'))
46: );
47: CREATE TABLE discovery_aliases (
48:   candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id),
49:   term TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('alias','purpose')),
50:   PRIMARY KEY(candidate_id,term,kind)
51: );
52: CREATE INDEX discovery_alias_term ON discovery_aliases(term);
53: CREATE TABLE discovery_releases (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, note TEXT NOT NULL);
54: CREATE TABLE discovery_release_items (
55:   release_id TEXT NOT NULL REFERENCES discovery_releases(id),
56:   candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id),
57:   version_id TEXT NOT NULL REFERENCES discovery_candidate_versions(id),
58:   PRIMARY KEY(release_id,candidate_id)
59: );
60: CREATE TABLE discovery_active_release (
61:   singleton INTEGER PRIMARY KEY CHECK(singleton=1), release_id TEXT REFERENCES discovery_releases(id)
62: );
63: INSERT INTO discovery_active_release(singleton,release_id) VALUES(1,NULL);
64: -- Mutable observations are separate from immutable published versions.
65: CREATE TABLE discovery_document_jobs (
66:   id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES discovery_sources(id),
67:   source_revision INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
68:   status TEXT NOT NULL CHECK(status IN ('pending','queued','processing','ready','needs_review','failed')),
69:   record_id TEXT REFERENCES discovery_source_records(id),
70:   fragments_json TEXT CHECK(fragments_json IS NULL OR json_valid(fragments_json)),
71:   next_refresh_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER,
72:   attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_seen_at INTEGER NOT NULL,
73:   UNIQUE(source_id,source_revision,url)
74: );
75: CREATE INDEX discovery_jobs_due ON discovery_document_jobs(next_refresh_at,status);
76: CREATE TABLE discovery_host_budget (
77:   hostname TEXT PRIMARY KEY, day TEXT NOT NULL, requests INTEGER NOT NULL,
78:   lease_token TEXT, lease_until INTEGER NOT NULL, next_at INTEGER NOT NULL
79: );
80: CREATE TABLE discovery_robots (
81:   hostname TEXT PRIMARY KEY, body TEXT NOT NULL, checked_at INTEGER NOT NULL
82: );
83: CREATE TABLE discovery_ai_budget (day TEXT PRIMARY KEY, calls INTEGER NOT NULL CHECK(calls>=0));
84: -- Do not overwrite a version after it has been included in any release.
85: CREATE TRIGGER discovery_immutable_payload BEFORE UPDATE OF payload_json,content_hash,source_revision ON discovery_candidate_versions
86: WHEN EXISTS(SELECT 1 FROM discovery_release_items WHERE version_id=OLD.id)
87: BEGIN SELECT RAISE(ABORT,'published_version_is_immutable'); END;