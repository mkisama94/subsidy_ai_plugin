const JGRANTS_SEARCH_URL =
  "https://api.jgrants-portal.go.jp/exp/v1/public/subsidies";
const JGRANTS_DETAIL_URL =
  "https://api.jgrants-portal.go.jp/exp/v2/public/subsidies/id";
const JGRANTS_SOURCE_URL = "https://developers.digital.go.jp/documents/jgrants/api/";
const REQUEST_TIMEOUT_MS = 15_000;

type JsonRecord = Record<string, unknown>;

export type SearchSubsidiesInput = {
  keyword: string;
  usePurpose?: string;
  targetArea?: string;
  industry?: string;
  employeeCount?: number;
  acceptingOnly: boolean;
  sort:
    | "created_date"
    | "acceptance_start_datetime"
    | "acceptance_end_datetime";
  order: "ASC" | "DESC";
  limit: number;
};

export type SubsidySearchItem = {
  id: string;
  referenceNumber: string | null;
  title: string;
  institutionName: string | null;
  targetArea: string | null;
  employeeLimit: string | null;
  subsidyMaxLimitYen: number | null;
  createdAt: string | null;
  acceptanceStart: string | null;
  acceptanceEnd: string | null;
  acceptanceStatus: "scheduled" | "open" | "closed" | "unknown";
  detailUrl: string;
};

