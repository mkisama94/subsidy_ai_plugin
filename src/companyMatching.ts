import { getCompanyProfile } from "./gbizinfo";
import { evaluateSubsidyFit } from "./matching";
import type {
  CompanyRelationshipGateInput,
  CompanyRelationshipGateResult,
  ParentCompanyCandidate,
} from "./companyRelationshipGate";

export type CompanyProfileOverrides = {
  location?: string;
  industry?: string;
  employeeCount?: number;
  capitalYen?: number;
};

export type CompanyRelationshipResolver = (
  input: CompanyRelationshipGateInput,
) => Promise<CompanyRelationshipGateResult>;

export function recommendationGate(
  relationship: CompanyRelationshipGateResult,
) {
  if (relationship.status === "needs_verification") {
    return {
      status: "blocked_pending_corporate_relationship_verification" as const,
      candidateSearchAllowed: false,
      companySpecificRecommendationAllowed: false,
      eligibilityConclusionAllowed: false,
      requiredNextAction:
        "親会社候補をEDINET提出書類で確認できるまで、企業別の推薦・順位付けを行わないでください。",
    };
  }
  if (relationship.status === "verification_failed") {
    return {
      status: "blocked_corporate_relationship_unavailable" as const,
      candidateSearchAllowed: false,
      companySpecificRecommendationAllowed: false,
      eligibilityConclusionAllowed: false,
      requiredNextAction:
        "資本関係の確認を再実行してください。確認できるまでは企業別の推薦を行わないでください。",
    };
  }
  if (relationship.status === "not_identified") {
    return {
      status: "provisional_relationship_not_identified" as const,
      candidateSearchAllowed: true,
      companySpecificRecommendationAllowed: false,
      eligibilityConclusionAllowed: false,
      requiredNextAction:
        "候補制度の探索だけに留め、親会社候補の有無を利用者に確認してから企業別の推薦を確定してください。",
    };
  }
  if (relationship.riskLevel === "high") {
    return {
      status: "conditional_verified_group_relationship" as const,
      candidateSearchAllowed: true,
      companySpecificRecommendationAllowed: true,
      eligibilityConclusionAllowed: false,
      requiredNextAction:
        "検証済みの大企業子会社リスクを、対象制度の最新公募要領にあるみなし大企業規定と照合してください。",
    };
  }
  return {
    status: "relationship_verified" as const,
    candidateSearchAllowed: true,
    companySpecificRecommendationAllowed: true,
    eligibilityConclusionAllowed: false,
    requiredNextAction:
      "検証済み資本関係を含め、対象制度の最新公募要領と照合してください。",
  };
}

function defaultRelationshipResult(): CompanyRelationshipGateResult {
  return {
    status: "not_identified",
    source: "none",
    riskLevel: "unknown",
    checkedBeforeSubsidyAssessment: true,
    storageAvailable: false,
    verifiedRelations: [],
    parentCandidate: null,
    verification: null,
    error: null,
  };
}

type ProfileValue = string | number;
type FieldRelationship =
  | "exact_match"
  | "compatible"
  | "conflict"
  | "unknown";

function comparable(value: ProfileValue): ProfileValue {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase()
    : value;
}

function normalizeLocation(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^〒?\d{3}-?\d{4}/u, "")
    .replace(/[\s　]+/gu, "")
    .trim();
}

function administrativeArea(value: string) {
  const normalized = normalizeLocation(value);
  const prefectureMatch = normalized.match(
    /^(東京都|北海道|大阪府|京都府|.{2,3}県)/u,
  );
  if (!prefectureMatch) {
    return { prefecture: null, municipality: null };
  }
  const prefecture = prefectureMatch[1];
  const remainder = normalized.slice(prefecture.length);
  const municipalityMatch = remainder.match(/^(.+?(?:市|区|町|村))/u);
  return {
    prefecture,
    municipality: municipalityMatch?.[1] ?? null,
  };
}

function isAdministrativeScope(value: string): boolean {
  const normalized = normalizeLocation(value);
  const area = administrativeArea(normalized);
  if (!area.prefecture) return false;
  return (
    normalized === area.prefecture ||
    (area.municipality !== null &&
      normalized === `${area.prefecture}${area.municipality}`)
  );
}

function compareLocations(
  gbizInfoValue: string,
  userProvidedValue: string,
): FieldRelationship {
  const publicLocation = normalizeLocation(gbizInfoValue);
  const suppliedLocation = normalizeLocation(userProvidedValue);
  if (publicLocation === suppliedLocation) return "exact_match";
  if (publicLocation.startsWith(suppliedLocation)) {
    return isAdministrativeScope(suppliedLocation) ? "compatible" : "unknown";
  }
  if (suppliedLocation.startsWith(publicLocation)) {
    return isAdministrativeScope(publicLocation) ? "compatible" : "unknown";
  }

  const publicArea = administrativeArea(publicLocation);
  const suppliedArea = administrativeArea(suppliedLocation);
  if (
    publicArea.prefecture &&
    suppliedArea.prefecture &&
    publicArea.prefecture !== suppliedArea.prefecture
  ) {
    return "conflict";
  }
  if (
    publicArea.municipality &&
    suppliedArea.municipality &&
    publicArea.municipality !== suppliedArea.municipality
  ) {
    return "conflict";
  }
  if (
    publicArea.municipality &&
    suppliedArea.municipality &&
    publicArea.municipality === suppliedArea.municipality
  ) {
    return "conflict";
  }
  return "unknown";
}

