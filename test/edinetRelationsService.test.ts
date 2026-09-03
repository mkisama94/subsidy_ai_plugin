import assert from "node:assert/strict";
import test from "node:test";
import type {
  CompanyInput,
  CompanyRelationInput,
  EdinetDocumentInput,
} from "../src/d1Relations";
import {
  type CompanyRelationsWriter,
  type CorporateRelationshipVerifier,
  verifyAndStoreCorporateRelationship,
} from "../src/edinetRelationsService";

const input = {
  targetCompanyName: "株式会社トレファクテクノロジーズ",
  targetCorporateNumber: "7010001224615",
  parentCompanyName: "株式会社トレジャー・ファクトリー",
  parentCorporateNumber: "3010001067815",
  filingDate: "2026-05-26",
};

function confirmedVerifier(): CorporateRelationshipVerifier {
  return (async () => ({
    source: {
      name: "EDINET（金融庁）",
      apiDocumentationUrl: "https://example.test/edinet",
    },
    retrievedAt: "2026-09-03T10:00:00.000Z",
    query: input,
    parent: {
      edinetCode: "E03520",
      name: "株式会社トレジャー・ファクトリー",
      nameEnglish: null,
      corporateNumber: "3010001067815",
      securitiesCode: "30930",
      fiscalYearEnd: "2月末日",
      location: "東京都",
    },
    filing: {
      documentId: "S100Y644",
      filerName: "株式会社トレジャー・ファクトリー",
      description: "有価証券報告書",
      submittedAt: "2026-05-26 10:00",
      periodStart: "2025-03-01",
      periodEnd: "2026-02-28",
      checkedDateRange: { from: "2026-05-26", to: "2026-05-26", count: 1 },
    },
    assessment: {
      status: "confirmed",
      reason: "確認しました。",
      percentages: ["100%"],
      evidence: [
        {
          file: "XBRL_TO_CSV/report.csv",
          itemId: "jpcrp_cor:OverviewOfAffiliatedEntitiesTextBlock",
          itemName: "関係会社の状況",
          snippet:
            "連結子会社 株式会社トレファクテクノロジーズ 議決権所有割合100%",
        },
      ],
    },
    largeEnterpriseAffiliation: {
      requiresGuidelineReview: true,
      note: "公募要領の確認が必要です。",
    },
    caution: "申請資格を保証しません。",
  })) as CorporateRelationshipVerifier;
}

class RecordingWriter implements CompanyRelationsWriter {
  readonly companies: CompanyInput[] = [];
  readonly documents: EdinetDocumentInput[] = [];
  readonly relations: CompanyRelationInput[] = [];

  async upsertCompany(value: CompanyInput) {
    this.companies.push(value);
    return { id: this.companies.length };
  }

  async upsertEdinetDocument(value: EdinetDocumentInput) {
    this.documents.push(value);
    return { documentId: value.documentId };
  }

  async upsertCompanyRelation(value: CompanyRelationInput) {
    this.relations.push(value);
    return { id: 10 };
  }
}

test("confirmedのみをEDINET文書と検証済み企業関係として保存する", async () => {
  const writer = new RecordingWriter();

  const result = await verifyAndStoreCorporateRelationship(
    input,
    "secret",
    writer,
    confirmedVerifier(),
  );

  assert.deepEqual(result.persistence, {
    status: "stored",
    parentCompanyId: 1,
    childCompanyId: 2,
    documentId: "S100Y644",
    relationId: 10,
  });
  assert.equal(writer.companies.length, 2);
  assert.equal(writer.documents[0]!.fetchStatus, "parsed");
  assert.equal(writer.documents[0]!.documentTypeCode, "120");
  assert.equal(writer.documents[0]!.sourceReference.includes("secret"), false);
  assert.equal(writer.relations[0]!.ownershipPercent, 100);
  assert.equal(writer.relations[0]!.isConsolidated, true);
  assert.equal(writer.relations[0]!.verificationStatus, "verified");
  assert.equal(writer.relations[0]!.sourceDocumentId, "S100Y644");
});

test("未確定の検証結果はD1へ保存しない", async () => {
  const writer = new RecordingWriter();
  const verifier = (async () => ({
    source: {
      name: "EDINET（金融庁）",
      apiDocumentationUrl: "https://example.test/edinet",
    },
    retrievedAt: "2026-09-03T10:00:00.000Z",
    query: input,
    assessment: {
      status: "unknown",
      reason: "確認できませんでした。",
      parentCandidates: [],
      checkedDateRange: null,
      evidence: [],
    },
    caution: "資本関係がないことを意味しません。",
  })) as CorporateRelationshipVerifier;

  const result = await verifyAndStoreCorporateRelationship(
    input,
    "secret",
    writer,
    verifier,
  );

  assert.deepEqual(result.persistence, {
    status: "skipped",
    reason: "verification_not_confirmed",
  });
  assert.equal(writer.companies.length, 0);
  assert.equal(writer.documents.length, 0);
  assert.equal(writer.relations.length, 0);
});

test("D1未設定と保存失敗を検証結果から分離する", async () => {
  const withoutDatabase = await verifyAndStoreCorporateRelationship(
    input,
    "secret",
    null,
    confirmedVerifier(),
  );
  assert.deepEqual(withoutDatabase.persistence, { status: "not_configured" });
  assert.equal(withoutDatabase.assessment.status, "confirmed");

  const failedWriter = new RecordingWriter();
  failedWriter.upsertCompany = async () => {
    throw new Error("private SQL detail");
  };
  const failed = await verifyAndStoreCorporateRelationship(
    input,
    "secret",
    failedWriter,
    confirmedVerifier(),
  );
  assert.equal(failed.assessment.status, "confirmed");
  assert.deepEqual(failed.persistence, {
    status: "failed",
    error: {
      code: "database_error",
      message:
        "EDINETの検証は完了しましたが、企業関係データベースへ保存できませんでした。",
    },
  });
  assert.equal(JSON.stringify(failed).includes("private SQL detail"), false);
});

test("割合が複数ある場合は推測で一つを保存しない", async () => {
  const writer = new RecordingWriter();
  const baseVerifier = confirmedVerifier();
  const verifier = (async (...args: Parameters<CorporateRelationshipVerifier>) => {
    const result = await baseVerifier(...args);
    if (result.assessment.status === "confirmed") {
      result.assessment.percentages = ["100%", "25%"];
    }
    return result;
  }) as CorporateRelationshipVerifier;

  await verifyAndStoreCorporateRelationship(input, "secret", writer, verifier);

  assert.equal(writer.relations[0]!.ownershipPercent, null);
});
