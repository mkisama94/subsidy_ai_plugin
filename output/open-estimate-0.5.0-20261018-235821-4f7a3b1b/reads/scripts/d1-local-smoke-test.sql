1: -- ローカルD1専用のスモークテストです。
2: -- 本番データベース（--remote）には適用しないでください。
3: 
4: DELETE FROM company_relations
5: WHERE source_doc_id = 'TEST-DOC-0001';
6: 
7: DELETE FROM edinet_documents
8: WHERE doc_id = 'TEST-DOC-0001';
9: 
10: DELETE FROM companies
11: WHERE corporate_number IN ('1000000000001', '1000000000002');
12: 
13: INSERT INTO companies (
14:   corporate_number,
15:   edinet_code,
16:   securities_code,
17:   name,
18:   normalized_name,
19:   source_updated_at
20: ) VALUES (
21:   '1000000000001',
22:   'E00001',
23:   '00010',
24:   'テスト親会社株式会社',
25:   'テスト親会社',
26:   '2026-09-03T00:00:00Z'
27: );
28: 
29: INSERT INTO companies (
30:   corporate_number,
31:   name,
32:   normalized_name,
33:   source_updated_at
34: ) VALUES (
35:   '1000000000002',
36:   'テスト子会社株式会社',
37:   'テスト子会社',
38:   '2026-09-03T00:00:00Z'
39: );
40: 
41: INSERT INTO edinet_documents (
42:   doc_id,
43:   filer_company_id,
44:   filer_name,
45:   filer_corporate_number,
46:   filer_edinet_code,
47:   doc_type_code,
48:   document_type,
49:   submitted_at,
50:   period_start,
51:   period_end,
52:   source_reference,
53:   fetch_status,
54:   fetched_at,
55:   parsed_at
56: ) VALUES (
57:   'TEST-DOC-0001',
58:   (SELECT id FROM companies WHERE corporate_number = '1000000000001'),
59:   'テスト親会社株式会社',
60:   '1000000000001',
61:   'E00001',
62:   '120',
63:   '有価証券報告書',
64:   '2026-06-30T00:00:00Z',
65:   '2025-04-01',
66:   '2026-03-31',
67:   'urn:test:edinet:TEST-DOC-0001',
68:   'parsed',
69:   '2026-09-03T00:00:00Z',
70:   '2026-09-03T00:00:00Z'
71: );
72: 
73: INSERT INTO company_relations (
74:   parent_company_id,
75:   child_company_id,
76:   parent_name,
77:   parent_normalized_name,
78:   child_name,
79:   child_normalized_name,
80:   relation_type,
81:   ownership_percent,
82:   indirect_ownership_percent,
83:   is_consolidated,
84:   as_of_date,
85:   source_doc_id,
86:   source_locator,
87:   extraction_method,
88:   verification_status
89: ) VALUES (
90:   (SELECT id FROM companies WHERE corporate_number = '1000000000001'),
91:   (SELECT id FROM companies WHERE corporate_number = '1000000000002'),
92:   'テスト親会社株式会社',
93:   'テスト親会社',
94:   'テスト子会社株式会社',
95:   'テスト子会社',
96:   'subsidiary',
97:   100.0,
98:   0.0,
99:   1,
100:   '2026-03-31',
101:   'TEST-DOC-0001',
102:   '関係会社の状況/テスト子会社',
103:   'xbrl',
104:   'verified'
105: );
106: 
107: -- 子会社の法人番号から、親会社と根拠文書を逆引きできることを確認します。
108: SELECT
109:   child.corporate_number AS child_corporate_number,
110:   relation.child_name,
111:   parent.corporate_number AS parent_corporate_number,
112:   relation.parent_name,
113:   relation.ownership_percent,
114:   relation.is_consolidated,
115:   relation.as_of_date,
116:   document.doc_id AS source_doc_id,
117:   document.document_type,
118:   relation.verification_status
119: FROM company_relations AS relation
120: LEFT JOIN companies AS child
121:   ON child.id = relation.child_company_id
122: LEFT JOIN companies AS parent
123:   ON parent.id = relation.parent_company_id
124: INNER JOIN edinet_documents AS document
125:   ON document.doc_id = relation.source_doc_id
126: WHERE child.corporate_number = '1000000000002';