function resolveField<T extends ProfileValue>(
  gbizInfoValue: T | null | undefined,
  userProvidedValue: T | undefined,
) {
  const publicValue = gbizInfoValue ?? null;
  const suppliedValue = userProvidedValue ?? null;
  const hasUserValue = suppliedValue !== null;
  const value = hasUserValue ? suppliedValue : publicValue;
  const conflict =
    hasUserValue &&
    publicValue !== null &&
    comparable(suppliedValue) !== comparable(publicValue);
  return {
    value,
    source: hasUserValue
      ? ("user_provided" as const)
      : publicValue !== null
        ? ("gbizinfo" as const)
        : ("missing" as const),
    gbizInfoValue: publicValue,
    userProvidedValue: suppliedValue,
    relationship: value === null
      ? ("unknown" as const)
      : conflict
        ? ("conflict" as const)
        : publicValue !== null && suppliedValue !== null
          ? ("exact_match" as const)
          : ("unknown" as const),
    conflict,
  };
}

function resolveLocation(
  gbizInfoValue: string | null | undefined,
  userProvidedValue: string | undefined,
) {
  const resolved = resolveField(gbizInfoValue, userProvidedValue);
  const relationship =
    resolved.gbizInfoValue !== null && resolved.userProvidedValue !== null
      ? compareLocations(
          resolved.gbizInfoValue,
          resolved.userProvidedValue,
        )
      : ("unknown" as const);
  return {
    ...resolved,
    relationship,
    conflict: relationship === "conflict",
  };
}

export async function evaluateSubsidyFitForCompany(
  subsidyId: string,
  corporateNumber: string,
  apiToken: string | undefined,
  businessPlans?: string[],
  overrides: CompanyProfileOverrides = {},
  relationshipOptions: {
    parentCandidate?: ParentCompanyCandidate;
    resolver?: CompanyRelationshipResolver;
  } = {},
) {
  const companyProfile = await getCompanyProfile(corporateNumber, apiToken, 10);
  const company = companyProfile.company;
  const corporateRelationship = relationshipOptions.resolver
    ? await relationshipOptions.resolver({
        targetCompanyName:
          company.name ?? `法人番号${company.corporateNumber}`,
        targetCorporateNumber: company.corporateNumber,
        parentCandidate: relationshipOptions.parentCandidate,
      })
    : defaultRelationshipResult();
  const gate = recommendationGate(corporateRelationship);

  if (!gate.candidateSearchAllowed) {
    return {
      sources: [companyProfile.source],
      retrievedAt: { company: companyProfile.retrievedAt, subsidy: null },
      company,
      corporateRelationship,
      recommendationGate: gate,
      assessment: null,
      caution:
        "資本関係を公的資料で確認できていないため、補助金の適合度評価と推薦を停止しました。",
    };
  }
  const publicIndustry = company.industries.length
    ? company.industries.join(" / ")
    : null;
  const resolved = {
    location: resolveLocation(company.location, overrides.location?.trim()),
    industry: resolveField(publicIndustry, overrides.industry?.trim()),
    employeeCount: resolveField(
      company.employeeNumber,
      overrides.employeeCount,
    ),
    capitalYen: resolveField(company.capitalStockYen, overrides.capitalYen),
  };
  const assessment = await evaluateSubsidyFit(subsidyId, {
    location: resolved.location.value ?? undefined,
    industry: resolved.industry.value ?? undefined,
    employeeCount: resolved.employeeCount.value ?? undefined,
    capitalYen: resolved.capitalYen.value ?? undefined,
    businessPlans,
  });

  const conflictFields = Object.entries(resolved)
    .filter(([, field]) => field.conflict)
    .map(([field]) => field);
  const missingFields = Object.entries(resolved)
    .filter(([, field]) => field.source === "missing")
    .map(([field]) => field);

  return {
    sources: [companyProfile.source, assessment.source],
    retrievedAt: {
      company: companyProfile.retrievedAt,
      subsidy: assessment.retrievedAt,
    },
    company: {
      corporateNumber: company.corporateNumber,
      name: company.name,
      location: company.location,
      industries: company.industries,
      employeeNumber: company.employeeNumber,
      capitalStockYen: company.capitalStockYen,
      industryCodes: company.industryCodes,
      status: company.status,
      statusAvailability: company.statusAvailability,
      updateDate: company.updateDate,
      certificationCount: companyProfile.activities.certificationCount,
      subsidyHistoryCount: companyProfile.activities.subsidyHistoryCount,
    },
    profileResolution: {
      precedence: "user_provided_over_gbizinfo",
      fields: resolved,
      businessPlans: {
        value: businessPlans ?? [],
        source:
          businessPlans && businessPlans.length
            ? ("user_provided" as const)
            : ("missing" as const),
      },
      conflictFields,
      missingFields,
      requiresUserConfirmation: conflictFields.length > 0,
    },
    statusPolicy: companyProfile.statusPolicy,
    corporateRelationship,
    recommendationGate: gate,
    assessment,
    caution:
      "gBizINFOとJグランツの公開構造化情報、および明示された利用者入力を組み合わせた候補評価です。利用者入力は公的データより優先して照合しますが、矛盾がある場合は確認が必要です。申請資格や採択を保証しないため、最新の公募要領と実施機関の案内を確認してください。",
  };
}
