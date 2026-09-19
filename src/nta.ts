const SOURCE_URL = "https://www.houjin-bangou.nta.go.jp/webapi/";
export const NTA_NOTICE = "このサービスは、国税庁法人番号システムのWeb-API機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない";

export class NtaApiError extends Error {
  constructor(message: string, readonly code: "configuration_error" | "invalid_request" | "authentication_error" | "not_found" | "rate_limited" | "timeout" | "upstream_error" | "invalid_response") {
    super(message);
    this.name = "NtaApiError";
  }
}
function invalid(): never {
  throw new NtaApiError("国税庁APIの応答形式が不正です。", "invalid_response");
}

// Ver.4 CSV/UTF-8 (type=02). Quoted commas, newlines and escaped quotes
// are significant; splitting lines or commas would corrupt legal names.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(field); field = ""; closed = false;
      if (c !== ",") {
        rows.push(row); row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (c === '"' && !field && !closed) quoted = true;
    else {
      if (closed || c === '"') invalid();
      field += c;
    }
  }
  if (quoted) invalid();
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  return rows;
}

function parseResponse(text: string) {
  const [header, ...rows] = parseCsv(text);
  if (!header || header.length !== 4 || !/^\d{4}-\d{2}-\d{2}$/.test(header[0]) ||
      !header.slice(1).every(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)))) invalid();
  const [totalCount, divideNumber, divideSize] = header.slice(1).map(Number);
  if (rows.length > totalCount || (totalCount > 0 && (!divideNumber || divideNumber > divideSize || !rows.length)) ||
      (divideSize <= 1 && rows.length !== totalCount)) invalid();
  const corporations = rows.map(r => {
    if (r.length !== 30 || !/^\d{13}$/.test(r[1]) || !r[6] || !/^[01]$/.test(r[23]) || !/^[01]$/.test(r[29])) invalid();
    const value = (i: number) => r[i].trim() || null;
    return {
      corporateNumber: r[1], name: r[6], kana: value(28), nameEnglish: value(24),
      kind: value(8), postalCode: value(15),
      location: r.slice(9, 12).join("") || null, addressOutside: value(16),
      nameImageId: value(7), addressImageId: value(12), addressOutsideImageId: value(17),
      updateDate: value(4), changeDate: value(5), process: value(2),
      closeDate: value(18), closeCause: value(19), successorCorporateNumber: value(20),
      changeCause: value(21), assignmentDate: value(22), latest: r[23] === "1",
      excludedFromSearch: r[29] === "1",
      status: r[18] || r[19] ? "closed" : "no_closure_information",
      statusLabel: r[18] || r[19] ? "登記記録の閉鎖等の情報あり" : "登記記録の閉鎖等の情報なし（営業実態を保証しません）",
    };
  });
  return { lastUpdateDate: header[0], totalCount, divideNumber, divideSize, corporations };
}

async function request(path: "name" | "num", params: Record<string, string>, applicationId?: string) {
  const id = applicationId?.trim();
  if (!id) throw new NtaApiError("NTA_APPLICATION_IDに発行されたアプリケーションIDを設定してください。", "configuration_error");
  const url = new URL(`https://api.houjin-bangou.nta.go.jp/4/${path}`);
  url.search = new URLSearchParams({ ...params, id, type: "02" }).toString();
  const signal = AbortSignal.timeout(15_000);
  try {
    // The upstream requires the secret in the query. Never log the URL or echo
    // upstream bodies/errors; also prevent redirects from forwarding the ID.
    // workerd rejects redirect:"error" before sending the request. Use manual
    // and reject every 3xx explicitly to preserve the same security boundary.
    const response = await fetch(url.toString(), { signal, redirect: "manual", headers: { Accept: "text/csv" } });
    if (response.status >= 300 && response.status < 400) {
      throw new NtaApiError("国税庁APIが転送を要求したため、アプリケーションIDを保護して照会を停止しました。", "upstream_error");
    }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "authentication_error"
        : response.status === 429 ? "rate_limited"
        : response.status >= 500 ? "upstream_error" : "invalid_request";
      throw new NtaApiError(`国税庁APIがHTTP ${response.status}を返しました。`, code);
    }
    const result = parseResponse(await response.text());
    return { ...result, source: { name: "国税庁法人番号公表サイト", url: SOURCE_URL }, notice: NTA_NOTICE,
      responseGuidance: "出典とnoticeを利用者に表示してください。閉鎖情報なしを営業中や申請資格ありと断定しないでください。検索対象除外やイメージIDがある場合は公式サイトで確認してください。" };
  } catch (error) {
    if (error instanceof NtaApiError) throw error;
    throw new NtaApiError(signal.aborted ? "国税庁APIへの接続がタイムアウトしました。" : "国税庁APIへ接続できませんでした。", signal.aborted ? "timeout" : "upstream_error");
  }
}

export async function getCorporateIdentity(corporateNumber: string, applicationId?: string) {
  const number = corporateNumber.trim();
  if (!/^\d{13}$/.test(number)) throw new NtaApiError("法人番号は13桁の数字で指定してください。", "invalid_request");
  const result = await request("num", { number, history: "0" }, applicationId);
  if (!result.corporations.length) throw new NtaApiError("指定した法人番号の公表情報が見つかりませんでした。", "not_found");
  if (result.totalCount !== 1 || result.corporations.some(c => c.corporateNumber !== number || !c.latest)) invalid();
  return { ...result, corporation: result.corporations[0] };
}

export async function searchCorporateIdentities(input: { name: string; addressCode?: string; page?: number }, applicationId?: string) {
  const name = input.name.trim().normalize("NFKC").replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/ /g, "　");
  const page = input.page ?? 1;
  if (!name || name.length > 200 || !Number.isInteger(page) || page < 1 || page > 99999 ||
      (input.addressCode !== undefined && !/^(?:(?:0[1-9]|[1-3][0-9]|4[0-7])(?:\d{3})?|99)$/.test(input.addressCode))) {
    throw new NtaApiError("法人名、所在地コード、分割番号を確認してください。", "invalid_request");
  }
  const result = await request("name", { name, mode: "2", target: "1", change: "0", close: "1", divide: String(page), ...(input.addressCode ? { address: input.addressCode } : {}) }, applicationId);
  if (result.totalCount > 0 && (result.divideNumber !== page || result.corporations.some(c => !c.latest))) invalid();
  return { ...result, mayHaveMore: result.divideNumber < result.divideSize,
    nextPage: result.divideNumber < result.divideSize ? result.divideNumber + 1 : null,
    selectionGuidance: "同名法人を自動決定せず所在地と法人番号で候補を確認してください。mayHaveMoreがtrueなら後続ページがあります。確定した法人番号をget_company_profileへ渡すと企業情報を取得できます。" };
}
