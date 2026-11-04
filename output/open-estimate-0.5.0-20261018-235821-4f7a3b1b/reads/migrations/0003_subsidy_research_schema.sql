1: -- 公開された補助金採択実績の出典・計算根拠を保存する。
2: -- PDFやWebページの全文、企業情報、利用者情報は保存しない。
3: 
4: CREATE TABLE IF NOT EXISTS subsidy_programs (
5:   id INTEGER PRIMARY KEY AUTOINCREMENT,
6:   program_series_key TEXT NOT NULL UNIQUE,
7:   canonical_name TEXT NOT NULL,
8:   institution_name TEXT,
9:   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
10:   updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
11: );
12: 
13: CREATE TABLE IF NOT EXISTS subsidy_rounds (
14:   id INTEGER PRIMARY KEY AUTOINCREMENT,
15:   program_id INTEGER NOT NULL,
16:   jgrants_subsidy_id TEXT,
17:   fiscal_year INTEGER NOT NULL,
18:   round_name TEXT NOT NULL,
19:   scope_key TEXT NOT NULL DEFAULT 'overall',
20:   acceptance_start TEXT,
21:   acceptance_end TEXT,
22:   budget_yen INTEGER,
23:   official_detail_url TEXT,
24:   last_checked_at TEXT NOT NULL,
25:   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
26:   updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
27:   FOREIGN KEY (program_id) REFERENCES subsidy_programs(id) ON DELETE CASCADE,
28:   UNIQUE (program_id, fiscal_year, round_name, scope_key),
29:   CHECK (budget_yen IS NULL OR budget_yen >= 0)
30: );
31: 
32: CREATE INDEX IF NOT EXISTS idx_subsidy_rounds_jgrants_id
33:   ON subsidy_rounds(jgrants_subsidy_id)
34:   WHERE jgrants_subsidy_id IS NOT NULL;
35: 
36: CREATE INDEX IF NOT EXISTS idx_subsidy_rounds_program_year
37:   ON subsidy_rounds(program_id, fiscal_year DESC, id DESC);
38: 
39: CREATE TABLE IF NOT EXISTS research_sources (
40:   id INTEGER PRIMARY KEY AUTOINCREMENT,
41:   source_type TEXT NOT NULL CHECK (source_type IN (
42:     'official_result',
43:     'official_report',
44:     'official_budget',
45:     'official_guideline',
46:     'government_statistics',
47:     'secondary_analysis'
48:   )),
49:   publisher TEXT NOT NULL,
50:   title TEXT NOT NULL,
51:   url TEXT NOT NULL,
52:   published_at TEXT,
53:   retrieved_at TEXT NOT NULL,
54:   content_hash TEXT NOT NULL,
55:   reliability TEXT NOT NULL CHECK (reliability IN ('high', 'medium', 'low')),
56:   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
57:   UNIQUE (url, content_hash)
58: );
59: 
60: CREATE TABLE IF NOT EXISTS subsidy_selection_statistics (
61:   id INTEGER PRIMARY KEY AUTOINCREMENT,
62:   subsidy_round_id INTEGER NOT NULL UNIQUE,
63:   applications_count INTEGER,
64:   selected_count INTEGER,
65:   denominator_label TEXT,
66:   numerator_label TEXT,
67:   comparability TEXT NOT NULL CHECK (comparability IN (
68:     'confirmed_same_round_and_scope',
69:     'not_confirmed',
70:     'not_comparable'
71:   )),
72:   official_rate REAL,
73:   estimated_rate_low REAL,
74:   estimated_rate_mid REAL,
75:   estimated_rate_high REAL,
76:   estimation_method TEXT,
77:   methodology_version TEXT,
78:   confidence TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
79:   basis_summary TEXT NOT NULL,
80:   estimate_basis_summary TEXT,
81:   as_of_date TEXT NOT NULL,
82:   expires_at TEXT,
83:   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
84:   updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
85:   FOREIGN KEY (subsidy_round_id) REFERENCES subsidy_rounds(id) ON DELETE CASCADE,
86:   CHECK (applications_count IS NULL OR applications_count >= 0),
87:   CHECK (selected_count IS NULL OR selected_count >= 0),
88:   CHECK (official_rate IS NULL OR official_rate BETWEEN 0 AND 1),
89:   CHECK (estimated_rate_low IS NULL OR estimated_rate_low BETWEEN 0 AND 1),
90:   CHECK (estimated_rate_mid IS NULL OR estimated_rate_mid BETWEEN 0 AND 1),
91:   CHECK (estimated_rate_high IS NULL OR estimated_rate_high BETWEEN 0 AND 1),
92:   CHECK (
93:     official_rate IS NULL OR (
94:       applications_count > 0
95:       AND selected_count IS NOT NULL
96:       AND selected_count <= applications_count
97:       AND comparability = 'confirmed_same_round_and_scope'
98:     )
99:   )
100: );
101: 
102: CREATE TABLE IF NOT EXISTS selection_statistic_sources (
103:   statistic_id INTEGER NOT NULL,
104:   source_id INTEGER NOT NULL,
105:   role TEXT NOT NULL CHECK (role IN (
106:     'applications_count',
107:     'selected_count',
108:     'both_counts',
109:     'budget',
110:     'methodology'
111:   )),
112:   PRIMARY KEY (statistic_id, source_id, role),
113:   FOREIGN KEY (statistic_id) REFERENCES subsidy_selection_statistics(id) ON DELETE CASCADE,
114:   FOREIGN KEY (source_id) REFERENCES research_sources(id) ON DELETE CASCADE
115: );
116: 
117: CREATE INDEX IF NOT EXISTS idx_selection_statistics_rate
118:   ON subsidy_selection_statistics(official_rate)
119:   WHERE official_rate IS NOT NULL;
120: 
121: CREATE INDEX IF NOT EXISTS idx_selection_statistic_sources_source
122:   ON selection_statistic_sources(source_id);