1: import { getCompanyProfile } from "./gbizinfo";
2: import type { JGrantsCacheOptions } from "./jgrants";
3: import { evaluateSubsidyFit } from "./matching";
4: 
5: export type CompanyProfileOverrides = {
6:   location?: string;
7:   industry?: string;
8:   employeeCount?: number;
9:   capitalYen?: number;
10: };
11: 
12: type ProfileValue = string | number;
13: type FieldRelationship =
14:   | "exact_match"
15:   | "compatible"
16:   | "conflict"
17:   | "unknown";
18: 
19: function comparable(value: ProfileValue): ProfileValue {
20:   return typeof value === "string"
21:     ? value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase()
22:     : value;
23: }
24: 
25: function normalizeLocation(value: string): string {
26:   return value
27:     .normalize("NFKC")
28:     .replace(/^〒?\d{3}-?\d{4}/u, "")
29:     .replace(/[\s　]+/gu, "")
30:     .trim();
31: }
32: 
33: function administrativeArea(value: string) {
34:   const normalized = normalizeLocation(value);
35:   const prefectureMatch = normalized.match(
36:     /^(東京都|北海道|大阪府|京都府|.{2,3}県)/u,
37:   );
38:   if (!prefectureMatch) {
39:     return { prefecture: null, municipality: null };
40:   }
41:   const prefecture = prefectureMatch[1];
42:   const remainder = normalized.slice(prefecture.length);
43:   const municipalityMatch = remainder.match(/^(.+?(?:市|区|町|村))/u);
44:   return {
45:     prefecture,
46:     municipality: municipalityMatch?.[1] ?? null,
47:   };
48: }
49: 
50: function isAdministrativeScope(value: string): boolean {
51:   const normalized = normalizeLocation(value);
52:   const area = administrativeArea(normalized);
53:   if (!area.prefecture) return false;
54:   return (
55:     normalized === area.prefecture ||
56:     (area.municipality !== null &&
57:       normalized === `${area.prefecture}${area.municipality}`)
58:   );
59: }
60: 
61: function compareLocations(
62:   gbizInfoValue: string,
63:   userProvidedValue: string,
64: ): FieldRelationship {
65:   const publicLocation = normalizeLocation(gbizInfoValue);
66:   const suppliedLocation = normalizeLocation(userProvidedValue);
67:   if (publicLocation === suppliedLocation) return "exact_match";
68:   if (publicLocation.startsWith(suppliedLocation)) {
69:     return isAdministrativeScope(suppliedLocation) ? "compatible" : "unknown";
70:   }
71:   if (suppliedLocation.startsWith(publicLocation)) {
72:     return isAdministrativeScope(publicLocation) ? "compatible" : "unknown";
73:   }
74: 
75:   const publicArea = administrativeArea(publicLocation);
76:   const suppliedArea = administrativeArea(suppliedLocation);
77:   if (
78:     publicArea.prefecture &&
79:     suppliedArea.prefecture &&
80:     publicArea.prefecture !== suppliedArea.prefecture
81:   ) {
82:     return "conflict";
83:   }
84:   if (
85:     publicArea.municipality &&
86:     suppliedArea.municipality &&
87:     publicArea.municipality !== suppliedArea.municipality
88:   ) {
89:     return "conflict";
90:   }
91:   if (
92:     publicArea.municipality &&
93:     suppliedArea.municipality &&
94:     publicArea.municipality === suppliedArea.municipality
95:   ) {
96:     return "conflict";
97:   }
98:   return "unknown";
99: }
100: 
101: function resolveField<T extends ProfileValue>(
102:   gbizInfoValue: T | null | undefined,
103:   userProvidedValue: T | undefined,
104: ) {
105:   const publicValue = gbizInfoValue ?? null;
106:   const suppliedValue = userProvidedValue ?? null;
107:   const hasUserValue = suppliedValue !== null;
108:   const value = hasUserValue ? suppliedValue : publicValue;
109:   const conflict =
110:     hasUserValue &&
111:     publicValue !== null &&
112:     comparable(suppliedValue) !== comparable(publicValue);
113:   return {
114:     value,
115:     source: hasUserValue
116:       ? ("user_provided" as const)
117:       : publicValue !== null
118:         ? ("gbizinfo" as const)
119:         : ("missing" as const),
120:     gbizInfoValue: publicValue,
121:     userProvidedValue: suppliedValue,
122:     relationship: value === null
123:       ? ("unknown" as const)
124:       : conflict
125:         ? ("conflict" as const)
126:         : publicValue !== null && suppliedValue !== null
127:           ? ("exact_match" as const)
128:           : ("unknown" as const),
129:     conflict,
130:   };
131: }
132: 
133: function resolveLocation(
134:   gbizInfoValue: string | null | undefined,
135:   userProvidedValue: string | undefined,
136: ) {
137:   const resolved = resolveField(gbizInfoValue, userProvidedValue);
138:   const relationship =
139:     resolved.gbizInfoValue !== null && resolved.userProvidedValue !== null
140:       ? compareLocations(
141:           resolved.gbizInfoValue,
142:           resolved.userProvidedValue,
143:         )
144:       : ("unknown" as const);
145:   return {
146:     ...resolved,
147:     relationship,
148:     conflict: relationship === "conflict",
149:   };
150: }
151: 
152: export async function evaluateSubsidyFitForCompany(
153:   subsidyId: string,
154:   corporateNumber: string,
155:   apiToken: string | undefined,
156:   businessPlans?: string[],
157:   overrides: CompanyProfileOverrides = {},
158:   cacheOptions: JGrantsCacheOptions = {},
159: ) {
160:   const companyProfile = await getCompanyProfile(corporateNumber, apiToken, 10);
161:   const company = companyProfile.company;
162:   const publicIndustry = company.industries.length
163:     ? company.industries.join(" / ")
164:     : null;
165:   const resolved = {
166:     location: resolveLocation(company.location, overrides.location?.trim()),
167:     industry: resolveField(publicIndustry, overrides.industry?.trim()),
168:     employeeCount: resolveField(
169:       company.employeeNumber,
170:       overrides.employeeCount,
171:     ),
172:     capitalYen: resolveField(company.capitalStockYen, overrides.capitalYen),
173:   };
174:   const assessment = await evaluateSubsidyFit(
175:     subsidyId,
176:     {
177:       location: resolved.location.value ?? undefined,
178:       industry: resolved.industry.value ?? undefined,
179:       employeeCount: resolved.employeeCount.value ?? undefined,
180:       capitalYen: resolved.capitalYen.value ?? undefined,
181:       businessPlans,
182:     },
183:     cacheOptions,
184:   );
185: 
186:   const conflictFields = Object.entries(resolved)
187:     .filter(([, field]) => field.conflict)
188:     .map(([field]) => field);
189:   const missingFields = Object.entries(resolved)
190:     .filter(([, field]) => field.source === "missing")
191:     .map(([field]) => field);
192: 
193:   return {
194:     sources: [companyProfile.source, assessment.source],
195:     retrievedAt: {
196:       company: companyProfile.retrievedAt,
197:       subsidy: assessment.retrievedAt,
198:     },
199:     company: {
200:       corporateNumber: company.corporateNumber,
201:       name: company.name,
202:       location: company.location,
203:       industries: company.industries,
204:       employeeNumber: company.employeeNumber,
205:       capitalStockYen: company.capitalStockYen,
206:       industryCodes: company.industryCodes,
207:       status: company.status,
208:       statusAvailability: company.statusAvailability,
209:       updateDate: company.updateDate,
210:       certificationCount: companyProfile.activities.certificationCount,
211:       subsidyHistoryCount: companyProfile.activities.subsidyHistoryCount,
212:     },
213:     profileResolution: {
214:       precedence: "user_provided_over_gbizinfo",
215:       fields: resolved,
216:       businessPlans: {
217:         value: businessPlans ?? [],
218:         source:
219:           businessPlans && businessPlans.length
220:             ? ("user_provided" as const)
221:             : ("missing" as const),
222:       },
223:       conflictFields,
224:       missingFields,
225:       requiresUserConfirmation: conflictFields.length > 0,
226:     },
227:     statusPolicy: companyProfile.statusPolicy,
228:     assessment,
229:     caution:
230:       "経済産業省の法人情報データベース（gBizINFO）とJグランツの公開情報、および明示された利用者入力を組み合わせた候補評価です。利用者入力は公的データより優先して照合しますが、矛盾がある場合は確認が必要です。申請資格や採択を保証しないため、最新の公募要領と実施機関の案内を確認してください。",
231:   };
232: }