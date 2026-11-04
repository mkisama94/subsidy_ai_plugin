1: import { GBIZINFO_DISPLAY_NAME, GBizInfoApiError } from "./gbizinfo";
2: 
3: const GBIZINFO_BASE_URL = "https://api.info.gbiz.go.jp/hojin/v2/hojin";
4: const GBIZINFO_SOURCE_URL = "https://content.info.gbiz.go.jp/api/index.html";
5: const REQUEST_TIMEOUT_MS = 15_000;
6: 
7: type JsonRecord = Record<string, unknown>;
8: 
9: export const GBIZINFO_ACTIVITY_TYPES = [
10:   "certification",
11:   "commendation",
12:   "corporation",
13:   "finance",
14:   "patent",
15:   "procurement",
16:   "subsidy",
17:   "workplace",
18: ] as const;
19: 
20: export type GBizInfoActivityType =
21:   (typeof GBIZINFO_ACTIVITY_TYPES)[number];
22: 
23: const RESPONSE_FIELDS: Record<GBizInfoActivityType, string> = {
24:   certification: "certification",
25:   commendation: "commendation",
26:   corporation: "corporation-info",
27:   finance: "finance",
28:   patent: "patent",
29:   procurement: "procurement",
30:   subsidy: "subsidy",
31:   workplace: "workplace_info",
32: };
33: 
34: const SINGLE_OBJECT_TYPES = new Set<GBizInfoActivityType>([
35:   "finance",
36:   "workplace",
37: ]);
38: 
39: function isRecord(value: unknown): value is JsonRecord {
40:   return typeof value === "object" && value !== null && !Array.isArray(value);
41: }
42: 
43: function asRecords(value: unknown): JsonRecord[] {
44:   if (Array.isArray(value)) return value.filter(isRecord);
45:   return isRecord(value) ? [value] : [];
46: }
47: 
48: function asNumber(value: unknown): number | null {
49:   if (typeof value === "number" && Number.isFinite(value)) return value;
50:   if (typeof value === "string" && value.trim()) {
51:     const parsed = Number(value);
52:     return Number.isFinite(parsed) ? parsed : null;
53:   }
54:   return null;
55: }
56: 
57: function requireApiToken(apiToken: string | undefined): string {
58:   const normalizedToken = apiToken?.trim();
59:   if (!normalizedToken) {
60:     throw new GBizInfoApiError(
61:       `${GBIZINFO_DISPLAY_NAME}のAPIトークンが設定されていません。Cloudflare SecretのGBIZINFO_API_TOKENを設定してください。`,
62:       "configuration_error",
63:     );
64:   }
65:   return normalizedToken;
66: }
67: 
68: function validateCorporateNumber(corporateNumber: string): string {
69:   const normalized = corporateNumber.trim();
70:   if (!/^\d{13}$/.test(normalized)) {
71:     throw new GBizInfoApiError(
72:       "法人番号は13桁の数字で指定してください。",
73:       "invalid_request",
74:       400,
75:     );
76:   }
77:   return normalized;
78: }
79: 
80: async function fetchJson(url: URL, apiToken: string): Promise<unknown> {
81:   const controller = new AbortController();
82:   const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
83:   try {
84:     const response = await fetch(url, {
85:       method: "GET",
86:       headers: {
87:         Accept: "application/json",
88:         "X-hojinInfo-api-token": apiToken,
89:       },
90:       signal: controller.signal,
91:     });
92:     if (!response.ok) {
93:       const code =
94:         response.status === 400
95:           ? "invalid_request"
96:           : response.status === 401 || response.status === 403
97:             ? "authentication_error"
98:             : response.status === 404
99:               ? "not_found"
100:               : response.status === 429
101:                 ? "rate_limited"
102:                 : "upstream_error";
103:       throw new GBizInfoApiError(
104:         `${GBIZINFO_DISPLAY_NAME} APIがHTTP ${response.status}を返しました。`,
105:         code,
106:         response.status,
107:       );
108:     }
109:     try {
110:       return await response.json();
111:     } catch {
112:       throw new GBizInfoApiError(
113:         `${GBIZINFO_DISPLAY_NAME} APIの応答をJSONとして解析できませんでした。`,
114:         "invalid_response",
115:         response.status,
116:       );
117:     }
118:   } catch (error) {
119:     if (error instanceof GBizInfoApiError) throw error;
120:     if (error instanceof DOMException && error.name === "AbortError") {
121:       throw new GBizInfoApiError(
122:         `${GBIZINFO_DISPLAY_NAME} APIへの接続がタイムアウトしました。`,
123:         "timeout",
124:       );
125:     }
126:     throw new GBizInfoApiError(
127:       `${GBIZINFO_DISPLAY_NAME} APIへ接続できませんでした。時間をおいて再試行してください。`,
128:       "upstream_error",
129:     );
130:   } finally {
131:     clearTimeout(timeout);
132:   }
133: }
134: 
135: function camelCaseKey(key: string): string {
136:   return key.replace(/[-_]([a-z])/gu, (_, letter: string) =>
137:     letter.toUpperCase(),
138:   );
139: }
140: 
141: function sanitizeValue(value: unknown, arrayLimit: number, depth = 0): unknown {
142:   if (depth > 8) return null;
143:   if (
144:     value === null ||
145:     typeof value === "string" ||
146:     typeof value === "number" ||
147:     typeof value === "boolean"
148:   ) {
149:     return value;
150:   }
151:   if (Array.isArray(value)) {
152:     return value
153:       .slice(0, arrayLimit)
154:       .map((item) => sanitizeValue(item, arrayLimit, depth + 1));
155:   }
156:   if (!isRecord(value)) return null;
157:   return Object.fromEntries(
158:     Object.entries(value)
159:       .filter(([key]) => key !== "meta-data")
160:       .map(([key, item]) => [
161:         camelCaseKey(key),
162:         sanitizeValue(item, arrayLimit, depth + 1),
163:       ]),
164:   );
165: }
166: 
167: function hasMeaningfulValue(value: unknown): boolean {
168:   if (value === null || value === undefined || value === "") return false;
169:   if (Array.isArray(value)) return value.some(hasMeaningfulValue);
170:   if (isRecord(value)) return Object.values(value).some(hasMeaningfulValue);
171:   return true;
172: }
173: 
174: function activityDate(type: GBizInfoActivityType, item: unknown): string | null {
175:   if (!isRecord(item)) return null;
176:   const field =
177:     type === "commendation"
178:       ? "dateOfCommendation"
179:       : type === "patent"
180:         ? "applicationDate"
181:         : type === "procurement"
182:           ? "dateOfOrder"
183:           : type === "corporation"
184:             ? "lossDate"
185:             : "dateOfApproval";
186:   const value = item[field];
187:   return typeof value === "string" && value.trim() ? value : null;
188: }
189: 
190: function newestFirst(
191:   type: GBizInfoActivityType,
192:   items: unknown[],
193: ): unknown[] {
194:   return items.sort((left, right) => {
195:     const leftDate = activityDate(type, left);
196:     const rightDate = activityDate(type, right);
197:     const leftTime = leftDate ? Date.parse(leftDate) : Number.NaN;
198:     const rightTime = rightDate ? Date.parse(rightDate) : Number.NaN;
199:     if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
200:     if (!Number.isFinite(leftTime)) return 1;
201:     if (!Number.isFinite(rightTime)) return -1;
202:     return rightTime - leftTime;
203:   });
204: }
205: 
206: async function fetchActivity(
207:   corporateNumber: string,
208:   type: GBizInfoActivityType,
209:   apiToken: string,
210:   limit: number,
211: ) {
212:   const url = new URL(
213:     `${GBIZINFO_BASE_URL}/${encodeURIComponent(corporateNumber)}/${type}`,
214:   );
215:   url.searchParams.set("metadata_flg", "false");
216:   const payload = await fetchJson(url, apiToken);
217:   if (!isRecord(payload)) {
218:     throw new GBizInfoApiError(
219:       `${GBIZINFO_DISPLAY_NAME}の${type}応答がJSONオブジェクトではありません。`,
220:       "invalid_response",
221:     );
222:   }
223:   const company = asRecords(payload["hojin-infos"])[0];
224:   if (!company) {
225:     return {
226:       type,
227:       totalCount: 0,
228:       returnedCount: 0,
229:       hasMore: false,
230:       items: [],
231:     };
232:   }
233:   const rawValue = company[RESPONSE_FIELDS[type]];
234:   if (SINGLE_OBJECT_TYPES.has(type)) {
235:     const sanitized = sanitizeValue(rawValue, limit);
236:     const items = hasMeaningfulValue(sanitized) ? [sanitized] : [];
237:     return {
238:       type,
239:       totalCount: items.length,
240:       returnedCount: items.length,
241:       hasMore: false,
242:       items,
243:     };
244:   }
245:   const rawItems = Array.isArray(rawValue) ? rawValue : [];
246:   const sanitizedItems = newestFirst(
247:     type,
248:     rawItems
249:       .map((item) => sanitizeValue(item, limit))
250:       .filter(hasMeaningfulValue),
251:   );
252:   return {
253:     type,
254:     totalCount: sanitizedItems.length,
255:     returnedCount: Math.min(sanitizedItems.length, limit),
256:     hasMore: sanitizedItems.length > limit,
257:     items: sanitizedItems.slice(0, limit),
258:   };
259: }
260: 
261: async function fetchReportedActivityCount(
262:   corporateNumber: string,
263:   apiToken: string,
264: ): Promise<number | null> {
265:   const url = new URL(GBIZINFO_BASE_URL);
266:   url.searchParams.set("corporate_number", corporateNumber);
267:   url.searchParams.set("page", "1");
268:   url.searchParams.set("limit", "1");
269:   url.searchParams.set("metadata_flg", "false");
270:   const payload = await fetchJson(url, apiToken);
271:   if (!isRecord(payload)) return null;
272:   const company = asRecords(payload["hojin-infos"]).find(
273:     (item) => item.corporate_number === corporateNumber,
274:   );
275:   return company ? asNumber(company.number_of_activity) : null;
276: }
277: 
278: function publicError(error: unknown) {
279:   if (error instanceof GBizInfoApiError) {
280:     return {
281:       code: error.code,
282:       message: error.message,
283:       retryable:
284:         error.code === "timeout" ||
285:         error.code === "upstream_error" ||
286:         error.code === "rate_limited",
287:     };
288:   }
289:   return {
290:     code: "internal_error",
291:     message: "活動情報の取得中に予期しないエラーが発生しました。",
292:     retryable: false,
293:   };
294: }
295: 
296: export async function getCompanyActivities(
297:   corporateNumber: string,
298:   apiToken: string | undefined,
299:   activityTypes: GBizInfoActivityType[] = [...GBIZINFO_ACTIVITY_TYPES],
300:   activityLimit = 20,
301: ) {
302:   const normalizedNumber = validateCorporateNumber(corporateNumber);
303:   const normalizedToken = requireApiToken(apiToken);
304:   const limit = Math.min(Math.max(Math.trunc(activityLimit), 1), 50);
305:   const selectedTypes = [
306:     ...new Set(
307:       activityTypes.filter((type) =>
308:         GBIZINFO_ACTIVITY_TYPES.includes(type),
309:       ),
310:     ),
311:   ];
312:   if (!selectedTypes.length) {
313:     throw new GBizInfoApiError(
314:       "activity_typesを1種類以上指定してください。",
315:       "invalid_request",
316:       400,
317:     );
318:   }
319: 
320:   const [reportedResult, ...activityResults] = await Promise.allSettled([
321:     fetchReportedActivityCount(normalizedNumber, normalizedToken),
322:     ...selectedTypes.map((type) =>
323:       fetchActivity(normalizedNumber, type, normalizedToken, limit),
324:     ),
325:   ]);
326: 
327:   const activities: Partial<
328:     Record<GBizInfoActivityType, Awaited<ReturnType<typeof fetchActivity>>>
329:   > = {};
330:   const errors: Array<{
331:     type: GBizInfoActivityType;
332:     error: ReturnType<typeof publicError>;
333:   }> = [];
334:   activityResults.forEach((result, index) => {
335:     const type = selectedTypes[index];
336:     if (result.status === "fulfilled") {
337:       activities[type] = result.value;
338:     } else {
339:       errors.push({ type, error: publicError(result.reason) });
340:     }
341:   });
342: 
343:   const reportedActivityCount =
344:     reportedResult.status === "fulfilled" ? reportedResult.value : null;
345:   const reportedCountError =
346:     reportedResult.status === "rejected"
347:       ? publicError(reportedResult.reason)
348:       : null;
349:   const retrievedTopLevelItemCount = Object.values(activities).reduce(
350:     (total, activity) => total + activity.totalCount,
351:     0,
352:   );
353:   const difference =
354:     reportedActivityCount === null
355:       ? null
356:       : reportedActivityCount - retrievedTopLevelItemCount;
357: 
358:   return {
359:     source: {
360:       name: GBIZINFO_DISPLAY_NAME,
361:       apiDocumentationUrl: GBIZINFO_SOURCE_URL,
362:     },
363:     retrievedAt: new Date().toISOString(),
364:     corporateNumber: normalizedNumber,
365:     selectedTypes,
366:     activityLimit: limit,
367:     reportedActivityCount,
368:     retrievedTopLevelItemCount,
369:     countComparison: {
370:       status:
371:         difference === null
372:           ? "unavailable"
373:           : difference === 0
374:             ? "matched"
375:             : "mismatch",
376:       difference,
377:       note:
378:         "reportedActivityCountは法人検索APIの法人活動情報件数です。retrievedTopLevelItemCountは選択した専用APIから取得した最上位項目数であり、財務・職場情報など複合オブジェクトの数え方により一致しない場合があります。",
379:     },
380:     activities,
381:     errors,
382:     reportedCountError,
383:     partial: errors.length > 0 || reportedCountError !== null,
384:     caution:
385:       `活動情報は各府省等の公開情報を${GBIZINFO_DISPLAY_NAME}が集約したものです。未登録や更新時差があり、現在の法人状態、権利の有効性、補助金の申請資格や採択を保証しません。`,
386:   };
387: }