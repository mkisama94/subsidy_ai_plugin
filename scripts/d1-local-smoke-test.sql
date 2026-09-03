-- ローカルD1専用のスモークテストです。
-- 本番データベース（--remote）には適用しないでください。

DELETE FROM company_relations
WHERE source_doc_id = 'TEST-DOC-0001';

DELETE FROM edinet_documents
WHERE doc_id = 'TEST-DOC-0001';

DELETE FROM companies
WHERE corporate_number IN ('1000000000001', '1000000000002');

INSERT INTO companies (
  corporate_number,
  edinet_code,
  securities_code,
  name,
  normalized_name,
  source_updated_at
) VALUES (
  '1000000000001',
  'E00001',
  '00010',
  'テスト親会社株式会社',
  'テスト親会社',
  '2026-09-03T00:00:00Z'
);

INSERT INTO companies (
  corporate_number,
  name,
  normalized_name,
  source_updated_at
) VALUES (
  '1000000000002',
  'テスト子会社株式会社',
  'テスト子会社',
  '2026-09-03T00:00:00Z'
);

INSERT INTO edinet_documents (
  doc_id,
  filer_company_id,
  filer_name,
  filer_corporate_number,
  filer_edinet_code,
  doc_type_code,
  document_type,
  submitted_at,
  period_start,
  period_end,
  source_reference,
  fetch_status,
  fetched_at,
  parsed_at
) VALUES (
  'TEST-DOC-0001',
  (SELECT id FROM companies WHERE corporate_number = '1000000000001'),
  'テスト親会社株式会社',
  '1000000000001',
  'E00001',
  '120',
  '有価証券報告書',
  '2026-06-30T00:00:00Z',
  '2025-04-01',
  '2026-03-31',
  'urn:test:edinet:TEST-DOC-0001',
  'parsed',
  '2026-09-03T00:00:00Z',
  '2026-09-03T00:00:00Z'
);

INSERT INTO company_relations (
  parent_company_id,
  child_company_id,
  parent_name,
  parent_normalized_name,
  child_name,
  child_normalized_name,
  relation_type,
  ownership_percent,
  indirect_ownership_percent,
  is_consolidated,
  as_of_date,
  source_doc_id,
  source_locator,
  extraction_method,
  verification_status
) VALUES (
  (SELECT id FROM companies WHERE corporate_number = '1000000000001'),
  (SELECT id FROM companies WHERE corporate_number = '1000000000002'),
  'テスト親会社株式会社',
  'テスト親会社',
  'テスト子会社株式会社',
  'テスト子会社',
  'subsidiary',
  100.0,
  0.0,
  1,
  '2026-03-31',
  'TEST-DOC-0001',
  '関係会社の状況/テスト子会社',
  'xbrl',
  'verified'
);

-- 子会社の法人番号から、親会社と根拠文書を逆引きできることを確認します。
SELECT
  child.corporate_number AS child_corporate_number,
  relation.child_name,
  parent.corporate_number AS parent_corporate_number,
  relation.parent_name,
  relation.ownership_percent,
  relation.is_consolidated,
  relation.as_of_date,
  document.doc_id AS source_doc_id,
  document.document_type,
  relation.verification_status
FROM company_relations AS relation
LEFT JOIN companies AS child
  ON child.id = relation.child_company_id
LEFT JOIN companies AS parent
  ON parent.id = relation.parent_company_id
INNER JOIN edinet_documents AS document
  ON document.doc_id = relation.source_doc_id
WHERE child.corporate_number = '1000000000002';
