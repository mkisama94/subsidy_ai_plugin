import { unzipSync } from "fflate";

const EDINET_API_BASE_URL = "https://api.edinet-fsa.go.jp/api/v2";
const EDINET_CODE_LIST_URL =
  "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip";
const EDINET_SOURCE_URL =
  "https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WZEK0110.html";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
const MAX_EVIDENCE_ITEMS = 2;

type JsonRecord = Record<string, unknown>;

export type CorporateRelationshipStatus =
  | "confirmed"
  | "possible"
  | "not_found_in_checked_filing"
  | "unknown";

export type VerifyCorporateRelationshipInput = {
  targetCompanyName: string;
  targetCorporateNumber?: string;
  parentCompanyName: string;
  parentCorporateNumber?: string;
  filingDate?: string;
  documentId?: string;
};

export type EdinetCodeCandidate = {
  edinetCode: string;
  name: string;
  nameEnglish: string | null;
  corporateNumber: string | null;
  securitiesCode: string | null;
  fiscalYearEnd: string | null;
  location: string | null;
};

type EdinetDocument = {
  docID: string;
  edinetCode: string | null;
  filerName: string | null;
  docDescription: string | null;
  docTypeCode: string | null;
  submitDateTime: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  csvFlag: string | null;
  legalStatus: string | null;
};

export class EdinetApiError extends Error {
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
    this.name = "EdinetApiError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeCompanyName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・･.,，、'"“”‘’()（）\-‐‑–—―]/gu, "")
    .replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/u, "")
    .replace(/(株式会社|有限会社|合同会社|合資会社|合名会社)$/u, "");
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("shift_jis").decode(bytes);
    } catch {
      throw new EdinetApiError(
        "EDINETが返したCSVの文字コードを解釈できませんでした。",
        "invalid_response",
      );
    }
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}

function unzipArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new EdinetApiError(
      "EDINETの取得ファイルが安全上の上限を超えています。",
      "invalid_response",
    );
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new EdinetApiError(
      "EDINETのZIPファイルを展開できませんでした。",
      "invalid_response",
    );
  }
  const totalSize = Object.values(files).reduce(
    (sum, file) => sum + file.byteLength,
    0,
  );
  if (totalSize > MAX_UNCOMPRESSED_BYTES) {
    throw new EdinetApiError(
      "EDINETの展開後ファイルが安全上の上限を超えています。",
      "invalid_response",
    );
  }
  return files;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "application/json, application/zip, */*" },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new EdinetApiError(
        "EDINET APIへの接続がタイムアウトしました。",
        "timeout",
      );
    }
    throw new EdinetApiError(
      "EDINET APIへ接続できませんでした。",
      "upstream_error",
    );
  }
}

async function checkedResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  const code =
    response.status === 401 || response.status === 403
      ? "authentication_error"
      : response.status === 404
        ? "not_found"
        : response.status === 429
          ? "rate_limited"
          : response.status >= 500
            ? "upstream_error"
            : "invalid_request";
  throw new EdinetApiError(
    `EDINET APIがHTTP ${response.status}を返しました。`,
    code,
    response.status,
  );
}

async function fetchArchive(url: string): Promise<Record<string, Uint8Array>> {
  const response = await checkedResponse(await fetchWithTimeout(url));
  return unzipArchive(new Uint8Array(await response.arrayBuffer()));
}

export function parseEdinetCodeList(
  files: Record<string, Uint8Array>,
): EdinetCodeCandidate[] {
  const entry = Object.entries(files).find(([name]) =>
    name.toLowerCase().endsWith(".csv"),
  );
  if (!entry) {
    throw new EdinetApiError(
      "EDINETコード一覧にCSVが含まれていません。",
      "invalid_response",
    );
  }
  return parseCsv(decodeText(entry[1]))
    .filter((row) => /^E\d{5}$/u.test(row[0]?.trim() ?? ""))
    .map((row) => ({
      edinetCode: row[0]!.trim(),
      fiscalYearEnd: asString(row[5]),
      name: asString(row[6]) ?? "",
      nameEnglish: asString(row[7]),
      location: asString(row[9]),
      securitiesCode: asString(row[11]),
      corporateNumber: asString(row[12]),
    }))
    .filter((candidate) => candidate.name.length > 0);
}

