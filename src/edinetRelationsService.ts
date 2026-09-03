import {
  type CompanyInput,
  type CompanyRelationInput,
  type EdinetDocumentInput,
} from "./d1Relations";
import {
  type VerifyCorporateRelationshipInput,
  verifyCorporateRelationship,
} from "./edinet";

type VerificationResult = Awaited<
  ReturnType<typeof verifyCorporateRelationship>
>;

export type CompanyRelationsWriter = {
  upsertCompany(input: CompanyInput): Promise<{ id: number }>;
  upsertEdinetDocument(
    input: EdinetDocumentInput,
  ): Promise<{ documentId: string }>;
  upsertCompanyRelation(
    input: CompanyRelationInput,
  ): Promise<{ id: number }>;
};

export type RelationshipPersistenceResult =
  | { status: "not_configured" }
  | {
      status: "skipped";
      reason: "verification_not_confirmed" | "missing_filing_metadata";
    }
  | {
      status: "stored";
      parentCompanyId: number;
      childCompanyId: number | null;
      documentId: string;
      relationId: number;
    }
  | {
      status: "failed";
      error: {
        code: "database_error";
        message: string;
      };
    };

export type CorporateRelationshipVerifier = (
  input: VerifyCorporateRelationshipInput,
  apiKey?: string,
) => Promise<VerificationResult>;

const EDINET_DISCLOSURE_URL =
  "https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx";

function parseUnambiguousPercentage(values: string[]): number | null {
  const percentages = [
    ...new Set(
      values
        .map((value) =>
          value
            .normalize("NFKC")
            .match(/(?:^|[^\d])(\d{1,3}(?:\.\d+)?)\s*%/u)?.[1],
        )
        .filter((value): value is string => value !== undefined)
        .map(Number)
        .filter((value) => Number.isFinite(value) && value <= 100),
    ),
  ];
  return percentages.length === 1 ? percentages[0]! : null;
}

function relationTypeFromEvidence(
  evidence: Array<{ snippet: string }>,
): CompanyRelationInput["relationType"] {
  const text = evidence.map((item) => item.snippet).join(" ");
  return text.includes("関連会社") && !text.includes("子会社")
    ? "affiliate"
    : "subsidiary";
}

function consolidatedFromEvidence(
  evidence: Array<{ snippet: string }>,
): boolean | null {
  return evidence.some((item) => item.snippet.includes("連結子会社"))
    ? true
    : null;
}

function sourceLocator(
  evidence: Array<{
    file: string;
    itemId: string | null;
    itemName: string | null;
  }>,
): string | null {
  const value = evidence
    .map((item) =>
      [item.file, item.itemId, item.itemName].filter(Boolean).join("#"),
    )
    .filter(Boolean)
    .join(" | ");
  return value ? value.slice(0, 2_000) : null;
}

function documentReference(documentId: string): string {
  const url = new URL(EDINET_DISCLOSURE_URL);
  url.searchParams.set("docID", documentId);
  return url.toString();
}

async function persistConfirmedRelationship(
  verification: VerificationResult,
  writer: CompanyRelationsWriter,
): Promise<RelationshipPersistenceResult> {
  if (
    verification.assessment.status !== "confirmed" ||
    !("parent" in verification) ||
    !("filing" in verification) ||
    !verification.parent ||
    !verification.filing
  ) {
    return { status: "skipped", reason: "verification_not_confirmed" };
  }

  const { parent, filing, query, retrievedAt, assessment } = verification;
  if (!filing.documentId || !filing.submittedAt) {
    return { status: "skipped", reason: "missing_filing_metadata" };
  }

  try {
    const parentCompany = await writer.upsertCompany({
      corporateNumber: parent.corporateNumber,
      edinetCode: parent.edinetCode,
      securitiesCode: parent.securitiesCode,
      name: parent.name,
      sourceUpdatedAt: filing.submittedAt,
    });
    const childCompany = query.targetCorporateNumber
      ? await writer.upsertCompany({
          corporateNumber: query.targetCorporateNumber,
          name: query.targetCompanyName,
          sourceUpdatedAt: filing.submittedAt,
        })
      : null;
    const document = await writer.upsertEdinetDocument({
      documentId: filing.documentId,
      filerCompanyId: parentCompany.id,
      filerName: filing.filerName ?? parent.name,
      filerCorporateNumber: parent.corporateNumber,
      filerEdinetCode: parent.edinetCode,
      documentTypeCode: "120",
      documentType: filing.description ?? "有価証券報告書",
      submittedAt: filing.submittedAt,
      periodStart: filing.periodStart,
      periodEnd: filing.periodEnd,
      sourceReference: documentReference(filing.documentId),
      fetchStatus: "parsed",
      fetchedAt: retrievedAt,
      parsedAt: retrievedAt,
    });
    const relation = await writer.upsertCompanyRelation({
      parentCompanyId: parentCompany.id,
      childCompanyId: childCompany?.id ?? null,
      parentName: parent.name,
      childName: query.targetCompanyName,
      relationType: relationTypeFromEvidence(assessment.evidence),
      ownershipPercent: parseUnambiguousPercentage(assessment.percentages),
      indirectOwnershipPercent: null,
      isConsolidated: consolidatedFromEvidence(assessment.evidence),
      asOfDate: filing.periodEnd,
      sourceDocumentId: document.documentId,
      sourceSection: "関係会社の状況",
      sourceLocator: sourceLocator(assessment.evidence),
      extractionMethod: "xbrl",
      verificationStatus: "verified",
    });
    return {
      status: "stored",
      parentCompanyId: parentCompany.id,
      childCompanyId: childCompany?.id ?? null,
      documentId: document.documentId,
      relationId: relation.id,
    };
  } catch {
    return {
      status: "failed",
      error: {
        code: "database_error",
        message:
          "EDINETの検証は完了しましたが、企業関係データベースへ保存できませんでした。",
      },
    };
  }
}

export async function verifyAndStoreCorporateRelationship(
  input: VerifyCorporateRelationshipInput,
  apiKey: string | undefined,
  writer: CompanyRelationsWriter | null,
  verifier: CorporateRelationshipVerifier = verifyCorporateRelationship,
) {
  const verification = await verifier(input, apiKey);
  const persistence = writer
    ? await persistConfirmedRelationship(verification, writer)
    : ({ status: "not_configured" } as const);
  return { ...verification, persistence };
}
