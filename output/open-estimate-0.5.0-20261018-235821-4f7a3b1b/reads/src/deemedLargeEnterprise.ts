1: import {
2:   createProfessionalConsultationBrief,
3:   type ConsultationTopic,
4: } from "./professionalConsultation";
5: 
6: export type ProgramTreatment =
7:   | "excluded"
8:   | "allowed"
9:   | "conditional"
10:   | "not_stated";
11: 
12: export type DeemedLargeEnterpriseRule = {
13:   treatment: ProgramTreatment;
14:   singleLargeOwnerThresholdPercent?: number;
15:   multipleLargeOwnersThresholdPercent?: number;
16:   officerOverlapThresholdPercent?: number;
17:   indirectOwnershipIncluded?: boolean;
18:   highIncomeRuleIncluded?: boolean;
19:   sourceUrl: string;
20:   sourceTitle?: string;
21:   sourceSection?: string;
22:   checkedAt: string;
23: };
24: 
25: export type PublicAffiliationFacts = {
26:   singleLargeOwnerPercent?: number;
27:   multipleLargeOwnersPercent?: number;
28:   officerOverlapPercent?: number;
29:   indirectlyControlledByLargeEnterprise?: boolean;
30:   highIncomeRuleApplies?: boolean;
31:   conditionalRequirementMet?: boolean;
32: };
33: 
34: export type DeemedLargeEnterpriseAssessmentStatus =
35:   | "allowed_by_program"
36:   | "likely_excluded"
37:   | "no_exclusion_identified"
38:   | "needs_confirmation";
39: 
40: type AssessmentReason = {
41:   field: string;
42:   message: string;
43: };
44: 
45: const STATUS_LABELS: Record<DeemedLargeEnterpriseAssessmentStatus, string> = {
46:   allowed_by_program: "みなし大企業であることだけでは対象外になりません",
47:   likely_excluded: "みなし大企業として対象外となる可能性が高いです",
48:   no_exclusion_identified: "確認できた基準には該当していません",
49:   needs_confirmation: "制度要件または企業情報の追加確認が必要です",
50: };
51: 
52: function atLeast(value: number | undefined, threshold: number | undefined) {
53:   return value !== undefined && threshold !== undefined && value >= threshold;
54: }
55: 
56: function missingFact(
57:   required: boolean,
58:   value: unknown,
59:   field: string,
60:   message: string,
61:   missing: AssessmentReason[],
62: ) {
63:   if (required && value === undefined) missing.push({ field, message });
64: }
65: 
66: export function assessDeemedLargeEnterpriseEligibility(
67:   subsidyId: string,
68:   rule: DeemedLargeEnterpriseRule,
69:   facts: PublicAffiliationFacts,
70: ) {
71:   const matchedRules: AssessmentReason[] = [];
72:   const missingInformation: AssessmentReason[] = [];
73: 
74:   if (rule.treatment === "allowed") {
75:     const status = "allowed_by_program" as const;
76:     return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
77:       "公式資料では、みなし大企業であることだけを理由に申請対象外とはされていません。その他の申請要件は別途確認してください。",
78:     );
79:   }
80: 
81:   if (rule.treatment === "not_stated") {
82:     const status = "needs_confirmation" as const;
83:     missingInformation.push({
84:       field: "program_rule",
85:       message: "確認した公式資料では、みなし大企業の扱いを特定できませんでした。",
86:     });
87:     return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
88:       "制度の公式資料または実施機関で、みなし大企業の扱いを確認してください。",
89:     );
90:   }
91: 
92:   if (rule.treatment === "conditional") {
93:     if (facts.conditionalRequirementMet === true) {
94:       const status = "allowed_by_program" as const;
95:       return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
96:         "制度固有の条件を満たすことが確認されています。その他の申請要件は別途確認してください。",
97:       );
98:     }
99:     if (facts.conditionalRequirementMet === false) {
100:       matchedRules.push({
101:         field: "conditional_requirement",
102:         message: "みなし大企業に適用される制度固有の条件を満たしていません。",
103:       });
104:       const status = "likely_excluded" as const;
105:       return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
106:         "制度固有の条件を満たさないため、対象外となる可能性が高いです。",
107:       );
108:     }
109:     missingInformation.push({
110:       field: "conditional_requirement",
111:       message: "みなし大企業に適用される制度固有の条件を満たすか確認が必要です。",
112:     });
113:     const status = "needs_confirmation" as const;
114:     return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
115:       "制度固有の条件を満たすか確認してください。",
116:     );
117:   }
118: 
119:   if (atLeast(facts.singleLargeOwnerPercent, rule.singleLargeOwnerThresholdPercent)) {
120:     matchedRules.push({
121:       field: "single_large_owner",
122:       message: `単一の大企業による保有割合が基準の${rule.singleLargeOwnerThresholdPercent}%以上です。`,
123:     });
124:   }
125:   if (atLeast(facts.multipleLargeOwnersPercent, rule.multipleLargeOwnersThresholdPercent)) {
126:     matchedRules.push({
127:       field: "multiple_large_owners",
128:       message: `複数の大企業による合計保有割合が基準の${rule.multipleLargeOwnersThresholdPercent}%以上です。`,
129:     });
130:   }
131:   if (atLeast(facts.officerOverlapPercent, rule.officerOverlapThresholdPercent)) {
132:     matchedRules.push({
133:       field: "officer_overlap",
134:       message: `大企業の役員・職員による兼務割合が基準の${rule.officerOverlapThresholdPercent}%以上です。`,
135:     });
136:   }
137:   if (
138:     rule.indirectOwnershipIncluded &&
139:     facts.indirectlyControlledByLargeEnterprise === true
140:   ) {
141:     matchedRules.push({
142:       field: "indirect_control",
143:       message: "制度が対象とする大企業からの間接支配が確認されています。",
144:     });
145:   }
146:   if (rule.highIncomeRuleIncluded && facts.highIncomeRuleApplies === true) {
147:     matchedRules.push({
148:       field: "high_income_rule",
149:       message: "制度が定める課税所得等の基準に該当すると申告されています。",
150:     });
151:   }
152: 
153:   if (matchedRules.length) {
154:     const status = "likely_excluded" as const;
155:     return result(subsidyId, rule, facts, status, matchedRules, missingInformation,
156:       "公式資料の対象外基準に該当する公開情報または利用者確認情報があります。最終判断は実施機関に確認してください。",
157:     );
158:   }
159: 
160:   missingFact(
161:     rule.singleLargeOwnerThresholdPercent !== undefined,
162:     facts.singleLargeOwnerPercent,
163:     "single_large_owner",
164:     "単一の大企業による保有割合を確認できません。",
165:     missingInformation,
166:   );
167:   missingFact(
168:     rule.multipleLargeOwnersThresholdPercent !== undefined,
169:     facts.multipleLargeOwnersPercent,
170:     "multiple_large_owners",
171:     "複数の大企業による合計保有割合を確認できません。",
172:     missingInformation,
173:   );
174:   missingFact(
175:     rule.officerOverlapThresholdPercent !== undefined,
176:     facts.officerOverlapPercent,
177:     "officer_overlap",
178:     "大企業の役員・職員による兼務割合を公開情報から確認できません。",
179:     missingInformation,
180:   );
181:   missingFact(
182:     rule.indirectOwnershipIncluded === true,
183:     facts.indirectlyControlledByLargeEnterprise,
184:     "indirect_control",
185:     "大企業からの間接支配の有無を確認できません。",
186:     missingInformation,
187:   );
188:   missingFact(
189:     rule.highIncomeRuleIncluded === true,
190:     facts.highIncomeRuleApplies,
191:     "high_income_rule",
192:     "課税所得等の非公開情報は自動取得せず、利用者の確認が必要です。",
193:     missingInformation,
194:   );
195: 
196:   if (
197:     rule.singleLargeOwnerThresholdPercent === undefined &&
198:     rule.multipleLargeOwnersThresholdPercent === undefined &&
199:     rule.officerOverlapThresholdPercent === undefined &&
200:     !rule.indirectOwnershipIncluded &&
201:     !rule.highIncomeRuleIncluded
202:   ) {
203:     missingInformation.push({
204:       field: "program_rule_details",
205:       message: "対象外基準の具体的な条件が入力されていません。",
206:     });
207:   }
208: 
209:   const status: DeemedLargeEnterpriseAssessmentStatus = missingInformation.length
210:     ? "needs_confirmation"
211:     : "no_exclusion_identified";
212:   const summary = missingInformation.length
213:     ? "判定に必要な情報が不足しています。公開情報で確認できない事項は推定せず、申請企業または実施機関に確認してください。"
214:     : "入力された公開情報の範囲では、制度の対象外基準への該当を確認できませんでした。その他の申請要件は別途確認してください。";
215:   return result(subsidyId, rule, facts, status, matchedRules, missingInformation, summary);
216: }
217: 
218: function result(
219:   subsidyId: string,
220:   rule: DeemedLargeEnterpriseRule,
221:   facts: PublicAffiliationFacts,
222:   status: DeemedLargeEnterpriseAssessmentStatus,
223:   matchedRules: AssessmentReason[],
224:   missingInformation: AssessmentReason[],
225:   summary: string,
226: ) {
227:   const issues = [
228:     ...matchedRules,
229:     ...missingInformation,
230:   ].map((item) => ({
231:     topic: consultationTopic(item.field),
232:     summary: item.message,
233:   }));
234:   return {
235:     subsidyId,
236:     assessment: {
237:       status,
238:       statusLabel: STATUS_LABELS[status],
239:       summary,
240:       matchedRules,
241:       missingInformation,
242:     },
243:     programRule: rule,
244:     affiliationFacts: facts,
245:     professionalConsultation: createProfessionalConsultationBrief({
246:       sourceUrl: rule.sourceUrl,
247:       confirmedFacts: matchedRules.map((item) => item.message),
248:       issues,
249:     }),
250:     privacy:
251:       "この判定結果は保存しません。公開情報で確認できない課税所得や役員兼務などは推定しません。",
252:     caution:
253:       "これは入力された公式資料の基準と確認済み情報の機械的な照合です。補助金の申請資格を保証しないため、最新の公募要領と実施機関の案内を確認してください。",
254:   };
255: }
256: 
257: function consultationTopic(field: string): ConsultationTopic {
258:   switch (field) {
259:     case "officer_overlap":
260:       return "officer_overlap";
261:     case "indirect_control":
262:       return "indirect_control";
263:     case "high_income_rule":
264:       return "high_income_rule";
265:     case "conditional_requirement":
266:       return "conditional_requirement";
267:     case "program_rule":
268:     case "program_rule_details":
269:       return "program_rule";
270:     default:
271:       return "corporate_relationship";
272:   }
273: }