const GBIZINFO_BASE_URL = "https://api.info.gbiz.go.jp/hojin/v2/hojin";
const GBIZINFO_SOURCE_URL = "https://content.info.gbiz.go.jp/api/index.html";
const REQUEST_TIMEOUT_MS = 15_000;

type JsonRecord = Record<string, unknown>;

export type CompanyProfile = {
  corporateNumber: string;
  name: string | null;
  kana: string | null;
  nameEnglish: string | null;
  kind: string | null;
  postalCode: string | null;
  location: string | null;
  representativeName: string | null;
  capitalStockYen: number | null;
  employeeNumber: number | null;
  companyUrl: string | null;
  dateOfEstablishment: string | null;
  foundingYear: number | null;
  businessSummary: string | null;
  industries: string[];
  businessItems: string[];
  qualificationGrade: string | null;
  status: string | null;
  updateDate: string | null;
  closeDate: string | null;
  closeCause: string | null;
};

export class GBizInfoApiError extends Error {
  constructor(
    message: string,
    readonly code:
      | "configuration_error"
      | "invalid_request"
      | "authentication_error"
      | "not_found"
      | "rate_limited"
      | "timeout"
      | "upstream_error"
      | "invalid_response",
    readonly status?: number,
  ) {
    super(message);
    this.name = "GBizInfoApiError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((item): item is string => item !== null);
}

function normalizeCertification(item: JsonRecord) {
  return {
    title: asString(item.title),
    target: asString(item.target),
    category: asString(item.category),
    governmentDepartments: asString(item.government_departments),
    dateOfApproval: asString(item.date_of_approval),
  };
}

function normalizeSubsidy(item: JsonRecord) {
  return {
    title: asString(item.title),
    target: asString(item.target),
    amount: asString(item.amount),
    governmentDepartments: asString(item.government_departments),
    dateOfApproval: asString(item.date_of_approval),
  };
}

function newestFirst<T extends { dateOfApproval: string | null }>(
  items: T[],
): T[] {
  return items.sort((left, right) => {
    const leftTime = left.dateOfApproval
      ? Date.parse(left.dateOfApproval)
      : Number.NaN;
    const rightTime = right.dateOfApproval
      ? Date.parse(right.dateOfApproval)
      : Number.NaN;
    if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
    if (!Number.isFinite(leftTime)) return 1;
    if (!Number.isFinite(rightTime)) return -1;
    return rightTime - leftTime;
  });
}

function normalizeProfile(item: JsonRecord): CompanyProfile {
  const corporateNumber = asString(item.corporate_number);
  if (!corporateNumber) {
    throw new GBizInfoApiError(
      "gBizINFOの応答に法人番号がありません。",
      "invalid_response",
    );
  }
  return {
    corporateNumber,
    name: asString(item.name),
    kana: asString(item.kana),
    nameEnglish: asString(item.name_en),
    kind: asString(item.kind),
    postalCode: asString(item.postal_code),
    location: asString(item.location),
    representativeName: asString(item.representative_name),
    capitalStockYen: asNumber(item.capital_stock),
    employeeNumber: asNumber(item.employee_number),
    companyUrl: asString(item.company_url),
    dateOfEstablishment: asString(item.date_of_establishment),
    foundingYear: asNumber(item.founding_year),
    businessSummary: asString(item.business_summary),
    industries: asStrings(item.industry),
    businessItems: asStrings(item.business_items),
    qualificationGrade: asString(item.qualification_grade),
    status: asString(item.status),
    updateDate: asString(item.update_date),
    closeDate: asString(item.close_date),
    closeCause: asString(item.close_cause),
  };
}

async function fetchCompany(
  corporateNumber: string,
  apiToken: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = new URL(
    `${GBIZINFO_BASE_URL}/${encodeURIComponent(corporateNumber)}`,
  );
  url.searchParams.set("metadata_flg", "false");
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-hojinInfo-api-token": apiToken,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const code =
        response.status === 400
          ? "invalid_request"
          : response.status === 401 || response.status === 403
            ? "authentication_error"
            : response.status === 404
              ? "not_found"
              : response.status === 429
                ? "rate_limited"
                : "upstream_error";
      throw new GBizInfoApiError(
        `gBizINFO APIがHTTP ${response.status}を返しました。`,
        code,
        response.status,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new GBizInfoApiError(
        "gBizINFO APIの応答をJSONとして解析できませんでした。",
        "invalid_response",
        response.status,
      );
    }
  } catch (error) {
    if (error instanceof GBizInfoApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new GBizInfoApiError(
        "gBizINFO APIへの接続がタイムアウトしました。",
        "timeout",
      );
    }
    throw new GBizInfoApiError(
      "gBizINFO APIへ接続できませんでした。時間をおいて再試行してください。",
      "upstream_error",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCompanyProfile(
  corporateNumber: string,
  apiToken: string | undefined,
  activityLimit = 20,
) {
  const normalizedNumber = corporateNumber.trim();
  if (!/^\d{13}$/.test(normalizedNumber)) {
    throw new GBizInfoApiError(
      "法人番号は13桁の数字で指定してください。",
      "invalid_request",
      400,
    );
  }
  const normalizedToken = apiToken?.trim();
  if (!normalizedToken) {
    throw new GBizInfoApiError(
      "gBizINFO APIトークンが設定されていません。Cloudflare SecretのGBIZINFO_API_TOKENを設定してください。",
      "configuration_error",
    );
  }
  const limit = Math.min(Math.max(Math.trunc(activityLimit), 1), 50);
  const payload = await fetchCompany(normalizedNumber, normalizedToken);
  if (!isRecord(payload)) {
    throw new GBizInfoApiError(
      "gBizINFO APIからJSONオブジェクト以外の応答が返されました。",
      "invalid_response",
    );
  }
  const item = asRecords(payload["hojin-infos"])[0];
  if (!item) {
    throw new GBizInfoApiError(
      `法人番号「${normalizedNumber}」はgBizINFOで見つかりませんでした。`,
      "not_found",
      404,
    );
  }
  const certifications = newestFirst(
    asRecords(item.certification).map(normalizeCertification),
  );
  const subsidies = newestFirst(asRecords(item.subsidy).map(normalizeSubsidy));

  return {
    source: {
      name: "Gビズインフォ（gBizINFO）",
      apiDocumentationUrl: GBIZINFO_SOURCE_URL,
    },
    retrievedAt: new Date().toISOString(),
    company: normalizeProfile(item),
    activities: {
      certificationCount: certifications.length,
      returnedCertificationCount: Math.min(certifications.length, limit),
      certifications: certifications.slice(0, limit),
      subsidyHistoryCount: subsidies.length,
      returnedSubsidyHistoryCount: Math.min(subsidies.length, limit),
      subsidyHistory: subsidies.slice(0, limit),
      hasMore: certifications.length > limit || subsidies.length > limit,
    },
    caution:
      "gBizINFOの公開情報には未登録・未更新の項目があります。補助金の申請資格や採択実績を保証するものではありません。",
  };
}