async function resolveParentCandidates(
  parentName: string,
  parentCorporateNumber?: string,
): Promise<EdinetCodeCandidate[]> {
  const candidates = parseEdinetCodeList(
    await fetchArchive(EDINET_CODE_LIST_URL),
  );
  if (parentCorporateNumber) {
    return candidates.filter(
      (candidate) => candidate.corporateNumber === parentCorporateNumber,
    );
  }
  const normalized = normalizeCompanyName(parentName);
  return candidates.filter(
    (candidate) => normalizeCompanyName(candidate.name) === normalized,
  );
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function inferredFilingDates(
  fiscalYearEnd: string,
  now = new Date(),
): string[] {
  const match = fiscalYearEnd
    .normalize("NFKC")
    .match(/(\d{1,2})月(?:(\d{1,2})日|(末日?))/u);
  if (!match) return [];
  const month = Number(match[1]);
  const explicitDay = match[2] ? Number(match[2]) : null;
  const closingForYear = (year: number) => {
    const day =
      explicitDay ?? new Date(Date.UTC(year, month, 0)).getUTCDate();
    return new Date(Date.UTC(year, month - 1, day));
  };
  let closing = closingForYear(now.getUTCFullYear());
  if (closing.getTime() > addUtcDays(now, -65).getTime()) {
    closing = closingForYear(now.getUTCFullYear() - 1);
  }
  const start = addUtcDays(closing, 65);
  return Array.from({ length: 40 }, (_, index) =>
    formatDate(addUtcDays(start, index)),
  ).filter((date) => date <= formatDate(now));
}

function normalizeDocument(value: JsonRecord): EdinetDocument | null {
  const docID = asString(value.docID);
  if (!docID) return null;
  return {
    docID,
    edinetCode: asString(value.edinetCode),
    filerName: asString(value.filerName),
    docDescription: asString(value.docDescription),
    docTypeCode: asString(value.docTypeCode),
    submitDateTime: asString(value.submitDateTime),
    periodStart: asString(value.periodStart),
    periodEnd: asString(value.periodEnd),
    csvFlag: asString(value.csvFlag),
    legalStatus: asString(value.legalStatus),
  };
}

async function fetchDocumentsForDate(
  date: string,
  apiKey: string,
): Promise<EdinetDocument[]> {
  const url = new URL(`${EDINET_API_BASE_URL}/documents.json`);
  url.searchParams.set("date", date);
  url.searchParams.set("type", "2");
  url.searchParams.set("Subscription-Key", apiKey);
  const response = await checkedResponse(await fetchWithTimeout(url.toString()));
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EdinetApiError(
      "EDINETの書類一覧がJSONではありませんでした。",
      "invalid_response",
    );
  }
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new EdinetApiError(
      "EDINETの書類一覧形式を解釈できませんでした。",
      "invalid_response",
    );
  }
  return payload.results
    .filter(isRecord)
    .map(normalizeDocument)
    .filter((document): document is EdinetDocument => document !== null);
}

async function findLatestAnnualReport(
  parent: EdinetCodeCandidate,
  apiKey: string,
  filingDate?: string,
  documentId?: string,
): Promise<{ document: EdinetDocument | null; checkedDates: string[] }> {
  const dates = filingDate
    ? [filingDate]
    : parent.fiscalYearEnd
      ? inferredFilingDates(parent.fiscalYearEnd)
      : [];
  if (!dates.length) return { document: null, checkedDates: [] };

  const datesNewestFirst = [...dates].reverse();
  const checkedDates: string[] = [];
  for (let index = 0; index < datesNewestFirst.length; index += 8) {
    const batch = datesNewestFirst.slice(index, index + 8);
    const results = await Promise.all(
      batch.map((date) => fetchDocumentsForDate(date, apiKey)),
    );
    checkedDates.push(...batch);
    const annualReports = results
      .flat()
      .filter(
        (document) =>
          document.edinetCode === parent.edinetCode &&
          (document.docTypeCode === "120" ||
            document.docDescription?.includes("有価証券報告書")) &&
          !document.docDescription?.includes("訂正") &&
          document.csvFlag === "1" &&
          (document.legalStatus === "1" || document.legalStatus === "2") &&
          (!documentId || document.docID === documentId),
      )
      .sort((left, right) =>
        (right.submitDateTime ?? "").localeCompare(left.submitDateTime ?? ""),
      );
    if (annualReports.length) {
      return { document: annualReports[0]!, checkedDates };
    }
  }
  return { document: null, checkedDates };
}
function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
}

