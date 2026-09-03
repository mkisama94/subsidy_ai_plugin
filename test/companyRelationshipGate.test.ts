import assert from "node:assert/strict";
import test from "node:test";
import { resolveCompanyRelationshipGate } from "../src/companyRelationshipGate";

const cachedRelation = {
  id: 1,
  parentCompanyId: 1,
  childCompanyId: 2,
  parentName: "株式会社トレジャー・ファクトリー",
  parentNormalizedName: "トレジャーファクトリー",
  childName: "株式会社トレファクテクノロジーズ",
  childNormalizedName: "トレファクテクノロジーズ",
  relationType: "subsidiary" as const,
  ownershipPercent: 100,
  indirectOwnershipPercent: null,
  isConsolidated: true,
  asOfDate: "2026-02-28",
  sourceDocumentId: "S100Y644",
  sourceSection: "関係会社の状況",
  sourceLocator: null,
  extractionMethod: "xbrl" as const,
  verificationStatus: "verified" as const,
  createdAt: "2026-09-03T00:00:00Z",
  updatedAt: "2026-09-03T00:00:00Z",
  parentCorporateNumber: "3011801014408",
  parentEdinetCode: "E03520",
  childCorporateNumber: "7010001224615",
  childEdinetCode: null,
  document: {
    filerName: "株式会社トレジャー・ファクトリー",
    documentType: "有価証券報告書",
    submittedAt: "2026-05-26T15:09:00+09:00",
    periodStart: "2025-03-01",
    periodEnd: "2026-02-28",
    sourceReference: "https://example.test/S100Y644",
  },
};

test("D1の検証済み関係をEDINET再照会より先に使用する", async () => {
  let verifierCalled = false;
  const repository = {
    async findParentRelationsByCorporateNumber() {
      return [cachedRelation];
    },
    async upsertCompany() {
      return { id: 1 };
    },
    async upsertEdinetDocument() {
      return { documentId: "S100Y644" };
    },
    async upsertCompanyRelation() {
      return { id: 1 };
    },
  };

  const result = await resolveCompanyRelationshipGate(
    {
      targetCompanyName: "株式会社トレファクテクノロジーズ",
      targetCorporateNumber: "7010001224615",
      parentCandidate: { name: "株式会社トレジャー・ファクトリー" },
    },
    "api-key",
    repository,
    async () => {
      verifierCalled = true;
      throw new Error("呼ばれない想定");
    },
  );

  assert.equal(result.status, "verified");
  assert.equal(result.source, "d1");
  assert.equal(result.riskLevel, "high");
  assert.equal(verifierCalled, false);
});

test("親会社候補をEDINETで確認できなければ要検証として止める", async () => {
  const repository = {
    async findParentRelationsByCorporateNumber() {
      return [];
    },
    async upsertCompany() {
      return { id: 1 };
    },
    async upsertEdinetDocument() {
      return { documentId: "unused" };
    },
    async upsertCompanyRelation() {
      return { id: 1 };
    },
  };
  const result = await resolveCompanyRelationshipGate(
    {
      targetCompanyName: "対象会社株式会社",
      targetCorporateNumber: "1000000000001",
      parentCandidate: { name: "親会社候補株式会社" },
    },
    "api-key",
    repository,
    async () =>
      ({
        query: {
          targetCompanyName: "対象会社株式会社",
          targetCorporateNumber: "1000000000001",
          parentCompanyName: "親会社候補株式会社",
          parentCorporateNumber: null,
          filingDate: null,
          documentId: null,
        },
        parent: null,
        filing: null,
        assessment: {
          status: "not_found_in_checked_filing",
          evidence: [],
          percentages: [],
        },
        retrievedAt: "2026-09-03T00:00:00Z",
      }) as never,
  );

  assert.equal(result.status, "needs_verification");
  assert.equal(result.source, "none");
  assert.equal(result.verifiedRelations.length, 0);
});

