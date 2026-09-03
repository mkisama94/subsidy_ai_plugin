-- 日本の補助金・公的支援検索
-- EDINET由来の企業関係を、根拠文書とともに保持するための初期スキーマ。
--
-- 設計方針:
--   * EDINETの原本は公式APIを正とし、D1には検索・検証に必要な正規化情報を保存する。
--   * EDINETの関係会社情報では法人番号が得られない場合があるため、企業IDは任意とする。
--   * 企業関係には必ず根拠となるEDINET文書を紐付ける。

PRAGMA foreign_keys = ON;

CREATE TABLE companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corporate_number TEXT UNIQUE,
  edinet_code TEXT UNIQUE,
  securities_code TEXT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  source_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  CHECK (corporate_number IS NULL OR length(corporate_number) = 13),
  CHECK (edinet_code IS NULL OR length(edinet_code) > 0),
  CHECK (length(trim(name)) > 0),
  CHECK (length(trim(normalized_name)) > 0)
);

CREATE INDEX idx_companies_normalized_name
  ON companies(normalized_name);

CREATE INDEX idx_companies_securities_code
  ON companies(securities_code)
  WHERE securities_code IS NOT NULL;

CREATE TABLE edinet_documents (
  doc_id TEXT PRIMARY KEY,
  filer_company_id INTEGER,
  filer_name TEXT NOT NULL,
  filer_corporate_number TEXT,
  filer_edinet_code TEXT,
  doc_type_code TEXT,
  document_type TEXT,
  submitted_at TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  source_reference TEXT NOT NULL,
  fetch_status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (fetch_status IN ('discovered', 'fetched', 'parsed', 'failed')),
  fetched_at TEXT,
  parsed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  FOREIGN KEY (filer_company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CHECK (length(trim(doc_id)) > 0),
  CHECK (length(trim(filer_name)) > 0),
  CHECK (filer_corporate_number IS NULL OR length(filer_corporate_number) = 13),
  CHECK (length(trim(source_reference)) > 0)
);

CREATE INDEX idx_edinet_documents_filer_company
  ON edinet_documents(filer_company_id);

CREATE INDEX idx_edinet_documents_filer_corporate_number
  ON edinet_documents(filer_corporate_number)
  WHERE filer_corporate_number IS NOT NULL;

CREATE INDEX idx_edinet_documents_filer_edinet_code
  ON edinet_documents(filer_edinet_code)
  WHERE filer_edinet_code IS NOT NULL;

CREATE INDEX idx_edinet_documents_submitted_at
  ON edinet_documents(submitted_at DESC);

CREATE TABLE company_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_company_id INTEGER,
  child_company_id INTEGER,
  parent_name TEXT NOT NULL,
  parent_normalized_name TEXT NOT NULL,
  child_name TEXT NOT NULL,
  child_normalized_name TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'subsidiary'
    CHECK (relation_type IN ('parent', 'subsidiary', 'affiliate', 'other')),
  ownership_percent REAL,
  indirect_ownership_percent REAL,
  is_consolidated INTEGER
    CHECK (is_consolidated IS NULL OR is_consolidated IN (0, 1)),
  as_of_date TEXT,
  source_doc_id TEXT NOT NULL,
  source_section TEXT NOT NULL DEFAULT '関係会社の状況',
  source_locator TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'xbrl'
    CHECK (extraction_method IN ('xbrl', 'document_text', 'manual')),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  FOREIGN KEY (parent_company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (child_company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (source_doc_id) REFERENCES edinet_documents(doc_id) ON DELETE CASCADE,
  CHECK (length(trim(parent_name)) > 0),
  CHECK (length(trim(parent_normalized_name)) > 0),
  CHECK (length(trim(child_name)) > 0),
  CHECK (length(trim(child_normalized_name)) > 0),
  CHECK (ownership_percent IS NULL OR ownership_percent BETWEEN 0 AND 100),
  CHECK (
    indirect_ownership_percent IS NULL
    OR indirect_ownership_percent BETWEEN 0 AND 100
  ),
  UNIQUE (
    source_doc_id,
    parent_normalized_name,
    child_normalized_name,
    relation_type
  )
);

CREATE INDEX idx_company_relations_parent_company
  ON company_relations(parent_company_id);

CREATE INDEX idx_company_relations_child_company
  ON company_relations(child_company_id);

CREATE INDEX idx_company_relations_parent_name
  ON company_relations(parent_normalized_name);

CREATE INDEX idx_company_relations_child_name
  ON company_relations(child_normalized_name);

CREATE INDEX idx_company_relations_source_doc
  ON company_relations(source_doc_id);

CREATE INDEX idx_company_relations_as_of_date
  ON company_relations(as_of_date DESC)
  WHERE as_of_date IS NOT NULL;