export class JGrantsApiError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_request"
      | "not_found"
      | "timeout"
      | "upstream_error"
      | "invalid_response",
    readonly status?: number,
  ) {
    super(message);
    this.name = "JGrantsApiError";
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

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function getResultRecords(payload: unknown): JsonRecord[] {
  if (!isRecord(payload)) {
    throw new JGrantsApiError(
      "JグランツAPIからJSONオブジェクト以外の応答が返されました。",
      "invalid_response",
    );
  }
  return asRecords(payload.result);
}

function getResultCount(payload: unknown, fallback: number): number {
  if (!isRecord(payload) || !isRecord(payload.metadata)) return fallback;
  const resultset = payload.metadata.resultset;
  if (!isRecord(resultset)) return fallback;
  return asNumber(resultset.count) ?? fallback;
}

async function fetchJson(url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      const code =
        response.status === 400
          ? "invalid_request"
          : response.status === 404
            ? "not_found"
            : "upstream_error";
      throw new JGrantsApiError(
        `JグランツAPIがHTTP ${response.status}を返しました。`,
        code,
        response.status,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new JGrantsApiError(
        "JグランツAPIの応答をJSONとして解析できませんでした。",
        "invalid_response",
        response.status,
      );
    }
  } catch (error) {
    if (error instanceof JGrantsApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new JGrantsApiError(
        "JグランツAPIへの接続がタイムアウトしました。",
        "timeout",
      );
    }
    throw new JGrantsApiError(
      "JグランツAPIへ接続できませんでした。時間をおいて再試行してください。",
      "upstream_error",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function getAcceptanceStatus(
  start: string | null,
  end: string | null,
  now = new Date(),
): SubsidySearchItem["acceptanceStatus"] {
  const startMs = start ? Date.parse(start) : Number.NaN;
  const endMs = end ? Date.parse(end) : Number.NaN;
  const nowMs = now.getTime();
  if (Number.isFinite(startMs) && nowMs < startMs) return "scheduled";
  if (Number.isFinite(endMs) && nowMs > endMs) return "closed";
  if (
    (Number.isFinite(startMs) && nowMs >= startMs) ||
    (Number.isFinite(endMs) && nowMs <= endMs)
  ) {
    return "open";
  }
  return "unknown";
}

function normalizeSearchItem(item: JsonRecord): SubsidySearchItem | null {
  const id = asString(item.id);
  const title = asString(item.title);
  if (!id || !title) return null;
  const acceptanceStart = asString(item.acceptance_start_datetime);
  const acceptanceEnd = asString(item.acceptance_end_datetime);
  return {
    id,
    referenceNumber: asString(item.name),
    title,
    institutionName: asString(item.institution_name),
    targetArea: asString(item.target_area_search),
    employeeLimit: asString(item.target_number_of_employees),
    subsidyMaxLimitYen: asNumber(item.subsidy_max_limit),
    createdAt: asString(item.created_date),
    acceptanceStart,
    acceptanceEnd,
    acceptanceStatus: getAcceptanceStatus(acceptanceStart, acceptanceEnd),
    detailUrl: `https://www.jgrants-portal.go.jp/subsidy/${encodeURIComponent(id)}`,
  };
}

function employeeLimitAllows(
  employeeLimit: string | null,
  employeeCount: number | undefined,
): boolean {
  if (employeeCount === undefined || !employeeLimit) return true;
  if (employeeLimit.includes("制約なし")) return true;
  if (employeeLimit.includes("以上")) {
    const minimum = Number(employeeLimit.match(/\d+/)?.[0]);
    return Number.isFinite(minimum) ? employeeCount >= minimum : true;
  }
  const maximum = Number(employeeLimit.match(/\d+/)?.[0]);
  return Number.isFinite(maximum) ? employeeCount <= maximum : true;
}

function createSearchUrl(
  input: SearchSubsidiesInput,
  targetArea?: string,
): URL {
  const url = new URL(JGRANTS_SEARCH_URL);
  url.searchParams.set("keyword", input.keyword.trim());
  url.searchParams.set("sort", input.sort);
  url.searchParams.set("order", input.order);
  url.searchParams.set("acceptance", input.acceptingOnly ? "1" : "0");
  if (input.usePurpose) {
    url.searchParams.set("use_purpose", input.usePurpose.trim());
  }
  if (input.industry) url.searchParams.set("industry", input.industry.trim());
  if (targetArea) url.searchParams.set("target_area_search", targetArea.trim());
  return url;
}

function sortSubsidies(
  items: SubsidySearchItem[],
  sort: SearchSubsidiesInput["sort"],
  order: SearchSubsidiesInput["order"],
): SubsidySearchItem[] {
  const field =
    sort === "created_date"
      ? "createdAt"
      : sort === "acceptance_start_datetime"
        ? "acceptanceStart"
        : "acceptanceEnd";
  const direction = order === "ASC" ? 1 : -1;
  return items.sort((left, right) => {
    const leftMs = left[field] ? Date.parse(left[field]) : Number.NaN;
    const rightMs = right[field] ? Date.parse(right[field]) : Number.NaN;
    if (!Number.isFinite(leftMs) && !Number.isFinite(rightMs)) return 0;
    if (!Number.isFinite(leftMs)) return 1;
    if (!Number.isFinite(rightMs)) return -1;
    return (leftMs - rightMs) * direction;
  });
}

export async function searchSubsidies(input: SearchSubsidiesInput) {
  const targetAreas = input.targetArea?.trim()
    ? input.targetArea.trim() === "全国"
      ? ["全国"]
      : [input.targetArea.trim(), "全国"]
    : [undefined];
  const payloads = await Promise.all(
    targetAreas.map((targetArea) => fetchJson(createSearchUrl(input, targetArea))),
  );
  const unique = new Map<string, SubsidySearchItem>();
  let upstreamCount = 0;

  for (const payload of payloads) {
    const records = getResultRecords(payload);
    upstreamCount += getResultCount(payload, records.length);
    for (const record of records) {
      const normalized = normalizeSearchItem(record);
      if (normalized) unique.set(normalized.id, normalized);
    }
  }

  const matching = sortSubsidies([...unique.values()], input.sort, input.order)
    .filter((item) => employeeLimitAllows(item.employeeLimit, input.employeeCount))
    .filter((item) => !input.acceptingOnly || item.acceptanceStatus === "open");

  return {
    source: {
      name: "Jグランツ（jGrants）",
      apiDocumentationUrl: JGRANTS_SOURCE_URL,
    },
    retrievedAt: new Date().toISOString(),
    query: {
      keyword: input.keyword.trim(),
      usePurpose: input.usePurpose?.trim() || null,
      targetArea: input.targetArea?.trim() || null,
      includesNationwidePrograms: Boolean(
        input.targetArea?.trim() && input.targetArea.trim() !== "全国",
      ),
      industry: input.industry?.trim() || null,
      employeeCount: input.employeeCount ?? null,
      acceptingOnly: input.acceptingOnly,
      sort: input.sort,
      order: input.order,
      limit: input.limit,
    },
    upstreamCount,
    matchingCount: matching.length,
    returnedCount: Math.min(matching.length, input.limit),
    hasMore: matching.length > input.limit,
    subsidies: matching.slice(0, input.limit),
    caution:
      "検索結果だけで対象可否を断定せず、詳細情報と最新の公募要領を確認してください。",
  };
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1]?.toLowerCase() === "x";
      const parsed = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function htmlToText(value: string | null): string | null {
  if (!value) return null;
  const withBreaks = value
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeHtmlEntities(withBreaks)
    .replace(/\uFEFF/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeWorkflow(workflow: JsonRecord) {
  const start = asString(workflow.acceptance_start_datetime);
  const end = asString(workflow.acceptance_end_datetime);
  return {
    id: asString(workflow.id),
    fiscalYearRound: asString(workflow.fiscal_year_round),
    targetArea: asString(workflow.target_area_search),
    targetAreaDetail: asString(workflow.target_area_detail),
    acceptanceStart: start,
    acceptanceEnd: end,
    acceptanceStatus: getAcceptanceStatus(start, end),
    projectEndDeadline: asString(workflow.project_end_deadline),
  };
}

function estimateBase64Bytes(data: string | null): number | null {
  if (!data) return null;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function normalizeDocuments(value: unknown, type: string) {
  return asRecords(value).map((document) => {
    const data = asString(document.data);
    return {
      type,
      name: asString(document.name) ?? "名称未設定",
      availableFromDetailApi: Boolean(data),
      approximateSizeBytes: estimateBase64Bytes(data),
    };
  });
}

export async function getSubsidyDetail(subsidyId: string) {
  const url = new URL(
    `${JGRANTS_DETAIL_URL}/${encodeURIComponent(subsidyId.trim())}`,
  );
  const payload = await fetchJson(url);
  const item = getResultRecords(payload)[0];
  if (!item) {
    throw new JGrantsApiError(
      `補助金ID「${subsidyId}」は見つかりませんでした。`,
      "not_found",
      404,
    );
  }

  const id = asString(item.id) ?? subsidyId.trim();
  const workflows = asRecords(item.workflow).map(normalizeWorkflow);
  const documents = [
    ...normalizeDocuments(item.application_guidelines, "application_guidelines"),
    ...normalizeDocuments(item.outline_of_grant, "outline_of_grant"),
    ...normalizeDocuments(item.application_form, "application_form"),
  ];

  return {
    source: {
      name: "Jグランツ（jGrants）",
      apiDocumentationUrl: JGRANTS_SOURCE_URL,
    },
    retrievedAt: new Date().toISOString(),
    subsidy: {
      id,
      referenceNumber: asString(item.name),
      title: asString(item.title) ?? "名称未設定",
      catchPhrase: asString(item.subsidy_catch_phrase),
      description: htmlToText(asString(item.detail)),
      institutionName: asString(item.institution_name),
      usePurpose: asString(item.use_purpose),
      industry: asString(item.industry),
      employeeLimit: asString(item.target_number_of_employees),
      subsidyRate: asString(item.subsidy_rate),
      subsidyMaxLimitYen: asNumber(item.subsidy_max_limit),
      requestReceptionPresence: asString(item.request_reception_presence),
      multipleApplicationsAllowed: asBoolean(item.is_enable_multiple_request),
      grantType: asString(item.granttype),
      detailUrl:
        asString(item.front_subsidy_detail_page_url) ??
        `https://www.jgrants-portal.go.jp/subsidy/${encodeURIComponent(id)}`,
      workflows,
      documents,
    },
    caution:
      "この情報は参考情報です。申請前に最新の公募要領を確認し、必要に応じて実施機関へ問い合わせてください。",
  };
}
