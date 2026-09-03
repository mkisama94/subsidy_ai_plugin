import { GBizInfoApiError } from "./gbizinfo";

const GBIZINFO_BASE_URL = "https://api.info.gbiz.go.jp/hojin/v2/hojin";
const GBIZINFO_SOURCE_URL = "https://content.info.gbiz.go.jp/api/index.html";
const REQUEST_TIMEOUT_MS = 15_000;

type JsonRecord = Record<string, unknown>;

export const GBIZINFO_ACTIVITY_TYPES = [
  "certification",
  "commendation",
  "corporation",
  "finance",
  "patent",
  "procurement",
  "subsidy",
  "workplace",
] as const;

export type GBizInfoActivityType =
  (typeof GBIZINFO_ACTIVITY_TYPES)[number];

const RESPONSE_FIELDS: Record<GBizInfoActivityType, string> = {
  certification: "certification",
  commendation: "commendation",
  corporation: "corporation-info",
  finance: "finance",
  patent: "patent",
  procurement: "procurement",
  subsidy: "subsidy",
  workplace: "workplace_info",
};

const SINGLE_OBJECT_TYPES = new Set<GBizInfoActivityType>([
  "finance",
  "workplace",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function requireApiToken(apiToken: string | undefined): string {
  const normalizedToken = apiToken?.trim();
  if (!normalizedToken) {
    throw new GBizInfoApiError(
      "gBizINFO APIトークンが設定されていません。Cloudflare SecretのGBIZINFO_API_TOKENを設定してください。",
      "configuration_error",
    );
  }
  return normalizedToken;
}

function validateCorporateNumber(corporateNumber: string): string {
  const normalized = corporateNumber.trim();
  if (!/^\d{13}$/.test(normalized)) {
    throw new GBizInfoApiError(
      "法人番号は13桁の数字で指定してください。",
      "invalid_request",
      400,
    );
  }
  return normalized;
}

async function fetchJson(url: URL, apiToken: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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

function camelCaseKey(key: string): string {
  return key.replace(/[-_]([a-z])/gu, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function sanitizeValue(value: unknown, arrayLimit: number, depth = 0): unknown {
  if (depth > 8) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, arrayLimit)
      .map((item) => sanitizeValue(item, arrayLimit, depth + 1));
  }
  if (!isRecord(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "meta-data")
      .map(([key, item]) => [
        camelCaseKey(key),
        sanitizeValue(item, arrayLimit, depth + 1),
      ]),
  );
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (isRecord(value)) return Object.values(value).some(hasMeaningfulValue);
  return true;
}

function activityDate(type: GBizInfoActivityType, item: unknown): string | null {
  if (!isRecord(item)) return null;
  const field =
    type === "commendation"
      ? "dateOfCommendation"
      : type === "patent"
        ? "applicationDate"
        : type === "procurement"
          ? "dateOfOrder"
          : type === "corporation"
            ? "lossDate"
            : "dateOfApproval";
  const value = item[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function newestFirst(
  type: GBizInfoActivityType,
  items: unknown[],
): unknown[] {
  return items.sort((left, right) => {
    const leftDate = activityDate(type, left);
    const rightDate = activityDate(type, right);
    const leftTime = leftDate ? Date.parse(leftDate) : Number.NaN;
    const rightTime = rightDate ? Date.parse(rightDate) : Number.NaN;
    if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
    if (!Number.isFinite(leftTime)) return 1;
    if (!Number.isFinite(rightTime)) return -1;
    return rightTime - leftTime;
  });
}

async function fetchActivity(
  corporateNumber: string,
  type: GBizInfoActivityType,
  apiToken: string,
  limit: number,
) {
  const url = new URL(
    `${GBIZINFO_BASE_URL}/${encodeURIComponent(corporateNumber)}/${type}`,
  );
  url.searchParams.set("metadata_flg", "false");
  const payload = await fetchJson(url, apiToken);
  if (!isRecord(payload)) {
    throw new GBizInfoApiError(
      `gBizINFOの${type}応答がJSONオブジェクトではありません。`,
      "invalid_response",
    );
  }
  const company = asRecords(payload["hojin-infos"])[0];
  if (!company) {
    return {
      type,
      totalCount: 0,
      returnedCount: 0,
      hasMore: false,
      items: [],
    };
  }
  const rawValue = company[RESPONSE_FIELDS[type]];
  if (SINGLE_OBJECT_TYPES.has(type)) {
    const sanitized = sanitizeValue(rawValue, limit);
    const items = hasMeaningfulValue(sanitized) ? [sanitized] : [];
    return {
      type,
      totalCount: items.length,
      returnedCount: items.length,
      hasMore: false,
      items,
    };
  }
  const rawItems = Array.isArray(rawValue) ? rawValue : [];
  const sanitizedItems = newestFirst(
    type,
    rawItems
      .map((item) => sanitizeValue(item, limit))
      .filter(hasMeaningfulValue),
  );
  return {
    type,
    totalCount: sanitizedItems.length,
    returnedCount: Math.min(sanitizedItems.length, limit),
    hasMore: sanitizedItems.length > limit,
    items: sanitizedItems.slice(0, limit),
  };
}

async function fetchReportedActivityCount(
  corporateNumber: string,
  apiToken: string,
): Promise<number | null> {
  const url = new URL(GBIZINFO_BASE_URL);
  url.searchParams.set("corporate_number", corporateNumber);
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", "1");
  url.searchParams.set("metadata_flg", "false");
  const payload = await fetchJson(url, apiToken);
  if (!isRecord(payload)) return null;
  const company = asRecords(payload["hojin-infos"]).find(
    (item) => item.corporate_number === corporateNumber,
  );
  return company ? asNumber(company.number_of_activity) : null;
}

function publicError(error: unknown) {
  if (error instanceof GBizInfoApiError) {
    return {
      code: error.code,
      message: error.message,
      retryable:
        error.code === "timeout" ||
        error.code === "upstream_error" ||
        error.code === "rate_limited",
    };
  }
  return {
    code: "internal_error",
    message: "活動情報の取得中に予期しないエラーが発生しました。",
    retryable: false,
  };
}

export async function getCompanyActivities(
  corporateNumber: string,
  apiToken: string | undefined,
  activityTypes: GBizInfoActivityType[] = [...GBIZINFO_ACTIVITY_TYPES],
  activityLimit = 20,
) {
  const normalizedNumber = validateCorporateNumber(corporateNumber);
  const normalizedToken = requireApiToken(apiToken);
  const limit = Math.min(Math.max(Math.trunc(activityLimit), 1), 50);
  const selectedTypes = [
    ...new Set(
      activityTypes.filter((type) =>
        GBIZINFO_ACTIVITY_TYPES.includes(type),
      ),
    ),
  ];
  if (!selectedTypes.length) {
    throw new GBizInfoApiError(
      "activity_typesを1種類以上指定してください。",
      "invalid_request",
      400,
    );
  }

  const [reportedResult, ...activityResults] = await Promise.allSettled([
    fetchReportedActivityCount(normalizedNumber, normalizedToken),
    ...selectedTypes.map((type) =>
      fetchActivity(normalizedNumber, type, normalizedToken, limit),
    ),
  ]);

  const activities: Partial<
    Record<GBizInfoActivityType, Awaited<ReturnType<typeof fetchActivity>>>
  > = {};
  const errors: Array<{
    type: GBizInfoActivityType;
    error: ReturnType<typeof publicError>;
  }> = [];
  activityResults.forEach((result, index) => {
    const type = selectedTypes[index];
    if (result.status === "fulfilled") {
      activities[type] = result.value;
    } else {
      errors.push({ type, error: publicError(result.reason) });
    }
  });

  const reportedActivityCount =
    reportedResult.status === "fulfilled" ? reportedResult.value : null;
  const reportedCountError =
    reportedResult.status === "rejected"
      ? publicError(reportedResult.reason)
      : null;
  const retrievedTopLevelItemCount = Object.values(activities).reduce(
    (total, activity) => total + activity.totalCount,
    0,
  );
  const difference =
    reportedActivityCount === null
      ? null
      : reportedActivityCount - retrievedTopLevelItemCount;

  return {
    source: {
      name: "Gビズインフォ（gBizINFO）",
      apiDocumentationUrl: GBIZINFO_SOURCE_URL,
    },
    retrievedAt: new Date().toISOString(),
    corporateNumber: normalizedNumber,
    selectedTypes,
    activityLimit: limit,
    reportedActivityCount,
    retrievedTopLevelItemCount,
    countComparison: {
      status:
        difference === null
          ? "unavailable"
          : difference === 0
            ? "matched"
            : "mismatch",
      difference,
      note:
        "reportedActivityCountは法人検索APIの法人活動情報件数です。retrievedTopLevelItemCountは選択した専用APIから取得した最上位項目数であり、財務・職場情報など複合オブジェクトの数え方により一致しない場合があります。",
    },
    activities,
    errors,
    reportedCountError,
    partial: errors.length > 0 || reportedCountError !== null,
    caution:
      "活動情報は各府省等の公開情報をgBizINFOが集約したものです。未登録や更新時差があり、現在の法人状態、権利の有効性、補助金の申請資格や採択を保証しません。",
  };
}
