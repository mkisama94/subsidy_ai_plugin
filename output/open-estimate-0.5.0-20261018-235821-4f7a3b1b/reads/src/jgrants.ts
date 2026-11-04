1: import {
2:   createPrivateCacheKey,
3:   type PublicApiCache,
4:   readThroughPublicCache,
5: } from "./cache";
6: 
7: import { RESPONSE_GUIDANCE, SEARCH_GUIDANCE } from "./responseGuidance";
8: 
9: const JGRANTS_SEARCH_URL =
10:   "https://api.jgrants-portal.go.jp/exp/v1/public/subsidies";
11: const JGRANTS_DETAIL_URL =
12:   "https://api.jgrants-portal.go.jp/exp/v2/public/subsidies/id";
13: const JGRANTS_SOURCE_URL = "https://developers.digital.go.jp/documents/jgrants/api/";
14: const REQUEST_TIMEOUT_MS = 15_000;
15: const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
16: const SEARCH_CACHE_STALE_TTL_MS = 24 * 60 * 60 * 1000;
17: const DETAIL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
18: const DETAIL_CACHE_STALE_TTL_MS = 72 * 60 * 60 * 1000;
19: 
20: type JsonRecord = Record<string, unknown>;
21: 
22: export type SearchSubsidiesInput = {
23:   keyword: string;
24:   usePurpose?: string;
25:   targetArea?: string;
26:   industry?: string;
27:   employeeCount?: number;
28:   acceptingOnly: boolean;
29:   sort:
30:     | "created_date"
31:     | "acceptance_start_datetime"
32:     | "acceptance_end_datetime";
33:   order: "ASC" | "DESC";
34:   limit: number;
35: };
36: 
37: export type JGrantsCacheOptions = {
38:   cache?: PublicApiCache;
39:   searchCacheKeySecret?: string;
40:   now?: () => number;
41: };
42: 
43: export type SubsidySearchItem = {
44:   id: string;
45:   referenceNumber: string | null;
46:   title: string;
47:   institutionName: string | null;
48:   targetArea: string | null;
49:   employeeLimit: string | null;
50:   subsidyMaxLimitYen: number | null;
51:   createdAt: string | null;
52:   acceptanceStart: string | null;
53:   acceptanceEnd: string | null;
54:   acceptanceStatus: "scheduled" | "open" | "closed" | "unknown";
55:   detailUrl: string;
56: };
57: 
58: export class JGrantsApiError extends Error {
59:   constructor(
60:     message: string,
61:     readonly code:
62:       | "invalid_request"
63:       | "not_found"
64:       | "timeout"
65:       | "upstream_error"
66:       | "invalid_response",
67:     readonly status?: number,
68:   ) {
69:     super(message);
70:     this.name = "JGrantsApiError";
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
82: function asNumber(value: unknown): number | null {
83:   if (typeof value === "number" && Number.isFinite(value)) return value;
84:   if (typeof value === "string" && value.trim()) {
85:     const parsed = Number(value);
86:     return Number.isFinite(parsed) ? parsed : null;
87:   }
88:   return null;
89: }
90: 
91: function asBoolean(value: unknown): boolean | null {
92:   return typeof value === "boolean" ? value : null;
93: }
94: 
95: function asRecords(value: unknown): JsonRecord[] {
96:   if (Array.isArray(value)) return value.filter(isRecord);
97:   return isRecord(value) ? [value] : [];
98: }
99: 
100: function getResultRecords(payload: unknown): JsonRecord[] {
101:   if (!isRecord(payload)) {
102:     throw new JGrantsApiError(
103:       "JグランツAPIからJSONオブジェクト以外の応答が返されました。",
104:       "invalid_response",
105:     );
106:   }
107:   return asRecords(payload.result);
108: }
109: 
110: function getResultCount(payload: unknown, fallback: number): number {
111:   if (!isRecord(payload) || !isRecord(payload.metadata)) return fallback;
112:   const resultset = payload.metadata.resultset;
113:   if (!isRecord(resultset)) return fallback;
114:   return asNumber(resultset.count) ?? fallback;
115: }
116: 
117: async function fetchJson(url: URL): Promise<unknown> {
118:   const controller = new AbortController();
119:   const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
120:   try {
121:     const response = await fetch(url, {
122:       method: "GET",
123:       headers: { Accept: "application/json" },
124:       signal: controller.signal,
125:     });
126:     if (!response.ok) {
127:       const code =
128:         response.status === 400
129:           ? "invalid_request"
130:           : response.status === 404
131:             ? "not_found"
132:             : "upstream_error";
133:       throw new JGrantsApiError(
134:         `JグランツAPIがHTTP ${response.status}を返しました。`,
135:         code,
136:         response.status,
137:       );
138:     }
139:     try {
140:       return await response.json();
141:     } catch {
142:       throw new JGrantsApiError(
143:         "JグランツAPIの応答をJSONとして解析できませんでした。",
144:         "invalid_response",
145:         response.status,
146:       );
147:     }
148:   } catch (error) {
149:     if (error instanceof JGrantsApiError) throw error;
150:     if (error instanceof DOMException && error.name === "AbortError") {
151:       throw new JGrantsApiError(
152:         "JグランツAPIへの接続がタイムアウトしました。",
153:         "timeout",
154:       );
155:     }
156:     throw new JGrantsApiError(
157:       "JグランツAPIへ接続できませんでした。時間をおいて再試行してください。",
158:       "upstream_error",
159:     );
160:   } finally {
161:     clearTimeout(timeout);
162:   }
163: }
164: 
165: function getAcceptanceStatus(
166:   start: string | null,
167:   end: string | null,
168:   now = new Date(),
169: ): SubsidySearchItem["acceptanceStatus"] {
170:   const startMs = start ? Date.parse(start) : Number.NaN;
171:   const endMs = end ? Date.parse(end) : Number.NaN;
172:   const nowMs = now.getTime();
173:   if (Number.isFinite(startMs) && nowMs < startMs) return "scheduled";
174:   if (Number.isFinite(endMs) && nowMs > endMs) return "closed";
175:   if (
176:     (Number.isFinite(startMs) && nowMs >= startMs) ||
177:     (Number.isFinite(endMs) && nowMs <= endMs)
178:   ) {
179:     return "open";
180:   }
181:   return "unknown";
182: }
183: 
184: function normalizeSearchItem(item: JsonRecord): SubsidySearchItem | null {
185:   const id = asString(item.id);
186:   const title = asString(item.title);
187:   if (!id || !title) return null;
188:   const acceptanceStart = asString(item.acceptance_start_datetime);
189:   const acceptanceEnd = asString(item.acceptance_end_datetime);
190:   return {
191:     id,
192:     referenceNumber: asString(item.name),
193:     title,
194:     institutionName: asString(item.institution_name),
195:     targetArea: asString(item.target_area_search),
196:     employeeLimit: asString(item.target_number_of_employees),
197:     subsidyMaxLimitYen: asNumber(item.subsidy_max_limit),
198:     createdAt: asString(item.created_date),
199:     acceptanceStart,
200:     acceptanceEnd,
201:     acceptanceStatus: getAcceptanceStatus(acceptanceStart, acceptanceEnd),
202:     detailUrl: `https://www.jgrants-portal.go.jp/subsidy/${encodeURIComponent(id)}`,
203:   };
204: }
205: 
206: function employeeLimitAllows(
207:   employeeLimit: string | null,
208:   employeeCount: number | undefined,
209: ): boolean {
210:   if (employeeCount === undefined || !employeeLimit) return true;
211:   if (employeeLimit.includes("制約なし")) return true;
212:   if (employeeLimit.includes("以上")) {
213:     const minimum = Number(employeeLimit.match(/\d+/)?.[0]);
214:     return Number.isFinite(minimum) ? employeeCount >= minimum : true;
215:   }
216:   const maximum = Number(employeeLimit.match(/\d+/)?.[0]);
217:   return Number.isFinite(maximum) ? employeeCount <= maximum : true;
218: }
219: 
220: function createSearchUrl(
221:   input: SearchSubsidiesInput,
222:   targetArea?: string,
223: ): URL {
224:   const url = new URL(JGRANTS_SEARCH_URL);
225:   url.searchParams.set("keyword", input.keyword.trim());
226:   url.searchParams.set("sort", input.sort);
227:   url.searchParams.set("order", input.order);
228:   url.searchParams.set("acceptance", input.acceptingOnly ? "1" : "0");
229:   if (input.usePurpose) {
230:     url.searchParams.set("use_purpose", input.usePurpose.trim());
231:   }
232:   if (input.industry) url.searchParams.set("industry", input.industry.trim());
233:   if (targetArea) url.searchParams.set("target_area_search", targetArea.trim());
234:   return url;
235: }
236: 
237: function sortSubsidies(
238:   items: SubsidySearchItem[],
239:   sort: SearchSubsidiesInput["sort"],
240:   order: SearchSubsidiesInput["order"],
241: ): SubsidySearchItem[] {
242:   const field =
243:     sort === "created_date"
244:       ? "createdAt"
245:       : sort === "acceptance_start_datetime"
246:         ? "acceptanceStart"
247:         : "acceptanceEnd";
248:   const direction = order === "ASC" ? 1 : -1;
249:   return items.sort((left, right) => {
250:     const leftMs = left[field] ? Date.parse(left[field]) : Number.NaN;
251:     const rightMs = right[field] ? Date.parse(right[field]) : Number.NaN;
252:     if (!Number.isFinite(leftMs) && !Number.isFinite(rightMs)) return 0;
253:     if (!Number.isFinite(leftMs)) return 1;
254:     if (!Number.isFinite(rightMs)) return -1;
255:     return (leftMs - rightMs) * direction;
256:   });
257: }
258: 
259: function searchQuery(input: SearchSubsidiesInput) {
260:   return {
261:     keyword: input.keyword.trim(),
262:     usePurpose: input.usePurpose?.trim() || null,
263:     targetArea: input.targetArea?.trim() || null,
264:     includesNationwidePrograms: Boolean(
265:       input.targetArea?.trim() && input.targetArea.trim() !== "全国",
266:     ),
267:     industry: input.industry?.trim() || null,
268:     employeeCount: input.employeeCount ?? null,
269:     acceptingOnly: input.acceptingOnly,
270:     sort: input.sort,
271:     order: input.order,
272:     limit: input.limit,
273:   };
274: }
275: 
276: async function fetchSubsidySearch(input: SearchSubsidiesInput) {
277:   const targetAreas = input.targetArea?.trim()
278:     ? input.targetArea.trim() === "全国"
279:       ? ["全国"]
280:       : [input.targetArea.trim(), "全国"]
281:     : [undefined];
282:   const payloads = await Promise.all(
283:     targetAreas.map((targetArea) => fetchJson(createSearchUrl(input, targetArea))),
284:   );
285:   const unique = new Map<string, SubsidySearchItem>();
286:   let upstreamCount = 0;
287: 
288:   for (const payload of payloads) {
289:     const records = getResultRecords(payload);
290:     upstreamCount += getResultCount(payload, records.length);
291:     for (const record of records) {
292:       const normalized = normalizeSearchItem(record);
293:       if (normalized) unique.set(normalized.id, normalized);
294:     }
295:   }
296: 
297:   const matching = sortSubsidies([...unique.values()], input.sort, input.order)
298:     .filter((item) => employeeLimitAllows(item.employeeLimit, input.employeeCount))
299:     .filter((item) => !input.acceptingOnly || item.acceptanceStatus === "open");
300: 
301:   return {
302:     source: {
303:       name: "Jグランツ（jGrants）",
304:       apiDocumentationUrl: JGRANTS_SOURCE_URL,
305:     },
306:     retrievedAt: new Date().toISOString(),
307:     upstreamCount,
308:     matchingCount: matching.length,
309:     returnedCount: Math.min(matching.length, input.limit),
310:     hasMore: matching.length > input.limit,
311:     subsidies: matching.slice(0, input.limit),
312:     caution:
313:       "検索結果だけで対象可否を断定せず、詳細情報と最新の公募要領を確認してください。",
314:   };
315: }
316: 
317: function canUseStaleJGrantsData(error: unknown): boolean {
318:   return (
319:     error instanceof JGrantsApiError &&
320:     (error.code === "timeout" || error.code === "upstream_error")
321:   );
322: }
323: 
324: export async function searchSubsidies(
325:   input: SearchSubsidiesInput,
326:   cacheOptions: JGrantsCacheOptions = {},
327: ) {
328:   const query = searchQuery(input);
329:   const cacheKey = cacheOptions.searchCacheKeySecret
330:     ? await createPrivateCacheKey(
331:         "jgrants:search:v1",
332:         query,
333:         cacheOptions.searchCacheKeySecret,
334:       )
335:     : undefined;
336:   const cached = await readThroughPublicCache({
337:     cache: cacheOptions.cache,
338:     key: cacheKey,
339:     source: "jgrants",
340:     resourceType: "subsidy_search",
341:     ttlMs: SEARCH_CACHE_TTL_MS,
342:     staleTtlMs: SEARCH_CACHE_STALE_TTL_MS,
343:     load: () => fetchSubsidySearch(input),
344:     canUseStale: canUseStaleJGrantsData,
345:     now: cacheOptions.now,
346:   });
347: 
348:   return {
349:     ...cached.value,
350:     query,
351:     searchGuidance: SEARCH_GUIDANCE,
352:     responseGuidance: RESPONSE_GUIDANCE,
353:     servedAt: new Date((cacheOptions.now ?? Date.now)()).toISOString(),
354:     cache: {
355:       status: cached.status,
356:       isStale: cached.isStale,
357:       expiresAt:
358:         cached.expiresAt === null
359:           ? null
360:           : new Date(cached.expiresAt).toISOString(),
361:     },
362:   };
363: }
364: 
365: function decodeHtmlEntities(value: string): string {
366:   const named: Record<string, string> = {
367:     amp: "&",
368:     lt: "<",
369:     gt: ">",
370:     quot: '"',
371:     apos: "'",
372:     nbsp: " ",
373:   };
374:   return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
375:     if (entity.startsWith("#")) {
376:       const isHex = entity[1]?.toLowerCase() === "x";
377:       const parsed = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
378:       return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
379:     }
380:     return named[entity.toLowerCase()] ?? match;
381:   });
382: }
383: 
384: function htmlToText(value: string | null): string | null {
385:   if (!value) return null;
386:   const withBreaks = value
387:     .replace(/<\s*br\s*\/?\s*>/gi, "\n")
388:     .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
389:     .replace(/<[^>]*>/g, "");
390:   return decodeHtmlEntities(withBreaks)
391:     .replace(/\uFEFF/g, "")
392:     .replace(/[ \t]+\n/g, "\n")
393:     .replace(/\n{3,}/g, "\n\n")
394:     .trim();
395: }
396: 
397: function normalizeWorkflow(workflow: JsonRecord) {
398:   const start = asString(workflow.acceptance_start_datetime);
399:   const end = asString(workflow.acceptance_end_datetime);
400:   return {
401:     id: asString(workflow.id),
402:     fiscalYearRound: asString(workflow.fiscal_year_round),
403:     targetArea: asString(workflow.target_area_search),
404:     targetAreaDetail: asString(workflow.target_area_detail),
405:     acceptanceStart: start,
406:     acceptanceEnd: end,
407:     acceptanceStatus: getAcceptanceStatus(start, end),
408:     projectEndDeadline: asString(workflow.project_end_deadline),
409:   };
410: }
411: 
412: function estimateBase64Bytes(data: string | null): number | null {
413:   if (!data) return null;
414:   const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
415:   return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
416: }
417: 
418: function normalizeDocuments(value: unknown, type: string) {
419:   return asRecords(value).map((document) => {
420:     const data = asString(document.data);
421:     return {
422:       type,
423:       name: asString(document.name) ?? "名称未設定",
424:       availableFromDetailApi: Boolean(data),
425:       approximateSizeBytes: estimateBase64Bytes(data),
426:     };
427:   });
428: }
429: 
430: async function fetchSubsidyDetail(subsidyId: string) {
431:   const url = new URL(
432:     `${JGRANTS_DETAIL_URL}/${encodeURIComponent(subsidyId.trim())}`,
433:   );
434:   const payload = await fetchJson(url);
435:   const item = getResultRecords(payload)[0];
436:   if (!item) {
437:     throw new JGrantsApiError(
438:       `補助金ID「${subsidyId}」は見つかりませんでした。`,
439:       "not_found",
440:       404,
441:     );
442:   }
443: 
444:   const id = asString(item.id) ?? subsidyId.trim();
445:   const workflows = asRecords(item.workflow).map(normalizeWorkflow);
446:   const documents = [
447:     ...normalizeDocuments(item.application_guidelines, "application_guidelines"),
448:     ...normalizeDocuments(item.outline_of_grant, "outline_of_grant"),
449:     ...normalizeDocuments(item.application_form, "application_form"),
450:   ];
451: 
452:   return {
453:     source: {
454:       name: "Jグランツ（jGrants）",
455:       apiDocumentationUrl: JGRANTS_SOURCE_URL,
456:     },
457:     retrievedAt: new Date().toISOString(),
458:     subsidy: {
459:       id,
460:       referenceNumber: asString(item.name),
461:       title: asString(item.title) ?? "名称未設定",
462:       catchPhrase: asString(item.subsidy_catch_phrase),
463:       description: htmlToText(asString(item.detail)),
464:       institutionName: asString(item.institution_name),
465:       usePurpose: asString(item.use_purpose),
466:       industry: asString(item.industry),
467:       employeeLimit: asString(item.target_number_of_employees),
468:       subsidyRate: asString(item.subsidy_rate),
469:       subsidyMaxLimitYen: asNumber(item.subsidy_max_limit),
470:       requestReceptionPresence: asString(item.request_reception_presence),
471:       multipleApplicationsAllowed: asBoolean(item.is_enable_multiple_request),
472:       grantType: asString(item.granttype),
473:       detailUrl:
474:         asString(item.front_subsidy_detail_page_url) ??
475:         `https://www.jgrants-portal.go.jp/subsidy/${encodeURIComponent(id)}`,
476:       workflows,
477:       documents,
478:     },
479:     caution:
480:       "この情報は参考情報です。申請前に最新の公募要領を確認し、必要に応じて実施機関へ問い合わせてください。",
481:   };
482: }
483: 
484: // Internal metadata projection: never return or persist attachment Base64 bodies.
485: export function extractJgrantsDocumentMetadata(payload: unknown) {
486:   const item = getResultRecords(payload)[0];
487:   if (!item) throw new JGrantsApiError("補助金詳細がありません。", "invalid_response");
488:   return {
489:     id: asString(item.id), detailHtml: asString(item.detail) ?? "",
490:     workflowIds: asRecords(item.workflow).map(w => asString(w.id)).filter((x): x is string => Boolean(x)),
491:     attachments: ["application_guidelines", "outline_of_grant", "application_form"].flatMap(type =>
492:       asRecords(item[type]).map(doc => ({ type, name: asString(doc.name) ?? "名称未設定" }))),
493:   };
494: }
495: 
496: export async function getSubsidyDetail(
497:   subsidyId: string,
498:   cacheOptions: JGrantsCacheOptions = {},
499: ) {
500:   const normalizedId = subsidyId.trim();
501:   const cached = await readThroughPublicCache({
502:     cache: cacheOptions.cache,
503:     key: `jgrants:detail:v1:${normalizedId}`,
504:     source: "jgrants",
505:     resourceType: "subsidy_detail",
506:     ttlMs: DETAIL_CACHE_TTL_MS,
507:     staleTtlMs: DETAIL_CACHE_STALE_TTL_MS,
508:     load: () => fetchSubsidyDetail(normalizedId),
509:     canUseStale: canUseStaleJGrantsData,
510:     now: cacheOptions.now,
511:   });
512: 
513:   return {
514:     ...cached.value,
515:     responseGuidance: RESPONSE_GUIDANCE,
516:     servedAt: new Date((cacheOptions.now ?? Date.now)()).toISOString(),
517:     cache: {
518:       status: cached.status,
519:       isStale: cached.isStale,
520:       expiresAt:
521:         cached.expiresAt === null
522:           ? null
523:           : new Date(cached.expiresAt).toISOString(),
524:     },
525:   };
526: }