function targetEvidenceSegment(value: string, targetCompanyName: string): string {
  const compact = stripMarkup(value).normalize("NFKC").replace(/\s+/gu, "");
  const target = normalizeCompanyName(targetCompanyName);
  const targetIndex = compact.toLowerCase().indexOf(target);
  if (targetIndex < 0) return compact.slice(0, 500);

  const relationshipMarker = /\((?:連結)?(?:子会社|関連会社|親会社)[^)]*\)/gu;
  const markers = [...compact.matchAll(relationshipMarker)].map((match) => ({
    index: match.index,
  }));
  const currentMarker = markers
    .filter((marker) => marker.index <= targetIndex)
    .at(-1);
  const nextMarker = markers.find((marker) => marker.index > targetIndex);
  const start = currentMarker?.index ?? Math.max(0, targetIndex - 120);
  const end = nextMarker?.index ?? targetIndex + target.length + 320;
  return compact.slice(start, Math.min(compact.length, end, start + 700));
}

function evidencePriority(itemId: string | null, itemName: string | null): number {
  const value = `${itemId ?? ""} ${itemName ?? ""}`;
  if (/OverviewOfAffiliatedEntitiesTextBlock|関係会社の状況/u.test(value)) return 0;
  if (/NumberOfConsolidatedSubsidiaries|連結子会社の数/u.test(value)) return 1;
  if (/DescriptionOfBusinessTextBlock|事業の内容/u.test(value)) return 2;
  if (/ConsolidatedFinancialStatements|連結の範囲/u.test(value)) return 3;
  return 10;
}

function checkedDateRange(dates: string[]) {
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  return {
    from: sorted[0]!,
    to: sorted.at(-1)!,
    count: sorted.length,
  };
}

function inspectRelationshipCsv(
  files: Record<string, Uint8Array>,
  targetCompanyName: string,
) {
  const normalizedTarget = normalizeCompanyName(targetCompanyName);
  const evidence: Array<{
    file: string;
    itemId: string | null;
    itemName: string | null;
    snippet: string;
    priority: number;
  }> = [];

  for (const [file, bytes] of Object.entries(files)) {
    if (!file.toLowerCase().endsWith(".csv")) continue;
    for (const row of parseCsv(decodeText(bytes))) {
      const fields = row.flatMap((cell) => cell.split("\t"));
      const matchingCell = fields.find((cell) =>
        normalizeCompanyName(stripMarkup(cell)).includes(normalizedTarget),
      );
      if (!matchingCell) continue;
      const itemIdIndex = fields.findIndex((field) =>
        /^[A-Za-z][A-Za-z0-9_]*:[A-Za-z0-9_]+$/u.test(field.trim()),
      );
      const itemId = asString(fields[itemIdIndex >= 0 ? itemIdIndex : 0]);
      const itemName = asString(fields[itemIdIndex >= 0 ? itemIdIndex + 1 : 1]);
      evidence.push({
        file,
        itemId,
        itemName: itemName?.slice(0, 160) ?? null,
        snippet: targetEvidenceSegment(matchingCell, targetCompanyName),
        priority: evidencePriority(itemId, itemName),
      });
    }
  }

  evidence.sort((left, right) => left.priority - right.priority);
  const selectedEvidence = evidence.slice(0, MAX_EVIDENCE_ITEMS);
  const primaryEvidence = selectedEvidence[0];
  const combined = selectedEvidence.map((item) => item.snippet).join(" ");
  const relationshipWords = [
    "子会社",
    "連結子会社",
    "関係会社",
    "親会社",
    "議決権",
    "所有割合",
    "出資比率",
  ];
  const hasRelationshipContext = relationshipWords.some((word) =>
    combined.includes(word),
  );
  const percentages = [
    ...new Set(
      [
        ...(primaryEvidence?.snippet ?? "").matchAll(
          /(?:\d{1,3}(?:\.\d+)?)\s*[%％]/gu,
        ),
      ].map((match) => match[0].replace("％", "%")),
    ),
  ].slice(0, 10);

  return {
    evidence: selectedEvidence.map(({ priority: _priority, ...item }) => item),
    hasRelationshipContext,
    percentages,
  };
}
function unknownResult(
  input: VerifyCorporateRelationshipInput,
  reason: string,
  parentCandidates: EdinetCodeCandidate[] = [],
  checkedDates: string[] = [],
) {
  return {
    source: { name: "EDINET（金融庁）", apiDocumentationUrl: EDINET_SOURCE_URL },
    retrievedAt: new Date().toISOString(),
    query: input,
    assessment: {
      status: "unknown" as const,
      reason,
      parentCandidates,
      checkedDateRange: checkedDateRange(checkedDates),
      evidence: [],
    },
    caution:
      "EDINETで確認できないことは、資本関係が存在しないことを意味しません。最新の公募要領と株主構成・役員構成を確認してください。",
  };
}

