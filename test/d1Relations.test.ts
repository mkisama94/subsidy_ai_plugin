import assert from "node:assert/strict";
import test from "node:test";
import {
  createD1CompanyRelationsRepository,
  D1CompanyRelationsRepository,
  D1RelationsRepositoryError,
  normalizeCompanyNameForRelations,
} from "../src/d1Relations";

type PreparedCall = {
  query: string;
  bindings: unknown[];
};

class FakeD1Database {
  readonly calls: PreparedCall[] = [];
  firstResults: unknown[] = [];
  allResults: unknown[][] = [];
  error: Error | null = null;

  prepare(query: string) {
    const call: PreparedCall = { query, bindings: [] };
    this.calls.push(call);
    const database = this;
    const statement = {
      bind(...values: unknown[]) {
        call.bindings = values;
        return statement;
      },
      async first<T>() {
        if (database.error) throw database.error;
        return (database.firstResults.shift() ?? null) as T | null;
      },
      async all<T>() {
        if (database.error) throw database.error;
        return {
          success: true,
          results: (database.allResults.shift() ?? []) as T[],
          meta: {},
        };
      },
    };
    return statement;
  }

  asD1Database(): D1Database {
    return this as unknown as D1Database;
  }
}

const timestamps = {
  created_at: "2026-09-03T00:00:00.000Z",
  updated_at: "2026-09-03T00:00:00.000Z",
};

test("会社種別・空白・記号を除いて法人名を正規化する", () => {
  assert.equal(
    normalizeCompanyNameForRelations("株式会社Ｃｏ　ｃｒｅａｔｅ"),
    "cocreate",
  );
  assert.equal(
    normalizeCompanyNameForRelations("テスト・ホールディングス（株）"),
    "テストホールディングス株",
  );
});

test("企業を再実行可能なUPSERTで保存し、公開型へ変換する", async () => {
  const database = new FakeD1Database();
  database.firstResults.push({
    id: 1,
    corporate_number: "7010001224615",
    edinet_code: "E00001",
    securities_code: "30930",
    name: "株式会社トレジャー・ファクトリー",
    normalized_name: "トレジャーファクトリー",
    source_updated_at: "2026-06-30",
    ...timestamps,
  });
  const repository = new D1CompanyRelationsRepository(database.asD1Database());

  const company = await repository.upsertCompany({
    corporateNumber: "7010001224615",
    edinetCode: "E00001",
    securitiesCode: "30930",
    name: "株式会社トレジャー・ファクトリー",
    sourceUpdatedAt: "2026-06-30",
  });

  assert.equal(company.id, 1);
  assert.equal(company.corporateNumber, "7010001224615");
  assert.equal(company.normalizedName, "トレジャーファクトリー");
  assert.match(database.calls[0]!.query, /ON CONFLICT DO UPDATE/u);
  assert.deepEqual(database.calls[0]!.bindings, [
    "7010001224615",
    "E00001",
    "30930",
    "株式会社トレジャー・ファクトリー",
    "トレジャーファクトリー",
    "2026-06-30",
  ]);
});

test("EDINET文書の取得・解析状態を保存する", async () => {
  const database = new FakeD1Database();
  database.firstResults.push({
    doc_id: "S100TEST",
    filer_company_id: 1,
    filer_name: "株式会社トレジャー・ファクトリー",
    filer_corporate_number: "7010001224615",
    filer_edinet_code: "E00001",
    doc_type_code: "120",
    document_type: "有価証券報告書",
    submitted_at: "2026-05-26T10:00:00Z",
    period_start: "2025-03-01",
    period_end: "2026-02-28",
    source_reference: "https://disclosure.example/S100TEST",
    fetch_status: "parsed",
    fetched_at: "2026-09-03T00:00:00Z",
    parsed_at: "2026-09-03T00:00:01Z",
    error_message: null,
    ...timestamps,
  });
  const repository = new D1CompanyRelationsRepository(database.asD1Database());

  const document = await repository.upsertEdinetDocument({
    documentId: "S100TEST",
    filerCompanyId: 1,
    filerName: "株式会社トレジャー・ファクトリー",
    filerCorporateNumber: "7010001224615",
    filerEdinetCode: "E00001",
    documentTypeCode: "120",
    documentType: "有価証券報告書",
    submittedAt: "2026-05-26T10:00:00Z",
    periodStart: "2025-03-01",
    periodEnd: "2026-02-28",
    sourceReference: "https://disclosure.example/S100TEST",
    fetchStatus: "parsed",
    fetchedAt: "2026-09-03T00:00:00Z",
    parsedAt: "2026-09-03T00:00:01Z",
  });

  assert.equal(document.documentId, "S100TEST");
  assert.equal(document.fetchStatus, "parsed");
  assert.equal(document.errorMessage, null);
  assert.match(database.calls[0]!.query, /ON CONFLICT\(doc_id\)/u);
});

