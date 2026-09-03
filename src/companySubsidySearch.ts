import { getCompanyProfile } from "./gbizinfo";
import {
  recommendationGate,
  type CompanyProfileOverrides,
  type CompanyRelationshipResolver,
} from "./companyMatching";
import type { ParentCompanyCandidate } from "./companyRelationshipGate";
import {
  searchSubsidies,
  type SearchSubsidiesInput,
} from "./jgrants";

export type SearchSubsidiesForCompanyInput = Omit<
  SearchSubsidiesInput,
  "targetArea" | "industry" | "employeeCount"
> & {
  corporateNumber: string;
  profileOverrides?: CompanyProfileOverrides;
  parentCandidate?: ParentCompanyCandidate;
};

export async function searchSubsidiesForCompany(
  input: SearchSubsidiesForCompanyInput,
  gbizInfoApiToken: string | undefined,
  relationshipResolver: CompanyRelationshipResolver,
) {
  const companyProfile = await getCompanyProfile(
    input.corporateNumber,
    gbizInfoApiToken,
    10,
  );
  const company = companyProfile.company;
  const corporateRelationship = await relationshipResolver({
    targetCompanyName:
      company.name ?? `法人番号${company.corporateNumber}`,
    targetCorporateNumber: company.corporateNumber,
    parentCandidate: input.parentCandidate,
  });
  const gate = recommendationGate(corporateRelationship);

  if (!gate.candidateSearchAllowed) {
    return {
      sources: [companyProfile.source],
      retrievedAt: { company: companyProfile.retrievedAt, subsidies: null },
      company,
      corporateRelationship,
      recommendationGate: gate,
      search: null,
      caution:
        "資本関係を確認できていないため、会社別の補助金検索と推薦を停止しました。",
    };
  }

  const overrides = input.profileOverrides ?? {};
  const search = await searchSubsidies({
    keyword: input.keyword,
    usePurpose: input.usePurpose,
    targetArea: overrides.location ?? company.location ?? undefined,
    industry:
      overrides.industry ??
      (company.industries.length ? company.industries.join(" / ") : undefined),
    employeeCount: overrides.employeeCount ?? company.employeeNumber ?? undefined,
    acceptingOnly: input.acceptingOnly,
    sort: input.sort,
    order: input.order,
    limit: input.limit,
  });

  return {
    sources: [companyProfile.source, search.source],
    retrievedAt: {
      company: companyProfile.retrievedAt,
      subsidies: search.retrievedAt,
    },
    company,
    corporateRelationship,
    recommendationGate: gate,
    search,
    caution:
      gate.companySpecificRecommendationAllowed
        ? "資本関係は確認済みです。各候補の最新公募要領とみなし大企業規定を照合してから適合度を確定してください。"
        : "これは探索候補です。親会社候補の有無を確認し、各候補をevaluate_subsidy_fit_for_companyで評価するまで企業別のおすすめとして提示しないでください。",
  };
}

