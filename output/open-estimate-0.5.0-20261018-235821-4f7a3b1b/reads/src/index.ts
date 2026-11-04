1: import { McpServer } from "@modelcontextprotocol/server";
2: import { registerComparison } from "./comparison/register";
3: import { registerDiscovery } from "./subsidyDiscovery/register";
4: import { DISCOVERY_GUIDANCE } from "./subsidyDiscovery/service";
5: import { collectDueMhlwSources } from "./officialSources/mhlw/collect";
6: import type { CatalogEnv } from "./officialSubsidyCatalog/types";
7: import { NtaApiError, getCorporateIdentity, searchCorporateIdentities } from "./nta";
8: import { createMcpHandler } from "agents/mcp/server";
9: import { z } from "zod";
10: import { DocumentError, enabled, inputSchema as documentInputSchema, type DocumentEnv } from "./officialDocuments/types";
11: import { getSubsidyDocuments } from "./officialDocuments/service";
12: import { collectDueSources } from "./officialDocuments/collect";
13: import { D1PublicApiCache } from "./cache";
14: import { getSubsidyDetail, JGrantsApiError, searchSubsidies } from "./jgrants";
15: import { evaluateSubsidyFit } from "./matching";
16: import {
17:   GBizInfoApiError,
18:   getCompanyProfile,
19:   searchCompanies,
20: } from "./gbizinfo";
21: import { evaluateSubsidyFitForCompany } from "./companyMatching";
22: import {
23:   GBIZINFO_ACTIVITY_TYPES,
24:   getCompanyActivities,
25: } from "./gbizinfoActivities";
26: import { EdinetApiError } from "./edinet";
27: import { createD1CompanyRelationsRepository } from "./d1Relations";
28: import { verifyAndStoreCorporateRelationship } from "./edinetRelationsService";
29: import { assessDeemedLargeEnterpriseEligibility } from "./deemedLargeEnterprise";
30: import {
31:   createD1SelectionStatisticsRepository,
32:   estimateSelectionOutlook,
33:   recordSelectionEvidence,
34:   SelectionStatisticsError,
35:   verifyOfficialResearchSource,
36: } from "./selectionStatistics";
37: import {
38:   createProfessionalConsultationBrief,
39:   type ConsultationTopic,
40: } from "./professionalConsultation";
41: 
42: const SERVER_NAME = "subsidy-ai-mcp";
43: const SERVER_VERSION = "0.13.0";
44: const DOMAIN_VERIFICATION_PATH = "/.well-known/openai-apps-challenge";
45: 
46: // OpenAI's public plugin review requires all three safety hints on every tool.
47: // Bounded computation and reads from the application's own database.
48: const READ_ONLY_ANNOTATIONS = {
49:   readOnlyHint: true,
50:   openWorldHint: false,
51:   destructiveHint: false,
52:   idempotentHint: true,
53: } as const;
54: 
55: // Public government APIs are open-world even when accessed only for reading.
56: const PUBLIC_READ_ANNOTATIONS = {
57:   ...READ_ONLY_ANNOTATIONS,
58:   openWorldHint: true,
59: } as const;
60: 
61: // These tools can refresh an internal cache while performing a lookup. The
62: // cache is disposable public data; refreshes also purge expired cache rows.
63: // Timestamps/expiry and cleanup can change on retries, so do not claim idempotence.
64: const INTERNAL_CACHE_ANNOTATIONS = {
65:   readOnlyHint: false,
66:   openWorldHint: true,
67:   destructiveHint: false,
68:   idempotentHint: false,
69: } as const;
70: 
71: // These tools upsert reviewable public evidence or derived records in our D1
72: // database. They never publish, message, transact, or change third-party data.
73: const INTERNAL_UPSERT_ANNOTATIONS = {
74:   readOnlyHint: false,
75:   openWorldHint: false,
76:   destructiveHint: true,
77:   idempotentHint: false,
78: } as const;
79: 
80: const PUBLIC_UPSERT_ANNOTATIONS = {
81:   ...INTERNAL_UPSERT_ANNOTATIONS,
82:   openWorldHint: true,
83: } as const;
84: 
85: function jsonToolResult(value: unknown) {
86:   return {
87:     content: [
88:       {
89:         type: "text" as const,
90:         text: JSON.stringify(value, null, 2),
91:       },
92:     ],
93:   };
94: }
95: 
96: function errorToolResult(error: unknown) {
97:   const known =
98:     error instanceof DocumentError ||
99:     error instanceof NtaApiError ||
100:     error instanceof JGrantsApiError ||
101:     error instanceof GBizInfoApiError ||
102:     error instanceof EdinetApiError ||
103:     error instanceof SelectionStatisticsError;
104:   const payload = {
105:     error: {
106:       code: known ? error.code : "internal_error",
107:       message: known
108:         ? error.message
109:         : "公的情報の取得中に予期しないエラーが発生しました。",
110:       retryable: known
111:         ? error.code === "timeout" ||
112:           error.code === "upstream_error" ||
113:           error.code === "rate_limited"
114:         : false,
115:     },
116:   };
117:   return {
118:     isError: true,
119:     content: [
120:       {
121:         type: "text" as const,
122:         text: JSON.stringify(payload, null, 2),
123:       },
124:     ],
125:   };
126: }
127: 
128: type Env = DocumentEnv & CatalogEnv & {
129:   SUBSIDY_COMPARISON_ENABLED?: string;
130:   NTA_APPLICATION_ID?: string;
131:   GBIZINFO_API_TOKEN?: string;
132:   EDINET_API_KEY?: string;
133:   CACHE_KEY_SECRET?: string;
134:   OPENAI_APPS_CHALLENGE_TOKEN?: string;
135:   PUBLIC_CACHE?: D1Database;
136:   subsidy_ai_relations?: D1Database;
137: };
138: 
139: export function createDomainVerificationResponse(token?: string): Response {
140:   const verificationToken = token?.trim();
141: 
142:   if (!verificationToken) {
143:     return Response.json({ error: "Not found" }, { status: 404 });
144:   }
145: 
146:   return new Response(verificationToken, {
147:     status: 200,
148:     headers: {
149:       "Cache-Control": "no-store",
150:       "Content-Type": "text/plain; charset=utf-8",
151:       "X-Content-Type-Options": "nosniff",
152:     },
153:   });
154: }
155: 
156: export function createServer(env: Env): McpServer {
157:   const server = new McpServer({
158:     name: SERVER_NAME,
159:     version: SERVER_VERSION,
160:   });
161:   const publicCacheDatabase =
162:     env.PUBLIC_CACHE ?? env.subsidy_ai_relations;
163:   const jGrantsCacheOptions = {
164:     cache: publicCacheDatabase
165:       ? new D1PublicApiCache(publicCacheDatabase)
166:       : undefined,
167:     searchCacheKeySecret: env.CACHE_KEY_SECRET,
168:   };
169: 
170:   server.registerTool(
171:     "search_corporate_identities",
172:     {
173:       annotations: PUBLIC_READ_ANNOTATIONS,
174:       description: "国税庁の法人名検索で正式名称・法人番号・所在地・閉鎖情報を取得します。閉鎖法人も含みます。同名法人を自動決定せず、所在地で確認してください。mayHaveMoreがtrueならpageを進めてください。noticeの出典・非保証表示を利用者に提示してください。",
175:       inputSchema: {
176:         name: z.string().trim().min(1).max(200),
177:         address_code: z.string().regex(/^(?:(?:0[1-9]|[1-3][0-9]|4[0-7])(?:\d{3})?|99)$/).optional().describe("都道府県2桁または都道府県＋市区町村5桁のJISコード。東京都=13、千代田区=13101、国外=99"),
178:         page: z.number().int().min(1).max(99999).optional().default(1),
179:       },
180:     },
181:     async ({ name, address_code, page }) => {
182:       try { return jsonToolResult(await searchCorporateIdentities({ name, addressCode: address_code, page }, env.NTA_APPLICATION_ID)); }
183:       catch (error) { return errorToolResult(error); }
184:     },
185:   );
186: 
187:   server.registerTool(
188:     "get_corporate_identity",
189:     {
190:       annotations: PUBLIC_READ_ANNOTATIONS,
191:       description: "国税庁の法人番号照会で最新の正式名称・所在地・閉鎖情報・検索対象除外情報を取得します。閉鎖情報なしを営業中と断定せず、noticeの出典・非保証表示を利用者に提示してください。資本金・従業員数等はget_company_profileを使ってください。",
192:       inputSchema: { corporate_number: z.string().trim().regex(/^\d{13}$/) },
193:     },
194:     async ({ corporate_number }) => {
195:       try { return jsonToolResult(await getCorporateIdentity(corporate_number, env.NTA_APPLICATION_ID)); }
196:       catch (error) { return errorToolResult(error); }
197:     },
198:   );
199: 
200:   server.registerTool(
201:     "search_companies",
202:     {
203:       annotations: PUBLIC_READ_ANNOTATIONS,
204:       description:
205:         "経済産業省の法人情報データベース（gBizINFO）で法人名を検索し、法人番号・所在地を含む候補を返します。利用者向け回答では単に『gBizINFO』とせず、『経済産業省の法人情報データベース』と説明してください。同名法人など複数候補がある場合は自動決定せず、利用者に所在地や正式名称を確認してください。mayHaveMoreがtrueなら先頭ページだけであることを明示してください。statusAvailabilityがnot_providedの法人を登記中・存続中と断定しないでください。候補確定後はget_company_profileを使用します。",
206:       inputSchema: {
207:         name: z
208:           .string()
209:           .trim()
210:           .min(1)
211:           .max(200)
212:           .describe("検索する法人名。正式名称が望ましい"),
213:         prefecture: z
214:           .string()
215:           .trim()
216:           .min(1)
217:           .max(20)
218:           .optional()
219:           .describe("候補を絞り込む都道府県。例: 東京都"),
220:         city: z
221:           .string()
222:           .trim()
223:           .min(1)
224:           .max(100)
225:           .optional()
226:           .describe("候補を絞り込む市区町村。例: 千代田区"),
227:         page: z.number().int().min(1).max(10_000).optional().default(1),
228:         limit: z.number().int().min(1).max(20).optional().default(10),
229:       },
230:     },
231:     async ({ name, prefecture, city, page, limit }) => {
232:       try {
233:         return jsonToolResult(
234:           await searchCompanies(
235:             { name, prefecture, city, page, limit },
236:             env.GBIZINFO_API_TOKEN,
237:           ),
238:         );
239:       } catch (error) {
240:         return errorToolResult(error);
241:       }
242:     },
243:   );
244: 
245:   server.registerTool(
246:     "get_company_profile",
247:     {
248:       annotations: PUBLIC_READ_ANNOTATIONS,
249:       description:
250:         "法人番号から経済産業省の法人情報データベース（gBizINFO）にある公開法人基本情報を取得します。利用者向け回答では単に『gBizINFO』とせず、『経済産業省の法人情報データベース』と説明してください。所在地、業種、従業員数、資本金などを返します。活動情報は完全性を保証できない基本情報レスポンスから数えず、not_fetchedとして返します。認定、特許、補助金などはget_company_activitiesを使用してください。未登録項目は推測せずnullまたは空配列で返し、statusAvailabilityがnot_providedの場合は登記中・存続中と断定しません。",
251:       inputSchema: {
252:         corporate_number: z
253:           .string()
254:           .trim()
255:           .regex(/^\d{13}$/)
256:           .describe("13桁の法人番号"),
257:         activity_limit: z
258:           .number()
259:           .int()
260:           .min(1)
261:           .max(50)
262:           .optional()
263:           .default(20)
264:           .describe(
265:             "後方互換用。活動情報は取得しないため、get_company_activitiesのactivity_limitを使用してください",
266:           ),
267:       },
268:     },
269:     async ({ corporate_number, activity_limit }) => {
270:       try {
271:         return jsonToolResult(
272:           await getCompanyProfile(
273:             corporate_number,
274:             env.GBIZINFO_API_TOKEN,
275:             activity_limit,
276:           ),
277:         );
278:       } catch (error) {
279:         return errorToolResult(error);
280:       }
281:     },
282:   );
283: 
284:   server.registerTool(
285:     "get_company_activities",
286:     {
287:       annotations: PUBLIC_READ_ANNOTATIONS,
288:       description:
289:         "法人番号から経済産業省の法人情報データベース（gBizINFO）にある活動情報を取得します。利用者向け回答では単に『gBizINFO』とせず、『経済産業省の法人情報データベース』と説明してください。届出・認定、表彰、事業所、財務、特許・意匠・商標、調達、補助金、職場情報を返します。法人名検索のactivityCountはこれらの総合指標であり、特定種類の件数とは限りません。種類別件数、取得失敗、検索APIの報告件数との差を分けて返します。",
290:       inputSchema: {
291:         corporate_number: z
292:           .string()
293:           .trim()
294:           .regex(/^\d{13}$/)
295:           .describe("活動情報を取得する13桁の法人番号"),
296:         activity_types: z
297:           .array(z.enum(GBIZINFO_ACTIVITY_TYPES))
298:           .min(1)
299:           .max(GBIZINFO_ACTIVITY_TYPES.length)
300:           .optional()
301:           .default([...GBIZINFO_ACTIVITY_TYPES])
302:           .describe(
303:             "取得する活動情報の種類。省略時は8種類すべてを取得",
304:           ),
305:         activity_limit: z
306:           .number()
307:           .int()
308:           .min(1)
309:           .max(50)
310:           .optional()
311:           .default(20)
312:           .describe("各活動種類の最大返却件数。総件数は切り捨て前を返す"),
313:       },
314:     },
315:     async ({ corporate_number, activity_types, activity_limit }) => {
316:       try {
317:         return jsonToolResult(
318:           await getCompanyActivities(
319:             corporate_number,
320:             env.GBIZINFO_API_TOKEN,
321:             activity_types,
322:             activity_limit,
323:           ),
324:         );
325:       } catch (error) {
326:         return errorToolResult(error);
327:       }
328:     },
329:   );
330: 
331:   server.registerTool(
332:     "verify_corporate_relationship",
333:     {
334:       annotations: PUBLIC_UPSERT_ANNOTATIONS,
335:       description:
336:         "利用者が申告した親会社候補を、金融庁EDINETの最新の有価証券報告書で検証します。D1設定時は確認できた公開企業・文書・関係の記録を保存し、同じ識別条件の既存記録を上書きする場合があります。親会社をゼロから推測するツールではありません。対象会社名が書類にない場合も資本関係なしとは断定しません。statusやpersistenceの英語値、relationIdなどは内部処理用です。利用者向け回答では自然な日本語に言い換え、保存状態や内部IDは求められない限り表示しないでください。関係が確認できても、資本関係だけで補助金候補から除外しないでください。候補制度の最新の公募要領または公式FAQを確認し、assess_deemed_large_enterprise_eligibilityで制度別に照合してください。",
337:       inputSchema: {
338:         target_company_name: z
339:           .string()
340:           .trim()
341:           .min(1)
342:           .max(200)
343:           .describe("親子関係を確認したい対象会社の正式名称"),
344:         target_corporate_number: z
345:           .string()
346:           .trim()
347:           .regex(/^\d{13}$/)
348:           .optional()
349:           .describe("対象会社の13桁の法人番号。判明している場合に指定"),
350:         parent_company_name: z
351:           .string()
352:           .trim()
353:           .min(1)
354:           .max(200)
355:           .describe("利用者が申告した親会社候補の正式名称"),
356:         parent_corporate_number: z
357:           .string()
358:           .trim()
359:           .regex(/^\d{13}$/)
360:           .optional()
361:           .describe("親会社候補の13桁の法人番号。同名候補の特定に使用"),
362:         filing_date: z
363:           .string()
364:           .trim()
365:           .regex(/^\d{4}-\d{2}-\d{2}$/)
366:           .optional()
367:           .describe(
368:             "有価証券報告書の提出日。分かる場合にYYYY-MM-DDで指定すると、その日だけを照会",
369:           ),
370:         document_id: z
371:           .string()
372:           .trim()
373:           .regex(/^[A-Za-z0-9]+$/)
374:           .max(20)
375:           .optional()
376:           .describe(
377:             "EDINETの書類管理番号。分かる場合は提出日検索を省略して直接検証",
378:           ),
379:       },
380:     },
381:     async ({
382:       target_company_name,
383:       target_corporate_number,
384:       parent_company_name,
385:       parent_corporate_number,
386:       filing_date,
387:       document_id,
388:     }) => {
389:       try {
390:         return jsonToolResult(
391:           await verifyAndStoreCorporateRelationship(
392:             {
393:               targetCompanyName: target_company_name,
394:               targetCorporateNumber: target_corporate_number,
395:               parentCompanyName: parent_company_name,
396:               parentCorporateNumber: parent_corporate_number,
397:               filingDate: filing_date,
398:               documentId: document_id,
399:             },
400:             env.EDINET_API_KEY,
401:             createD1CompanyRelationsRepository(env.subsidy_ai_relations),
402:           ),
403:         );
404:       } catch (error) {
405:         return errorToolResult(error);
406:       }
407:     },
408:   );
409:   server.registerTool(
410:     "prepare_professional_consultation",
411:     {
412:       annotations: READ_ONLY_ANNOTATIONS,
413:       description:
414:         "利用者が補助金候補を検討したい、専門家に相談したい、次に何をすればよいかと尋ねたときに使います。Web検索や他ツールで得た情報からも、顧問社労士などへコピーして送れる相談文を作成できます。確認済みの制度名・公式URL・公開事実と未確認論点を引き継ぎ、対応可否・紹介・必要資料・初期相談費用を尋ねる文面を返します。nextActionとreadyToSendMessageを利用者がコピーできる形で提示し、単に『専門家へ相談してください』に要約しないでください。未取得の会社名・事業概要・期限は推測せず省略してください。株主名簿、決算書、賃金台帳など非公開資料の内容や個人情報は入力せず、資料名と相談論点だけを指定してください。結果は保存せず、送信もしません。",
415:       inputSchema: {
416:         company_name: z.string().trim().min(1).max(200).optional()
417:           .describe("相談対象の公開法人名。未確認なら省略"),
418:         public_business_summary: z.string().trim().min(1).max(500).optional()
419:           .describe("公開情報で確認した事業概要。非公開の事業計画・取引条件は入力しない"),
420:         subsidy_name: z.string().trim().min(1).max(300).optional(),
421:         source_url: z.url().optional(),
422:         confirmed_facts: z
423:           .array(z.string().trim().min(1).max(500))
424:           .max(20)
425:           .optional()
426:           .default([]),
427:         issues: z
428:           .array(
429:             z.object({
430:               topic: z.enum([
431:                 "location",
432:                 "industry",
433:                 "employee_count",
434:                 "capital_yen",
435:                 "business_plans",
436:                 "official_guidelines",
437:                 "acceptance_period",
438:                 "corporate_relationship",
439:                 "officer_overlap",
440:                 "indirect_control",
441:                 "high_income_rule",
442:                 "conditional_requirement",
443:                 "program_rule",
444:                 "research_and_development_costs",
445:                 "partnership_structure",
446:               ]),
447:               summary: z.string().trim().min(1).max(500),
448:             }),
449:           )
450:           .min(1)
451:           .max(20),
452:         application_deadline: z.string().trim().min(1).max(40).optional(),
453:         consult_by: z.string().trim().min(1).max(40).optional(),
454:       },
455:     },
456:     async ({
457:       company_name,
458:       public_business_summary,
459:       subsidy_name,
460:       source_url,
461:       confirmed_facts,
462:       issues,
463:       application_deadline,
464:       consult_by,
465:     }) =>
466:       jsonToolResult(
467:         createProfessionalConsultationBrief({
468:           companyName: company_name,
469:           publicBusinessSummary: public_business_summary,
470:           subsidyName: subsidy_name,
471:           sourceUrl: source_url,
472:           confirmedFacts: confirmed_facts,
473:           issues: issues.map((issue) => ({
474:             topic: issue.topic as ConsultationTopic,
475:             summary: issue.summary,
476:           })),
477:           applicationDeadline: application_deadline,
478:           consultBy: consult_by,
479:         }),
480:       ),
481:   );
482: 
483:   server.registerTool(
484:     "assess_deemed_large_enterprise_eligibility",
485:     {
486:       annotations: READ_ONLY_ANNOTATIONS,
487:       description:
488:         "候補となった補助金の公式資料にある『みなし大企業』の扱いと、EDINET等で確認した公開資本関係を照合します。100%子会社という事実だけで全制度を対象外にせず、制度が申請を認める場合、対象外とする場合、条件付きの場合を分けます。program_ruleは必ず最新の公募要領・公式FAQなどから入力し、source_urlと確認日を付けてください。single_large_owner_percent等は、株主がその制度上の大企業に該当すると確認できた場合だけ入力してください。課税所得や役員兼務など公開情報で確認できない値は推測せず省略してください。英語のstatusは内部処理用であり、利用者向け回答ではstatusLabel、summary、professionalConsultationを使い、判定と専門家への具体的な相談事項を自然な日本語で説明してください。入力と判定結果は保存しません。",
489:       inputSchema: {
490:         subsidy_id: z
491:           .string()
492:           .trim()
493:           .min(1)
494:           .max(18)
495:           .regex(/^[A-Za-z0-9]+$/)
496:           .describe("対象となるJグランツの補助金ID"),
497:         program_rule: z.object({
498:           treatment: z
499:             .enum(["excluded", "allowed", "conditional", "not_stated"])
500:             .describe(
501:               "公式資料における扱い。対象外、申請可能、条件付き、明記なしのいずれか",
502:             ),
503:           single_large_owner_threshold_percent: z
504:             .number()
505:             .min(0)
506:             .max(100)
507:             .optional()
508:             .describe("単一の大企業による保有割合の対象外基準（%）"),
509:           multiple_large_owners_threshold_percent: z
510:             .number()
511:             .min(0)
512:             .max(100)
513:             .optional()
514:             .describe("複数大企業の合計保有割合の対象外基準（%）"),
515:           officer_overlap_threshold_percent: z
516:             .number()
517:             .min(0)
518:             .max(100)
519:             .optional()
520:             .describe("大企業の役員・職員が兼務する役員割合の基準（%）"),
521:           indirect_ownership_included: z
522:             .boolean()
523:             .optional()
524:             .default(false)
525:             .describe("間接保有・孫会社等を対象外基準に含むか"),
526:           high_income_rule_included: z
527:             .boolean()
528:             .optional()
529:             .default(false)
530:             .describe("課税所得等の非公開情報に関する基準を含むか"),
531:           source_url: z
532:             .url()
533:             .refine((value) => value.startsWith("https://"), {
534:               message: "公式資料のHTTPS URLを指定してください",
535:             })
536:             .describe("判定基準を確認した公募要領または公式FAQのURL"),
537:           source_title: z.string().trim().min(1).max(300).optional(),
538:           source_section: z
539:             .string()
540:             .trim()
541:             .min(1)
542:             .max(300)
543:             .optional()
544:             .describe("根拠となるページ番号または節見出し"),
545:           checked_at: z
546:             .string()
547:             .regex(/^\d{4}-\d{2}-\d{2}$/)
548:             .describe("公式資料を確認した日（YYYY-MM-DD）"),
549:         }),
550:         affiliation_facts: z.object({
551:           single_large_owner_percent: z
552:             .number()
553:             .min(0)
554:             .max(100)
555:             .optional()
556:             .describe("制度上の大企業に該当する単一株主の確認済み保有割合"),
557:           multiple_large_owners_percent: z
558:             .number()
559:             .min(0)
560:             .max(100)
561:             .optional()
562:             .describe("制度上の大企業に該当する複数株主の確認済み合計保有割合"),
563:           officer_overlap_percent: z
564:             .number()
565:             .min(0)
566:             .max(100)
567:             .optional()
568:             .describe("公開情報または利用者確認による役員・職員兼務割合"),
569:           indirectly_controlled_by_large_enterprise: z.boolean().optional(),
570:           high_income_rule_applies: z
571:             .boolean()
572:             .optional()
573:             .describe("利用者が確認した場合のみ指定。課税所得そのものは入力しない"),
574:           conditional_requirement_met: z
575:             .boolean()
576:             .optional()
577:             .describe("条件付きで申請可能な制度について、公式条件を満たすか"),
578:         }),
579:       },
580:     },
581:     async ({ subsidy_id, program_rule, affiliation_facts }) =>
582:       jsonToolResult(
583:         assessDeemedLargeEnterpriseEligibility(
584:           subsidy_id,
585:           {
586:             treatment: program_rule.treatment,
587:             singleLargeOwnerThresholdPercent:
588:               program_rule.single_large_owner_threshold_percent,
589:             multipleLargeOwnersThresholdPercent:
590:               program_rule.multiple_large_owners_threshold_percent,
591:             officerOverlapThresholdPercent:
592:               program_rule.officer_overlap_threshold_percent,
593:             indirectOwnershipIncluded:
594:               program_rule.indirect_ownership_included,
595:             highIncomeRuleIncluded: program_rule.high_income_rule_included,
596:             sourceUrl: program_rule.source_url,
597:             sourceTitle: program_rule.source_title,
598:             sourceSection: program_rule.source_section,
599:             checkedAt: program_rule.checked_at,
600:           },
601:           {
602:             singleLargeOwnerPercent:
603:               affiliation_facts.single_large_owner_percent,
604:             multipleLargeOwnersPercent:
605:               affiliation_facts.multiple_large_owners_percent,
606:             officerOverlapPercent: affiliation_facts.officer_overlap_percent,
607:             indirectlyControlledByLargeEnterprise:
608:               affiliation_facts.indirectly_controlled_by_large_enterprise,
609:             highIncomeRuleApplies: affiliation_facts.high_income_rule_applies,
610:             conditionalRequirementMet:
611:               affiliation_facts.conditional_requirement_met,
612:           },
613:         ),
614:       ),
615:   );
616:   server.registerTool(
617:     "record_official_selection_statistics",
618:     {
619:       annotations: PUBLIC_UPSERT_ANNOTATIONS,
620:       description:
621:         "実施機関・政府が公開した同一公募回の申請件数と採択件数を、出典と計算根拠付きでD1へ保存します。保存前に公式URLの本文と根拠を照合し、同じ制度・公募回・対象範囲等の既存記録を上書きする場合があります。割合は入力せず、コードが採択件数÷申請件数で計算します。同じ公募回・同じ枠・同じ審査段階と確認できない場合はcomparabilityをnot_confirmedまたはnot_comparableにし、公式採択率を算定しないでください。採択者一覧しかない場合もapplications_countを推測しません。根拠本文はハッシュ計算にだけ使い、DBへ保存しません。企業情報や利用者情報を入力しないでください。",
622:       inputSchema: {
623:         program: z.object({
624:           series_key: z.string().trim().min(1).max(100),
625:           canonical_name: z.string().trim().min(1).max(300),
626:           institution_name: z.string().trim().min(1).max(300).optional(),
627:         }),
628:         round: z.object({
629:           jgrants_subsidy_id: z.string().trim().max(18).optional(),
630:           fiscal_year: z.number().int().min(2000).max(2200),
631:           round_name: z.string().trim().min(1).max(200),
632:           scope_key: z
633:             .string()
634:             .trim()
635:             .min(1)
636:             .max(100)
637:             .optional()
638:             .default("overall")
639:             .describe("制度全体・通常枠など、数値の対象範囲を識別する安定したキー"),
640:           acceptance_start: z.string().trim().max(40).optional(),
641:           acceptance_end: z.string().trim().max(40).optional(),
642:           budget_yen: z.number().int().min(0).optional(),
643:           official_detail_url: z.url().optional(),
644:           last_checked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
645:         }),
646:         counts: z.object({
647:           applications_count: z.number().int().min(0).optional(),
648:           selected_count: z.number().int().min(0).optional(),
649:           denominator_label: z.string().trim().min(1).max(100).optional(),
650:           numerator_label: z.string().trim().min(1).max(100).optional(),
651:           comparability: z.enum([
652:             "confirmed_same_round_and_scope",
653:             "not_confirmed",
654:             "not_comparable",
655:           ]),
656:         }),
657:         source: z.object({
658:           source_type: z.enum([
659:             "official_result",
660:             "official_report",
661:             "official_budget",
662:             "official_guideline",
663:             "government_statistics",
664:           ]),
665:           publisher: z.string().trim().min(1).max(300),
666:           title: z.string().trim().min(1).max(500),
667:           url: z.url().refine((value) => value.startsWith("https://"), {
668:             message: "公的資料のHTTPS URLを指定してください",
669:           }),
670:           published_at: z.string().trim().max(40).optional(),
671:           retrieved_at: z.string().trim().min(1).max(40),
672:           reliability: z.enum(["high", "medium"]).default("high"),
673:           role: z.enum([
674:             "applications_count",
675:             "selected_count",
676:             "both_counts",
677:             "budget",
678:             "methodology",
679:           ]),
680:           evidence_text: z
681:             .string()
682:             .trim()
683:             .min(1)
684:             .max(2000)
685:             .describe("件数と対象公募回を確認できる必要最小限の根拠。保存せずハッシュ化する"),
686:         }),
687:         basis_summary: z.string().trim().min(1).max(1000),
688:         as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
689:         expires_at: z.string().trim().max(40).optional(),
690:       },
691:     },
692:     async ({ program, round, counts, source, basis_summary, as_of_date, expires_at }) => {
693:       try {
694:         const verifiedSource = await verifyOfficialResearchSource(
695:           source.url,
696:           source.evidence_text,
697:         );
698:         return jsonToolResult(
699:           await recordSelectionEvidence(
700:             {
701:               program: {
702:                 seriesKey: program.series_key,
703:                 canonicalName: program.canonical_name,
704:                 institutionName: program.institution_name,
705:               },
706:               round: {
707:                 jgrantsSubsidyId: round.jgrants_subsidy_id,
708:                 fiscalYear: round.fiscal_year,
709:                 roundName: round.round_name,
710:                 scopeKey: round.scope_key,
711:                 acceptanceStart: round.acceptance_start,
712:                 acceptanceEnd: round.acceptance_end,
713:                 budgetYen: round.budget_yen,
714:                 officialDetailUrl: round.official_detail_url,
715:                 lastCheckedAt: round.last_checked_at,
716:               },
717:               counts: {
718:                 applicationsCount: counts.applications_count,
719:                 selectedCount: counts.selected_count,
720:                 denominatorLabel: counts.denominator_label,
721:                 numeratorLabel: counts.numerator_label,
722:                 comparability: counts.comparability,
723:               },
724:               source: {
725:                 sourceType: source.source_type,
726:                 publisher: source.publisher,
727:                 title: source.title,
728:                 url: verifiedSource.verifiedUrl,
729:                 publishedAt: source.published_at,
730:                 retrievedAt: source.retrieved_at,
731:                 contentHash: verifiedSource.contentHash,
732:                 reliability: source.reliability,
733:                 role: source.role,
734:               },
735:               basisSummary: basis_summary,
736:               asOfDate: as_of_date,
737:               expiresAt: expires_at,
738:             },
739:             createD1SelectionStatisticsRepository(publicCacheDatabase),
740:           ),
741:         );
742:       } catch (error) {
743:         return errorToolResult(error);
744:       }
745:     },
746:   );
747: 
748:   server.registerTool(
749:     "get_official_selection_statistics",
750:     {
751:       annotations: READ_ONLY_ANNOTATIONS,
752:       description:
753:         "Jグランツ補助金IDに紐づけて保存された、公募回別の公式申請件数・採択件数・公式採択率と根拠を返します。officialRateがnullの場合は割合を推測しないでください。利用者向けには『過去の公式採択率』と表記し、個別企業の採択確率とは説明しないでください。",
754:       inputSchema: {
755:         jgrants_subsidy_id: z.string().trim().min(1).max(18),
756:       },
757:     },
758:     async ({ jgrants_subsidy_id }) => {
759:       try {
760:         const repository = createD1SelectionStatisticsRepository(publicCacheDatabase);
761:         if (!repository) {
762:           throw new SelectionStatisticsError(
763:             "採択実績用のD1データベースが設定されていません。",
764:             "database_error",
765:           );
766:         }
767:         const records = await repository.findByJgrantsSubsidyId(jgrants_subsidy_id);
768:         return jsonToolResult({
769:           ...records,
770:           statusLabel: records.statistics.length
771:             ? "保存済みの公式採択実績があります"
772:             : "保存済みの公式採択実績はありません",
773:           guidance:
774:             "公式採択率は制度全体の過去実績であり、個別企業の採択確率ではありません。nullの割合は推測しないでください。",
775:         });
776:       } catch (error) {
777:         return errorToolResult(error);
778:       }
779:     },
780:   );
781: 
782:   server.registerTool(
783:     "estimate_program_selection_outlook",
784:     {
785:       annotations: INTERNAL_UPSERT_ANNOTATIONS,
786:       description:
787:         "同じ制度系列の過去最大3回の公式採択実績から、今回の制度全体の採択見通しを説明可能なルールで参考算定します。個別企業の採択確率ではありません。申請資格が未確定・条件付き・対象外可能性ありの場合は必ず計算を停止します。予算、補助上限、対象範囲の変化は公式資料で確認できる場合だけ入力してください。target_jgrants_subsidy_idに登録済み公募回を指定すると、算定結果と方法論バージョンをD1へ保存し、その公募回の既存推計を上書きする場合があります。保存しない場合はtarget_jgrants_subsidy_idを省略してください。",
788:       inputSchema: {
789:         program_series_key: z.string().trim().min(1).max(100),
790:         target_jgrants_subsidy_id: z
791:           .string()
792:           .trim()
793:           .min(1)
794:           .max(18)
795:           .optional()
796:           .describe("算定結果を保存する現在公募回のJグランツID"),
797:         eligibility_status: z.enum([
798:           "eligible",
799:           "conditional",
800:           "needs_confirmation",
801:           "likely_ineligible",
802:         ]),
803:         budget_change_percent: z.number().min(-100).max(1000).optional(),
804:         maximum_grant_change_percent: z.number().min(-100).max(1000).optional(),
805:         target_scope_change: z
806:           .enum(["expanded", "unchanged", "narrowed", "unknown"])
807:           .optional()
808:           .default("unknown"),
809:         program_continuity: z
810:           .enum(["continuing", "new", "unknown"])
811:           .optional()
812:           .default("unknown"),
813:       },
814:     },
815:     async ({
816:       program_series_key,
817:       target_jgrants_subsidy_id,
818:       eligibility_status,
819:       budget_change_percent,
820:       maximum_grant_change_percent,
821:       target_scope_change,
822:       program_continuity,
823:     }) => {
824:       try {
825:         const repository = createD1SelectionStatisticsRepository(publicCacheDatabase);
826:         if (!repository) {
827:           throw new SelectionStatisticsError(
828:             "採択実績用のD1データベースが設定されていません。",
829:             "database_error",
830:           );
831:         }
832:         const historicalRates = await repository.historicalOfficialRates(
833:           program_series_key,
834:           3,
835:         );
836:         const outlook = estimateSelectionOutlook({
837:           eligibilityStatus: eligibility_status,
838:           historicalRates,
839:           budgetChangePercent: budget_change_percent,
840:           maximumGrantChangePercent: maximum_grant_change_percent,
841:           targetScopeChange: target_scope_change,
842:           programContinuity: program_continuity,
843:         });
844:         const persistence = target_jgrants_subsidy_id
845:           ? await repository.saveEstimateForJgrantsId(
846:               target_jgrants_subsidy_id,
847:               outlook,
848:               new Date().toISOString().slice(0, 10),
849:             )
850:           : ({
851:               status: "not_saved",
852:               reason: "target_round_not_specified",
853:             } as const);
854:         return jsonToolResult({ ...outlook, persistence });
855:       } catch (error) {
856:         return errorToolResult(error);
857:       }
858:     },
859:   );
860: 
861:   server.registerTool(
862:     "evaluate_subsidy_fit_for_company",
863:     {
864:       annotations: INTERNAL_CACHE_ANNOTATIONS,
865:       description:
866:         "法人番号から経済産業省の法人情報データベース（gBizINFO）の企業プロフィールを取得し、指定したJグランツ補助金の公開条件と照合します。利用者向け回答では単に『gBizINFO』とせず、『経済産業省の法人情報データベース』と説明してください。公開情報で未登録または古い所在地、業種、従業員数、資本金は利用者の明示入力で補完でき、各値の出典と矛盾も返します。中小企業要件がある制度では親会社・大企業からの出資関係を利用者に確認し、親会社候補が示された場合はverify_corporate_relationshipで検証してください。ただし、資本関係だけで候補から除外せず、公式資料の制度別基準をassess_deemed_large_enterprise_eligibilityで照合してください。assessment.assessment.statusは内部処理用です。利用者向け回答には英語コードを表示せず、assessment.assessment.statusLabel、summary、assessment.professionalConsultationを使って、判定と専門家への具体的な相談事項を自然な日本語で説明してください。申請資格や採択を断定しません。assessment.responseGuidanceに従い、事業との相性・申請資格・実行可能性を分け、資金試算と申請延期の前提を再確認してください。",
867:       inputSchema: {
868:         subsidy_id: z
869:           .string()
870:           .trim()
871:           .min(1)
872:           .max(18)
873:           .regex(/^[A-Za-z0-9]+$/)
874:           .describe("search_subsidiesが返したJグランツの補助金ID"),
875:         corporate_number: z
876:           .string()
877:           .trim()
878:           .regex(/^\d{13}$/)
879:           .describe("経済産業省の法人情報データベースで企業を特定する13桁の法人番号"),
880:         business_plans: z
881:           .array(z.string().trim().min(1).max(255))
882:           .max(20)
883:           .optional()
884:           .describe("補助金との照合に使う任意の事業計画"),
885:         location: z
886:           .string()
887:           .trim()
888:           .min(1)
889:           .max(100)
890:           .optional()
891:           .describe("利用者が確認した現在の所在地。指定時は公開法人情報より優先"),
892:         industry: z
893:           .string()
894:           .trim()
895:           .min(1)
896:           .max(255)
897:           .optional()
898:           .describe("利用者が確認した現在の業種。指定時は公開法人情報より優先"),
899:         employee_count: z
900:           .number()
901:           .int()
902:           .min(0)
903:           .max(10_000_000)
904:           .optional()
905:           .describe("利用者が確認した現在の従業員数。指定時は公開法人情報より優先"),
906:         capital_yen: z
907:           .number()
908:           .int()
909:           .min(0)
910:           .max(100_000_000_000_000)
911:           .optional()
912:           .describe("利用者が確認した現在の資本金（円）。指定時は公開法人情報より優先"),
913:       },
914:     },
915:     async ({
916:       subsidy_id,
917:       corporate_number,
918:       business_plans,
919:       location,
920:       industry,
921:       employee_count,
922:       capital_yen,
923:     }) => {
924:       try {
925:         return jsonToolResult(
926:           await evaluateSubsidyFitForCompany(
927:             subsidy_id,
928:             corporate_number,
929:             env.GBIZINFO_API_TOKEN,
930:             business_plans,
931:             {
932:               location,
933:               industry,
934:               employeeCount: employee_count,
935:               capitalYen: capital_yen,
936:             },
937:             jGrantsCacheOptions,
938:           ),
939:         );
940:       } catch (error) {
941:         return errorToolResult(error);
942:       }
943:     },
944:   );
945:   server.registerTool(
946:     "search_subsidies",
947:     {
948:       annotations: INTERNAL_CACHE_ANNOTATIONS,
949:       description:
950:         "Jグランツの公開APIから補助金候補を検索します。検索範囲はJグランツに限られます。返却のsearchGuidanceとresponseGuidanceに従い、0件を制度不存在とせず、雇用・研修では利用可能な標準Web検索で厚労省公式情報を補完してください。所在地が指定された場合は全国対象制度も含めます。検索結果だけで対象可否を断定せず、候補選定後にget_subsidy_detailを使用してください。",
951:       inputSchema: {
952:         keyword: z
953:           .string()
954:           .trim()
955:           .min(2)
956:           .max(255)
957:           .describe("事業や投資目的を表す2〜255文字の検索語"),
958:         use_purpose: z
959:           .string()
960:           .trim()
961:           .min(1)
962:           .max(255)
963:           .optional()
964:           .describe("Jグランツの利用目的区分"),
965:         target_area: z
966:           .string()
967:           .trim()
968:           .min(1)
969:           .max(100)
970:           .optional()
971:           .describe("事業実施地域または所在地。例: 東京都"),
972:         industry: z
973:           .string()
974:           .trim()
975:           .min(1)
976:           .max(255)
977:           .optional()
978:           .describe("Jグランツの業種区分。例: 製造業"),
979:         employee_count: z
980:           .number()
981:           .int()
982:           .min(0)
983:           .max(10_000_000)
984:           .optional()
985:           .describe("現在の従業員数。API取得後の候補絞り込みに使用"),
986:         accepting_only: z
987:           .boolean()
988:           .optional()
989:           .default(true)
990:           .describe("trueの場合、現在受付中の制度だけを返す"),
991:         sort: z
992:           .enum([
993:             "created_date",
994:             "acceptance_start_datetime",
995:             "acceptance_end_datetime",
996:           ])
997:           .optional()
998:           .default("acceptance_end_datetime"),
999:         order: z.enum(["ASC", "DESC"]).optional().default("ASC"),
1000:         limit: z.number().int().min(1).max(50).optional().default(10),
1001:       },
1002:     },
1003:     async ({
1004:       keyword,
1005:       use_purpose,
1006:       target_area,
1007:       industry,
1008:       employee_count,
1009:       accepting_only,
1010:       sort,
1011:       order,
1012:       limit,
1013:     }) => {
1014:       try {
1015:         return jsonToolResult(
1016:           await searchSubsidies(
1017:             {
1018:               keyword,
1019:               usePurpose: use_purpose,
1020:               targetArea: target_area,
1021:               industry,
1022:               employeeCount: employee_count,
1023:               acceptingOnly: accepting_only,
1024:               sort,
1025:               order,
1026:               limit,
1027:             },
1028:             jGrantsCacheOptions,
1029:           ).then(result => enabled(env.MHLW_DISCOVERY_GUIDANCE_ENABLED) && enabled(env.SUBSIDY_DISCOVERY_TOOLS_ENABLED) && enabled(env.MHLW_CATALOG_SERVING_ENABLED)
1030:             ? {...result, searchGuidance: result.searchGuidance + " " + DISCOVERY_GUIDANCE} : result),
1031:         );
1032:       } catch (error) {
1033:         return errorToolResult(error);
1034:       }
1035:     },
1036:   );
1037: 
1038:   server.registerTool(
1039:     "get_subsidy_detail",
1040:     {
1041:       annotations: INTERNAL_CACHE_ANNOTATIONS,
1042:       description:
1043:         "search_subsidiesが返した補助金IDからJグランツ詳細API V2を取得します。公募回ごとの受付期間と文書メタデータを返し、Base64文書本体は返しません。responseGuidanceに従い、金額試算前に費用区分別の補助率・例外・交付先を公式資料で確認してください。",
1044:       inputSchema: {
1045:         subsidy_id: z
1046:           .string()
1047:           .trim()
1048:           .min(1)
1049:           .max(18)
1050:           .regex(/^[A-Za-z0-9]+$/)
1051:           .describe("Jグランツの補助金ID（18文字以内の英数字）"),
1052:       },
1053:     },
1054:     async ({ subsidy_id }) => {
1055:       try {
1056:         return jsonToolResult(
1057:           await getSubsidyDetail(subsidy_id, jGrantsCacheOptions),
1058:         );
1059:       } catch (error) {
1060:         return errorToolResult(error);
1061:       }
1062:     },
1063:   );
1064: 
1065:   server.registerTool(
1066:     "evaluate_subsidy_fit",
1067:     {
1068:       annotations: INTERNAL_CACHE_ANNOTATIONS,
1069:       description:
1070:         "指定した補助金のJグランツ詳細と企業プロフィールを照合し、明示的な一致、不一致、未確認事項を分けて返します。assessment.statusは内部処理用です。利用者向け回答にはstrong_candidate、needs_confirmation、potentially_ineligible、insufficient_informationなどの英語コードを表示せず、statusLabel、summary、professionalConsultationを使って、判定と専門家への具体的な相談事項を自然な日本語で説明してください。受給資格や採択を断定するツールではありません。responseGuidanceに従い、事業との相性・申請資格・実行可能性を分け、後続の資金相談や申請延期でも前提を再確認してください。",
1071:       inputSchema: {
1072:         subsidy_id: z
1073:           .string()
1074:           .trim()
1075:           .min(1)
1076:           .max(18)
1077:           .regex(/^[A-Za-z0-9]+$/)
1078:           .describe("search_subsidiesが返したJグランツの補助金ID"),
1079:         company_profile: z.object({
1080:           location: z.string().trim().min(1).max(100).optional(),
1081:           industry: z.string().trim().min(1).max(255).optional(),
1082:           employee_count: z.number().int().min(0).max(10_000_000).optional(),
1083:           capital_yen: z
1084:             .number()
1085:             .int()
1086:             .min(0)
1087:             .max(100_000_000_000_000)
1088:             .optional(),
1089:           business_plans: z
1090:             .array(z.string().trim().min(1).max(255))
1091:             .max(20)
1092:             .optional(),
1093:         }),
1094:       },
1095:     },
1096:     async ({ subsidy_id, company_profile }) => {
1097:       try {
1098:         return jsonToolResult(
1099:           await evaluateSubsidyFit(
1100:             subsidy_id,
1101:             {
1102:               location: company_profile.location,
1103:               industry: company_profile.industry,
1104:               employeeCount: company_profile.employee_count,
1105:               capitalYen: company_profile.capital_yen,
1106:               businessPlans: company_profile.business_plans,
1107:             },
1108:             jGrantsCacheOptions,
1109:           ),
1110:         );
1111:       } catch (error) {
1112:         return errorToolResult(error);
1113:       }
1114:     },
1115:   );
1116: 
1117:   if (enabled(env.OFFICIAL_DOCUMENTS_ENABLED)) {
1118:     server.registerTool("get_subsidy_documents", {
1119:       annotations: READ_ONLY_ANNOTATIONS,
1120:       description: "登録済みの公式資料リンクを公募回別に取得します。内部D1の読み取りのみで、Web取得・AI分類・ジョブ登録を起こしません。未収集、古い情報、公募回の選択待ちを区別してください。必要書類一式や個別企業への提出義務は判定しません。直リンクがない場合はsourcePageUrlを案内し、recommendedActionとresponseGuidanceに従ってください。",
1121:       inputSchema: documentInputSchema.shape,
1122:     }, async input => {
1123:       try { return jsonToolResult(await getSubsidyDocuments(input,env)); }
1124:       catch(error) { return errorToolResult(error); }
1125:     });
1126:   }
1127:   if (enabled(env.SUBSIDY_COMPARISON_ENABLED)) registerComparison(server);
1128:   registerDiscovery(server, env);
1129:   return server;
1130: }
1131: 
1132: export default {
1133:   async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
1134:     ctx.waitUntil(collectDueSources(env).then(result => { console.log(JSON.stringify({event:"document_discovery",...result})); }));
1135:     ctx.waitUntil(collectDueMhlwSources(env).then(result => { console.log(JSON.stringify({event:"mhlw_discovery",...result})); }));
1136:   },
1137:   async fetch(
1138:     request: Request,
1139:     env: Env,
1140:     ctx: ExecutionContext,
1141:   ): Promise<Response> {
1142:     const url = new URL(request.url);
1143: 
1144:     if (url.pathname === DOMAIN_VERIFICATION_PATH) {
1145:       return createDomainVerificationResponse(
1146:         env.OPENAI_APPS_CHALLENGE_TOKEN,
1147:       );
1148:     }
1149: 
1150:     if (url.pathname === "/" || url.pathname === "/health") {
1151:       return Response.json({
1152:         ok: true,
1153:         service: SERVER_NAME,
1154:         version: SERVER_VERSION,
1155:         mcpEndpoint: "/mcp",
1156:       });
1157:     }
1158: 
1159:     if (url.pathname === "/mcp") {
1160:       const handleMcpRequest = createMcpHandler(() => createServer(env));
1161:       return handleMcpRequest(request, env, ctx);
1162:     }
1163: 
1164:     return Response.json({ error: "Not found" }, { status: 404 });
1165:   },
1166: } satisfies ExportedHandler<Env>;