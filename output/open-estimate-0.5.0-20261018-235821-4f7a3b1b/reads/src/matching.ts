1: import { getSubsidyDetail, type JGrantsCacheOptions } from "./jgrants";
2: import { RESPONSE_GUIDANCE } from "./responseGuidance";
3: import {
4:   createProfessionalConsultationBrief,
5:   type ConsultationTopic,
6: } from "./professionalConsultation";
7: 
8: export type CompanyProfileInput = {
9:   location?: string;
10:   industry?: string;
11:   employeeCount?: number;
12:   capitalYen?: number;
13:   businessPlans?: string[];
14: };
15: 
16: type ConditionResult = {
17:   field: string;
18:   companyValue: string | number | null;
19:   subsidyRequirement: string | null;
20:   reason: string;
21: };
22: 
23: export type SubsidyFitStatus =
24:   | "strong_candidate"
25:   | "needs_confirmation"
26:   | "potentially_ineligible"
27:   | "insufficient_information";
28: 
29: const STATUS_LABELS: Record<SubsidyFitStatus, string> = {
30:   strong_candidate: "有力な候補です",
31:   needs_confirmation: "申請条件の追加確認が必要です",
32:   potentially_ineligible: "対象外となる可能性があります",
33:   insufficient_information: "判断に必要な企業情報が不足しています",
34: };
35: 
36: function summarizeAssessment(
37:   status: SubsidyFitStatus,
38:   conflictingCount: number,
39:   unconfirmedCount: number,
40:   missingCount: number,
41: ): string {
42:   switch (status) {
43:     case "strong_candidate":
44:       return "公開情報で確認できる条件は一致しています。申請前に最新の公募要領を確認してください。";
45:     case "needs_confirmation":
46:       return `公開情報で確認できる範囲では候補ですが、公募要領などで追加確認が必要な項目が${unconfirmedCount}件あります。`;
47:     case "potentially_ineligible":
48:       return `公開情報上、対象条件と一致しない可能性がある項目が${conflictingCount}件あります。公募要領または実施機関に確認してください。`;
49:     case "insufficient_information":
50:       return `判断に必要な企業情報が${missingCount}件不足しています。情報を補ってから改めて確認してください。`;
51:   }
52: }
53: 
54: export type SubsidyDetailSnapshot = {
55:   source: { name: string; apiDocumentationUrl: string };
56:   retrievedAt: string;
57:   servedAt?: string;
58:   cache?: {
59:     status: "hit" | "miss" | "stale" | "bypass";
60:     isStale: boolean;
61:     expiresAt: string | null;
62:   };
63:   subsidy: {
64:     id: string;
65:     title: string;
66:     detailUrl: string;
67:     industry: string | null;
68:     employeeLimit: string | null;
69:     usePurpose: string | null;
70:     subsidyRate: string | null;
71:     subsidyMaxLimitYen: number | null;
72:     workflows: Array<{
73:       targetArea: string | null;
74:       targetAreaDetail: string | null;
75:       acceptanceStatus: "scheduled" | "open" | "closed" | "unknown";
76:       acceptanceStart: string | null;
77:       acceptanceEnd: string | null;
78:     }>;
79:   };
80: };
81: 
82: function normalizeText(value: string): string {
83:   return value.normalize("NFKC").replace(/[\s,、・/／]/g, "").toLowerCase();
84: }
85: 
86: function isUnrestricted(value: string): boolean {
87:   const normalized = normalizeText(value);
88:   return ["制約なし", "指定なし", "問わない", "全業種", "全国"].some(
89:     (word) => normalized.includes(word),
90:   );
91: }
92: 
93: function thresholdValues(
94:   value: string,
95:   suffix: "以下" | "未満" | "以上",
96: ): number[] {
97:   const pattern = new RegExp(`([0-9０-９][0-9０-９,，]*)\\s*人?\\s*${suffix}`, "g");
98:   return [
99:     ...new Set(
100:       [...value.normalize("NFKC").matchAll(pattern)]
101:         .map((match) => Number(match[1]?.replace(/,/g, "")))
102:         .filter(Number.isFinite),
103:     ),
104:   ];
105: }
106: 
107: export function evaluateSubsidyFitFromDetail(
108:   detail: SubsidyDetailSnapshot,
109:   profile: CompanyProfileInput,
110: ) {
111:   const matchedConditions: ConditionResult[] = [];
112:   const conflictingConditions: ConditionResult[] = [];
113:   const unconfirmedConditions: ConditionResult[] = [];
114:   const missingProfileFields = [
115:     !profile.location ? "location" : null,
116:     !profile.industry ? "industry" : null,
117:     profile.employeeCount === undefined ? "employee_count" : null,
118:   ].filter((field): field is string => Boolean(field));
119: 
120:   const areas = [
121:     ...new Set(
122:       detail.subsidy.workflows
123:         .map((workflow) => workflow.targetArea)
124:         .filter((value): value is string => Boolean(value)),
125:     ),
126:   ];
127:   const areaDetails = [
128:     ...new Set(
129:       detail.subsidy.workflows
130:         .map((workflow) => workflow.targetAreaDetail)
131:         .filter((value): value is string => Boolean(value)),
132:     ),
133:   ];
134:   if (profile.location) {
135:     if (!areas.length) {
136:       unconfirmedConditions.push({
137:         field: "location",
138:         companyValue: profile.location,
139:         subsidyRequirement: null,
140:         reason: "構造化された対象地域がないため、公募要領で確認が必要です。",
141:       });
142:     } else {
143:       const location = normalizeText(profile.location);
144:       const compatible = areas.some((area) => {
145:         const normalizedArea = normalizeText(area);
146:         return (
147:           isUnrestricted(area) ||
148:           normalizedArea.includes(location) ||
149:           location.includes(normalizedArea)
150:         );
151:       });
152:       (compatible ? matchedConditions : conflictingConditions).push({
153:         field: "location",
154:         companyValue: profile.location,
155:         subsidyRequirement: areas.join(" / "),
156:         reason: compatible
157:           ? "所在地は対象地域表記と一致しています。"
158:           : "所在地が対象地域表記に含まれていません。",
159:       });
160:     }
161:   }
162:   if (areaDetails.length) {
163:     unconfirmedConditions.push({
164:       field: "location_detail",
165:       companyValue: profile.location ?? null,
166:       subsidyRequirement: areaDetails.join(" / "),
167:       reason:
168:         "対象地域の補足条件は除外地域等を含む可能性があるため、公募要領で確認が必要です。",
169:     });
170:   }
171: 
172:   if (profile.industry) {
173:     const requirement = detail.subsidy.industry;
174:     if (!requirement) {
175:       unconfirmedConditions.push({
176:         field: "industry",
177:         companyValue: profile.industry,
178:         subsidyRequirement: null,
179:         reason: "構造化された対象業種がないため、公募要領で確認が必要です。",
180:       });
181:     } else {
182:       const industry = normalizeText(profile.industry);
183:       const normalizedRequirement = normalizeText(requirement);
184:       const compatible =
185:         isUnrestricted(requirement) ||
186:         normalizedRequirement.includes(industry) ||
187:         industry.includes(normalizedRequirement);
188:       (compatible ? matchedConditions : unconfirmedConditions).push({
189:         field: "industry",
190:         companyValue: profile.industry,
191:         subsidyRequirement: requirement,
192:         reason: compatible
193:           ? "業種は対象業種表記と一致しています。"
194:           : "業種分類が一致しないため、公募要領で確認が必要です。",
195:       });
196:     }
197:   }
198: 
199:   if (profile.employeeCount !== undefined) {
200:     const requirement = detail.subsidy.employeeLimit;
201:     if (!requirement) {
202:       unconfirmedConditions.push({
203:         field: "employee_count",
204:         companyValue: profile.employeeCount,
205:         subsidyRequirement: null,
206:         reason: "構造化された従業員数条件がないため、公募要領で確認が必要です。",
207:       });
208:     } else if (isUnrestricted(requirement)) {
209:       matchedConditions.push({
210:         field: "employee_count",
211:         companyValue: profile.employeeCount,
212:         subsidyRequirement: requirement,
213:         reason: "Jグランツでは従業員数の制約なしとされています。",
214:       });
215:     } else {
216:       const maximums = thresholdValues(requirement, "以下");
217:       const strictMaximums = thresholdValues(requirement, "未満");
218:       const minimums = thresholdValues(requirement, "以上");
219:       if (maximums.length + strictMaximums.length + minimums.length !== 1) {
220:         unconfirmedConditions.push({
221:           field: "employee_count",
222:           companyValue: profile.employeeCount,
223:           subsidyRequirement: requirement,
224:           reason: "複数条件の可能性があるため、公募要領で確認が必要です。",
225:         });
226:       } else {
227:         const compatible = maximums.length
228:           ? profile.employeeCount <= maximums[0]!
229:           : strictMaximums.length
230:             ? profile.employeeCount < strictMaximums[0]!
231:             : profile.employeeCount >= minimums[0]!;
232:         (compatible ? matchedConditions : conflictingConditions).push({
233:           field: "employee_count",
234:           companyValue: profile.employeeCount,
235:           subsidyRequirement: requirement,
236:           reason: compatible
237:             ? "従業員数は構造化条件を満たしています。"
238:             : "従業員数が構造化条件と一致しません。",
239:         });
240:       }
241:     }
242:   }
243: 
244:   const statuses = detail.subsidy.workflows.map(
245:     (workflow) => workflow.acceptanceStatus,
246:   );
247:   if (statuses.includes("open")) {
248:     matchedConditions.push({
249:       field: "acceptance_period",
250:       companyValue: null,
251:       subsidyRequirement: null,
252:       reason: "現在受付中の公募回があります。",
253:     });
254:   } else if (statuses.length && statuses.every((status) => status === "closed")) {
255:     conflictingConditions.push({
256:       field: "acceptance_period",
257:       companyValue: null,
258:       subsidyRequirement: null,
259:       reason: "確認できる公募回は終了しています。",
260:     });
261:   } else {
262:     unconfirmedConditions.push({
263:       field: "acceptance_period",
264:       companyValue: null,
265:       subsidyRequirement: null,
266:       reason: "現在の受付状態を確定できません。",
267:     });
268:   }
269: 
270:   if (profile.capitalYen !== undefined) {
271:     unconfirmedConditions.push({
272:       field: "capital_yen",
273:       companyValue: profile.capitalYen,
274:       subsidyRequirement: null,
275:       reason: "資本金要件は公募要領で確認が必要です。",
276:     });
277:   }
278:   if (profile.businessPlans?.length) {
279:     unconfirmedConditions.push({
280:       field: "business_plans",
281:       companyValue: profile.businessPlans.join(" / "),
282:       subsidyRequirement: detail.subsidy.usePurpose,
283:       reason: "事業計画と対象事業・対象経費の具体的な照合が必要です。",
284:     });
285:   }
286:   unconfirmedConditions.push({
287:     field: "official_guidelines",
288:     companyValue: null,
289:     subsidyRequirement: null,
290:     reason: "申請主体、対象経費、実施期間などを最新の公募要領で確認してください。",
291:   });
292: 
293:   const status: SubsidyFitStatus = conflictingConditions.length
294:     ? "potentially_ineligible"
295:     : missingProfileFields.length
296:       ? "insufficient_information"
297:       : unconfirmedConditions.length
298:         ? "needs_confirmation"
299:         : "strong_candidate";
300: 
301:   const consultationIssues = [
302:     ...conflictingConditions,
303:     ...unconfirmedConditions,
304:     ...missingProfileFields.map((field) => ({
305:       field,
306:       reason: `${field}の企業情報を確認できません。`,
307:     })),
308:   ].map((condition) => ({
309:     topic: consultationTopic(condition.field),
310:     summary: condition.reason,
311:   }));
312:   const openDeadlines = detail.subsidy.workflows
313:     .filter((workflow) => workflow.acceptanceStatus === "open")
314:     .map((workflow) => workflow.acceptanceEnd)
315:     .filter((value): value is string => Boolean(value))
316:     .sort();
317: 
318:   return {
319:     source: detail.source,
320:     responseGuidance: RESPONSE_GUIDANCE,
321:     retrievedAt: detail.retrievedAt,
322:     servedAt: detail.servedAt ?? detail.retrievedAt,
323:     cache: detail.cache ?? null,
324:     subsidy: {
325:       id: detail.subsidy.id,
326:       title: detail.subsidy.title,
327:       detailUrl: detail.subsidy.detailUrl,
328:       subsidyRate: detail.subsidy.subsidyRate,
329:       subsidyMaxLimitYen: detail.subsidy.subsidyMaxLimitYen,
330:     },
331:     companyProfile: {
332:       location: profile.location ?? null,
333:       industry: profile.industry ?? null,
334:       employeeCount: profile.employeeCount ?? null,
335:       capitalYen: profile.capitalYen ?? null,
336:       businessPlans: profile.businessPlans ?? [],
337:     },
338:     assessment: {
339:       status,
340:       statusLabel: STATUS_LABELS[status],
341:       summary: summarizeAssessment(
342:         status,
343:         conflictingConditions.length,
344:         unconfirmedConditions.length,
345:         missingProfileFields.length,
346:       ),
347:       matchedConditions,
348:       conflictingConditions,
349:       unconfirmedConditions,
350:       missingProfileFields,
351:     },
352:     professionalConsultation: createProfessionalConsultationBrief({
353:       subsidyName: detail.subsidy.title,
354:       sourceUrl: detail.subsidy.detailUrl,
355:       confirmedFacts: matchedConditions.map((condition) => condition.reason),
356:       issues: consultationIssues,
357:       applicationDeadline: openDeadlines[0] ?? null,
358:     }),
359:     caution:
360:       "これはJグランツの構造化情報に基づく候補評価であり、受給資格や採択を保証しません。必ず最新の公募要領と実施機関の案内を確認してください。",
361:   };
362: }
363: 
364: function consultationTopic(field: string): ConsultationTopic {
365:   switch (field) {
366:     case "location":
367:     case "location_detail":
368:       return "location";
369:     case "industry":
370:       return "industry";
371:     case "employee_count":
372:       return "employee_count";
373:     case "capital_yen":
374:       return "capital_yen";
375:     case "business_plans":
376:       return "business_plans";
377:     case "acceptance_period":
378:       return "acceptance_period";
379:     default:
380:       return "official_guidelines";
381:   }
382: }
383: 
384: export async function evaluateSubsidyFit(
385:   subsidyId: string,
386:   profile: CompanyProfileInput,
387:   cacheOptions: JGrantsCacheOptions = {},
388: ) {
389:   return evaluateSubsidyFitFromDetail(
390:     await getSubsidyDetail(subsidyId, cacheOptions),
391:     profile,
392:   );
393: }