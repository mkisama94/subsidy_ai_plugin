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
  industryCodes: string[];
  businessItems: string[];
  qualificationGrade: string | null;
  status: string | null;
  statusAvailability: "provided" | "not_provided";
  updateDate: string | null;
  closeDate: string | null;
  closeCause: string | null;
};

export type CompanySearchInput = {
  name: string;
  prefecture?: string;
  city?: string;
  page?: number;
  limit?: number;
};

export type CompanySearchCandidate = {
  corporateNumber: string;
  name: string | null;
  nameEnglish: string | null;
  postalCode: string | null;
  location: string | null;
  status: string | null;
  statusAvailability: "provided" | "not_provided";
  updateDate: string | null;
  activityCount: number | null;
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

const EMPTY_PLACEHOLDERS = new Set(["-", "－", "―", "—", "‐", "なし", "無し"]);

function asNullableString(value: unknown): string | null {
  const normalized = asString(value);
  return normalized && !EMPTY_PLACEHOLDERS.has(normalized) ? normalized : null;
}

function asUrl(value: unknown): string | null {
  const normalized = asNullableString(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
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
  return value
    .map(asNullableString)
    .filter((item): item is string => item !== null);
}

const INDUSTRY_MAJOR_LABELS: Record<string, string> = {
  A: "農業、林業",
  B: "漁業",
  C: "鉱業、採石業、砂利採取業",
  D: "建設業",
  E: "製造業",
  F: "電気・ガス・熱供給・水道業",
  G: "情報通信業",
  H: "運輸業、郵便業",
  I: "卸売業、小売業",
  J: "金融業、保険業",
  K: "不動産業、物品賃貸業",
  L: "学術研究、専門・技術サービス業",
  M: "宿泊業、飲食サービス業",
  N: "生活関連サービス業、娯楽業",
  O: "教育、学習支援業",
  P: "医療、福祉",
  Q: "複合サービス事業",
  R: "サービス業（他に分類されないもの）",
  S: "公務（他に分類されるものを除く）",
  T: "分類不能の産業",
};

function normalizeIndustries(value: unknown) {
  const rawValues = asStrings(value);
  const codes: string[] = [];
  const labels = rawValues.map((item) => {
    const code = item.normalize("NFKC").toUpperCase();
    const label = INDUSTRY_MAJOR_LABELS[code];
    if (label) codes.push(code);
    return label ?? item;
  });
  return {
    codes: [...new Set(codes)],
    labels: [...new Set(labels)],
  };
}

function normalizeQualificationGrade(value: unknown): string | null {
  const normalized = asNullableString(value);
  if (!normalized) return null;
  const grades = normalized
    .split(/[、,，/／]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return grades.length ? [...new Set(grades)].join("、") : null;
}

function normalizeProfile(item: JsonRecord): CompanyProfile {
  const corporateNumber = asString(item.corporate_number);
  if (!corporateNumber) {
    throw new GBizInfoApiError(
      "gBizINFOの応答に法人番号がありません。",
      "invalid_response",
    );
  }
  const industries = normalizeIndustries(item.industry);
  const status = asNullableString(item.status);
  return {
    corporateNumber,
    name: asNullableString(item.name),
    kana: asNullableString(item.kana),
    nameEnglish: asNullableString(item.name_en),
    kind: asNullableString(item.kind),
    postalCode: asNullableString(item.postal_code),
    location: asNullableString(item.location),
    representativeName: asNullableString(item.representative_name),
    capitalStockYen: asNumber(item.capital_stock),
    employeeNumber: asNumber(item.employee_number),
    companyUrl: asUrl(item.company_url),
    dateOfEstablishment: asNullableString(item.date_of_establishment),
    foundingYear: asNumber(item.founding_year),
    businessSummary: asNullableString(item.business_summary),
    industries: industries.labels,
    industryCodes: industries.codes,
    businessItems: asStrings(item.business_items),
    qualificationGrade: normalizeQualificationGrade(item.qualification_grade),
    status,
    statusAvailability: status ? "provided" : "not_provided",
    updateDate: asNullableString(item.update_date),
    closeDate: asNullableString(item.close_date),
    closeCause: asNullableString(item.close_cause),
  };
}

function normalizeSearchCandidate(item: JsonRecord): CompanySearchCandidate {
  const corporateNumber = asString(item.corporate_number);
  if (!corporateNumber) {
    throw new GBizInfoApiError(
      "gBizINFOの検索応答に法人番号がありません。",
      "invalid_response",
    );
  }
  const status = asNullableString(item.status);
  return {
    corporateNumber,
    name: asNullableString(item.name),
    nameEnglish: asNullableString(item.name_en),
    postalCode: asNullableString(item.postal_code),
    location: asNullableString(item.location),
    status,
    statusAvailability: status ? "provided" : "not_provided",
    updateDate: asNullableString(item.update_date),
    activityCount: asNumber(item.number_of_activity),
  };
}

async function fetchGBizInfo(
  url: URL,
  apiToken: string,
): Promise<unknown> {
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
  const normalizedToken = requireApiToken(apiToken);
  const limit = Math.min(Math.max(Math.trunc(activityLimit), 1), 50);
  const url = new URL(
    `${GBIZINFO_BASE_URL}/${encodeURIComponent(normalizedNumber)}`,
  );
  url.searchParams.set("metadata_flg", "false");
  const payload = await fetchGBizInfo(url, normalizedToken);
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
  return {
    source: {
      name: "Gビズインフォ（gBizINFO）",
      apiDocumentationUrl: GBIZINFO_SOURCE_URL,
    },
    retrievedAt: new Date().toISOString(),
    company: normalizeProfile(item),
    activities: {
      status: "not_fetched" as const,
      certificationCount: null,
      returnedCertificationCount: 0,
      certifications: [],
      subsidyHistoryCount: null,
      returnedSubsidyHistoryCount: 0,
      subsidyHistory: [],
      hasMore: null,
      activityLimit: limit,
      nextTool: "get_company_activities",
      note:
        "法人基本情報APIだけでは活動情報の完全性を保証できないため、この応答では活動件数を0件と断定しません。活動情報はget_company_activitiesで専用APIから取得してください。",
    },
    statusPolicy:
      "statusAvailabilityがnot_providedの場合、登記中・存続中とは断定できません。状態情報が取得できていないものとして扱ってください。",
    caution:
      "gBizINFOの公開情報には未登録・未更新の項目があります。補助金の申請資格や採択実績を保証するものではありません。",
  };
}

export async function searchCompanies(
  input: CompanySearchInput,
  apiToken: string | undefined,
) {
  const name = input.name.trim();
  if (!name || name.length > 200) {
    throw new GBizInfoApiError(
      "法人名は1〜200文字で指定してください。",
      "invalid_request",
      400,
    );
  }
  const prefecture = input.prefecture?.trim();
  const city = input.city?.trim();
  if (prefecture && prefecture.length > 20) {
    throw new GBizInfoApiError(
      "都道府県は20文字以内で指定してください。",
      "invalid_request",
      400,
    );
  }
  if (city && city.length > 100) {
    throw new GBizInfoApiError(
      "市区町村は100文字以内で指定してください。",
      "invalid_request",
      400,
    );
  }

  const page = Math.min(Math.max(Math.trunc(input.page ?? 1), 1), 10_000);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 10), 1), 20);
  const url = new URL(GBIZINFO_BASE_URL);
  url.searchParams.set("name", name);
  if (prefecture) url.searchParams.set("prefecture", prefecture);
  if (city) url.searchParams.set("city", city);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("metadata_flg", "false");

  const payload = await fetchGBizInfo(url, requireApiToken(apiToken));
  if (!isRecord(payload)) {
    throw new GBizInfoApiError(
      "gBizINFO APIからJSONオブジェクト以外の応答が返されました。",
      "invalid_response",
    );
  }
  const candidates = asRecords(payload["hojin-infos"]).map(
    normalizeSearchCandidate,
  );
  const mayHaveMore = candidates.length === limit;
  const selectionStatus =
    candidates.length === 0
      ? "no_match"
      : candidates.length === 1 && !mayHaveMore
        ? "unique"
        : "ambiguous";

  return {
    source: {
      name: "Gビズインフォ（gBizINFO）",
      apiDocumentationUrl: GBIZINFO_SOURCE_URL,
    },
    retrievedAt: new Date().toISOString(),
    query: {
      name,
      prefecture: prefecture || null,
      city: city || null,
      page,
      limit,
    },
    selectionStatus,
    requiresSelection: selectionStatus === "ambiguous",
    returnedCount: candidates.length,
    mayHaveMore,
    resultScope: mayHaveMore
      ? `第${page}ページの先頭${limit}件。次ページに候補が存在する可能性があります。`
      : `第${page}ページで返された${candidates.length}件。`,
    candidates,
    nextStep:
      selectionStatus === "unique"
        ? "唯一の候補の法人番号をget_company_profileに渡して詳細を確認してください。"
        : selectionStatus === "ambiguous"
          ? mayHaveMore
            ? "これは先頭ページの候補です。所在地や正式名称で絞り込むか次ページを確認し、候補を自動決定せず法人番号を選択してください。"
            : "所在地や正式名称を利用者に確認し、候補を自動決定せず法人番号を選択してください。"
          : "名称の表記を変えるか、都道府県・市区町村を追加して再検索してください。",
    statusPolicy:
      "候補のstatusAvailabilityがnot_providedの場合、登記中・存続中とは断定せず、状態情報なしと表示してください。",
    caution:
      "名称検索は法人を一意に特定できない場合があります。所在地と法人番号を確認してから企業プロフィールや補助金適合度判定へ進んでください。",
  };
}
