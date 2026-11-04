1: const GBIZINFO_BASE_URL = "https://api.info.gbiz.go.jp/hojin/v2/hojin";
2: const GBIZINFO_SOURCE_URL = "https://content.info.gbiz.go.jp/api/index.html";
3: export const GBIZINFO_DISPLAY_NAME =
4:   "経済産業省の法人情報データベース（gBizINFO）";
5: const REQUEST_TIMEOUT_MS = 15_000;
6: 
7: type JsonRecord = Record<string, unknown>;
8: 
9: export type CompanyProfile = {
10:   corporateNumber: string;
11:   name: string | null;
12:   kana: string | null;
13:   nameEnglish: string | null;
14:   kind: string | null;
15:   postalCode: string | null;
16:   location: string | null;
17:   representativeName: string | null;
18:   capitalStockYen: number | null;
19:   employeeNumber: number | null;
20:   companyUrl: string | null;
21:   dateOfEstablishment: string | null;
22:   foundingYear: number | null;
23:   businessSummary: string | null;
24:   industries: string[];
25:   industryCodes: string[];
26:   businessItems: string[];
27:   qualificationGrade: string | null;
28:   status: string | null;
29:   statusAvailability: "provided" | "not_provided";
30:   updateDate: string | null;
31:   closeDate: string | null;
32:   closeCause: string | null;
33: };
34: 
35: export type CompanySearchInput = {
36:   name: string;
37:   prefecture?: string;
38:   city?: string;
39:   page?: number;
40:   limit?: number;
41: };
42: 
43: export type CompanySearchCandidate = {
44:   corporateNumber: string;
45:   name: string | null;
46:   nameEnglish: string | null;
47:   postalCode: string | null;
48:   location: string | null;
49:   status: string | null;
50:   statusAvailability: "provided" | "not_provided";
51:   updateDate: string | null;
52:   activityCount: number | null;
53: };
54: 
55: export class GBizInfoApiError extends Error {
56:   constructor(
57:     message: string,
58:     readonly code:
59:       | "configuration_error"
60:       | "invalid_request"
61:       | "authentication_error"
62:       | "not_found"
63:       | "rate_limited"
64:       | "timeout"
65:       | "upstream_error"
66:       | "invalid_response",
67:     readonly status?: number,
68:   ) {
69:     super(message);
70:     this.name = "GBizInfoApiError";
71:   }
72: }
73: 
74: function isRecord(value: unknown): value is JsonRecord {
75:   return typeof value === "object" && value !== null && !Array.isArray(value);
76: }
77: 
78: function asString(value: unknown): string | null {
79:   return typeof value === "string" && value.trim() ? value.trim() : null;
80: }
81: 
82: const EMPTY_PLACEHOLDERS = new Set(["-", "－", "―", "—", "‐", "なし", "無し"]);
83: 
84: function asNullableString(value: unknown): string | null {
85:   const normalized = asString(value);
86:   return normalized && !EMPTY_PLACEHOLDERS.has(normalized) ? normalized : null;
87: }
88: 
89: function asUrl(value: unknown): string | null {
90:   const normalized = asNullableString(value);
91:   if (!normalized) return null;
92:   try {
93:     const url = new URL(normalized);
94:     return url.protocol === "http:" || url.protocol === "https:"
95:       ? url.toString()
96:       : null;
97:   } catch {
98:     return null;
99:   }
100: }
101: 
102: function asNumber(value: unknown): number | null {
103:   if (typeof value === "number" && Number.isFinite(value)) return value;
104:   if (typeof value === "string" && value.trim()) {
105:     const parsed = Number(value);
106:     return Number.isFinite(parsed) ? parsed : null;
107:   }
108:   return null;
109: }
110: 
111: function asRecords(value: unknown): JsonRecord[] {
112:   if (Array.isArray(value)) return value.filter(isRecord);
113:   return isRecord(value) ? [value] : [];
114: }
115: 
116: function asStrings(value: unknown): string[] {
117:   if (!Array.isArray(value)) return [];
118:   return value
119:     .map(asNullableString)
120:     .filter((item): item is string => item !== null);
121: }
122: 
123: const INDUSTRY_MAJOR_LABELS: Record<string, string> = {
124:   A: "農業、林業",
125:   B: "漁業",
126:   C: "鉱業、採石業、砂利採取業",
127:   D: "建設業",
128:   E: "製造業",
129:   F: "電気・ガス・熱供給・水道業",
130:   G: "情報通信業",
131:   H: "運輸業、郵便業",
132:   I: "卸売業、小売業",
133:   J: "金融業、保険業",
134:   K: "不動産業、物品賃貸業",
135:   L: "学術研究、専門・技術サービス業",
136:   M: "宿泊業、飲食サービス業",
137:   N: "生活関連サービス業、娯楽業",
138:   O: "教育、学習支援業",
139:   P: "医療、福祉",
140:   Q: "複合サービス事業",
141:   R: "サービス業（他に分類されないもの）",
142:   S: "公務（他に分類されるものを除く）",
143:   T: "分類不能の産業",
144: };
145: 
146: function normalizeIndustries(value: unknown) {
147:   const rawValues = asStrings(value);
148:   const codes: string[] = [];
149:   const labels = rawValues.map((item) => {
150:     const code = item.normalize("NFKC").toUpperCase();
151:     const label = INDUSTRY_MAJOR_LABELS[code];
152:     if (label) codes.push(code);
153:     return label ?? item;
154:   });
155:   return {
156:     codes: [...new Set(codes)],
157:     labels: [...new Set(labels)],
158:   };
159: }
160: 
161: function normalizeQualificationGrade(value: unknown): string | null {
162:   const normalized = asNullableString(value);
163:   if (!normalized) return null;
164:   const grades = normalized
165:     .split(/[、,，/／]+/u)
166:     .map((item) => item.trim())
167:     .filter(Boolean);
168:   return grades.length ? [...new Set(grades)].join("、") : null;
169: }
170: 
171: function normalizeProfile(item: JsonRecord): CompanyProfile {
172:   const corporateNumber = asString(item.corporate_number);
173:   if (!corporateNumber) {
174:     throw new GBizInfoApiError(
175:       `${GBIZINFO_DISPLAY_NAME}の応答に法人番号がありません。`,
176:       "invalid_response",
177:     );
178:   }
179:   const industries = normalizeIndustries(item.industry);
180:   const status = asNullableString(item.status);
181:   return {
182:     corporateNumber,
183:     name: asNullableString(item.name),
184:     kana: asNullableString(item.kana),
185:     nameEnglish: asNullableString(item.name_en),
186:     kind: asNullableString(item.kind),
187:     postalCode: asNullableString(item.postal_code),
188:     location: asNullableString(item.location),
189:     representativeName: asNullableString(item.representative_name),
190:     capitalStockYen: asNumber(item.capital_stock),
191:     employeeNumber: asNumber(item.employee_number),
192:     companyUrl: asUrl(item.company_url),
193:     dateOfEstablishment: asNullableString(item.date_of_establishment),
194:     foundingYear: asNumber(item.founding_year),
195:     businessSummary: asNullableString(item.business_summary),
196:     industries: industries.labels,
197:     industryCodes: industries.codes,
198:     businessItems: asStrings(item.business_items),
199:     qualificationGrade: normalizeQualificationGrade(item.qualification_grade),
200:     status,
201:     statusAvailability: status ? "provided" : "not_provided",
202:     updateDate: asNullableString(item.update_date),
203:     closeDate: asNullableString(item.close_date),
204:     closeCause: asNullableString(item.close_cause),
205:   };
206: }
207: 
208: function normalizeSearchCandidate(item: JsonRecord): CompanySearchCandidate {
209:   const corporateNumber = asString(item.corporate_number);
210:   if (!corporateNumber) {
211:     throw new GBizInfoApiError(
212:       `${GBIZINFO_DISPLAY_NAME}の検索応答に法人番号がありません。`,
213:       "invalid_response",
214:     );
215:   }
216:   const status = asNullableString(item.status);
217:   return {
218:     corporateNumber,
219:     name: asNullableString(item.name),
220:     nameEnglish: asNullableString(item.name_en),
221:     postalCode: asNullableString(item.postal_code),
222:     location: asNullableString(item.location),
223:     status,
224:     statusAvailability: status ? "provided" : "not_provided",
225:     updateDate: asNullableString(item.update_date),
226:     activityCount: asNumber(item.number_of_activity),
227:   };
228: }
229: 
230: async function fetchGBizInfo(
231:   url: URL,
232:   apiToken: string,
233: ): Promise<unknown> {
234:   const controller = new AbortController();
235:   const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
236:   try {
237:     const response = await fetch(url, {
238:       method: "GET",
239:       headers: {
240:         Accept: "application/json",
241:         "X-hojinInfo-api-token": apiToken,
242:       },
243:       signal: controller.signal,
244:     });
245:     if (!response.ok) {
246:       const code =
247:         response.status === 400
248:           ? "invalid_request"
249:           : response.status === 401 || response.status === 403
250:             ? "authentication_error"
251:             : response.status === 404
252:               ? "not_found"
253:               : response.status === 429
254:                 ? "rate_limited"
255:                 : "upstream_error";
256:       throw new GBizInfoApiError(
257:         `${GBIZINFO_DISPLAY_NAME} APIがHTTP ${response.status}を返しました。`,
258:         code,
259:         response.status,
260:       );
261:     }
262:     try {
263:       return await response.json();
264:     } catch {
265:       throw new GBizInfoApiError(
266:         `${GBIZINFO_DISPLAY_NAME} APIの応答をJSONとして解析できませんでした。`,
267:         "invalid_response",
268:         response.status,
269:       );
270:     }
271:   } catch (error) {
272:     if (error instanceof GBizInfoApiError) throw error;
273:     if (error instanceof DOMException && error.name === "AbortError") {
274:       throw new GBizInfoApiError(
275:         `${GBIZINFO_DISPLAY_NAME} APIへの接続がタイムアウトしました。`,
276:         "timeout",
277:       );
278:     }
279:     throw new GBizInfoApiError(
280:       `${GBIZINFO_DISPLAY_NAME} APIへ接続できませんでした。時間をおいて再試行してください。`,
281:       "upstream_error",
282:     );
283:   } finally {
284:     clearTimeout(timeout);
285:   }
286: }
287: 
288: function requireApiToken(apiToken: string | undefined): string {
289:   const normalizedToken = apiToken?.trim();
290:   if (!normalizedToken) {
291:     throw new GBizInfoApiError(
292:       `${GBIZINFO_DISPLAY_NAME}のAPIトークンが設定されていません。Cloudflare SecretのGBIZINFO_API_TOKENを設定してください。`,
293:       "configuration_error",
294:     );
295:   }
296:   return normalizedToken;
297: }
298: 
299: export async function getCompanyProfile(
300:   corporateNumber: string,
301:   apiToken: string | undefined,
302:   activityLimit = 20,
303: ) {
304:   const normalizedNumber = corporateNumber.trim();
305:   if (!/^\d{13}$/.test(normalizedNumber)) {
306:     throw new GBizInfoApiError(
307:       "法人番号は13桁の数字で指定してください。",
308:       "invalid_request",
309:       400,
310:     );
311:   }
312:   const normalizedToken = requireApiToken(apiToken);
313:   const limit = Math.min(Math.max(Math.trunc(activityLimit), 1), 50);
314:   const url = new URL(
315:     `${GBIZINFO_BASE_URL}/${encodeURIComponent(normalizedNumber)}`,
316:   );
317:   url.searchParams.set("metadata_flg", "false");
318:   const payload = await fetchGBizInfo(url, normalizedToken);
319:   if (!isRecord(payload)) {
320:     throw new GBizInfoApiError(
321:       `${GBIZINFO_DISPLAY_NAME} APIからJSONオブジェクト以外の応答が返されました。`,
322:       "invalid_response",
323:     );
324:   }
325:   const item = asRecords(payload["hojin-infos"])[0];
326:   if (!item) {
327:     throw new GBizInfoApiError(
328:       `法人番号「${normalizedNumber}」は${GBIZINFO_DISPLAY_NAME}で見つかりませんでした。`,
329:       "not_found",
330:       404,
331:     );
332:   }
333:   return {
334:     source: {
335:       name: GBIZINFO_DISPLAY_NAME,
336:       apiDocumentationUrl: GBIZINFO_SOURCE_URL,
337:     },
338:     retrievedAt: new Date().toISOString(),
339:     company: normalizeProfile(item),
340:     activities: {
341:       status: "not_fetched" as const,
342:       certificationCount: null,
343:       returnedCertificationCount: 0,
344:       certifications: [],
345:       subsidyHistoryCount: null,
346:       returnedSubsidyHistoryCount: 0,
347:       subsidyHistory: [],
348:       hasMore: null,
349:       activityLimit: limit,
350:       nextTool: "get_company_activities",
351:       note:
352:         "法人基本情報APIだけでは活動情報の完全性を保証できないため、この応答では活動件数を0件と断定しません。活動情報はget_company_activitiesで専用APIから取得してください。",
353:     },
354:     statusPolicy:
355:       "statusAvailabilityがnot_providedの場合、登記中・存続中とは断定できません。状態情報が取得できていないものとして扱ってください。",
356:     caution:
357:       `${GBIZINFO_DISPLAY_NAME}の公開情報には未登録・未更新の項目があります。補助金の申請資格や採択実績を保証するものではありません。`,
358:   };
359: }
360: 
361: export async function searchCompanies(
362:   input: CompanySearchInput,
363:   apiToken: string | undefined,
364: ) {
365:   const name = input.name.trim();
366:   if (!name || name.length > 200) {
367:     throw new GBizInfoApiError(
368:       "法人名は1〜200文字で指定してください。",
369:       "invalid_request",
370:       400,
371:     );
372:   }
373:   const prefecture = input.prefecture?.trim();
374:   const city = input.city?.trim();
375:   if (prefecture && prefecture.length > 20) {
376:     throw new GBizInfoApiError(
377:       "都道府県は20文字以内で指定してください。",
378:       "invalid_request",
379:       400,
380:     );
381:   }
382:   if (city && city.length > 100) {
383:     throw new GBizInfoApiError(
384:       "市区町村は100文字以内で指定してください。",
385:       "invalid_request",
386:       400,
387:     );
388:   }
389: 
390:   const page = Math.min(Math.max(Math.trunc(input.page ?? 1), 1), 10_000);
391:   const limit = Math.min(Math.max(Math.trunc(input.limit ?? 10), 1), 20);
392:   const url = new URL(GBIZINFO_BASE_URL);
393:   url.searchParams.set("name", name);
394:   if (prefecture) url.searchParams.set("prefecture", prefecture);
395:   if (city) url.searchParams.set("city", city);
396:   url.searchParams.set("page", String(page));
397:   url.searchParams.set("limit", String(limit));
398:   url.searchParams.set("metadata_flg", "false");
399: 
400:   const payload = await fetchGBizInfo(url, requireApiToken(apiToken));
401:   if (!isRecord(payload)) {
402:     throw new GBizInfoApiError(
403:       `${GBIZINFO_DISPLAY_NAME} APIからJSONオブジェクト以外の応答が返されました。`,
404:       "invalid_response",
405:     );
406:   }
407:   const candidates = asRecords(payload["hojin-infos"]).map(
408:     normalizeSearchCandidate,
409:   );
410:   const mayHaveMore = candidates.length === limit;
411:   const selectionStatus =
412:     candidates.length === 0
413:       ? "no_match"
414:       : candidates.length === 1 && !mayHaveMore
415:         ? "unique"
416:         : "ambiguous";
417: 
418:   return {
419:     source: {
420:       name: GBIZINFO_DISPLAY_NAME,
421:       apiDocumentationUrl: GBIZINFO_SOURCE_URL,
422:     },
423:     retrievedAt: new Date().toISOString(),
424:     query: {
425:       name,
426:       prefecture: prefecture || null,
427:       city: city || null,
428:       page,
429:       limit,
430:     },
431:     selectionStatus,
432:     requiresSelection: selectionStatus === "ambiguous",
433:     returnedCount: candidates.length,
434:     mayHaveMore,
435:     resultScope: mayHaveMore
436:       ? `第${page}ページの先頭${limit}件。次ページに候補が存在する可能性があります。`
437:       : `第${page}ページで返された${candidates.length}件。`,
438:     candidates,
439:     nextStep:
440:       selectionStatus === "unique"
441:         ? "唯一の候補の法人番号をget_company_profileに渡して詳細を確認してください。"
442:         : selectionStatus === "ambiguous"
443:           ? mayHaveMore
444:             ? "これは先頭ページの候補です。所在地や正式名称で絞り込むか次ページを確認し、候補を自動決定せず法人番号を選択してください。"
445:             : "所在地や正式名称を利用者に確認し、候補を自動決定せず法人番号を選択してください。"
446:           : "名称の表記を変えるか、都道府県・市区町村を追加して再検索してください。",
447:     statusPolicy:
448:       "候補のstatusAvailabilityがnot_providedの場合、登記中・存続中とは断定せず、状態情報なしと表示してください。",
449:     caution:
450:       "名称検索は法人を一意に特定できない場合があります。所在地と法人番号を確認してから企業プロフィールや補助金適合度判定へ進んでください。",
451:   };
452: }