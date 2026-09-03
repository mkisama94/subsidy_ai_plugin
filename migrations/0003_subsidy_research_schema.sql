-- 公開された補助金採択実績の出典・計算根拠を保存する。
-- PDFやWebページの全文、企業情報、利用者情報は保存しない。

CREATE TABLE IF NOT EXISTS subsidy_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_series_key TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,
  institution_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS subsidy_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL,
  jgrants_subsidy_id TEXT,
  fiscal_year INTEGER NOT NULL,
  round_name TEXT NOT NULL,
  scope_key TEXT NOT NULL DEFAULT 'overall',
  acceptance_start TEXT,
  acceptance_end TEXT,
  budget_yen INTEGER,
  official_detail_url TEXT,
  last_checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (program_id) REFERENCES subsidy_programs(id) ON DELETE CASCADE,
  UNIQUE (program_id, fiscal_year, round_name, scope_key),
  CHECK (budget_yen IS NULL OR budget_yen >= 0)
);

CREATE INDEX IF NOT EXISTS idx_subsidy_rounds_jgrants_id
  ON subsidy_rounds(jgrants_subsidy_id)
  WHERE jgrants_subsidy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subsidy_rounds_program_year
  ON subsidy_rounds(program_id, fiscal_year DESC, id DESC);

CREATE TABLE IF NOT EXISTS research_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'official_result',
    'official_report',
    'official_budget',
    'official_guideline',
    'government_statistics',
    'secondary_analysis'
  )),
  publisher TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  reliability TEXT NOT NULL CHECK (reliability IN ('high', 'medium', 'low')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (url, content_hash)
);

CREATE TABLE IF NOT EXISTS subsidy_selection_statistics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subsidy_round_id INTEGER NOT NULL UNIQUE,
  applications_count INTEGER,
  selected_count INTEGER,
  denominator_label TEXT,
  numerator_label TEXT,
  comparability TEXT NOT NULL CHECK (comparability IN (
    'confirmed_same_round_and_scope',
    'not_confirmed',
    'not_comparable'
  )),
  official_rate REAL,
  estimated_rate_low REAL,
  estimated_rate_mid REAL,
  estimated_rate_high REAL,
  estimation_method TEXT,
  methodology_version TEXT,
  confidence TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
  basis_summary TEXT NOT NULL,
  estimate_basis_summary TEXT,
  as_of_date TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (subsidy_round_id) REFERENCES subsidy_rounds(id) ON DELETE CASCADE,
  CHECK (applications_count IS NULL OR applications_count >= 0),
  CHECK (selected_count IS NULL OR selected_count >= 0),
  CHECK (official_rate IS NULL OR official_rate BETWEEN 0 AND 1),
  CHECK (estimated_rate_low IS NULL OR estimated_rate_low BETWEEN 0 AND 1),
  CHECK (estimated_rate_mid IS NULL OR estimated_rate_mid BETWEEN 0 AND 1),
  CHECK (estimated_rate_high IS NULL OR estimated_rate_high BETWEEN 0 AND 1),
  CHECK (
    official_rate IS NULL OR (
      applications_count > 0
      AND selected_count IS NOT NULL
      AND selected_count <= applications_count
      AND comparability = 'confirmed_same_round_and_scope'
    )
  )
);

CREATE TABLE IF NOT EXISTS selection_statistic_sources (
  statistic_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'applications_count',
    'selected_count',
    'both_counts',
    'budget',
    'methodology'
  )),
  PRIMARY KEY (statistic_id, source_id, role),
  FOREIGN KEY (statistic_id) REFERENCES subsidy_selection_statistics(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES research_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_selection_statistics_rate
  ON subsidy_selection_statistics(official_rate)
  WHERE official_rate IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_selection_statistic_sources_source
  ON selection_statistic_sources(source_id);
