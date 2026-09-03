export type ProgramTreatment =
  | "excluded"
  | "allowed"
  | "conditional"
  | "not_stated";

export type DeemedLargeEnterpriseRule = {
  treatment: ProgramTreatment;
  singleLargeOwnerThresholdPercent?: number;
  multipleLargeOwnersThresholdPercent?: number;
  officerOverlapThresholdPercent?: number;
  indirectOwnershipIncluded?: boolean;
  highIncomeRuleIncluded?: boolean;
  sourceUrl: string;
  sourceTitle?: string;
  sourceSection?: string;
  checkedAt: string;
};

export type PublicAffiliationFacts = {
  singleLargeOwnerPercent?: number;
  multipleLargeOwnersPercent?: number;
  officerOverlapPercent?: number;
  indirectlyControlledByLargeEnterprise?: boolean;
  highIncomeRuleApplies?: boolean;
  conditionalRequirementMet?: boolean;
};

export type DeemedLargeEnterpriseAssessmentStatus =
  | "allowed_by_program"
  | "likely_excluded"
  | "no_exclusion_identified"
  | "needs_confirmation";

type AssessmentReason = {
  field: string;
  message: string;
};

const STATUS_LABELS: Record<DeemedLargeEnterpriseAssessmentStatus, string> = {
  allowed_by_program: "みなし大企業であることだけでは対象外になりません",
  likely_excluded: "みなし大企業として対象外となる可能性が高いです",
  no_exclusion_identified: "確認できた基準には該当していません",
  needs_confirmation: "制度要件または企業情報の追加確認が必要です",
};

function atLeast(value: number | undefined, threshold: number | undefined) {
  return value !== undefined && threshold !== undefined && value >= threshold;
}

function missingFact(
  required: boolean,
  value: unknown,
  field: string,
  message: string,
  missing: AssessmentReason[],
) {
  if (required && value === undefined) missing.push({ field, message });
}

