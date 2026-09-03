import { getCompanyProfile } from "./gbizinfo";
import { evaluateSubsidyFit } from "./matching";

export type CompanyProfileOverrides = {
  location?: string;
  industry?: string;
  employeeCount?: number;
  capitalYen?: number;
};

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
) {
  const companyProfile = await getCompanyProfile(corporateNumber, apiToken, 10);
  const company = companyProfile.company;
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
    assessment,
    caution:
      "gBizINFOとJグランツの公開構造化情報、および明示された利用者入力を組み合わせた候補評価です。利用者入力は公的データより優先して照合しますが、矛盾がある場合は確認が必要です。申請資格や採択を保証しないため、最新の公募要領と実施機関の案内を確認してください。",
  };
}
