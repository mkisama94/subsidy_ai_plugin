import { getSubsidyDetail, type JGrantsCacheOptions } from "./jgrants";
import {
  createProfessionalConsultationBrief,
  type ConsultationTopic,
} from "./professionalConsultation";

export type CompanyProfileInput = {
  location?: string;
  industry?: string;
  employeeCount?: number;
  capitalYen?: number;
  businessPlans?: string[];
};

type ConditionResult = {
  field: string;
  companyValue: string | number | null;
  subsidyRequirement: string | null;
  reason: string;
};

export type SubsidyFitStatus =
  | "strong_candidate"
  | "needs_confirmation"
  | "potentially_ineligible"
  | "insufficient_information";

const STATUS_LABELS: Record<SubsidyFitStatus, string> = {
  strong_candidate: "有力な候補です",
  needs_confirmation: "申請条件の追加確認が必要です",
  potentially_ineligible: "対象外となる可能性があります",
  insufficient_information: "判断に必要な企業情報が不足しています",
};

function summarizeAssessment(
  status: SubsidyFitStatus,
  conflictingCount: number,
  unconfirmedCount: number,
  missingCount: number,
): string {
  switch (status) {
    case "strong_candidate":
      return "公開情報で確認できる条件は一致しています。申請前に最新の公募要領を確認してください。";
    case "needs_confirmation":
      return `公開情報で確認できる範囲では候補ですが、公募要領などで追加確認が必要な項目が${unconfirmedCount}件あります。`;
    case "potentially_ineligible":
      return `公開情報上、対象条件と一致しない可能性がある項目が${conflictingCount}件あります。公募要領または実施機関に確認してください。`;
    case "insufficient_information":
      return `判断に必要な企業情報が${missingCount}件不足しています。情報を補ってから改めて確認してください。`;
  }
}

export type SubsidyDetailSnapshot = {
  source: { name: string; apiDocumentationUrl: string };
  retrievedAt: string;
  servedAt?: string;
  cache?: {
    status: "hit" | "miss" | "stale" | "bypass";
    isStale: boolean;
    expiresAt: string | null;
  };
  subsidy: {
    id: string;
    title: string;
    detailUrl: string;
    industry: string | null;
    employeeLimit: string | null;
    usePurpose: string | null;
    subsidyRate: string | null;
    subsidyMaxLimitYen: number | null;
    workflows: Array<{
      targetArea: string | null;
      targetAreaDetail: string | null;
      acceptanceStatus: "scheduled" | "open" | "closed" | "unknown";
      acceptanceStart: string | null;
      acceptanceEnd: string | null;
    }>;
  };
};

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/[\s,、・/／]/g, "").toLowerCase();
}

function isUnrestricted(value: string): boolean {
  const normalized = normalizeText(value);
  return ["制約なし", "指定なし", "問わない", "全業種", "全国"].some(
    (word) => normalized.includes(word),
  );
}

function thresholdValues(
  value: string,
  suffix: "以下" | "未満" | "以上",
): number[] {
  const pattern = new RegExp(`([0-9０-９][0-9０-９,，]*)\\s*人?\\s*${suffix}`, "g");
  return [
    ...new Set(
      [...value.normalize("NFKC").matchAll(pattern)]
        .map((match) => Number(match[1]?.replace(/,/g, "")))
        .filter(Number.isFinite),
    ),
  ];
}

