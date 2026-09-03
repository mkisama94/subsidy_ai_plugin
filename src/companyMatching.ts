import { getCompanyProfile } from "./gbizinfo";
import { evaluateSubsidyFit } from "./matching";

export type CompanyProfileOverrides = {
  location?: string;
  industry?: string;
  employeeCount?: number;
  capitalYen?: number;
};

type ProfileValue = string | number;

function comparable(value: ProfileValue): ProfileValue {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase()
    : value;
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
    conflict,
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
    location: resolveField(company.location, overrides.location?.trim()),
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
    assessment,
    caution:
      "gBizINFOとJグランツの公開構造化情報、および明示された利用者入力を組み合わせた候補評価です。利用者入力は公的データより優先して照合しますが、矛盾がある場合は確認が必要です。申請資格や採択を保証しないため、最新の公募要領と実施機関の案内を確認してください。",
  };
}
