1: export type ResearchSourceType =
2:   | "official_result"
3:   | "official_report"
4:   | "official_budget"
5:   | "official_guideline"
6:   | "government_statistics"
7:   | "secondary_analysis";
8: 
9: export type CountComparability =
10:   | "confirmed_same_round_and_scope"
11:   | "not_confirmed"
12:   | "not_comparable";
13: 
14: export type SelectionEvidenceInput = {
15:   program: {
16:     seriesKey: string;
17:     canonicalName: string;
18:     institutionName?: string;
19:   };
20:   round: {
21:     jgrantsSubsidyId?: string;
22:     fiscalYear: number;
23:     roundName: string;
24:     scopeKey?: string;
25:     acceptanceStart?: string;
26:     acceptanceEnd?: string;
27:     budgetYen?: number;
28:     officialDetailUrl?: string;
29:     lastCheckedAt: string;
30:   };
31:   counts: {
32:     applicationsCount?: number;
33:     selectedCount?: number;
34:     denominatorLabel?: string;
35:     numeratorLabel?: string;
36:     comparability: CountComparability;
37:   };
38:   source: {
39:     sourceType: ResearchSourceType;
40:     publisher: string;
41:     title: string;
42:     url: string;
43:     publishedAt?: string;
44:     retrievedAt: string;
45:     contentHash: string;
46:     reliability: "high" | "medium" | "low";
47:     role:
48:       | "applications_count"
49:       | "selected_count"
50:       | "both_counts"
51:       | "budget"
52:       | "methodology";
53:   };
54:   basisSummary: string;
55:   asOfDate: string;
56:   expiresAt?: string;
57: };
58: 
59: export type OfficialRateStatus =
60:   | "official_rate_available"
61:   | "insufficient_data"
62:   | "not_comparable";
63: 
64: export type OfficialRateCalculation = {
65:   status: OfficialRateStatus;
66:   statusLabel: string;
67:   officialRate: number | null;
68:   officialRatePercent: number | null;
69:   applicationsCount: number | null;
70:   selectedCount: number | null;
71:   explanation: string;
72: };
73: 
74: export class SelectionStatisticsError extends Error {
75:   constructor(
76:     message: string,
77:     readonly code: "invalid_input" | "database_error",
78:     options?: ErrorOptions,
79:   ) {
80:     super(message, options);
81:     this.name = "SelectionStatisticsError";
82:   }
83: }
84: 
85: export async function createResearchSourceHash(evidenceText: string) {
86:   const bytes = new TextEncoder().encode(evidenceText.normalize("NFKC").trim());
87:   const digest = await crypto.subtle.digest("SHA-256", bytes);
88:   return [...new Uint8Array(digest)]
89:     .map((value) => value.toString(16).padStart(2, "0"))
90:     .join("");
91: }
92: 
93: export function isOfficialResearchHostname(hostname: string) {
94:   const normalized = hostname.toLowerCase();
95:   return (
96:     normalized.endsWith(".go.jp") ||
97:     normalized.endsWith(".lg.jp") ||
98:     normalized === "go.jp" ||
99:     normalized === "lg.jp" ||
100:     normalized.endsWith(".smrj.go.jp") ||
101:     normalized === "smrj.go.jp" ||
102:     normalized.endsWith(".tokyo-kosha.or.jp") ||
103:     normalized === "tokyo-kosha.or.jp" ||
104:     normalized.endsWith(".jgrants-portal.go.jp") ||
105:     normalized === "jgrants-portal.go.jp"
106:   );
107: }
108: 
109: function normalizedEvidenceText(value: string) {
110:   return value.normalize("NFKC").replace(/\s+/gu, "").trim();
111: }
112: 
113: function decodeBasicHtmlEntities(value: string) {
114:   return value
115:     .replace(/&nbsp;|&#160;/giu, " ")
116:     .replace(/&amp;/giu, "&")
117:     .replace(/&lt;/giu, "<")
118:     .replace(/&gt;/giu, ">")
119:     .replace(/&quot;/giu, '"')
120:     .replace(/&#39;|&apos;/giu, "'")
121:     .replace(/&#(\d+);/gu, (_, codePoint: string) =>
122:       String.fromCodePoint(Number(codePoint)),
123:     )
124:     .replace(/&#x([0-9a-f]+);/giu, (_, codePoint: string) =>
125:       String.fromCodePoint(Number.parseInt(codePoint, 16)),
126:     );
127: }
128: 
129: function extractEvidenceSearchText(body: string, contentType: string) {
130:   if (
131:     !contentType.includes("text/html") &&
132:     !contentType.includes("application/xhtml+xml")
133:   ) {
134:     return body;
135:   }
136:   return decodeBasicHtmlEntities(
137:     body
138:       .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
139:       .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
140:       .replace(/<[^>]+>/gu, " "),
141:   );
142: }
143: 
144: export async function verifyOfficialResearchSource(
145:   sourceUrl: string,
146:   evidenceText: string,
147: ) {
148:   const url = new URL(sourceUrl);
149:   if (url.protocol !== "https:" || !isOfficialResearchHostname(url.hostname)) {
150:     throw new SelectionStatisticsError(
151:       "公的機関の公式ドメインにあるHTTPS資料だけを採択実績の出典として保存できます。",
152:       "invalid_input",
153:     );
154:   }
155:   const controller = new AbortController();
156:   const timeout = setTimeout(() => controller.abort(), 15_000);
157:   try {
158:     const response = await fetch(url, {
159:       headers: { Accept: "text/html,text/plain,application/json" },
160:       redirect: "follow",
161:       signal: controller.signal,
162:     });
163:     if (!response.ok) {
164:       throw new SelectionStatisticsError(
165:         `公式資料を確認できませんでした（HTTP ${response.status}）。`,
166:         "invalid_input",
167:       );
168:     }
169:     const finalUrl = new URL(response.url || url.toString());
170:     if (!isOfficialResearchHostname(finalUrl.hostname)) {
171:       throw new SelectionStatisticsError(
172:         "公式ドメイン外へ転送されたため、採択実績を保存しません。",
173:         "invalid_input",
174:       );
175:     }
176:     const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
177:     if (
178:       !contentType.includes("text/") &&
179:       !contentType.includes("application/json") &&
180:       !contentType.includes("application/xhtml+xml")
181:     ) {
182:       throw new SelectionStatisticsError(
183:         "この資料形式は根拠本文を自動照合できません。現段階では公式HTML、テキスト、JSON資料だけを保存できます。",
184:         "invalid_input",
185:       );
186:     }
187:     const body = await response.text();
188:     if (body.length > 5_000_000) {
189:       throw new SelectionStatisticsError(
190:         "公式資料が大きすぎるため自動照合できません。",
191:         "invalid_input",
192:       );
193:     }
194:     const normalizedBody = normalizedEvidenceText(
195:       extractEvidenceSearchText(body, contentType),
196:     );
197:     const normalizedEvidence = normalizedEvidenceText(evidenceText);
198:     if (!normalizedEvidence || !normalizedBody.includes(normalizedEvidence)) {
199:       throw new SelectionStatisticsError(
200:         "入力された根拠文を公式資料内で確認できないため、採択実績を保存しません。",
201:         "invalid_input",
202:       );
203:     }
204:     return {
205:       contentHash: await createResearchSourceHash(body),
206:       verifiedUrl: finalUrl.toString(),
207:       contentType,
208:     };
209:   } catch (error) {
210:     if (error instanceof SelectionStatisticsError) throw error;
211:     throw new SelectionStatisticsError(
212:       "公式資料への接続に失敗したため、採択実績を保存しません。",
213:       "invalid_input",
214:       { cause: error },
215:     );
216:   } finally {
217:     clearTimeout(timeout);
218:   }
219: }
220: 
221: const OFFICIAL_COUNT_SOURCES = new Set<ResearchSourceType>([
222:   "official_result",
223:   "official_report",
224:   "government_statistics",
225: ]);
226: 
227: function nullableCount(value: number | undefined, field: string): number | null {
228:   if (value === undefined) return null;
229:   if (!Number.isSafeInteger(value) || value < 0) {
230:     throw new SelectionStatisticsError(
231:       `${field}は0以上の整数で指定してください。`,
232:       "invalid_input",
233:     );
234:   }
235:   return value;
236: }
237: 
238: export function calculateOfficialSelectionRate(
239:   counts: SelectionEvidenceInput["counts"],
240:   sourceType: ResearchSourceType,
241: ): OfficialRateCalculation {
242:   const applicationsCount = nullableCount(
243:     counts.applicationsCount,
244:     "applicationsCount",
245:   );
246:   const selectedCount = nullableCount(counts.selectedCount, "selectedCount");
247:   if (selectedCount !== null && applicationsCount !== null && selectedCount > applicationsCount) {
248:     throw new SelectionStatisticsError(
249:       "採択件数が申請件数を上回っているため、公式採択率を計算できません。",
250:       "invalid_input",
251:     );
252:   }
253:   if (!OFFICIAL_COUNT_SOURCES.has(sourceType)) {
254:     return {
255:       status: "insufficient_data",
256:       statusLabel: "公式採択率は不明です",
257:       officialRate: null,
258:       officialRatePercent: null,
259:       applicationsCount,
260:       selectedCount,
261:       explanation:
262:         "実施機関または政府の公式資料ではないため、公式採択率として計算しません。",
263:     };
264:   }
265:   if (applicationsCount === null || applicationsCount === 0 || selectedCount === null) {
266:     return {
267:       status: "insufficient_data",
268:       statusLabel: "公式採択率は不明です",
269:       officialRate: null,
270:       officialRatePercent: null,
271:       applicationsCount,
272:       selectedCount,
273:       explanation:
274:         "同じ公募回の申請件数と採択件数が両方揃っていないため、公式採択率を計算しません。",
275:     };
276:   }
277:   if (counts.comparability !== "confirmed_same_round_and_scope") {
278:     return {
279:       status: "not_comparable",
280:       statusLabel: "公式採択率は算定できません",
281:       officialRate: null,
282:       officialRatePercent: null,
283:       applicationsCount,
284:       selectedCount,
285:       explanation:
286:         "申請件数と採択件数が同じ公募回・同じ対象範囲の数値であることを確認できないため、割り算しません。",
287:     };
288:   }
289:   const officialRate = selectedCount / applicationsCount;
290:   return {
291:     status: "official_rate_available",
292:     statusLabel: "過去の公式採択率を確認できました",
293:     officialRate,
294:     officialRatePercent: Math.round(officialRate * 10_000) / 100,
295:     applicationsCount,
296:     selectedCount,
297:     explanation: `${counts.denominatorLabel ?? "申請件数"}${applicationsCount.toLocaleString("ja-JP")}件に対し、${counts.numeratorLabel ?? "採択件数"}${selectedCount.toLocaleString("ja-JP")}件として計算しました。`,
298:   };
299: }
300: 
301: type IdRow = { id: number };
302: type ExistingStatisticRow = {
303:   applicationsCount: number | null;
304:   selectedCount: number | null;
305:   denominatorLabel: string | null;
306:   numeratorLabel: string | null;
307:   comparability: CountComparability;
308:   officialRate: number | null;
309:   basisSummary: string;
310: };
311: 
312: function isCountSourceRole(role: SelectionEvidenceInput["source"]["role"]) {
313:   return (
314:     role === "applications_count" ||
315:     role === "selected_count" ||
316:     role === "both_counts"
317:   );
318: }
319: 
320: export class D1SelectionStatisticsRepository {
321:   constructor(private readonly database: D1Database) {}
322: 
323:   private async operation<T>(callback: () => Promise<T>): Promise<T> {
324:     try {
325:       return await callback();
326:     } catch (error) {
327:       if (error instanceof SelectionStatisticsError) throw error;
328:       throw new SelectionStatisticsError(
329:         "補助金採択実績データベースの操作に失敗しました。",
330:         "database_error",
331:         { cause: error },
332:       );
333:     }
334:   }
335: 
336:   async saveEvidence(input: SelectionEvidenceInput) {
337:     if (
338:       isCountSourceRole(input.source.role) &&
339:       !OFFICIAL_COUNT_SOURCES.has(input.source.sourceType)
340:     ) {
341:       throw new SelectionStatisticsError(
342:         "申請件数・採択件数の根拠には、公式採択結果・公式報告書・政府統計のいずれかを指定してください。",
343:         "invalid_input",
344:       );
345:     }
346:     return this.operation(async () => {
347:       const program = await this.database
348:         .prepare(`
349:           INSERT INTO subsidy_programs (
350:             program_series_key, canonical_name, institution_name
351:           ) VALUES (?, ?, ?)
352:           ON CONFLICT(program_series_key) DO UPDATE SET
353:             canonical_name = excluded.canonical_name,
354:             institution_name = COALESCE(excluded.institution_name, institution_name),
355:             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
356:           RETURNING id
357:         `)
358:         .bind(
359:           input.program.seriesKey.trim(),
360:           input.program.canonicalName.trim(),
361:           input.program.institutionName?.trim() || null,
362:         )
363:         .first<IdRow>();
364:       if (!program) throw new SelectionStatisticsError("補助金制度を保存できませんでした。", "database_error");
365: 
366:       const round = await this.database
367:         .prepare(`
368:           INSERT INTO subsidy_rounds (
369:             program_id, jgrants_subsidy_id, fiscal_year, round_name, scope_key,
370:             acceptance_start, acceptance_end, budget_yen, official_detail_url,
371:             last_checked_at
372:           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
373:           ON CONFLICT(program_id, fiscal_year, round_name, scope_key) DO UPDATE SET
374:             jgrants_subsidy_id = COALESCE(excluded.jgrants_subsidy_id, jgrants_subsidy_id),
375:             acceptance_start = COALESCE(excluded.acceptance_start, acceptance_start),
376:             acceptance_end = COALESCE(excluded.acceptance_end, acceptance_end),
377:             budget_yen = COALESCE(excluded.budget_yen, budget_yen),
378:             official_detail_url = COALESCE(excluded.official_detail_url, official_detail_url),
379:             last_checked_at = excluded.last_checked_at,
380:             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
381:           RETURNING id
382:         `)
383:         .bind(
384:           program.id,
385:           input.round.jgrantsSubsidyId?.trim() || null,
386:           input.round.fiscalYear,
387:           input.round.roundName.trim(),
388:           input.round.scopeKey?.trim() || "overall",
389:           input.round.acceptanceStart?.trim() || null,
390:           input.round.acceptanceEnd?.trim() || null,
391:           input.round.budgetYen ?? null,
392:           input.round.officialDetailUrl?.trim() || null,
393:           input.round.lastCheckedAt,
394:         )
395:         .first<IdRow>();
396:       if (!round) throw new SelectionStatisticsError("公募回を保存できませんでした。", "database_error");
397: 
398:       const existing = await this.database
399:         .prepare(`
400:           SELECT
401:             applications_count AS applicationsCount,
402:             selected_count AS selectedCount,
403:             denominator_label AS denominatorLabel,
404:             numerator_label AS numeratorLabel,
405:             comparability,
406:             official_rate AS officialRate,
407:             basis_summary AS basisSummary
408:           FROM subsidy_selection_statistics
409:           WHERE subsidy_round_id = ?
410:         `)
411:         .bind(round.id)
412:         .first<ExistingStatisticRow>();
413:       const countEvidence = isCountSourceRole(input.source.role);
414:       const mergedCounts = {
415:         applicationsCount: countEvidence
416:           ? (input.counts.applicationsCount ?? existing?.applicationsCount ?? undefined)
417:           : (existing?.applicationsCount ?? undefined),
418:         selectedCount: countEvidence
419:           ? (input.counts.selectedCount ?? existing?.selectedCount ?? undefined)
420:           : (existing?.selectedCount ?? undefined),
421:         denominatorLabel: countEvidence
422:           ? (input.counts.denominatorLabel ?? existing?.denominatorLabel ?? undefined)
423:           : (existing?.denominatorLabel ?? undefined),
424:         numeratorLabel: countEvidence
425:           ? (input.counts.numeratorLabel ?? existing?.numeratorLabel ?? undefined)
426:           : (existing?.numeratorLabel ?? undefined),
427:         comparability: countEvidence
428:           ? input.counts.comparability
429:           : (existing?.comparability ?? input.counts.comparability),
430:       };
431:       const calculation = countEvidence
432:         ? calculateOfficialSelectionRate(mergedCounts, input.source.sourceType)
433:         : existing
434:           ? {
435:               status: existing.officialRate === null
436:                 ? "insufficient_data" as const
437:                 : "official_rate_available" as const,
438:               statusLabel: existing.officialRate === null
439:                 ? "公式採択率は不明です"
440:                 : "過去の公式採択率を確認できました",
441:               officialRate: existing.officialRate,
442:               officialRatePercent: existing.officialRate === null
443:                 ? null
444:                 : Math.round(existing.officialRate * 10_000) / 100,
445:               applicationsCount: existing.applicationsCount,
446:               selectedCount: existing.selectedCount,
447:               explanation: "件数以外の追加資料として保存し、既存の採択実績は変更していません。",
448:             }
449:           : calculateOfficialSelectionRate(mergedCounts, input.source.sourceType);
450: 
451:       const source = await this.database
452:         .prepare(`
453:           INSERT INTO research_sources (
454:             source_type, publisher, title, url, published_at, retrieved_at,
455:             content_hash, reliability
456:           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
457:           ON CONFLICT(url, content_hash) DO UPDATE SET
458:             publisher = excluded.publisher,
459:             title = excluded.title,
460:             published_at = COALESCE(excluded.published_at, published_at),
461:             retrieved_at = excluded.retrieved_at,
462:             reliability = excluded.reliability
463:           RETURNING id
464:         `)
465:         .bind(
466:           input.source.sourceType,
467:           input.source.publisher.trim(),
468:           input.source.title.trim(),
469:           input.source.url.trim(),
470:           input.source.publishedAt?.trim() || null,
471:           input.source.retrievedAt,
472:           input.source.contentHash.trim(),
473:           input.source.reliability,
474:         )
475:         .first<IdRow>();
476:       if (!source) throw new SelectionStatisticsError("調査出典を保存できませんでした。", "database_error");
477: 
478:       const statistic = await this.database
479:         .prepare(`
480:           INSERT INTO subsidy_selection_statistics (
481:             subsidy_round_id, applications_count, selected_count,
482:             denominator_label, numerator_label, comparability, official_rate,
483:             basis_summary, as_of_date, expires_at
484:           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
485:           ON CONFLICT(subsidy_round_id) DO UPDATE SET
486:             applications_count = excluded.applications_count,
487:             selected_count = excluded.selected_count,
488:             denominator_label = excluded.denominator_label,
489:             numerator_label = excluded.numerator_label,
490:             comparability = excluded.comparability,
491:             official_rate = excluded.official_rate,
492:             basis_summary = excluded.basis_summary,
493:             as_of_date = excluded.as_of_date,
494:             expires_at = excluded.expires_at,
495:             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
496:           RETURNING id
497:         `)
498:         .bind(
499:           round.id,
500:           mergedCounts.applicationsCount ?? null,
501:           mergedCounts.selectedCount ?? null,
502:           mergedCounts.denominatorLabel?.trim() || null,
503:           mergedCounts.numeratorLabel?.trim() || null,
504:           mergedCounts.comparability,
505:           calculation.officialRate,
506:           countEvidence || !existing
507:             ? input.basisSummary.trim()
508:             : existing.basisSummary,
509:           input.asOfDate,
510:           input.expiresAt?.trim() || null,
511:         )
512:         .first<IdRow>();
513:       if (!statistic) throw new SelectionStatisticsError("採択実績を保存できませんでした。", "database_error");
514: 
515:       await this.database
516:         .prepare(`
517:           INSERT OR IGNORE INTO selection_statistic_sources (
518:             statistic_id, source_id, role
519:           ) VALUES (?, ?, ?)
520:         `)
521:         .bind(statistic.id, source.id, input.source.role)
522:         .run();
523: 
524:       return {
525:         status: "stored" as const,
526:         programId: program.id,
527:         roundId: round.id,
528:         statisticId: statistic.id,
529:         sourceId: source.id,
530:         calculation,
531:       };
532:     });
533:   }
534: 
535:   async findByJgrantsSubsidyId(jgrantsSubsidyId: string) {
536:     return this.operation(async () => {
537:       const statistics = await this.database
538:         .prepare(`
539:           SELECT
540:             program.program_series_key AS programSeriesKey,
541:             program.canonical_name AS canonicalName,
542:             program.institution_name AS institutionName,
543:             round.jgrants_subsidy_id AS jgrantsSubsidyId,
544:             round.fiscal_year AS fiscalYear,
545:             round.round_name AS roundName,
546:             round.scope_key AS scopeKey,
547:             round.official_detail_url AS officialDetailUrl,
548:             statistic.applications_count AS applicationsCount,
549:             statistic.selected_count AS selectedCount,
550:             statistic.denominator_label AS denominatorLabel,
551:             statistic.numerator_label AS numeratorLabel,
552:             statistic.comparability,
553:             statistic.official_rate AS officialRate,
554:             statistic.estimated_rate_low AS estimatedRateLow,
555:             statistic.estimated_rate_mid AS estimatedRateMid,
556:             statistic.estimated_rate_high AS estimatedRateHigh,
557:             statistic.confidence,
558:             statistic.basis_summary AS basisSummary,
559:             statistic.estimate_basis_summary AS estimateBasisSummary,
560:             statistic.as_of_date AS asOfDate,
561:             statistic.expires_at AS expiresAt
562:           FROM subsidy_rounds AS round
563:           INNER JOIN subsidy_programs AS program ON program.id = round.program_id
564:           LEFT JOIN subsidy_selection_statistics AS statistic
565:             ON statistic.subsidy_round_id = round.id
566:           WHERE round.jgrants_subsidy_id = ?
567:           ORDER BY statistic.as_of_date DESC
568:         `)
569:         .bind(jgrantsSubsidyId.trim())
570:         .all<Record<string, unknown>>();
571:       const sources = await this.database
572:         .prepare(`
573:           SELECT
574:             statistic.id AS statisticId,
575:             source.source_type AS sourceType,
576:             source.publisher,
577:             source.title,
578:             source.url,
579:             source.published_at AS publishedAt,
580:             source.retrieved_at AS retrievedAt,
581:             source.content_hash AS contentHash,
582:             source.reliability,
583:             link.role
584:           FROM selection_statistic_sources AS link
585:           INNER JOIN subsidy_selection_statistics AS statistic
586:             ON statistic.id = link.statistic_id
587:           INNER JOIN subsidy_rounds AS round
588:             ON round.id = statistic.subsidy_round_id
589:           INNER JOIN research_sources AS source ON source.id = link.source_id
590:           WHERE round.jgrants_subsidy_id = ?
591:           ORDER BY source.published_at DESC, source.id DESC
592:         `)
593:         .bind(jgrantsSubsidyId.trim())
594:         .all<Record<string, unknown>>();
595:       return { statistics: statistics.results, sources: sources.results };
596:     });
597:   }
598: 
599:   async historicalOfficialRates(programSeriesKey: string, limit = 3) {
600:     return this.operation(async () => {
601:       const result = await this.database
602:         .prepare(`
603:           SELECT
604:             round.fiscal_year AS fiscalYear,
605:             round.round_name AS roundName,
606:             statistic.applications_count AS applicationsCount,
607:             statistic.selected_count AS selectedCount,
608:             statistic.official_rate AS officialRate,
609:             statistic.as_of_date AS asOfDate
610:           FROM subsidy_selection_statistics AS statistic
611:           INNER JOIN subsidy_rounds AS round ON round.id = statistic.subsidy_round_id
612:           INNER JOIN subsidy_programs AS program ON program.id = round.program_id
613:           WHERE program.program_series_key = ?
614:             AND statistic.official_rate IS NOT NULL
615:           ORDER BY round.fiscal_year DESC, round.id DESC
616:           LIMIT ?
617:         `)
618:         .bind(programSeriesKey.trim(), Math.max(1, Math.min(10, limit)))
619:         .all<HistoricalSelectionRate>();
620:       return result.results;
621:     });
622:   }
623: 
624:   async saveEstimateForJgrantsId(
625:     jgrantsSubsidyId: string,
626:     outlook: ReturnType<typeof estimateSelectionOutlook>,
627:     asOfDate: string,
628:   ) {
629:     if (outlook.status !== "estimated") {
630:       return { status: "not_saved" as const, reason: "estimate_withheld" as const };
631:     }
632:     return this.operation(async () => {
633:       const estimateBasisSummary = [outlook.reason, ...outlook.adjustments].join(" ");
634:       const row = await this.database
635:         .prepare(`
636:           INSERT INTO subsidy_selection_statistics (
637:             subsidy_round_id, comparability, estimated_rate_low,
638:             estimated_rate_mid, estimated_rate_high, estimation_method,
639:             methodology_version, confidence, basis_summary,
640:             estimate_basis_summary, as_of_date
641:           )
642:           SELECT
643:             round.id, 'not_confirmed', ?, ?, ?, ?, ?, ?,
644:             '公式採択率の算定に必要な件数は未登録です。', ?, ?
645:           FROM subsidy_rounds AS round
646:           WHERE round.jgrants_subsidy_id = ?
647:           ON CONFLICT(subsidy_round_id) DO UPDATE SET
648:             estimated_rate_low = excluded.estimated_rate_low,
649:             estimated_rate_mid = excluded.estimated_rate_mid,
650:             estimated_rate_high = excluded.estimated_rate_high,
651:             estimation_method = excluded.estimation_method,
652:             methodology_version = excluded.methodology_version,
653:             confidence = excluded.confidence,
654:             estimate_basis_summary = excluded.estimate_basis_summary,
655:             as_of_date = excluded.as_of_date,
656:             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
657:           RETURNING id
658:         `)
659:         .bind(
660:           outlook.estimatedRateLow,
661:           outlook.estimatedRateMid,
662:           outlook.estimatedRateHigh,
663:           "historical_weighted_rate_with_public_adjustments",
664:           outlook.methodologyVersion,
665:           outlook.confidence,
666:           estimateBasisSummary,
667:           asOfDate,
668:           jgrantsSubsidyId.trim(),
669:         )
670:         .first<IdRow>();
671:       return row
672:         ? { status: "stored" as const, statisticId: row.id }
673:         : {
674:             status: "not_saved" as const,
675:             reason: "target_round_not_found" as const,
676:           };
677:     });
678:   }
679: }
680: 
681: export type HistoricalSelectionRate = {
682:   fiscalYear: number;
683:   roundName: string;
684:   applicationsCount: number;
685:   selectedCount: number;
686:   officialRate: number;
687:   asOfDate: string;
688: };
689: 
690: export type SelectionOutlookInput = {
691:   eligibilityStatus:
692:     | "eligible"
693:     | "conditional"
694:     | "needs_confirmation"
695:     | "likely_ineligible";
696:   historicalRates: HistoricalSelectionRate[];
697:   budgetChangePercent?: number;
698:   maximumGrantChangePercent?: number;
699:   targetScopeChange?: "expanded" | "unchanged" | "narrowed" | "unknown";
700:   programContinuity?: "continuing" | "new" | "unknown";
701: };
702: 
703: function clampRate(value: number) {
704:   return Math.max(0, Math.min(1, value));
705: }
706: 
707: function roundRate(value: number) {
708:   return Math.round(clampRate(value) * 10_000) / 10_000;
709: }
710: 
711: export function estimateSelectionOutlook(input: SelectionOutlookInput) {
712:   if (input.eligibilityStatus !== "eligible") {
713:     return {
714:       status: "withheld" as const,
715:       statusLabel: "今回の採択見通しは判定保留です",
716:       reason:
717:         input.eligibilityStatus === "likely_ineligible"
718:           ? "申請資格について対象外となる可能性が高いため、採択見通しを計算しません。"
719:           : "申請資格が確定していないため、採択見通しを計算しません。",
720:       estimatedRateLow: null,
721:       estimatedRateMid: null,
722:       estimatedRateHigh: null,
723:       confidence: null,
724:       methodologyVersion: "rule_based_v1",
725:     };
726:   }
727:   const history = input.historicalRates
728:     .filter((item) => item.applicationsCount > 0 && item.selectedCount >= 0)
729:     .slice(0, 3);
730:   if (!history.length) {
731:     return {
732:       status: "withheld" as const,
733:       statusLabel: "今回の採択見通しは不明です",
734:       reason: "比較可能な過去の公式採択実績がないため、推定しません。",
735:       estimatedRateLow: null,
736:       estimatedRateMid: null,
737:       estimatedRateHigh: null,
738:       confidence: null,
739:       methodologyVersion: "rule_based_v1",
740:     };
741:   }
742:   const applications = history.reduce((sum, item) => sum + item.applicationsCount, 0);
743:   const selected = history.reduce((sum, item) => sum + item.selectedCount, 0);
744:   const baseRate = selected / applications;
745:   let multiplier = 1;
746:   const adjustments: string[] = [];
747:   if (input.budgetChangePercent !== undefined) {
748:     const factor = Math.sqrt(Math.max(0.25, 1 + input.budgetChangePercent / 100));
749:     multiplier *= Math.max(0.8, Math.min(1.2, factor));
750:     adjustments.push(`予算変化${input.budgetChangePercent}%を限定的に反映`);
751:   }
752:   if (input.maximumGrantChangePercent !== undefined) {
753:     const factor = 1 / Math.sqrt(Math.max(0.25, 1 + input.maximumGrantChangePercent / 100));
754:     multiplier *= Math.max(0.85, Math.min(1.15, factor));
755:     adjustments.push(`補助上限変化${input.maximumGrantChangePercent}%を限定的に反映`);
756:   }
757:   if (input.targetScopeChange === "expanded") {
758:     multiplier *= 0.9;
759:     adjustments.push("対象範囲拡大による応募増加可能性を反映");
760:   } else if (input.targetScopeChange === "narrowed") {
761:     multiplier *= 1.1;
762:     adjustments.push("対象範囲縮小による応募減少可能性を反映");
763:   }
764:   const mid = clampRate(baseRate * multiplier);
765:   const confidence =
766:     history.length >= 3 && applications >= 500 && input.programContinuity === "continuing"
767:       ? "high"
768:       : history.length >= 2 && input.programContinuity !== "new"
769:         ? "medium"
770:         : "low";
771:   const margin = confidence === "high" ? 0.05 : confidence === "medium" ? 0.1 : 0.15;
772:   return {
773:     status: "estimated" as const,
774:     statusLabel: "制度全体の採択見通しを参考範囲として算定しました",
775:     reason:
776:       "過去の公式実績の加重平均を基準に、公開された制度変更だけをルールで補正しました。個別企業の採択確率ではありません。",
777:     historicalWeightedRate: roundRate(baseRate),
778:     estimatedRateLow: roundRate(mid - margin),
779:     estimatedRateMid: roundRate(mid),
780:     estimatedRateHigh: roundRate(mid + margin),
781:     confidence,
782:     methodologyVersion: "rule_based_v1",
783:     historyUsed: history,
784:     adjustments,
785:   };
786: }
787: 
788: export function createD1SelectionStatisticsRepository(database: D1Database | undefined) {
789:   return database ? new D1SelectionStatisticsRepository(database) : null;
790: }
791: 
792: export async function recordSelectionEvidence(
793:   input: SelectionEvidenceInput,
794:   repository: D1SelectionStatisticsRepository | null,
795: ) {
796:   const inputCalculation = calculateOfficialSelectionRate(
797:     input.counts,
798:     input.source.sourceType,
799:   );
800:   const persistence = repository
801:     ? await repository.saveEvidence(input)
802:     : ({ status: "not_configured" } as const);
803:   const calculation =
804:     persistence.status === "stored"
805:       ? persistence.calculation
806:       : inputCalculation;
807:   return {
808:     calculation,
809:     source: input.source,
810:     round: input.round,
811:     persistence,
812:     displayGuidance:
813:       "利用者向けには『過去の公式採択率』と表示し、個別企業の採択確率とは説明しないでください。内部IDや保存状態は求められない限り表示しません。",
814:   };
815: }