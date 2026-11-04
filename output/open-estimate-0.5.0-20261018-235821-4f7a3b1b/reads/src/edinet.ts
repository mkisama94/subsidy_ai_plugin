1: import { unzipSync } from "fflate";
2: 
3: const EDINET_API_BASE_URL = "https://api.edinet-fsa.go.jp/api/v2";
4: const EDINET_CODE_LIST_URL =
5:   "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip";
6: const EDINET_SOURCE_URL =
7:   "https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WZEK0110.html";
8: const REQUEST_TIMEOUT_MS = 15_000;
9: const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
10: const MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
11: const MAX_EVIDENCE_ITEMS = 2;
12: 
13: type JsonRecord = Record<string, unknown>;
14: 
15: export type CorporateRelationshipStatus =
16:   | "confirmed"
17:   | "possible"
18:   | "not_found_in_checked_filing"
19:   | "unknown";
20: 
21: export type VerifyCorporateRelationshipInput = {
22:   targetCompanyName: string;
23:   targetCorporateNumber?: string;
24:   parentCompanyName: string;
25:   parentCorporateNumber?: string;
26:   filingDate?: string;
27:   documentId?: string;
28: };
29: 
30: export type EdinetCodeCandidate = {
31:   edinetCode: string;
32:   name: string;
33:   nameEnglish: string | null;
34:   corporateNumber: string | null;
35:   securitiesCode: string | null;
36:   fiscalYearEnd: string | null;
37:   location: string | null;
38: };
39: 
40: type EdinetDocument = {
41:   docID: string;
42:   edinetCode: string | null;
43:   filerName: string | null;
44:   docDescription: string | null;
45:   docTypeCode: string | null;
46:   submitDateTime: string | null;
47:   periodStart: string | null;
48:   periodEnd: string | null;
49:   csvFlag: string | null;
50:   legalStatus: string | null;
51: };
52: 
53: export class EdinetApiError extends Error {
54:   constructor(
55:     message: string,
56:     readonly code:
57:       | "configuration_error"
58:       | "invalid_request"
59:       | "authentication_error"
60:       | "not_found"
61:       | "rate_limited"
62:       | "timeout"
63:       | "upstream_error"
64:       | "invalid_response",
65:     readonly status?: number,
66:   ) {
67:     super(message);
68:     this.name = "EdinetApiError";
69:   }
70: }
71: 
72: function isRecord(value: unknown): value is JsonRecord {
73:   return typeof value === "object" && value !== null && !Array.isArray(value);
74: }
75: 
76: function asString(value: unknown): string | null {
77:   if (typeof value === "string" && value.trim()) return value.trim();
78:   if (typeof value === "number" && Number.isFinite(value)) return String(value);
79:   return null;
80: }
81: 
82: function normalizeCompanyName(value: string): string {
83:   return value
84:     .normalize("NFKC")
85:     .toLowerCase()
86:     .replace(/[\s　・･.,，、'"“”‘’()（）\-‐‑–—―]/gu, "")
87:     .replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/u, "")
88:     .replace(/(株式会社|有限会社|合同会社|合資会社|合名会社)$/u, "");
89: }
90: 
91: function decodeText(bytes: Uint8Array): string {
92:   if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
93:     return new TextDecoder("utf-8").decode(bytes.subarray(3));
94:   }
95:   if (bytes[0] === 0xff && bytes[1] === 0xfe) {
96:     return new TextDecoder("utf-16le").decode(bytes.subarray(2));
97:   }
98:   try {
99:     return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
100:   } catch {
101:     try {
102:       return new TextDecoder("shift_jis").decode(bytes);
103:     } catch {
104:       throw new EdinetApiError(
105:         "EDINETが返したCSVの文字コードを解釈できませんでした。",
106:         "invalid_response",
107:       );
108:     }
109:   }
110: }
111: 
112: export function parseCsv(text: string): string[][] {
113:   const rows: string[][] = [];
114:   let row: string[] = [];
115:   let field = "";
116:   let quoted = false;
117: 
118:   for (let index = 0; index < text.length; index += 1) {
119:     const character = text[index]!;
120:     if (quoted) {
121:       if (character === '"' && text[index + 1] === '"') {
122:         field += '"';
123:         index += 1;
124:       } else if (character === '"') {
125:         quoted = false;
126:       } else {
127:         field += character;
128:       }
129:       continue;
130:     }
131:     if (character === '"') {
132:       quoted = true;
133:     } else if (character === ",") {
134:       row.push(field);
135:       field = "";
136:     } else if (character === "\n") {
137:       row.push(field.replace(/\r$/u, ""));
138:       rows.push(row);
139:       row = [];
140:       field = "";
141:     } else {
142:       field += character;
143:     }
144:   }
145:   if (field || row.length) {
146:     row.push(field.replace(/\r$/u, ""));
147:     rows.push(row);
148:   }
149:   return rows;
150: }
151: 
152: function unzipArchive(bytes: Uint8Array): Record<string, Uint8Array> {
153:   if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
154:     throw new EdinetApiError(
155:       "EDINETの取得ファイルが安全上の上限を超えています。",
156:       "invalid_response",
157:     );
158:   }
159:   let files: Record<string, Uint8Array>;
160:   try {
161:     files = unzipSync(bytes);
162:   } catch {
163:     throw new EdinetApiError(
164:       "EDINETのZIPファイルを展開できませんでした。",
165:       "invalid_response",
166:     );
167:   }
168:   const totalSize = Object.values(files).reduce(
169:     (sum, file) => sum + file.byteLength,
170:     0,
171:   );
172:   if (totalSize > MAX_UNCOMPRESSED_BYTES) {
173:     throw new EdinetApiError(
174:       "EDINETの展開後ファイルが安全上の上限を超えています。",
175:       "invalid_response",
176:     );
177:   }
178:   return files;
179: }
180: 
181: async function fetchWithTimeout(url: string): Promise<Response> {
182:   try {
183:     return await fetch(url, {
184:       signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
185:       headers: { Accept: "application/json, application/zip, */*" },
186:     });
187:   } catch (error) {
188:     if (error instanceof DOMException && error.name === "TimeoutError") {
189:       throw new EdinetApiError(
190:         "EDINET APIへの接続がタイムアウトしました。",
191:         "timeout",
192:       );
193:     }
194:     throw new EdinetApiError(
195:       "EDINET APIへ接続できませんでした。",
196:       "upstream_error",
197:     );
198:   }
199: }
200: 
201: async function checkedResponse(response: Response): Promise<Response> {
202:   if (response.ok) return response;
203:   const code =
204:     response.status === 401 || response.status === 403
205:       ? "authentication_error"
206:       : response.status === 404
207:         ? "not_found"
208:         : response.status === 429
209:           ? "rate_limited"
210:           : response.status >= 500
211:             ? "upstream_error"
212:             : "invalid_request";
213:   throw new EdinetApiError(
214:     `EDINET APIがHTTP ${response.status}を返しました。`,
215:     code,
216:     response.status,
217:   );
218: }
219: 
220: async function fetchArchive(url: string): Promise<Record<string, Uint8Array>> {
221:   const response = await checkedResponse(await fetchWithTimeout(url));
222:   return unzipArchive(new Uint8Array(await response.arrayBuffer()));
223: }
224: 
225: export function parseEdinetCodeList(
226:   files: Record<string, Uint8Array>,
227: ): EdinetCodeCandidate[] {
228:   const entry = Object.entries(files).find(([name]) =>
229:     name.toLowerCase().endsWith(".csv"),
230:   );
231:   if (!entry) {
232:     throw new EdinetApiError(
233:       "EDINETコード一覧にCSVが含まれていません。",
234:       "invalid_response",
235:     );
236:   }
237:   return parseCsv(decodeText(entry[1]))
238:     .filter((row) => /^E\d{5}$/u.test(row[0]?.trim() ?? ""))
239:     .map((row) => ({
240:       edinetCode: row[0]!.trim(),
241:       fiscalYearEnd: asString(row[5]),
242:       name: asString(row[6]) ?? "",
243:       nameEnglish: asString(row[7]),
244:       location: asString(row[9]),
245:       securitiesCode: asString(row[11]),
246:       corporateNumber: asString(row[12]),
247:     }))
248:     .filter((candidate) => candidate.name.length > 0);
249: }
250: 
251: async function resolveParentCandidates(
252:   parentName: string,
253:   parentCorporateNumber?: string,
254: ): Promise<EdinetCodeCandidate[]> {
255:   const candidates = parseEdinetCodeList(
256:     await fetchArchive(EDINET_CODE_LIST_URL),
257:   );
258:   if (parentCorporateNumber) {
259:     return candidates.filter(
260:       (candidate) => candidate.corporateNumber === parentCorporateNumber,
261:     );
262:   }
263:   const normalized = normalizeCompanyName(parentName);
264:   return candidates.filter(
265:     (candidate) => normalizeCompanyName(candidate.name) === normalized,
266:   );
267: }
268: 
269: function formatDate(date: Date): string {
270:   return date.toISOString().slice(0, 10);
271: }
272: 
273: function addUtcDays(date: Date, days: number): Date {
274:   const result = new Date(date);
275:   result.setUTCDate(result.getUTCDate() + days);
276:   return result;
277: }
278: 
279: export function inferredFilingDates(
280:   fiscalYearEnd: string,
281:   now = new Date(),
282: ): string[] {
283:   const match = fiscalYearEnd
284:     .normalize("NFKC")
285:     .match(/(\d{1,2})月(?:(\d{1,2})日|(末日?))/u);
286:   if (!match) return [];
287:   const month = Number(match[1]);
288:   const explicitDay = match[2] ? Number(match[2]) : null;
289:   const closingForYear = (year: number) => {
290:     const day =
291:       explicitDay ?? new Date(Date.UTC(year, month, 0)).getUTCDate();
292:     return new Date(Date.UTC(year, month - 1, day));
293:   };
294:   let closing = closingForYear(now.getUTCFullYear());
295:   if (closing.getTime() > addUtcDays(now, -65).getTime()) {
296:     closing = closingForYear(now.getUTCFullYear() - 1);
297:   }
298:   const start = addUtcDays(closing, 65);
299:   return Array.from({ length: 40 }, (_, index) =>
300:     formatDate(addUtcDays(start, index)),
301:   ).filter((date) => date <= formatDate(now));
302: }
303: 
304: function normalizeDocument(value: JsonRecord): EdinetDocument | null {
305:   const docID = asString(value.docID);
306:   if (!docID) return null;
307:   return {
308:     docID,
309:     edinetCode: asString(value.edinetCode),
310:     filerName: asString(value.filerName),
311:     docDescription: asString(value.docDescription),
312:     docTypeCode: asString(value.docTypeCode),
313:     submitDateTime: asString(value.submitDateTime),
314:     periodStart: asString(value.periodStart),
315:     periodEnd: asString(value.periodEnd),
316:     csvFlag: asString(value.csvFlag),
317:     legalStatus: asString(value.legalStatus),
318:   };
319: }
320: 
321: async function fetchDocumentsForDate(
322:   date: string,
323:   apiKey: string,
324: ): Promise<EdinetDocument[]> {
325:   const url = new URL(`${EDINET_API_BASE_URL}/documents.json`);
326:   url.searchParams.set("date", date);
327:   url.searchParams.set("type", "2");
328:   url.searchParams.set("Subscription-Key", apiKey);
329:   const response = await checkedResponse(await fetchWithTimeout(url.toString()));
330:   let payload: unknown;
331:   try {
332:     payload = await response.json();
333:   } catch {
334:     throw new EdinetApiError(
335:       "EDINETの書類一覧がJSONではありませんでした。",
336:       "invalid_response",
337:     );
338:   }
339:   if (!isRecord(payload) || !Array.isArray(payload.results)) {
340:     throw new EdinetApiError(
341:       "EDINETの書類一覧形式を解釈できませんでした。",
342:       "invalid_response",
343:     );
344:   }
345:   return payload.results
346:     .filter(isRecord)
347:     .map(normalizeDocument)
348:     .filter((document): document is EdinetDocument => document !== null);
349: }
350: 
351: async function findLatestAnnualReport(
352:   parent: EdinetCodeCandidate,
353:   apiKey: string,
354:   filingDate?: string,
355:   documentId?: string,
356: ): Promise<{ document: EdinetDocument | null; checkedDates: string[] }> {
357:   const dates = filingDate
358:     ? [filingDate]
359:     : parent.fiscalYearEnd
360:       ? inferredFilingDates(parent.fiscalYearEnd)
361:       : [];
362:   if (!dates.length) return { document: null, checkedDates: [] };
363: 
364:   const datesNewestFirst = [...dates].reverse();
365:   const checkedDates: string[] = [];
366:   for (let index = 0; index < datesNewestFirst.length; index += 8) {
367:     const batch = datesNewestFirst.slice(index, index + 8);
368:     const results = await Promise.all(
369:       batch.map((date) => fetchDocumentsForDate(date, apiKey)),
370:     );
371:     checkedDates.push(...batch);
372:     const annualReports = results
373:       .flat()
374:       .filter(
375:         (document) =>
376:           document.edinetCode === parent.edinetCode &&
377:           (document.docTypeCode === "120" ||
378:             document.docDescription?.includes("有価証券報告書")) &&
379:           !document.docDescription?.includes("訂正") &&
380:           document.csvFlag === "1" &&
381:           (document.legalStatus === "1" || document.legalStatus === "2") &&
382:           (!documentId || document.docID === documentId),
383:       )
384:       .sort((left, right) =>
385:         (right.submitDateTime ?? "").localeCompare(left.submitDateTime ?? ""),
386:       );
387:     if (annualReports.length) {
388:       return { document: annualReports[0]!, checkedDates };
389:     }
390:   }
391:   return { document: null, checkedDates };
392: }
393: function stripMarkup(value: string): string {
394:   return value
395:     .replace(/<[^>]*>/gu, " ")
396:     .replace(/&nbsp;|&#160;/giu, " ")
397:     .replace(/&amp;/giu, "&")
398:     .replace(/&lt;/giu, "<")
399:     .replace(/&gt;/giu, ">")
400:     .replace(/\s+/gu, " ")
401:     .trim();
402: }
403: 
404: function targetEvidenceSegment(value: string, targetCompanyName: string): string {
405:   const compact = stripMarkup(value).normalize("NFKC").replace(/\s+/gu, "");
406:   const target = normalizeCompanyName(targetCompanyName);
407:   const targetIndex = compact.toLowerCase().indexOf(target);
408:   if (targetIndex < 0) return compact.slice(0, 500);
409: 
410:   const relationshipMarker = /\((?:連結)?(?:子会社|関連会社|親会社)[^)]*\)/gu;
411:   const markers = [...compact.matchAll(relationshipMarker)].map((match) => ({
412:     index: match.index,
413:   }));
414:   const currentMarker = markers
415:     .filter((marker) => marker.index <= targetIndex)
416:     .at(-1);
417:   const nextMarker = markers.find((marker) => marker.index > targetIndex);
418:   const start = currentMarker?.index ?? Math.max(0, targetIndex - 120);
419:   const end = nextMarker?.index ?? targetIndex + target.length + 320;
420:   return compact.slice(start, Math.min(compact.length, end, start + 700));
421: }
422: 
423: function evidencePriority(itemId: string | null, itemName: string | null): number {
424:   const value = `${itemId ?? ""} ${itemName ?? ""}`;
425:   if (/OverviewOfAffiliatedEntitiesTextBlock|関係会社の状況/u.test(value)) return 0;
426:   if (/NumberOfConsolidatedSubsidiaries|連結子会社の数/u.test(value)) return 1;
427:   if (/DescriptionOfBusinessTextBlock|事業の内容/u.test(value)) return 2;
428:   if (/ConsolidatedFinancialStatements|連結の範囲/u.test(value)) return 3;
429:   return 10;
430: }
431: 
432: function checkedDateRange(dates: string[]) {
433:   if (!dates.length) return null;
434:   const sorted = [...dates].sort();
435:   return {
436:     from: sorted[0]!,
437:     to: sorted.at(-1)!,
438:     count: sorted.length,
439:   };
440: }
441: 
442: function inspectRelationshipCsv(
443:   files: Record<string, Uint8Array>,
444:   targetCompanyName: string,
445: ) {
446:   const normalizedTarget = normalizeCompanyName(targetCompanyName);
447:   const evidence: Array<{
448:     file: string;
449:     itemId: string | null;
450:     itemName: string | null;
451:     snippet: string;
452:     priority: number;
453:   }> = [];
454: 
455:   for (const [file, bytes] of Object.entries(files)) {
456:     if (!file.toLowerCase().endsWith(".csv")) continue;
457:     for (const row of parseCsv(decodeText(bytes))) {
458:       const fields = row.flatMap((cell) => cell.split("\t"));
459:       const matchingCell = fields.find((cell) =>
460:         normalizeCompanyName(stripMarkup(cell)).includes(normalizedTarget),
461:       );
462:       if (!matchingCell) continue;
463:       const itemIdIndex = fields.findIndex((field) =>
464:         /^[A-Za-z][A-Za-z0-9_]*:[A-Za-z0-9_]+$/u.test(field.trim()),
465:       );
466:       const itemId = asString(fields[itemIdIndex >= 0 ? itemIdIndex : 0]);
467:       const itemName = asString(fields[itemIdIndex >= 0 ? itemIdIndex + 1 : 1]);
468:       evidence.push({
469:         file,
470:         itemId,
471:         itemName: itemName?.slice(0, 160) ?? null,
472:         snippet: targetEvidenceSegment(matchingCell, targetCompanyName),
473:         priority: evidencePriority(itemId, itemName),
474:       });
475:     }
476:   }
477: 
478:   evidence.sort((left, right) => left.priority - right.priority);
479:   const selectedEvidence = evidence.slice(0, MAX_EVIDENCE_ITEMS);
480:   const primaryEvidence = selectedEvidence[0];
481:   const combined = selectedEvidence.map((item) => item.snippet).join(" ");
482:   const relationshipWords = [
483:     "子会社",
484:     "連結子会社",
485:     "関係会社",
486:     "親会社",
487:     "議決権",
488:     "所有割合",
489:     "出資比率",
490:   ];
491:   const hasRelationshipContext = relationshipWords.some((word) =>
492:     combined.includes(word),
493:   );
494:   const percentages = [
495:     ...new Set(
496:       [
497:         ...(primaryEvidence?.snippet ?? "").matchAll(
498:           /(?:\d{1,3}(?:\.\d+)?)\s*[%％]/gu,
499:         ),
500:       ].map((match) => match[0].replace("％", "%")),
501:     ),
502:   ].slice(0, 10);
503: 
504:   return {
505:     evidence: selectedEvidence.map(({ priority: _priority, ...item }) => item),
506:     hasRelationshipContext,
507:     percentages,
508:   };
509: }
510: function unknownResult(
511:   input: VerifyCorporateRelationshipInput,
512:   reason: string,
513:   parentCandidates: EdinetCodeCandidate[] = [],
514:   checkedDates: string[] = [],
515: ) {
516:   return {
517:     source: { name: "EDINET（金融庁）", apiDocumentationUrl: EDINET_SOURCE_URL },
518:     retrievedAt: new Date().toISOString(),
519:     query: input,
520:     assessment: {
521:       status: "unknown" as const,
522:       reason,
523:       parentCandidates,
524:       checkedDateRange: checkedDateRange(checkedDates),
525:       evidence: [],
526:     },
527:     caution:
528:       "EDINETで確認できないことは、資本関係が存在しないことを意味しません。最新の公募要領と株主構成・役員構成を確認してください。",
529:   };
530: }
531: 
532: export async function verifyCorporateRelationship(
533:   input: VerifyCorporateRelationshipInput,
534:   apiKey?: string,
535: ) {
536:   if (!apiKey?.trim()) {
537:     throw new EdinetApiError(
538:       "EDINET_API_KEYが設定されていません。Cloudflare Secretとして登録してください。",
539:       "configuration_error",
540:     );
541:   }
542:   if (input.targetCorporateNumber && !/^\d{13}$/u.test(input.targetCorporateNumber)) {
543:     throw new EdinetApiError("対象法人番号は13桁で指定してください。", "invalid_request");
544:   }
545:   if (input.parentCorporateNumber && !/^\d{13}$/u.test(input.parentCorporateNumber)) {
546:     throw new EdinetApiError("親会社法人番号は13桁で指定してください。", "invalid_request");
547:   }
548: 
549:   const parentCandidates = await resolveParentCandidates(
550:     input.parentCompanyName,
551:     input.parentCorporateNumber,
552:   );
553:   if (parentCandidates.length === 0) {
554:     return unknownResult(
555:       input,
556:       "親会社候補をEDINETコード一覧で一意に特定できませんでした。正式名称または法人番号を確認してください。",
557:     );
558:   }
559:   if (parentCandidates.length > 1) {
560:     return unknownResult(
561:       input,
562:       "同名の親会社候補が複数あります。所在地または法人番号で候補を確定してください。",
563:       parentCandidates.slice(0, 20),
564:     );
565:   }
566:   const parent = parentCandidates[0]!;
567: 
568:   const found = await findLatestAnnualReport(
569:     parent,
570:     apiKey,
571:     input.filingDate,
572:     input.documentId,
573:   );
574:   const document = found.document;
575:   const checkedDates = found.checkedDates;
576:   if (!document) {
577:     return unknownResult(
578:       input,
579:       checkedDates.length
580:         ? "推定した提出期間にCSV取得可能な有価証券報告書が見つかりませんでした。提出日または書類管理番号が分かる場合は指定してください。"
581:         : "決算期または提出日を特定できず、有価証券報告書を検索できませんでした。提出日または書類管理番号を指定してください。",
582:       [parent],
583:       checkedDates,
584:     );
585:   }
586: 
587:   const documentUrl = new URL(
588:     `${EDINET_API_BASE_URL}/documents/${encodeURIComponent(document.docID)}`,
589:   );
590:   documentUrl.searchParams.set("type", "5");
591:   documentUrl.searchParams.set("Subscription-Key", apiKey);
592:   const inspection = inspectRelationshipCsv(
593:     await fetchArchive(documentUrl.toString()),
594:     input.targetCompanyName,
595:   );
596:   const status: CorporateRelationshipStatus = inspection.evidence.length
597:     ? inspection.hasRelationshipContext
598:       ? "confirmed"
599:       : "possible"
600:     : "not_found_in_checked_filing";
601: 
602:   return {
603:     source: { name: "EDINET（金融庁）", apiDocumentationUrl: EDINET_SOURCE_URL },
604:     retrievedAt: new Date().toISOString(),
605:     query: input,
606:     parent,
607:     filing: {
608:       documentId: document.docID,
609:       filerName: document.filerName,
610:       description: document.docDescription,
611:       submittedAt: document.submitDateTime,
612:       periodStart: document.periodStart,
613:       periodEnd: document.periodEnd,
614:       checkedDateRange: checkedDateRange(checkedDates),
615:     },
616:     assessment: {
617:       status,
618:       reason:
619:         status === "confirmed"
620:           ? "対象会社名と資本関係を示す文脈をEDINETの開示書類で確認しました。"
621:           : status === "possible"
622:             ? "対象会社名は確認できましたが、抽出箇所だけでは資本関係を確定できません。"
623:             : "確認した開示書類では対象会社名を発見できませんでした。資本関係がないことを意味するものではありません。",
624:       percentages: inspection.percentages,
625:       evidence: inspection.evidence,
626:     },
627:     largeEnterpriseAffiliation: {
628:       requiresGuidelineReview: true,
629:       relationshipConfirmed: status === "confirmed",
630:       programEligibilityEvaluated: false,
631:       statusLabel: "制度ごとの申請条件を確認する必要があります",
632:       note:
633:         "EDINETで確認できるのは資本関係の事実です。100%子会社であっても全制度で一律に対象外とは限りません。出資比率、複数大企業の保有、役員構成などを、候補となった補助金の最新の公募要領と照合してください。",
634:     },
635:     caution:
636:       "これはEDINET提出書類における名称検索と関係文脈の確認結果です。現在の資本関係、みなし大企業該当性、補助金の申請資格を保証しません。",
637:   };
638: }