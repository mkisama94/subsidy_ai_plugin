1: -- Public link metadata only. No file bodies, company inputs or end-user identities.
2: CREATE TABLE official_document_sources (
3:   id TEXT PRIMARY KEY,
4:   subsidy_round_id INTEGER NOT NULL REFERENCES subsidy_rounds(id) ON DELETE RESTRICT,
5:   source_kind TEXT NOT NULL CHECK(source_kind IN ('official_html','jgrants_detail')),
6:   source_page_url TEXT NOT NULL, fetch_url TEXT NOT NULL, publisher_name TEXT NOT NULL,
7:   jgrants_workflow_id TEXT,
8:   registration_status TEXT NOT NULL CHECK(registration_status IN ('pending','approved','paused','revoked')),
9:   trust_evidence_url TEXT NOT NULL, trust_evidence_note TEXT NOT NULL,
10:   approved_at TEXT, approval_revision INTEGER NOT NULL CHECK(approval_revision > 0),
11:   round_binding_hash TEXT NOT NULL CHECK(length(round_binding_hash)=64),
12:   fetch_policy_json TEXT NOT NULL CHECK(json_valid(fetch_policy_json)),
13:   extractor_config_json TEXT NOT NULL CHECK(json_valid(extractor_config_json)),
14:   active_run_id TEXT REFERENCES document_discovery_runs(id) ON DELETE RESTRICT,
15:   last_attempt_at TEXT, last_success_at TEXT, last_attempt_status TEXT, last_error_code TEXT,
16:   next_refresh_at TEXT NOT NULL, failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
17:   lease_token TEXT, lease_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
18:   UNIQUE(subsidy_round_id,source_kind,fetch_url),
19:   CHECK(registration_status <> 'approved' OR approved_at IS NOT NULL)
20: );
21: CREATE INDEX idx_document_sources_due ON official_document_sources(registration_status,next_refresh_at);
22: CREATE INDEX idx_document_sources_round ON official_document_sources(subsidy_round_id);
23: CREATE TABLE document_discovery_runs (
24:   id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES official_document_sources(id) ON DELETE RESTRICT,
25:   status TEXT NOT NULL CHECK(status IN ('running','succeeded','not_modified','partial','failed','superseded')),
26:   started_at TEXT NOT NULL, finished_at TEXT, source_observed_at TEXT,
27:   http_status INTEGER, final_url TEXT, page_body_hash TEXT, link_set_hash TEXT,
28:   etag TEXT, last_modified TEXT, extractor_version TEXT NOT NULL,
29:   approval_revision INTEGER NOT NULL, round_binding_hash TEXT NOT NULL,
30:   extraction_complete INTEGER NOT NULL DEFAULT 0 CHECK(extraction_complete IN (0,1)),
31:   candidate_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_count >= 0),
32:   published_count INTEGER NOT NULL DEFAULT 0 CHECK(published_count >= 0),
33:   unclassified_count INTEGER NOT NULL DEFAULT 0 CHECK(unclassified_count >= 0),
34:   warnings_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(warnings_json)), error_code TEXT,
35:   request_count INTEGER NOT NULL DEFAULT 0, ai_call_count INTEGER NOT NULL DEFAULT 0,
36:   ai_usage_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(ai_usage_json))
37: );
38: CREATE INDEX idx_document_runs_source ON document_discovery_runs(source_id,started_at DESC);
39: CREATE INDEX idx_document_runs_day ON document_discovery_runs(started_at);
40: -- Immutable typed metadata is stored as JSON; indexed fields have dedicated columns.
41: CREATE TABLE official_documents (
42:   id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES document_discovery_runs(id) ON DELETE CASCADE,
43:   document_key TEXT NOT NULL, classification_input_hash TEXT NOT NULL,
44:   classification_status TEXT NOT NULL, metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
45:   UNIQUE(run_id,document_key)
46: );
47: CREATE INDEX idx_documents_classification ON official_documents(classification_input_hash,classification_status);
48: CREATE INDEX idx_documents_key ON official_documents(document_key);
49: CREATE TABLE subsidy_round_documents (
50:   subsidy_round_id INTEGER NOT NULL REFERENCES subsidy_rounds(id) ON DELETE RESTRICT,
51:   document_id TEXT NOT NULL REFERENCES official_documents(id) ON DELETE CASCADE,
52:   association_status TEXT NOT NULL CHECK(association_status IN ('confirmed','needs_review','mismatch')),
53:   association_basis TEXT NOT NULL, round_label_original TEXT, scope_label_original TEXT,
54:   stage TEXT NOT NULL, context_excerpt TEXT NOT NULL, section_locator TEXT NOT NULL,
55:   association_checked_at TEXT,
56:   PRIMARY KEY(subsidy_round_id,document_id)
57: );
58: CREATE TRIGGER document_active_run_guard BEFORE UPDATE OF active_run_id ON official_document_sources
59: WHEN NEW.active_run_id IS NOT NULL AND NOT EXISTS (
60:   SELECT 1 FROM document_discovery_runs WHERE id=NEW.active_run_id AND source_id=NEW.id
61:     AND status IN ('succeeded','not_modified') AND extraction_complete=1
62:     AND approval_revision=NEW.approval_revision AND round_binding_hash=NEW.round_binding_hash
63: )
64: BEGIN SELECT RAISE(ABORT,'invalid document snapshot'); END;