export function evaluateSubsidyFitFromDetail(
  detail: SubsidyDetailSnapshot,
  profile: CompanyProfileInput,
) {
  const matchedConditions: ConditionResult[] = [];
  const conflictingConditions: ConditionResult[] = [];
  const unconfirmedConditions: ConditionResult[] = [];
  const missingProfileFields = [
    !profile.location ? "location" : null,
    !profile.industry ? "industry" : null,
    profile.employeeCount === undefined ? "employee_count" : null,
  ].filter((field): field is string => Boolean(field));

  const areas = [
    ...new Set(
      detail.subsidy.workflows
        .map((workflow) => workflow.targetArea)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const areaDetails = [
    ...new Set(
      detail.subsidy.workflows
        .map((workflow) => workflow.targetAreaDetail)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (profile.location) {
    if (!areas.length) {
      unconfirmedConditions.push({
        field: "location",
        companyValue: profile.location,
        subsidyRequirement: null,
        reason: "構造化された対象地域がないため、公募要領で確認が必要です。",
      });
    } else {
      const location = normalizeText(profile.location);
      const compatible = areas.some((area) => {
        const normalizedArea = normalizeText(area);
        return (
          isUnrestricted(area) ||
          normalizedArea.includes(location) ||
          location.includes(normalizedArea)
        );
      });
      (compatible ? matchedConditions : conflictingConditions).push({
        field: "location",
        companyValue: profile.location,
        subsidyRequirement: areas.join(" / "),
        reason: compatible
          ? "所在地は対象地域表記と一致しています。"
          : "所在地が対象地域表記に含まれていません。",
      });
    }
  }
  if (areaDetails.length) {
    unconfirmedConditions.push({
      field: "location_detail",
      companyValue: profile.location ?? null,
      subsidyRequirement: areaDetails.join(" / "),
      reason:
        "対象地域の補足条件は除外地域等を含む可能性があるため、公募要領で確認が必要です。",
    });
  }

  if (profile.industry) {
    const requirement = detail.subsidy.industry;
    if (!requirement) {
      unconfirmedConditions.push({
        field: "industry",
        companyValue: profile.industry,
        subsidyRequirement: null,
        reason: "構造化された対象業種がないため、公募要領で確認が必要です。",
      });
    } else {
      const industry = normalizeText(profile.industry);
      const normalizedRequirement = normalizeText(requirement);
      const compatible =
        isUnrestricted(requirement) ||
        normalizedRequirement.includes(industry) ||
        industry.includes(normalizedRequirement);
      (compatible ? matchedConditions : unconfirmedConditions).push({
        field: "industry",
        companyValue: profile.industry,
        subsidyRequirement: requirement,
        reason: compatible
          ? "業種は対象業種表記と一致しています。"
          : "業種分類が一致しないため、公募要領で確認が必要です。",
      });
    }
  }

  if (profile.employeeCount !== undefined) {
    const requirement = detail.subsidy.employeeLimit;
    if (!requirement) {
      unconfirmedConditions.push({
        field: "employee_count",
        companyValue: profile.employeeCount,
        subsidyRequirement: null,
        reason: "構造化された従業員数条件がないため、公募要領で確認が必要です。",
      });
    } else if (isUnrestricted(requirement)) {
      matchedConditions.push({
        field: "employee_count",
        companyValue: profile.employeeCount,
        subsidyRequirement: requirement,
        reason: "Jグランツでは従業員数の制約なしとされています。",
      });
    } else {
      const maximums = thresholdValues(requirement, "以下");
      const strictMaximums = thresholdValues(requirement, "未満");
      const minimums = thresholdValues(requirement, "以上");
      if (maximums.length + strictMaximums.length + minimums.length !== 1) {
        unconfirmedConditions.push({
          field: "employee_count",
          companyValue: profile.employeeCount,
          subsidyRequirement: requirement,
          reason: "複数条件の可能性があるため、公募要領で確認が必要です。",
        });
      } else {
        const compatible = maximums.length
          ? profile.employeeCount <= maximums[0]!
          : strictMaximums.length
            ? profile.employeeCount < strictMaximums[0]!
            : profile.employeeCount >= minimums[0]!;
        (compatible ? matchedConditions : conflictingConditions).push({
          field: "employee_count",
          companyValue: profile.employeeCount,
          subsidyRequirement: requirement,
          reason: compatible
            ? "従業員数は構造化条件を満たしています。"
            : "従業員数が構造化条件と一致しません。",
        });
      }
    }
  }

  const statuses = detail.subsidy.workflows.map(
    (workflow) => workflow.acceptanceStatus,
  );
  if (statuses.includes("open")) {
    matchedConditions.push({
      field: "acceptance_period",
      companyValue: null,
      subsidyRequirement: null,
      reason: "現在受付中の公募回があります。",
    });
  } else if (statuses.length && statuses.every((status) => status === "closed")) {
    conflictingConditions.push({
      field: "acceptance_period",
      companyValue: null,
      subsidyRequirement: null,
      reason: "確認できる公募回は終了しています。",
    });
  } else {
    unconfirmedConditions.push({
      field: "acceptance_period",
      companyValue: null,
      subsidyRequirement: null,
      reason: "現在の受付状態を確定できません。",
    });
  }

  if (profile.capitalYen !== undefined) {
    unconfirmedConditions.push({
      field: "capital_yen",
      companyValue: profile.capitalYen,
      subsidyRequirement: null,
      reason: "資本金要件は公募要領で確認が必要です。",
    });
  }
  if (profile.businessPlans?.length) {
    unconfirmedConditions.push({
      field: "business_plans",
      companyValue: profile.businessPlans.join(" / "),
      subsidyRequirement: detail.subsidy.usePurpose,
      reason: "事業計画と対象事業・対象経費の具体的な照合が必要です。",
    });
  }
  unconfirmedConditions.push({
    field: "official_guidelines",
    companyValue: null,
    subsidyRequirement: null,
    reason: "申請主体、対象経費、実施期間などを最新の公募要領で確認してください。",
  });

  const status: SubsidyFitStatus = conflictingConditions.length
    ? "potentially_ineligible"
    : missingProfileFields.length
      ? "insufficient_information"
      : unconfirmedConditions.length
        ? "needs_confirmation"
        : "strong_candidate";

  const consultationIssues = [
    ...conflictingConditions,
    ...unconfirmedConditions,
    ...missingProfileFields.map((field) => ({
      field,
      reason: `${field}の企業情報を確認できません。`,
    })),
  ].map((condition) => ({
    topic: consultationTopic(condition.field),
    summary: condition.reason,
  }));
  const openDeadlines = detail.subsidy.workflows
    .filter((workflow) => workflow.acceptanceStatus === "open")
    .map((workflow) => workflow.acceptanceEnd)
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    source: detail.source,
    retrievedAt: detail.retrievedAt,
    servedAt: detail.servedAt ?? detail.retrievedAt,
    cache: detail.cache ?? null,
    subsidy: {
      id: detail.subsidy.id,
      title: detail.subsidy.title,
      detailUrl: detail.subsidy.detailUrl,
      subsidyRate: detail.subsidy.subsidyRate,
      subsidyMaxLimitYen: detail.subsidy.subsidyMaxLimitYen,
    },
    companyProfile: {
      location: profile.location ?? null,
      industry: profile.industry ?? null,
      employeeCount: profile.employeeCount ?? null,
      capitalYen: profile.capitalYen ?? null,
      businessPlans: profile.businessPlans ?? [],
    },
    assessment: {
      status,
      statusLabel: STATUS_LABELS[status],
      summary: summarizeAssessment(
        status,
        conflictingConditions.length,
        unconfirmedConditions.length,
        missingProfileFields.length,
      ),
      matchedConditions,
      conflictingConditions,
      unconfirmedConditions,
      missingProfileFields,
    },
    professionalConsultation: createProfessionalConsultationBrief({
      subsidyName: detail.subsidy.title,
      sourceUrl: detail.subsidy.detailUrl,
      confirmedFacts: matchedConditions.map((condition) => condition.reason),
      issues: consultationIssues,
      applicationDeadline: openDeadlines[0] ?? null,
    }),
    caution:
      "これはJグランツの構造化情報に基づく候補評価であり、受給資格や採択を保証しません。必ず最新の公募要領と実施機関の案内を確認してください。",
  };
}

function consultationTopic(field: string): ConsultationTopic {
  switch (field) {
    case "location":
    case "location_detail":
      return "location";
    case "industry":
      return "industry";
    case "employee_count":
      return "employee_count";
    case "capital_yen":
      return "capital_yen";
    case "business_plans":
      return "business_plans";
    case "acceptance_period":
      return "acceptance_period";
    default:
      return "official_guidelines";
  }
}

export async function evaluateSubsidyFit(
  subsidyId: string,
  profile: CompanyProfileInput,
  cacheOptions: JGrantsCacheOptions = {},
) {
  return evaluateSubsidyFitFromDetail(
    await getSubsidyDetail(subsidyId, cacheOptions),
    profile,
  );
}