export async function verifyCorporateRelationship(
  input: VerifyCorporateRelationshipInput,
  apiKey?: string,
) {
  if (!apiKey?.trim()) {
    throw new EdinetApiError(
      "EDINET_API_KEYが設定されていません。Cloudflare Secretとして登録してください。",
      "configuration_error",
    );
  }
  if (input.targetCorporateNumber && !/^\d{13}$/u.test(input.targetCorporateNumber)) {
    throw new EdinetApiError("対象法人番号は13桁で指定してください。", "invalid_request");
  }
  if (input.parentCorporateNumber && !/^\d{13}$/u.test(input.parentCorporateNumber)) {
    throw new EdinetApiError("親会社法人番号は13桁で指定してください。", "invalid_request");
  }

  const parentCandidates = await resolveParentCandidates(
    input.parentCompanyName,
    input.parentCorporateNumber,
  );
  if (parentCandidates.length === 0) {
    return unknownResult(
      input,
      "親会社候補をEDINETコード一覧で一意に特定できませんでした。正式名称または法人番号を確認してください。",
    );
  }
  if (parentCandidates.length > 1) {
    return unknownResult(
      input,
      "同名の親会社候補が複数あります。所在地または法人番号で候補を確定してください。",
      parentCandidates.slice(0, 20),
    );
  }
  const parent = parentCandidates[0]!;

  const found = await findLatestAnnualReport(
    parent,
    apiKey,
    input.filingDate,
    input.documentId,
  );
  const document = found.document;
  const checkedDates = found.checkedDates;
  if (!document) {
    return unknownResult(
      input,
      checkedDates.length
        ? "推定した提出期間にCSV取得可能な有価証券報告書が見つかりませんでした。提出日または書類管理番号が分かる場合は指定してください。"
        : "決算期または提出日を特定できず、有価証券報告書を検索できませんでした。提出日または書類管理番号を指定してください。",
      [parent],
      checkedDates,
    );
  }

  const documentUrl = new URL(
    `${EDINET_API_BASE_URL}/documents/${encodeURIComponent(document.docID)}`,
  );
  documentUrl.searchParams.set("type", "5");
  documentUrl.searchParams.set("Subscription-Key", apiKey);
  const inspection = inspectRelationshipCsv(
    await fetchArchive(documentUrl.toString()),
    input.targetCompanyName,
  );
  const status: CorporateRelationshipStatus = inspection.evidence.length
    ? inspection.hasRelationshipContext
      ? "confirmed"
      : "possible"
    : "not_found_in_checked_filing";

  return {
    source: { name: "EDINET（金融庁）", apiDocumentationUrl: EDINET_SOURCE_URL },
    retrievedAt: new Date().toISOString(),
    query: input,
    parent,
    filing: {
      documentId: document.docID,
      filerName: document.filerName,
      description: document.docDescription,
      submittedAt: document.submitDateTime,
      periodStart: document.periodStart,
      periodEnd: document.periodEnd,
      checkedDateRange: checkedDateRange(checkedDates),
    },
    assessment: {
      status,
      reason:
        status === "confirmed"
          ? "対象会社名と資本関係を示す文脈をEDINETの開示書類で確認しました。"
          : status === "possible"
            ? "対象会社名は確認できましたが、抽出箇所だけでは資本関係を確定できません。"
            : "確認した開示書類では対象会社名を発見できませんでした。資本関係がないことを意味するものではありません。",
      percentages: inspection.percentages,
      evidence: inspection.evidence,
    },
    largeEnterpriseAffiliation: {
      requiresGuidelineReview: true,
      note:
        "みなし大企業の判定基準は補助金ごとに異なります。出資比率、複数大企業の保有、役員構成などを最新の公募要領と照合してください。",
    },
    caution:
      "これはEDINET提出書類における名称検索と関係文脈の確認結果です。現在の資本関係、みなし大企業該当性、補助金の申請資格を保証しません。",
  };
}
