import {
  type CompanyRelationEvidence,
  type D1CompanyRelationsRepository,
  normalizeCompanyNameForRelations,
} from "./d1Relations";
import {
  type CorporateRelationshipVerifier,
  verifyAndStoreCorporateRelationship,
} from "./edinetRelationsService";

export type ParentCompanyCandidate = {
  name: string;
  corporateNumber?: string;
  filingDate?: string;
  documentId?: string;
};

export type CompanyRelationshipGateInput = {
  targetCompanyName: string;
  targetCorporateNumber: string;
  parentCandidate?: ParentCompanyCandidate;
};

export type CompanyRelationshipGateResult = {
  status:
    | "verified"
    | "needs_verification"
    | "not_identified"
    | "verification_failed";
  source: "d1" | "official_edinet" | "none";
  riskLevel: "high" | "present" | "unknown";
  checkedBeforeSubsidyAssessment: true;
  storageAvailable: boolean;
  verifiedRelations: CompanyRelationEvidence[];
  parentCandidate: {
    name: string;
    corporateNumber: string | null;
  } | null;
  verification: unknown | null;
  error: { code: string; message: string } | null;
};

type RelationshipRepository = Pick<
  D1CompanyRelationsRepository,
  "findParentRelationsByCorporateNumber"
> &
  NonNullable<Parameters<typeof verifyAndStoreCorporateRelationship>[2]>;

function cachedRiskLevel(
  relations: CompanyRelationEvidence[],
): CompanyRelationshipGateResult["riskLevel"] {
  return relations.some(
    (relation) =>
      relation.isConsolidated === true ||
      (relation.ownershipPercent !== null && relation.ownershipPercent >= 50),
  )
    ? "high"
    : "present";
}

function verificationRiskLevel(
  verification: Awaited<ReturnType<typeof verifyAndStoreCorporateRelationship>>,
): CompanyRelationshipGateResult["riskLevel"] {
  if (verification.assessment.status !== "confirmed") return "unknown";
  const percentages = verification.assessment.percentages
    .map((value) =>
      Number(
        value
          .normalize("NFKC")
          .match(/(?:^|[^\d])(\d{1,3}(?:\.\d+)?)\s*%/u)?.[1],
      ),
    )
    .filter(Number.isFinite);
  return percentages.some((value) => value >= 50) ||
    verification.assessment.evidence.some((item) =>
      item.snippet.includes("連結子会社"),
    )
    ? "high"
    : "present";
}

function matchesCandidate(
  relation: CompanyRelationEvidence,
  candidate: ParentCompanyCandidate,
): boolean {
  if (
    candidate.corporateNumber &&
    relation.parentCorporateNumber === candidate.corporateNumber
  ) {
    return true;
  }
  return (
    normalizeCompanyNameForRelations(relation.parentName) ===
    normalizeCompanyNameForRelations(candidate.name)
  );
}

export async function resolveCompanyRelationshipGate(
  input: CompanyRelationshipGateInput,
  apiKey: string | undefined,
  repository: RelationshipRepository | null,
  verifier: CorporateRelationshipVerifier | undefined = undefined,
): Promise<CompanyRelationshipGateResult> {
  let databaseReadFailed = false;
  if (repository) {
    try {
      const relations = await repository.findParentRelationsByCorporateNumber(
        input.targetCorporateNumber,
        { limit: 20 },
      );
      const matching = input.parentCandidate
        ? relations.filter((relation) =>
            matchesCandidate(relation, input.parentCandidate!),
          )
        : relations;
      if (matching.length) {
        return {
          status: "verified",
          source: "d1",
          riskLevel: cachedRiskLevel(matching),
          checkedBeforeSubsidyAssessment: true,
          storageAvailable: true,
          verifiedRelations: matching,
          parentCandidate: input.parentCandidate
            ? {
                name: input.parentCandidate.name,
                corporateNumber:
                  input.parentCandidate.corporateNumber ?? null,
              }
            : null,
          verification: null,
          error: null,
        };
      }
    } catch {
      databaseReadFailed = true;
    }
  }

  if (input.parentCandidate) {
    try {
      const verification = await verifyAndStoreCorporateRelationship(
        {
          targetCompanyName: input.targetCompanyName,
          targetCorporateNumber: input.targetCorporateNumber,
          parentCompanyName: input.parentCandidate.name,
          parentCorporateNumber: input.parentCandidate.corporateNumber,
          filingDate: input.parentCandidate.filingDate,
          documentId: input.parentCandidate.documentId,
        },
        apiKey,
        repository,
        verifier,
      );
      return {
        status:
          verification.assessment.status === "confirmed"
            ? "verified"
            : "needs_verification",
        source:
          verification.assessment.status === "confirmed"
            ? "official_edinet"
            : "none",
        riskLevel: verificationRiskLevel(verification),
        checkedBeforeSubsidyAssessment: true,
        storageAvailable: repository !== null && !databaseReadFailed,
        verifiedRelations: [],
        parentCandidate: {
          name: input.parentCandidate.name,
          corporateNumber: input.parentCandidate.corporateNumber ?? null,
        },
        verification,
        error: null,
      };
    } catch {
      return {
        status: "verification_failed",
        source: "none",
        riskLevel: "unknown",
        checkedBeforeSubsidyAssessment: true,
        storageAvailable: repository !== null && !databaseReadFailed,
        verifiedRelations: [],
        parentCandidate: {
          name: input.parentCandidate.name,
          corporateNumber: input.parentCandidate.corporateNumber ?? null,
        },
        verification: null,
        error: {
          code: "relationship_verification_failed",
          message:
            "親会社候補を公的資料で検証できなかったため、企業別の推薦を確定できません。",
        },
      };
    }
  }

  return {
    status: databaseReadFailed ? "verification_failed" : "not_identified",
    source: "none",
    riskLevel: "unknown",
    checkedBeforeSubsidyAssessment: true,
    storageAvailable: repository !== null && !databaseReadFailed,
    verifiedRelations: [],
    parentCandidate: null,
    verification: null,
    error: databaseReadFailed
      ? {
          code: "relationship_database_unavailable",
          message:
            "検証済み資本関係を確認できないため、企業別の推薦を確定できません。",
        }
      : null,
  };
}
