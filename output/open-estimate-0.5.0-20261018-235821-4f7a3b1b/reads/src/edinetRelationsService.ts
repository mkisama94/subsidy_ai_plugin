1: import {
2:   type CompanyInput,
3:   type CompanyRelationInput,
4:   type EdinetDocumentInput,
5: } from "./d1Relations";
6: import {
7:   type VerifyCorporateRelationshipInput,
8:   verifyCorporateRelationship,
9: } from "./edinet";
10: 
11: type VerificationResult = Awaited<
12:   ReturnType<typeof verifyCorporateRelationship>
13: >;
14: 
15: export type CompanyRelationsWriter = {
16:   upsertCompany(input: CompanyInput): Promise<{ id: number }>;
17:   upsertEdinetDocument(
18:     input: EdinetDocumentInput,
19:   ): Promise<{ documentId: string }>;
20:   upsertCompanyRelation(
21:     input: CompanyRelationInput,
22:   ): Promise<{ id: number }>;
23: };
24: 
25: export type RelationshipPersistenceResult =
26:   | { status: "not_configured" }
27:   | {
28:       status: "skipped";
29:       reason: "verification_not_confirmed" | "missing_filing_metadata";
30:     }
31:   | {
32:       status: "stored";
33:       parentCompanyId: number;
34:       childCompanyId: number | null;
35:       documentId: string;
36:       relationId: number;
37:     }
38:   | {
39:       status: "failed";
40:       error: {
41:         code: "database_error";
42:         message: string;
43:       };
44:     };
45: 
46: export type CorporateRelationshipVerifier = (
47:   input: VerifyCorporateRelationshipInput,
48:   apiKey?: string,
49: ) => Promise<VerificationResult>;
50: 
51: const EDINET_DISCLOSURE_URL =
52:   "https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx";
53: 
54: function parseUnambiguousPercentage(values: string[]): number | null {
55:   const percentages = [
56:     ...new Set(
57:       values
58:         .map((value) =>
59:           value
60:             .normalize("NFKC")
61:             .match(/(?:^|[^\d])(\d{1,3}(?:\.\d+)?)\s*%/u)?.[1],
62:         )
63:         .filter((value): value is string => value !== undefined)
64:         .map(Number)
65:         .filter((value) => Number.isFinite(value) && value <= 100),
66:     ),
67:   ];
68:   return percentages.length === 1 ? percentages[0]! : null;
69: }
70: 
71: function relationTypeFromEvidence(
72:   evidence: Array<{ snippet: string }>,
73: ): CompanyRelationInput["relationType"] {
74:   const text = evidence.map((item) => item.snippet).join(" ");
75:   return text.includes("関連会社") && !text.includes("子会社")
76:     ? "affiliate"
77:     : "subsidiary";
78: }
79: 
80: function consolidatedFromEvidence(
81:   evidence: Array<{ snippet: string }>,
82: ): boolean | null {
83:   return evidence.some((item) => item.snippet.includes("連結子会社"))
84:     ? true
85:     : null;
86: }
87: 
88: function sourceLocator(
89:   evidence: Array<{
90:     file: string;
91:     itemId: string | null;
92:     itemName: string | null;
93:   }>,
94: ): string | null {
95:   const value = evidence
96:     .map((item) =>
97:       [item.file, item.itemId, item.itemName].filter(Boolean).join("#"),
98:     )
99:     .filter(Boolean)
100:     .join(" | ");
101:   return value ? value.slice(0, 2_000) : null;
102: }
103: 
104: function documentReference(documentId: string): string {
105:   const url = new URL(EDINET_DISCLOSURE_URL);
106:   url.searchParams.set("docID", documentId);
107:   return url.toString();
108: }
109: 
110: async function persistConfirmedRelationship(
111:   verification: VerificationResult,
112:   writer: CompanyRelationsWriter,
113: ): Promise<RelationshipPersistenceResult> {
114:   if (
115:     verification.assessment.status !== "confirmed" ||
116:     !("parent" in verification) ||
117:     !("filing" in verification) ||
118:     !verification.parent ||
119:     !verification.filing
120:   ) {
121:     return { status: "skipped", reason: "verification_not_confirmed" };
122:   }
123: 
124:   const { parent, filing, query, retrievedAt, assessment } = verification;
125:   if (!filing.documentId || !filing.submittedAt) {
126:     return { status: "skipped", reason: "missing_filing_metadata" };
127:   }
128: 
129:   try {
130:     const parentCompany = await writer.upsertCompany({
131:       corporateNumber: parent.corporateNumber,
132:       edinetCode: parent.edinetCode,
133:       securitiesCode: parent.securitiesCode,
134:       name: parent.name,
135:       sourceUpdatedAt: filing.submittedAt,
136:     });
137:     const childCompany = query.targetCorporateNumber
138:       ? await writer.upsertCompany({
139:           corporateNumber: query.targetCorporateNumber,
140:           name: query.targetCompanyName,
141:           sourceUpdatedAt: filing.submittedAt,
142:         })
143:       : null;
144:     const document = await writer.upsertEdinetDocument({
145:       documentId: filing.documentId,
146:       filerCompanyId: parentCompany.id,
147:       filerName: filing.filerName ?? parent.name,
148:       filerCorporateNumber: parent.corporateNumber,
149:       filerEdinetCode: parent.edinetCode,
150:       documentTypeCode: "120",
151:       documentType: filing.description ?? "有価証券報告書",
152:       submittedAt: filing.submittedAt,
153:       periodStart: filing.periodStart,
154:       periodEnd: filing.periodEnd,
155:       sourceReference: documentReference(filing.documentId),
156:       fetchStatus: "parsed",
157:       fetchedAt: retrievedAt,
158:       parsedAt: retrievedAt,
159:     });
160:     const relation = await writer.upsertCompanyRelation({
161:       parentCompanyId: parentCompany.id,
162:       childCompanyId: childCompany?.id ?? null,
163:       parentName: parent.name,
164:       childName: query.targetCompanyName,
165:       relationType: relationTypeFromEvidence(assessment.evidence),
166:       ownershipPercent: parseUnambiguousPercentage(assessment.percentages),
167:       indirectOwnershipPercent: null,
168:       isConsolidated: consolidatedFromEvidence(assessment.evidence),
169:       asOfDate: filing.periodEnd,
170:       sourceDocumentId: document.documentId,
171:       sourceSection: "関係会社の状況",
172:       sourceLocator: sourceLocator(assessment.evidence),
173:       extractionMethod: "xbrl",
174:       verificationStatus: "verified",
175:     });
176:     return {
177:       status: "stored",
178:       parentCompanyId: parentCompany.id,
179:       childCompanyId: childCompany?.id ?? null,
180:       documentId: document.documentId,
181:       relationId: relation.id,
182:     };
183:   } catch {
184:     return {
185:       status: "failed",
186:       error: {
187:         code: "database_error",
188:         message:
189:           "EDINETの検証は完了しましたが、企業関係データベースへ保存できませんでした。",
190:       },
191:     };
192:   }
193: }
194: 
195: export async function verifyAndStoreCorporateRelationship(
196:   input: VerifyCorporateRelationshipInput,
197:   apiKey: string | undefined,
198:   writer: CompanyRelationsWriter | null,
199:   verifier: CorporateRelationshipVerifier = verifyCorporateRelationship,
200: ) {
201:   const verification = await verifier(input, apiKey);
202:   const persistence = writer
203:     ? await persistConfirmedRelationship(verification, writer)
204:     : ({ status: "not_configured" } as const);
205:   return { ...verification, persistence };
206: }