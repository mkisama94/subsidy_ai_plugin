1: export type CompanyInput = {
2:   corporateNumber?: string | null;
3:   edinetCode?: string | null;
4:   securitiesCode?: string | null;
5:   name: string;
6:   normalizedName?: string;
7:   sourceUpdatedAt?: string | null;
8: };
9: 
10: export type CompanyRecord = {
11:   id: number;
12:   corporateNumber: string | null;
13:   edinetCode: string | null;
14:   securitiesCode: string | null;
15:   name: string;
16:   normalizedName: string;
17:   sourceUpdatedAt: string | null;
18:   createdAt: string;
19:   updatedAt: string;
20: };
21: 
22: export type EdinetDocumentFetchStatus =
23:   | "discovered"
24:   | "fetched"
25:   | "parsed"
26:   | "failed";
27: 
28: export type EdinetDocumentInput = {
29:   documentId: string;
30:   filerCompanyId?: number | null;
31:   filerName: string;
32:   filerCorporateNumber?: string | null;
33:   filerEdinetCode?: string | null;
34:   documentTypeCode?: string | null;
35:   documentType?: string | null;
36:   submittedAt: string;
37:   periodStart?: string | null;
38:   periodEnd?: string | null;
39:   sourceReference: string;
40:   fetchStatus?: EdinetDocumentFetchStatus;
41:   fetchedAt?: string | null;
42:   parsedAt?: string | null;
43:   errorMessage?: string | null;
44: };
45: 
46: export type EdinetDocumentRecord = {
47:   documentId: string;
48:   filerCompanyId: number | null;
49:   filerName: string;
50:   filerCorporateNumber: string | null;
51:   filerEdinetCode: string | null;
52:   documentTypeCode: string | null;
53:   documentType: string | null;
54:   submittedAt: string;
55:   periodStart: string | null;
56:   periodEnd: string | null;
57:   sourceReference: string;
58:   fetchStatus: EdinetDocumentFetchStatus;
59:   fetchedAt: string | null;
60:   parsedAt: string | null;
61:   errorMessage: string | null;
62:   createdAt: string;
63:   updatedAt: string;
64: };
65: 
66: export type CompanyRelationType =
67:   | "parent"
68:   | "subsidiary"
69:   | "affiliate"
70:   | "other";
71: 
72: export type RelationExtractionMethod = "xbrl" | "document_text" | "manual";
73: export type RelationVerificationStatus =
74:   | "unverified"
75:   | "verified"
76:   | "rejected";
77: 
78: export type CompanyRelationInput = {
79:   parentCompanyId?: number | null;
80:   childCompanyId?: number | null;
81:   parentName: string;
82:   parentNormalizedName?: string;
83:   childName: string;
84:   childNormalizedName?: string;
85:   relationType?: CompanyRelationType;
86:   ownershipPercent?: number | null;
87:   indirectOwnershipPercent?: number | null;
88:   isConsolidated?: boolean | null;
89:   asOfDate?: string | null;
90:   sourceDocumentId: string;
91:   sourceSection?: string;
92:   sourceLocator?: string | null;
93:   extractionMethod?: RelationExtractionMethod;
94:   verificationStatus?: RelationVerificationStatus;
95: };
96: 
97: export type CompanyRelationRecord = {
98:   id: number;
99:   parentCompanyId: number | null;
100:   childCompanyId: number | null;
101:   parentName: string;
102:   parentNormalizedName: string;
103:   childName: string;
104:   childNormalizedName: string;
105:   relationType: CompanyRelationType;
106:   ownershipPercent: number | null;
107:   indirectOwnershipPercent: number | null;
108:   isConsolidated: boolean | null;
109:   asOfDate: string | null;
110:   sourceDocumentId: string;
111:   sourceSection: string;
112:   sourceLocator: string | null;
113:   extractionMethod: RelationExtractionMethod;
114:   verificationStatus: RelationVerificationStatus;
115:   createdAt: string;
116:   updatedAt: string;
117: };
118: 
119: export type CompanyRelationEvidence = CompanyRelationRecord & {
120:   parentCorporateNumber: string | null;
121:   parentEdinetCode: string | null;
122:   childCorporateNumber: string | null;
123:   childEdinetCode: string | null;
124:   document: {
125:     filerName: string;
126:     documentType: string | null;
127:     submittedAt: string;
128:     periodStart: string | null;
129:     periodEnd: string | null;
130:     sourceReference: string;
131:   };
132: };
133: 
134: type CompanyRow = {
135:   id: number;
136:   corporate_number: string | null;
137:   edinet_code: string | null;
138:   securities_code: string | null;
139:   name: string;
140:   normalized_name: string;
141:   source_updated_at: string | null;
142:   created_at: string;
143:   updated_at: string;
144: };
145: 
146: type EdinetDocumentRow = {
147:   doc_id: string;
148:   filer_company_id: number | null;
149:   filer_name: string;
150:   filer_corporate_number: string | null;
151:   filer_edinet_code: string | null;
152:   doc_type_code: string | null;
153:   document_type: string | null;
154:   submitted_at: string;
155:   period_start: string | null;
156:   period_end: string | null;
157:   source_reference: string;
158:   fetch_status: EdinetDocumentFetchStatus;
159:   fetched_at: string | null;
160:   parsed_at: string | null;
161:   error_message: string | null;
162:   created_at: string;
163:   updated_at: string;
164: };
165: 
166: type CompanyRelationRow = {
167:   id: number;
168:   parent_company_id: number | null;
169:   child_company_id: number | null;
170:   parent_name: string;
171:   parent_normalized_name: string;
172:   child_name: string;
173:   child_normalized_name: string;
174:   relation_type: CompanyRelationType;
175:   ownership_percent: number | null;
176:   indirect_ownership_percent: number | null;
177:   is_consolidated: number | null;
178:   as_of_date: string | null;
179:   source_doc_id: string;
180:   source_section: string;
181:   source_locator: string | null;
182:   extraction_method: RelationExtractionMethod;
183:   verification_status: RelationVerificationStatus;
184:   created_at: string;
185:   updated_at: string;
186: };
187: 
188: type CompanyRelationEvidenceRow = CompanyRelationRow & {
189:   parent_corporate_number: string | null;
190:   parent_edinet_code: string | null;
191:   child_corporate_number: string | null;
192:   child_edinet_code: string | null;
193:   document_filer_name: string;
194:   document_type: string | null;
195:   document_submitted_at: string;
196:   document_period_start: string | null;
197:   document_period_end: string | null;
198:   document_source_reference: string;
199: };
200: 
201: export class D1RelationsRepositoryError extends Error {
202:   constructor(
203:     message: string,
204:     readonly code: "invalid_input" | "database_error",
205:     options?: ErrorOptions,
206:   ) {
207:     super(message, options);
208:     this.name = "D1RelationsRepositoryError";
209:   }
210: }
211: 
212: export function normalizeCompanyNameForRelations(value: string): string {
213:   return value
214:     .normalize("NFKC")
215:     .toLowerCase()
216:     .replace(/[\s　・･.,，、'"“”‘’()（）\-‐‑–—―]/gu, "")
217:     .replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/u, "")
218:     .replace(/(株式会社|有限会社|合同会社|合資会社|合名会社)$/u, "");
219: }
220: 
221: function requiredText(value: string, field: string): string {
222:   const normalized = value.trim();
223:   if (!normalized) {
224:     throw new D1RelationsRepositoryError(
225:       `${field}は必須です。`,
226:       "invalid_input",
227:     );
228:   }
229:   return normalized;
230: }
231: 
232: function optionalText(value: string | null | undefined): string | null {
233:   const normalized = value?.trim();
234:   return normalized ? normalized : null;
235: }
236: 
237: function corporateNumber(value: string | null | undefined): string | null {
238:   const normalized = optionalText(value);
239:   if (normalized !== null && !/^\d{13}$/u.test(normalized)) {
240:     throw new D1RelationsRepositoryError(
241:       "法人番号は13桁の数字で指定してください。",
242:       "invalid_input",
243:     );
244:   }
245:   return normalized;
246: }
247: 
248: function optionalId(value: number | null | undefined, field: string): number | null {
249:   if (value === null || value === undefined) return null;
250:   if (!Number.isInteger(value) || value <= 0) {
251:     throw new D1RelationsRepositoryError(
252:       `${field}は正の整数で指定してください。`,
253:       "invalid_input",
254:     );
255:   }
256:   return value;
257: }
258: 
259: function optionalPercentage(
260:   value: number | null | undefined,
261:   field: string,
262: ): number | null {
263:   if (value === null || value === undefined) return null;
264:   if (!Number.isFinite(value) || value < 0 || value > 100) {
265:     throw new D1RelationsRepositoryError(
266:       `${field}は0以上100以下で指定してください。`,
267:       "invalid_input",
268:     );
269:   }
270:   return value;
271: }
272: 
273: function normalizeLimit(value: number): number {
274:   if (!Number.isInteger(value) || value < 1 || value > 100) {
275:     throw new D1RelationsRepositoryError(
276:       "limitは1以上100以下の整数で指定してください。",
277:       "invalid_input",
278:     );
279:   }
280:   return value;
281: }
282: 
283: function mapCompany(row: CompanyRow): CompanyRecord {
284:   return {
285:     id: row.id,
286:     corporateNumber: row.corporate_number,
287:     edinetCode: row.edinet_code,
288:     securitiesCode: row.securities_code,
289:     name: row.name,
290:     normalizedName: row.normalized_name,
291:     sourceUpdatedAt: row.source_updated_at,
292:     createdAt: row.created_at,
293:     updatedAt: row.updated_at,
294:   };
295: }
296: 
297: function mapDocument(row: EdinetDocumentRow): EdinetDocumentRecord {
298:   return {
299:     documentId: row.doc_id,
300:     filerCompanyId: row.filer_company_id,
301:     filerName: row.filer_name,
302:     filerCorporateNumber: row.filer_corporate_number,
303:     filerEdinetCode: row.filer_edinet_code,
304:     documentTypeCode: row.doc_type_code,
305:     documentType: row.document_type,
306:     submittedAt: row.submitted_at,
307:     periodStart: row.period_start,
308:     periodEnd: row.period_end,
309:     sourceReference: row.source_reference,
310:     fetchStatus: row.fetch_status,
311:     fetchedAt: row.fetched_at,
312:     parsedAt: row.parsed_at,
313:     errorMessage: row.error_message,
314:     createdAt: row.created_at,
315:     updatedAt: row.updated_at,
316:   };
317: }
318: 
319: function mapRelation(row: CompanyRelationRow): CompanyRelationRecord {
320:   return {
321:     id: row.id,
322:     parentCompanyId: row.parent_company_id,
323:     childCompanyId: row.child_company_id,
324:     parentName: row.parent_name,
325:     parentNormalizedName: row.parent_normalized_name,
326:     childName: row.child_name,
327:     childNormalizedName: row.child_normalized_name,
328:     relationType: row.relation_type,
329:     ownershipPercent: row.ownership_percent,
330:     indirectOwnershipPercent: row.indirect_ownership_percent,
331:     isConsolidated:
332:       row.is_consolidated === null ? null : row.is_consolidated === 1,
333:     asOfDate: row.as_of_date,
334:     sourceDocumentId: row.source_doc_id,
335:     sourceSection: row.source_section,
336:     sourceLocator: row.source_locator,
337:     extractionMethod: row.extraction_method,
338:     verificationStatus: row.verification_status,
339:     createdAt: row.created_at,
340:     updatedAt: row.updated_at,
341:   };
342: }
343: 
344: function mapEvidence(row: CompanyRelationEvidenceRow): CompanyRelationEvidence {
345:   return {
346:     ...mapRelation(row),
347:     parentCorporateNumber: row.parent_corporate_number,
348:     parentEdinetCode: row.parent_edinet_code,
349:     childCorporateNumber: row.child_corporate_number,
350:     childEdinetCode: row.child_edinet_code,
351:     document: {
352:       filerName: row.document_filer_name,
353:       documentType: row.document_type,
354:       submittedAt: row.document_submitted_at,
355:       periodStart: row.document_period_start,
356:       periodEnd: row.document_period_end,
357:       sourceReference: row.document_source_reference,
358:     },
359:   };
360: }
361: 
362: const COMPANY_COLUMNS = `
363:   id, corporate_number, edinet_code, securities_code, name,
364:   normalized_name, source_updated_at, created_at, updated_at
365: `;
366: 
367: const DOCUMENT_COLUMNS = `
368:   doc_id, filer_company_id, filer_name, filer_corporate_number,
369:   filer_edinet_code, doc_type_code, document_type, submitted_at,
370:   period_start, period_end, source_reference, fetch_status, fetched_at,
371:   parsed_at, error_message, created_at, updated_at
372: `;
373: 
374: const RELATION_COLUMNS = `
375:   id, parent_company_id, child_company_id, parent_name,
376:   parent_normalized_name, child_name, child_normalized_name, relation_type,
377:   ownership_percent, indirect_ownership_percent, is_consolidated, as_of_date,
378:   source_doc_id, source_section, source_locator, extraction_method,
379:   verification_status, created_at, updated_at
380: `;
381: 
382: const EVIDENCE_SELECT = `
383:   SELECT
384:     relation.*,
385:     parent.corporate_number AS parent_corporate_number,
386:     parent.edinet_code AS parent_edinet_code,
387:     child.corporate_number AS child_corporate_number,
388:     child.edinet_code AS child_edinet_code,
389:     document.filer_name AS document_filer_name,
390:     document.document_type AS document_type,
391:     document.submitted_at AS document_submitted_at,
392:     document.period_start AS document_period_start,
393:     document.period_end AS document_period_end,
394:     document.source_reference AS document_source_reference
395:   FROM company_relations AS relation
396:   LEFT JOIN companies AS parent ON parent.id = relation.parent_company_id
397:   LEFT JOIN companies AS child ON child.id = relation.child_company_id
398:   INNER JOIN edinet_documents AS document
399:     ON document.doc_id = relation.source_doc_id
400: `;
401: 
402: export class D1CompanyRelationsRepository {
403:   constructor(private readonly database: D1Database) {}
404: 
405:   private async databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
406:     try {
407:       return await operation();
408:     } catch (error) {
409:       if (error instanceof D1RelationsRepositoryError) throw error;
410:       throw new D1RelationsRepositoryError(
411:         "企業関係データベースの操作に失敗しました。",
412:         "database_error",
413:         { cause: error },
414:       );
415:     }
416:   }
417: 
418:   async upsertCompany(input: CompanyInput): Promise<CompanyRecord> {
419:     const companyName = requiredText(input.name, "name");
420:     const companyCorporateNumber = corporateNumber(input.corporateNumber);
421:     const companyEdinetCode = optionalText(input.edinetCode);
422:     if (companyCorporateNumber === null && companyEdinetCode === null) {
423:       throw new D1RelationsRepositoryError(
424:         "corporateNumberまたはedinetCodeのどちらかが必要です。",
425:         "invalid_input",
426:       );
427:     }
428:     const normalizedName = requiredText(
429:       input.normalizedName ?? normalizeCompanyNameForRelations(companyName),
430:       "normalizedName",
431:     );
432: 
433:     return this.databaseOperation(async () => {
434:       const row = await this.database
435:         .prepare(`
436:           INSERT INTO companies (
437:             corporate_number, edinet_code, securities_code, name,
438:             normalized_name, source_updated_at
439:           ) VALUES (?, ?, ?, ?, ?, ?)
440:           ON CONFLICT DO UPDATE SET
441:             corporate_number = COALESCE(excluded.corporate_number, corporate_number),
442:             edinet_code = COALESCE(excluded.edinet_code, edinet_code),
443:             securities_code = COALESCE(excluded.securities_code, securities_code),
444:             name = excluded.name,
445:             normalized_name = excluded.normalized_name,
446:             source_updated_at = COALESCE(excluded.source_updated_at, source_updated_at),
447:             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
448:           RETURNING ${COMPANY_COLUMNS}
449:         `)
450:         .bind(
451:           companyCorporateNumber,
452:           companyEdinetCode,
453:           optionalText(input.securitiesCode),
454:           companyName,
455:           normalizedName,
456:           optionalText(input.sourceUpdatedAt),
457:         )
458:         .first<CompanyRow>();
459:       if (!row) {
460:         throw new D1RelationsRepositoryError(
461:           "企業情報を保存できませんでした。",
462:           "database_error",
463:         );
464:       }
465:       return mapCompany(row);
466:     });
467:   }
468: 
469:   async upsertEdinetDocument(
470:     input: EdinetDocumentInput,
471:   ): Promise<EdinetDocumentRecord> {
472:     const documentId = requiredText(input.documentId, "documentId");
473:     const filerName = requiredText(input.filerName, "filerName");
474:     const submittedAt = requiredText(input.submittedAt, "submittedAt");
475:     const sourceReference = requiredText(
476:       input.sourceReference,
477:       "sourceReference",
478:     );
479: 
480:     return this.databaseOperation(async () => {
481:       const row = await this.database
482:         .prepare(`
483:           INSERT INTO edinet_documents (
484:             doc_id, filer_company_id, filer_name, filer_corporate_number,
485:             filer_edinet_code, doc_type_code, document_type, submitted_at,
486:             period_start, period_end, source_reference, fetch_status,
487:             fetched_at, parsed_at, error_message
488:           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
489:           ON CONFLICT(doc_id) DO UPDATE SET
490:             filer_company_id = COALESCE(excluded.filer_company_id, filer_company_id),
491:             filer_name = excluded.filer_name,
492:             filer_corporate_number = COALESCE(
493:               excluded.filer_corporate_number,
494:               filer_corporate_number
495:             ),
496:             filer_edinet_code = COALESCE(excluded.filer_edinet_code, filer_edinet_code),
497:             doc_type_code = COALESCE(excluded.doc_type_code, doc_type_code),
498:             document_type = COALESCE(excluded.document_type, document_type),
499:             submitted_at = excluded.submitted_at,
500:             period_start = COALESCE(excluded.period_start, period_start),
501:             period_end = COALESCE(excluded.period_end, period_end),
502:             source_reference = excluded.source_reference,
503:             fetch_status = excluded.fetch_status,
504:             fetched_at = COALESCE(excluded.fetched_at, fetched_at),
505:             parsed_at = COALESCE(excluded.parsed_at, parsed_at),
506:             error_message = excluded.error_message,
507:             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
508:           RETURNING ${DOCUMENT_COLUMNS}
509:         `)
510:         .bind(
511:           documentId,
512:           optionalId(input.filerCompanyId, "filerCompanyId"),
513:           filerName,
514:           corporateNumber(input.filerCorporateNumber),
515:           optionalText(input.filerEdinetCode),
516:           optionalText(input.documentTypeCode),
517:           optionalText(input.documentType),
518:           submittedAt,
519:           optionalText(input.periodStart),
520:           optionalText(input.periodEnd),
521:           sourceReference,
522:           input.fetchStatus ?? "discovered",
523:           optionalText(input.fetchedAt),
524:           optionalText(input.parsedAt),
525:           optionalText(input.errorMessage),
526:         )
527:         .first<EdinetDocumentRow>();
528:       if (!row) {
529:         throw new D1RelationsRepositoryError(
530:           "EDINET文書を保存できませんでした。",
531:           "database_error",
532:         );
533:       }
534:       return mapDocument(row);
535:     });
536:   }
537: 
538:   async upsertCompanyRelation(
539:     input: CompanyRelationInput,
540:   ): Promise<CompanyRelationRecord> {
541:     const parentName = requiredText(input.parentName, "parentName");
542:     const childName = requiredText(input.childName, "childName");
543:     const parentNormalizedName = requiredText(
544:       input.parentNormalizedName ?? normalizeCompanyNameForRelations(parentName),
545:       "parentNormalizedName",
546:     );
547:     const childNormalizedName = requiredText(
548:       input.childNormalizedName ?? normalizeCompanyNameForRelations(childName),
549:       "childNormalizedName",
550:     );
551: 
552:     return this.databaseOperation(async () => {
553:       const row = await this.database
554:         .prepare(`
555:           INSERT INTO company_relations (
556:             parent_company_id, child_company_id, parent_name,
557:             parent_normalized_name, child_name, child_normalized_name,
558:             relation_type, ownership_percent, indirect_ownership_percent,
559:             is_consolidated, as_of_date, source_doc_id, source_section,
560:             source_locator, extraction_method, verification_status
561:           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
562:           ON CONFLICT(
563:             source_doc_id,
564:             parent_normalized_name,
565:             child_normalized_name,
566:             relation_type
567:           ) DO UPDATE SET
568:             parent_company_id = COALESCE(
569:               excluded.parent_company_id,
570:               parent_company_id
571:             ),
572:             child_company_id = COALESCE(excluded.child_company_id, child_company_id),
573:             parent_name = excluded.parent_name,
574:             child_name = excluded.child_name,
575:             ownership_percent = excluded.ownership_percent,
576:             indirect_ownership_percent = excluded.indirect_ownership_percent,
577:             is_consolidated = excluded.is_consolidated,
578:             as_of_date = COALESCE(excluded.as_of_date, as_of_date),
579:             source_section = excluded.source_section,
580:             source_locator = COALESCE(excluded.source_locator, source_locator),
581:             extraction_method = excluded.extraction_method,
582:             verification_status = excluded.verification_status,
583:             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
584:           RETURNING ${RELATION_COLUMNS}
585:         `)
586:         .bind(
587:           optionalId(input.parentCompanyId, "parentCompanyId"),
588:           optionalId(input.childCompanyId, "childCompanyId"),
589:           parentName,
590:           parentNormalizedName,
591:           childName,
592:           childNormalizedName,
593:           input.relationType ?? "subsidiary",
594:           optionalPercentage(input.ownershipPercent, "ownershipPercent"),
595:           optionalPercentage(
596:             input.indirectOwnershipPercent,
597:             "indirectOwnershipPercent",
598:           ),
599:           input.isConsolidated === null || input.isConsolidated === undefined
600:             ? null
601:             : input.isConsolidated
602:               ? 1
603:               : 0,
604:           optionalText(input.asOfDate),
605:           requiredText(input.sourceDocumentId, "sourceDocumentId"),
606:           requiredText(input.sourceSection ?? "関係会社の状況", "sourceSection"),
607:           optionalText(input.sourceLocator),
608:           input.extractionMethod ?? "xbrl",
609:           input.verificationStatus ?? "unverified",
610:         )
611:         .first<CompanyRelationRow>();
612:       if (!row) {
613:         throw new D1RelationsRepositoryError(
614:           "企業関係を保存できませんでした。",
615:           "database_error",
616:         );
617:       }
618:       return mapRelation(row);
619:     });
620:   }
621: 
622:   async findParentRelationsByCorporateNumber(
623:     childCorporateNumber: string,
624:     options: { includeUnverified?: boolean; limit?: number } = {},
625:   ): Promise<CompanyRelationEvidence[]> {
626:     const number = corporateNumber(childCorporateNumber);
627:     if (number === null) {
628:       throw new D1RelationsRepositoryError(
629:         "子会社の法人番号が必要です。",
630:         "invalid_input",
631:       );
632:     }
633:     const limit = normalizeLimit(options.limit ?? 20);
634:     return this.databaseOperation(async () => {
635:       const result = await this.database
636:         .prepare(`
637:           ${EVIDENCE_SELECT}
638:           WHERE child.corporate_number = ?
639:             AND relation.verification_status != 'rejected'
640:             AND (? = 1 OR relation.verification_status = 'verified')
641:           ORDER BY
642:             CASE relation.verification_status WHEN 'verified' THEN 0 ELSE 1 END,
643:             COALESCE(
644:               relation.as_of_date,
645:               document.period_end,
646:               substr(document.submitted_at, 1, 10)
647:             ) DESC,
648:             document.submitted_at DESC
649:           LIMIT ?
650:         `)
651:         .bind(number, options.includeUnverified ? 1 : 0, limit)
652:         .all<CompanyRelationEvidenceRow>();
653:       return result.results.map(mapEvidence);
654:     });
655:   }
656: 
657:   async findSubsidiariesByCorporateNumber(
658:     parentCorporateNumber: string,
659:     options: { includeUnverified?: boolean; limit?: number } = {},
660:   ): Promise<CompanyRelationEvidence[]> {
661:     const number = corporateNumber(parentCorporateNumber);
662:     if (number === null) {
663:       throw new D1RelationsRepositoryError(
664:         "親会社の法人番号が必要です。",
665:         "invalid_input",
666:       );
667:     }
668:     const limit = normalizeLimit(options.limit ?? 50);
669:     return this.databaseOperation(async () => {
670:       const result = await this.database
671:         .prepare(`
672:           ${EVIDENCE_SELECT}
673:           WHERE parent.corporate_number = ?
674:             AND relation.verification_status != 'rejected'
675:             AND (? = 1 OR relation.verification_status = 'verified')
676:           ORDER BY
677:             CASE relation.verification_status WHEN 'verified' THEN 0 ELSE 1 END,
678:             relation.child_normalized_name ASC,
679:             COALESCE(
680:               relation.as_of_date,
681:               document.period_end,
682:               substr(document.submitted_at, 1, 10)
683:             ) DESC
684:           LIMIT ?
685:         `)
686:         .bind(number, options.includeUnverified ? 1 : 0, limit)
687:         .all<CompanyRelationEvidenceRow>();
688:       return result.results.map(mapEvidence);
689:     });
690:   }
691: }
692: 
693: export function createD1CompanyRelationsRepository(
694:   database: D1Database | undefined,
695: ): D1CompanyRelationsRepository | null {
696:   return database ? new D1CompanyRelationsRepository(database) : null;
697: }