export function assessDeemedLargeEnterpriseEligibility(
  subsidyId: string,
  rule: DeemedLargeEnterpriseRule,
  facts: PublicAffiliationFacts,
) {
  const matchedRules: AssessmentReason[] = [];
  const missingInformation: AssessmentReason[] = [];

  if (rule.treatment === "allowed") {
    const status = "allowed_by_program" as const;
    return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
      "公式資料では、みなし大企業であることだけを理由に申請対象外とはされていません。その他の申請要件は別途確認してください。",
    );
  }

  if (rule.treatment === "not_stated") {
    const status = "needs_confirmation" as const;
    missingInformation.push({
      field: "program_rule",
      message: "確認した公式資料では、みなし大企業の扱いを特定できませんでした。",
    });
    return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
      "制度の公式資料または実施機関で、みなし大企業の扱いを確認してください。",
    );
  }

  if (rule.treatment === "conditional") {
    if (facts.conditionalRequirementMet === true) {
      const status = "allowed_by_program" as const;
      return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
        "制度固有の条件を満たすことが確認されています。その他の申請要件は別途確認してください。",
      );
    }
    if (facts.conditionalRequirementMet === false) {
      matchedRules.push({
        field: "conditional_requirement",
        message: "みなし大企業に適用される制度固有の条件を満たしていません。",
      });
      const status = "likely_excluded" as const;
      return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
        "制度固有の条件を満たさないため、対象外となる可能性が高いです。",
      );
    }
    missingInformation.push({
      field: "conditional_requirement",
      message: "みなし大企業に適用される制度固有の条件を満たすか確認が必要です。",
    });
    const status = "needs_confirmation" as const;
    return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
      "制度固有の条件を満たすか確認してください。",
    );
  }

  if (atLeast(facts.singleLargeOwnerPercent, rule.singleLargeOwnerThresholdPercent)) {
    matchedRules.push({
      field: "single_large_owner",
      message: `単一の大企業による保有割合が基準の${rule.singleLargeOwnerThresholdPercent}%以上です。`,
    });
  }
  if (atLeast(facts.multipleLargeOwnersPercent, rule.multipleLargeOwnersThresholdPercent)) {
    matchedRules.push({
      field: "multiple_large_owners",
      message: `複数の大企業による合計保有割合が基準の${rule.multipleLargeOwnersThresholdPercent}%以上です。`,
    });
  }
  if (atLeast(facts.officerOverlapPercent, rule.officerOverlapThresholdPercent)) {
    matchedRules.push({
      field: "officer_overlap",
      message: `大企業の役員・職員による兼務割合が基準の${rule.officerOverlapThresholdPercent}%以上です。`,
    });
  }
  if (
    rule.indirectOwnershipIncluded &&
    facts.indirectlyControlledByLargeEnterprise === true
  ) {
    matchedRules.push({
      field: "indirect_control",
      message: "制度が対象とする大企業からの間接支配が確認されています。",
    });
  }
  if (rule.highIncomeRuleIncluded && facts.highIncomeRuleApplies === true) {
    matchedRules.push({
      field: "high_income_rule",
      message: "制度が定める課税所得等の基準に該当すると申告されています。",
    });
  }

  if (matchedRules.length) {
    const status = "likely_excluded" as const;
    return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
      "公式資料の対象外基準に該当する公開情報または利用者確認情報があります。最終判断は実施機関に確認してください。",
    );
  }

  missingFact(
    rule.singleLargeOwnerThresholdPercent !== undefined,
    facts.singleLargeOwnerPercent,
    "single_large_owner",
    "単一の大企業による保有割合を確認できません。",
    missingInformation,
  );
  missingFact(
    rule.multipleLargeOwnersThresholdPercent !== undefined,
    facts.multipleLargeOwnersPercent,
    "multiple_large_owners",
    "複数の大企業による合計保有割合を確認できません。",
    missingInformation,
  );
  missingFact(
    rule.officerOverlapThresholdPercent !== undefined,
    facts.officerOverlapPercent,
    "officer_overlap",
    "大企業の役員・職員による兼務割合を公開情報から確認できません。",
    missingInformation,
  );
  missingFact(
    rule.indirectOwnershipIncluded === true,
    facts.indirectlyControlledByLargeEnterprise,
    "indirect_control",
    "大企業からの間接支配の有無を確認できません。",
    missingInformation,
  );
  missingFact(
    rule.highIncomeRuleIncluded === true,
    facts.highIncomeRuleApplies,
    "high_income_rule",
    "課税所得等の非公開情報は自動取得せず、利用者の確認が必要です。",
    missingInformation,
  );

  if (
    rule.singleLargeOwnerThresholdPercent === undefined &&
    rule.multipleLargeOwnersThresholdPercent === undefined &&
    rule.officerOverlapThresholdPercent === undefined &&
    !rule.indirectOwnershipIncluded &&
    !rule.highIncomeRuleIncluded
  ) {
    missingInformation.push({
      field: "program_rule_details",
      message: "対象外基準の具体的な条件が入力されていません。",
    });
  }

  const status: DeemedLargeEnterpriseAssessmentStatus = missingInformation.length
    ? "needs_confirmation"
    : "no_exclusion_identified";
  const summary = missingInformation.length
    ? "判定に必要な情報が不足しています。公開情報で確認できない事項は推定せず、申請企業または実施機関に確認してください。"
    : "入力された公開情報の範囲では、制度の対象外基準への該当を確認できませんでした。その他の申請要件は別途確認してください。";
  return result(subsidyId, rule, facts, status, matchedRules, missingInformation, summary);
}

function result(
  subsidyId: string,
  rule: DeemedLargeEnterpriseRule,
  facts: PublicAffiliationFacts,
  status: DeemedLargeEnterpriseAssessmentStatus,
  matchedRules: AssessmentReason[],
  missingInformation: AssessmentReason[],
  summary: string,
) {
  return {
    subsidyId,
    assessment: {
      status,
      statusLabel: STATUS_LABELS[status],
      summary,
      matchedRules,
      missingInformation,
    },
    programRule: rule,
    affiliationFacts: facts,
    privacy:
      "この判定結果は保存しません。公開情報で確認できない課税所得や役員兼務などは推定しません。",
    caution:
      "これは入力された公式資料の基準と確認済み情報の機械的な照合です。補助金の申請資格を保証しないため、最新の公募要領と実施機関の案内を確認してください。",
  };
}