test("子会社の法人番号から検証済み親会社と根拠文書を取得する", async () => {
  const database = new FakeD1Database();
  database.allResults.push([
    {
      id: 10,
      parent_company_id: 1,
      child_company_id: 2,
      parent_name: "株式会社トレジャー・ファクトリー",
      parent_normalized_name: "トレジャーファクトリー",
      child_name: "株式会社トレファクテクノロジーズ",
      child_normalized_name: "トレファクテクノロジーズ",
      relation_type: "subsidiary",
      ownership_percent: 100,
      indirect_ownership_percent: 0,
      is_consolidated: 1,
      as_of_date: "2026-02-28",
      source_doc_id: "S100TEST",
      source_section: "関係会社の状況",
      source_locator: "関係会社の状況/トレファクテクノロジーズ",
      extraction_method: "xbrl",
      verification_status: "verified",
      parent_corporate_number: "7010001224615",
      parent_edinet_code: "E00001",
      child_corporate_number: "7010001224616",
      child_edinet_code: null,
      document_filer_name: "株式会社トレジャー・ファクトリー",
      document_type: "有価証券報告書",
      document_submitted_at: "2026-05-26T10:00:00Z",
      document_period_start: "2025-03-01",
      document_period_end: "2026-02-28",
      document_source_reference: "https://disclosure.example/S100TEST",
      ...timestamps,
    },
  ]);
  const repository = new D1CompanyRelationsRepository(database.asD1Database());

  const relations = await repository.findParentRelationsByCorporateNumber(
    "7010001224616",
  );

  assert.equal(relations.length, 1);
  assert.equal(relations[0]!.parentCorporateNumber, "7010001224615");
  assert.equal(relations[0]!.ownershipPercent, 100);
  assert.equal(relations[0]!.isConsolidated, true);
  assert.equal(relations[0]!.document.documentType, "有価証券報告書");
  assert.equal(relations[0]!.verificationStatus, "verified");
  assert.match(database.calls[0]!.query, /verification_status = 'verified'/u);
  assert.deepEqual(database.calls[0]!.bindings, ["7010001224616", 0, 20]);
});

test("企業関係をUPSERTして連結フラグをbooleanで返す", async () => {
  const database = new FakeD1Database();
  database.firstResults.push({
    id: 10,
    parent_company_id: 1,
    child_company_id: 2,
    parent_name: "親会社株式会社",
    parent_normalized_name: "親会社",
    child_name: "子会社株式会社",
    child_normalized_name: "子会社",
    relation_type: "subsidiary",
    ownership_percent: 100,
    indirect_ownership_percent: 0,
    is_consolidated: 1,
    as_of_date: "2026-03-31",
    source_doc_id: "S100TEST",
    source_section: "関係会社の状況",
    source_locator: "関係会社の状況/子会社",
    extraction_method: "xbrl",
    verification_status: "verified",
    ...timestamps,
  });
  const repository = new D1CompanyRelationsRepository(database.asD1Database());

  const relation = await repository.upsertCompanyRelation({
    parentCompanyId: 1,
    childCompanyId: 2,
    parentName: "親会社株式会社",
    childName: "子会社株式会社",
    ownershipPercent: 100,
    indirectOwnershipPercent: 0,
    isConsolidated: true,
    asOfDate: "2026-03-31",
    sourceDocumentId: "S100TEST",
    sourceLocator: "関係会社の状況/子会社",
    verificationStatus: "verified",
  });

  assert.equal(relation.isConsolidated, true);
  assert.equal(relation.ownershipPercent, 100);
  assert.equal(relation.verificationStatus, "verified");
  assert.match(database.calls[0]!.query, /ON CONFLICT\(/u);
  assert.deepEqual(database.calls[0]!.bindings.slice(0, 7), [
    1,
    2,
    "親会社株式会社",
    "親会社",
    "子会社株式会社",
    "子会社",
    "subsidiary",
  ]);
});

test("親会社の法人番号から未検証を含む子会社一覧を取得できる", async () => {
  const database = new FakeD1Database();
  database.allResults.push([]);
  const repository = new D1CompanyRelationsRepository(database.asD1Database());

  const relations = await repository.findSubsidiariesByCorporateNumber(
    "7010001224615",
    { includeUnverified: true, limit: 10 },
  );

  assert.deepEqual(relations, []);
  assert.match(database.calls[0]!.query, /parent\.corporate_number = \?/u);
  assert.deepEqual(database.calls[0]!.bindings, ["7010001224615", 1, 10]);
});

test("未設定D1はnullとし、不正入力とDB障害を区別する", async () => {
  assert.equal(createD1CompanyRelationsRepository(undefined), null);

  const invalidDatabase = new FakeD1Database();
  const invalidRepository = new D1CompanyRelationsRepository(
    invalidDatabase.asD1Database(),
  );
  await assert.rejects(
    () => invalidRepository.upsertCompany({ name: "識別子なし株式会社" }),
    (error: unknown) =>
      error instanceof D1RelationsRepositoryError &&
      error.code === "invalid_input",
  );
  assert.equal(invalidDatabase.calls.length, 0);

  const failedDatabase = new FakeD1Database();
  failedDatabase.error = new Error("internal SQL detail");
  const failedRepository = new D1CompanyRelationsRepository(
    failedDatabase.asD1Database(),
  );
  await assert.rejects(
    () =>
      failedRepository.findParentRelationsByCorporateNumber("7010001224616"),
    (error: unknown) =>
      error instanceof D1RelationsRepositoryError &&
      error.code === "database_error" &&
      !error.message.includes("internal SQL detail"),
  );
});
