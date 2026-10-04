-- Public link metadata only. No file bodies, company inputs or end-user identities.
CREATE TABLE official_document_sources (
  id TEXT PRIMARY KEY,
  subsidy_round_id INTEGER NOT NULL REFERENCES subsidy_rounds(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('official_html','jgrants_detail')),
  source_page_url TEXT NOT NULL, fetch_url TEXT NOT NULL, publisher_name TEXT NOT NULL,
  jgrants_workflow_id TEXT,
  registration_status TEXT NOT NULL CHECK(registration_status IN ('pending','approved','paused','revoked')),
  trust_evidence_url TEXT NOT NULL, trust_evidence_note TEXT NOT NULL,
  approved_at TEXT, approval_revision INTEGER NOT NULL CHECK(approval_revision > 0),
  round_binding_hash TEXT NOT NULL CHECK(length(round_binding_hash)=64),
  fetch_policy_json TEXT NOT NULL CHECK(json_valid(fetch_policy_json)),
  extractor_config_json TEXT NOT NULL CHECK(json_valid(extractor_config_json)),
  active_run_id TEXT REFERENCES document_discovery_runs(id) ON DELETE RESTRICT,
  last_attempt_at TEXT, last_success_at TEXT, last_attempt_status TEXT, last_error_code TEXT,
  next_refresh_at TEXT NOT NULL, failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
  lease_token TEXT, lease_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(subsidy_round_id,source_kind,fetch_url),
  CHECK(registration_status <> 'approved' OR approved_at IS NOT NULL)
);
CREATE INDEX idx_document_sources_due ON official_document_sources(registration_status,next_refresh_at);
CREATE INDEX idx_document_sources_round ON official_document_sources(subsidy_round_id);
CREATE TABLE document_discovery_runs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES official_document_sources(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','not_modified','partial','failed','superseded')),
  started_at TEXT NOT NULL, finished_at TEXT, source_observed_at TEXT,
  http_status INTEGER, final_url TEXT, page_body_hash TEXT, link_set_hash TEXT,
  etag TEXT, last_modified TEXT, extractor_version TEXT NOT NULL,
  approval_revision INTEGER NOT NULL, round_binding_hash TEXT NOT NULL,
  extraction_complete INTEGER NOT NULL DEFAULT 0 CHECK(extraction_complete IN (0,1)),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_count >= 0),
  published_count INTEGER NOT NULL DEFAULT 0 CHECK(published_count >= 0),
  unclassified_count INTEGER NOT NULL DEFAULT 0 CHECK(unclassified_count >= 0),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(warnings_json)), error_code TEXT,
  request_count INTEGER NOT NULL DEFAULT 0, ai_call_count INTEGER NOT NULL DEFAULT 0,
  ai_usage_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(ai_usage_json))
);
CREATE INDEX idx_document_runs_source ON document_discovery_runs(source_id,started_at DESC);
CREATE INDEX idx_document_runs_day ON document_discovery_runs(started_at);
-- Immutable typed metadata is stored as JSON; indexed fields have dedicated columns.
CREATE TABLE official_documents (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES document_discovery_runs(id) ON DELETE CASCADE,
  document_key TEXT NOT NULL, classification_input_hash TEXT NOT NULL,
  classification_status TEXT NOT NULL, metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  UNIQUE(run_id,document_key)
);
CREATE INDEX idx_documents_classification ON official_documents(classification_input_hash,classification_status);
CREATE INDEX idx_documents_key ON official_documents(document_key);
CREATE TABLE subsidy_round_documents (
  subsidy_round_id INTEGER NOT NULL REFERENCES subsidy_rounds(id) ON DELETE RESTRICT,
  document_id TEXT NOT NULL REFERENCES official_documents(id) ON DELETE CASCADE,
  association_status TEXT NOT NULL CHECK(association_status IN ('confirmed','needs_review','mismatch')),
  association_basis TEXT NOT NULL, round_label_original TEXT, scope_label_original TEXT,
  stage TEXT NOT NULL, context_excerpt TEXT NOT NULL, section_locator TEXT NOT NULL,
  association_checked_at TEXT,
  PRIMARY KEY(subsidy_round_id,document_id)
);
CREATE TRIGGER document_active_run_guard BEFORE UPDATE OF active_run_id ON official_document_sources
WHEN NEW.active_run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM document_discovery_runs WHERE id=NEW.active_run_id AND source_id=NEW.id
    AND status IN ('succeeded','not_modified') AND extraction_complete=1
    AND approval_revision=NEW.approval_revision AND round_binding_hash=NEW.round_binding_hash
)
BEGIN SELECT RAISE(ABORT,'invalid document snapshot'); END;
