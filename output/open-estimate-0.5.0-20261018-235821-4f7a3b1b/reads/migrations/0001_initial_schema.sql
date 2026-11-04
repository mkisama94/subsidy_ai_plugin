1: -- 日本の補助金・公的支援検索
2: -- EDINET由来の企業関係を、根拠文書とともに保持するための初期スキーマ。
3: --
4: -- 設計方針:
5: --   * EDINETの原本は公式APIを正とし、D1には検索・検証に必要な正規化情報を保存する。
6: --   * EDINETの関係会社情報では法人番号が得られない場合があるため、企業IDは任意とする。
7: --   * 企業関係には必ず根拠となるEDINET文書を紐付ける。
8: 
9: PRAGMA foreign_keys = ON;
10: 
11: CREATE TABLE companies (
12:   id INTEGER PRIMARY KEY AUTOINCREMENT,
13:   corporate_number TEXT UNIQUE,
14:   edinet_code TEXT UNIQUE,
15:   securities_code TEXT,
16:   name TEXT NOT NULL,
17:   normalized_name TEXT NOT NULL,
18:   source_updated_at TEXT,
19:   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
20:   updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
21: 
22:   CHECK (corporate_number IS NULL OR length(corporate_number) = 13),
23:   CHECK (edinet_code IS NULL OR length(edinet_code) > 0),
24:   CHECK (length(trim(name)) > 0),
25:   CHECK (length(trim(normalized_name)) > 0)
26: );
27: 
28: CREATE INDEX idx_companies_normalized_name
29:   ON companies(normalized_name);
30: 
31: CREATE INDEX idx_companies_securities_code
32:   ON companies(securities_code)
33:   WHERE securities_code IS NOT NULL;
34: 
35: CREATE TABLE edinet_documents (
36:   doc_id TEXT PRIMARY KEY,
37:   filer_company_id INTEGER,
38:   filer_name TEXT NOT NULL,
39:   filer_corporate_number TEXT,
40:   filer_edinet_code TEXT,
41:   doc_type_code TEXT,
42:   document_type TEXT,
43:   submitted_at TEXT NOT NULL,
44:   period_start TEXT,
45:   period_end TEXT,
46:   source_reference TEXT NOT NULL,
47:   fetch_status TEXT NOT NULL DEFAULT 'discovered'
48:     CHECK (fetch_status IN ('discovered', 'fetched', 'parsed', 'failed')),
49:   fetched_at TEXT,
50:   parsed_at TEXT,
51:   error_message TEXT,
52:   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
53:   updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
54: 
55:   FOREIGN KEY (filer_company_id) REFERENCES companies(id) ON DELETE SET NULL,
56:   CHECK (length(trim(doc_id)) > 0),
57:   CHECK (length(trim(filer_name)) > 0),
58:   CHECK (filer_corporate_number IS NULL OR length(filer_corporate_number) = 13),
59:   CHECK (length(trim(source_reference)) > 0)
60: );
61: 
62: CREATE INDEX idx_edinet_documents_filer_company
63:   ON edinet_documents(filer_company_id);
64: 
65: CREATE INDEX idx_edinet_documents_filer_corporate_number
66:   ON edinet_documents(filer_corporate_number)
67:   WHERE filer_corporate_number IS NOT NULL;
68: 
69: CREATE INDEX idx_edinet_documents_filer_edinet_code
70:   ON edinet_documents(filer_edinet_code)
71:   WHERE filer_edinet_code IS NOT NULL;
72: 
73: CREATE INDEX idx_edinet_documents_submitted_at
74:   ON edinet_documents(submitted_at DESC);
75: 
76: CREATE TABLE company_relations (
77:   id INTEGER PRIMARY KEY AUTOINCREMENT,
78:   parent_company_id INTEGER,
79:   child_company_id INTEGER,
80:   parent_name TEXT NOT NULL,
81:   parent_normalized_name TEXT NOT NULL,
82:   child_name TEXT NOT NULL,
83:   child_normalized_name TEXT NOT NULL,
84:   relation_type TEXT NOT NULL DEFAULT 'subsidiary'
85:     CHECK (relation_type IN ('parent', 'subsidiary', 'affiliate', 'other')),
86:   ownership_percent REAL,
87:   indirect_ownership_percent REAL,
88:   is_consolidated INTEGER
89:     CHECK (is_consolidated IS NULL OR is_consolidated IN (0, 1)),
90:   as_of_date TEXT,
91:   source_doc_id TEXT NOT NULL,
92:   source_section TEXT NOT NULL DEFAULT '関係会社の状況',
93:   source_locator TEXT,
94:   extraction_method TEXT NOT NULL DEFAULT 'xbrl'
95:     CHECK (extraction_method IN ('xbrl', 'document_text', 'manual')),
96:   verification_status TEXT NOT NULL DEFAULT 'unverified'
97:     CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
98:   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
99:   updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
100: 
101:   FOREIGN KEY (parent_company_id) REFERENCES companies(id) ON DELETE SET NULL,
102:   FOREIGN KEY (child_company_id) REFERENCES companies(id) ON DELETE SET NULL,
103:   FOREIGN KEY (source_doc_id) REFERENCES edinet_documents(doc_id) ON DELETE CASCADE,
104:   CHECK (length(trim(parent_name)) > 0),
105:   CHECK (length(trim(parent_normalized_name)) > 0),
106:   CHECK (length(trim(child_name)) > 0),
107:   CHECK (length(trim(child_normalized_name)) > 0),
108:   CHECK (ownership_percent IS NULL OR ownership_percent BETWEEN 0 AND 100),
109:   CHECK (
110:     indirect_ownership_percent IS NULL
111:     OR indirect_ownership_percent BETWEEN 0 AND 100
112:   ),
113:   UNIQUE (
114:     source_doc_id,
115:     parent_normalized_name,
116:     child_normalized_name,
117:     relation_type
118:   )
119: );
120: 
121: CREATE INDEX idx_company_relations_parent_company
122:   ON company_relations(parent_company_id);
123: 
124: CREATE INDEX idx_company_relations_child_company
125:   ON company_relations(child_company_id);
126: 
127: CREATE INDEX idx_company_relations_parent_name
128:   ON company_relations(parent_normalized_name);
129: 
130: CREATE INDEX idx_company_relations_child_name
131:   ON company_relations(child_normalized_name);
132: 
133: CREATE INDEX idx_company_relations_source_doc
134:   ON company_relations(source_doc_id);
135: 
136: CREATE INDEX idx_company_relations_as_of_date
137:   ON company_relations(as_of_date DESC)
138:   WHERE as_of_date IS NOT NULL;