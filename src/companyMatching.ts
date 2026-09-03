import { getCompanyProfile } from "./gbizinfo";
import type { JGrantsCacheOptions } from "./jgrants";
import { evaluateSubsidyFit } from "./matching";

export async function evaluateSubsidyFitForCompany(
  subsidyId: string,
  corporateNumber: string,
  apiToken: string | undefined,
  businessPlans?: string[],
  cacheOptions: JGrantsCacheOptions = {},
) {
  const companyProfile = await getCompanyProfile(corporateNumber, apiToken, 10);
  const company = companyProfile.company;
  const assessment = await evaluateSubsidyFit(
    subsidyId,
    {
      location: company.location ?? undefined,
      industry: company.industries.length
        ? company.industries.join(" / ")
        : undefined,
      employeeCount: company.employeeNumber ?? undefined,
      capitalYen: company.capitalStockYen ?? undefined,
      businessPlans,
    },
    cacheOptions,
  );

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
      status: company.status,
      updateDate: company.updateDate,
      certificationCount: companyProfile.activities.certificationCount,
      subsidyHistoryCount: companyProfile.activities.subsidyHistoryCount,
    },
    assessment,
    caution:
      "gBizINFOとJグランツの公開構造化情報を組み合わせた候補評価です。申請資格や採択を保証しないため、最新の公募要領と実施機関の案内を確認してください。",
  };
}
