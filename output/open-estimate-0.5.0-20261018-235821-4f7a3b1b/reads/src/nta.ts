1: const SOURCE_URL = "https://www.houjin-bangou.nta.go.jp/webapi/";
2: export const NTA_NOTICE = "このサービスは、国税庁法人番号システムのWeb-API機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない";
3: 
4: export class NtaApiError extends Error {
5:   constructor(message: string, readonly code: "configuration_error" | "invalid_request" | "authentication_error" | "not_found" | "rate_limited" | "timeout" | "upstream_error" | "invalid_response") {
6:     super(message);
7:     this.name = "NtaApiError";
8:   }
9: }
10: function invalid(): never {
11:   throw new NtaApiError("国税庁APIの応答形式が不正です。", "invalid_response");
12: }
13: 
14: // Ver.4 CSV/UTF-8 (type=02). Quoted commas, newlines and escaped quotes
15: // are significant; splitting lines or commas would corrupt legal names.
16: function parseCsv(text: string): string[][] {
17:   const rows: string[][] = [];
18:   let row: string[] = [], field = "", quoted = false, closed = false;
19:   text = text.replace(/^\uFEFF/, "");
20:   for (let i = 0; i < text.length; i++) {
21:     const c = text[i];
22:     if (quoted) {
23:       if (c === '"') {
24:         if (text[i + 1] === '"') { field += '"'; i++; }
25:         else { quoted = false; closed = true; }
26:       } else field += c;
27:     } else if (c === "," || c === "\n" || c === "\r") {
28:       row.push(field); field = ""; closed = false;
29:       if (c !== ",") {
30:         rows.push(row); row = [];
31:         if (c === "\r" && text[i + 1] === "\n") i++;
32:       }
33:     } else if (c === '"' && !field && !closed) quoted = true;
34:     else {
35:       if (closed || c === '"') invalid();
36:       field += c;
37:     }
38:   }
39:   if (quoted) invalid();
40:   if (field || row.length || closed) { row.push(field); rows.push(row); }
41:   return rows;
42: }
43: 
44: function parseResponse(text: string) {
45:   const [header, ...rows] = parseCsv(text);
46:   if (!header || header.length !== 4 || !/^\d{4}-\d{2}-\d{2}$/.test(header[0]) ||
47:       !header.slice(1).every(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)))) invalid();
48:   const [totalCount, divideNumber, divideSize] = header.slice(1).map(Number);
49:   if (rows.length > totalCount || (totalCount > 0 && (!divideNumber || divideNumber > divideSize || !rows.length)) ||
50:       (divideSize <= 1 && rows.length !== totalCount)) invalid();
51:   const corporations = rows.map(r => {
52:     if (r.length !== 30 || !/^\d{13}$/.test(r[1]) || !r[6] || !/^[01]$/.test(r[23]) || !/^[01]$/.test(r[29])) invalid();
53:     const value = (i: number) => r[i].trim() || null;
54:     return {
55:       corporateNumber: r[1], name: r[6], kana: value(28), nameEnglish: value(24),
56:       kind: value(8), postalCode: value(15),
57:       location: r.slice(9, 12).join("") || null, addressOutside: value(16),
58:       nameImageId: value(7), addressImageId: value(12), addressOutsideImageId: value(17),
59:       updateDate: value(4), changeDate: value(5), process: value(2),
60:       closeDate: value(18), closeCause: value(19), successorCorporateNumber: value(20),
61:       changeCause: value(21), assignmentDate: value(22), latest: r[23] === "1",
62:       excludedFromSearch: r[29] === "1",
63:       status: r[18] || r[19] ? "closed" : "no_closure_information",
64:       statusLabel: r[18] || r[19] ? "登記記録の閉鎖等の情報あり" : "登記記録の閉鎖等の情報なし（営業実態を保証しません）",
65:     };
66:   });
67:   return { lastUpdateDate: header[0], totalCount, divideNumber, divideSize, corporations };
68: }
69: 
70: async function request(path: "name" | "num", params: Record<string, string>, applicationId?: string) {
71:   const id = applicationId?.trim();
72:   if (!id) throw new NtaApiError("NTA_APPLICATION_IDに発行されたアプリケーションIDを設定してください。", "configuration_error");
73:   const url = new URL(`https://api.houjin-bangou.nta.go.jp/4/${path}`);
74:   url.search = new URLSearchParams({ ...params, id, type: "02" }).toString();
75:   const signal = AbortSignal.timeout(15_000);
76:   try {
77:     // The upstream requires the secret in the query. Never log the URL or echo
78:     // upstream bodies/errors; also prevent redirects from forwarding the ID.
79:     // workerd rejects redirect:"error" before sending the request. Use manual
80:     // and reject every 3xx explicitly to preserve the same security boundary.
81:     const response = await fetch(url.toString(), { signal, redirect: "manual", headers: { Accept: "text/csv" } });
82:     if (response.status >= 300 && response.status < 400) {
83:       throw new NtaApiError("国税庁APIが転送を要求したため、アプリケーションIDを保護して照会を停止しました。", "upstream_error");
84:     }
85:     if (!response.ok) {
86:       const code = response.status === 401 || response.status === 403 ? "authentication_error"
87:         : response.status === 429 ? "rate_limited"
88:         : response.status >= 500 ? "upstream_error" : "invalid_request";
89:       throw new NtaApiError(`国税庁APIがHTTP ${response.status}を返しました。`, code);
90:     }
91:     const result = parseResponse(await response.text());
92:     return { ...result, source: { name: "国税庁法人番号公表サイト", url: SOURCE_URL }, notice: NTA_NOTICE,
93:       responseGuidance: "出典とnoticeを利用者に表示してください。閉鎖情報なしを営業中や申請資格ありと断定しないでください。検索対象除外やイメージIDがある場合は公式サイトで確認してください。" };
94:   } catch (error) {
95:     if (error instanceof NtaApiError) throw error;
96:     throw new NtaApiError(signal.aborted ? "国税庁APIへの接続がタイムアウトしました。" : "国税庁APIへ接続できませんでした。", signal.aborted ? "timeout" : "upstream_error");
97:   }
98: }
99: 
100: export async function getCorporateIdentity(corporateNumber: string, applicationId?: string) {
101:   const number = corporateNumber.trim();
102:   if (!/^\d{13}$/.test(number)) throw new NtaApiError("法人番号は13桁の数字で指定してください。", "invalid_request");
103:   const result = await request("num", { number, history: "0" }, applicationId);
104:   if (!result.corporations.length) throw new NtaApiError("指定した法人番号の公表情報が見つかりませんでした。", "not_found");
105:   if (result.totalCount !== 1 || result.corporations.some(c => c.corporateNumber !== number || !c.latest)) invalid();
106:   return { ...result, corporation: result.corporations[0] };
107: }
108: 
109: export async function searchCorporateIdentities(input: { name: string; addressCode?: string; page?: number }, applicationId?: string) {
110:   const name = input.name.trim().normalize("NFKC").replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/ /g, "　");
111:   const page = input.page ?? 1;
112:   if (!name || name.length > 200 || !Number.isInteger(page) || page < 1 || page > 99999 ||
113:       (input.addressCode !== undefined && !/^(?:(?:0[1-9]|[1-3][0-9]|4[0-7])(?:\d{3})?|99)$/.test(input.addressCode))) {
114:     throw new NtaApiError("法人名、所在地コード、分割番号を確認してください。", "invalid_request");
115:   }
116:   const result = await request("name", { name, mode: "2", target: "1", change: "0", close: "1", divide: String(page), ...(input.addressCode ? { address: input.addressCode } : {}) }, applicationId);
117:   if (result.totalCount > 0 && (result.divideNumber !== page || result.corporations.some(c => !c.latest))) invalid();
118:   return { ...result, mayHaveMore: result.divideNumber < result.divideSize,
119:     nextPage: result.divideNumber < result.divideSize ? result.divideNumber + 1 : null,
120:     selectionGuidance: "同名法人を自動決定せず所在地と法人番号で候補を確認してください。mayHaveMoreがtrueなら後続ページがあります。確定した法人番号をget_company_profileへ渡すと企業情報を取得できます。" };
121: }