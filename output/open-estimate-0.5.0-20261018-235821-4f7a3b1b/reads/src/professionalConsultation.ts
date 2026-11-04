1: import { RESPONSE_GUIDANCE } from "./responseGuidance";
2: 
3: export type ConsultationTopic =
4:   | "location"
5:   | "industry"
6:   | "employee_count"
7:   | "capital_yen"
8:   | "business_plans"
9:   | "official_guidelines"
10:   | "acceptance_period"
11:   | "corporate_relationship"
12:   | "officer_overlap"
13:   | "indirect_control"
14:   | "high_income_rule"
15:   | "conditional_requirement"
16:   | "program_rule"
17:   | "research_and_development_costs"
18:   | "partnership_structure";
19: 
20: type ConsultationIssue = {
21:   topic: ConsultationTopic;
22:   summary: string;
23: };
24: 
25: export type ProfessionalConsultationBriefInput = {
26:   companyName?: string;
27:   publicBusinessSummary?: string;
28:   subsidyName?: string;
29:   sourceUrl?: string;
30:   confirmedFacts?: string[];
31:   issues: ConsultationIssue[];
32:   applicationDeadline?: string | null;
33:   consultBy?: string | null;
34: };
35: 
36: const TOPIC_GUIDANCE: Record<
37:   ConsultationTopic,
38:   { question: string; documents: string[]; specialists: string[] }
39: > = {
40:   location: {
41:     question: "本店所在地または事業実施場所は、この制度の対象地域に含まれますか。",
42:     documents: ["登記事項証明書または所在地を確認できる資料", "事業実施場所の資料"],
43:     specialists: ["実施機関の相談窓口"],
44:   },
45:   industry: {
46:     question: "当社の主たる事業と今回の事業は、制度上の対象業種に該当しますか。",
47:     documents: ["会社案内または事業概要", "今回実施する事業の概要"],
48:     specialists: ["中小企業診断士など補助金支援の専門家", "実施機関の相談窓口"],
49:   },
50:   employee_count: {
51:     question: "この制度で使用する従業員数の定義と基準日は、当社の集計方法で正しいですか。",
52:     documents: ["従業員数の集計表", "必要に応じて労働者名簿・賃金台帳"],
53:     specialists: ["社会保険労務士", "実施機関の相談窓口"],
54:   },
55:   capital_yen: {
56:     question: "資本金と資本関係を踏まえ、この制度の企業規模要件を満たしますか。",
57:     documents: ["直近の決算書", "株主名簿または法人税申告書別表二"],
58:     specialists: ["税理士または公認会計士", "実施機関の相談窓口"],
59:   },
60:   business_plans: {
61:     question: "計画している事業・支出は、制度上の対象事業および対象経費に含まれますか。",
62:     documents: ["事業計画の概要", "見積書・費用内訳", "実施スケジュール"],
63:     specialists: ["中小企業診断士など補助金支援の専門家", "実施機関の相談窓口"],
64:   },
65:   official_guidelines: {
66:     question: "最新の公募要領・交付要綱・FAQを前提に、ほかに満たすべき申請条件はありますか。",
67:     documents: ["最新の公募要領・交付要綱・FAQ"],
68:     specialists: ["実施機関の相談窓口"],
69:   },
70:   acceptance_period: {
71:     question: "申請期限と、専門家への相談・社内決裁・必要書類取得の期限をどう設定すべきですか。",
72:     documents: ["公募日程", "社内決裁と書類準備の予定表"],
73:     specialists: ["中小企業診断士など補助金支援の専門家", "実施機関の相談窓口"],
74:   },
75:   corporate_relationship: {
76:     question: "現在の株主構成と関係会社の状況は、みなし大企業または持分法適用会社の除外要件に該当しますか。",
77:     documents: ["最新の株主名簿", "法人税申告書別表二", "資本関係図"],
78:     specialists: ["税理士または公認会計士", "実施機関の相談窓口"],
79:   },
80:   officer_overlap: {
81:     question: "大企業の役員・職員との兼務状況は、制度上のみなし大企業要件に該当しますか。",
82:     documents: ["役員名簿", "兼務状況を確認できる社内資料"],
83:     specialists: ["社会保険労務士など顧問専門家", "実施機関の相談窓口"],
84:   },
85:   indirect_control: {
86:     question: "直接保有だけでなく間接保有を含めた場合、大企業による支配要件に該当しますか。",
87:     documents: ["株主名簿", "グループ全体の資本関係図"],
88:     specialists: ["税理士または公認会計士", "実施機関の相談窓口"],
89:   },
90:   high_income_rule: {
91:     question: "直近年度の課税所得等は、この制度固有の除外基準に該当しますか。",
92:     documents: ["直近の法人税申告書と決算書"],
93:     specialists: ["税理士または公認会計士", "実施機関の相談窓口"],
94:   },
95:   conditional_requirement: {
96:     question: "条件付きで申請できる場合の追加要件を、当社は満たしていますか。",
97:     documents: ["追加要件への対応状況が分かる資料"],
98:     specialists: ["中小企業診断士など補助金支援の専門家", "実施機関の相談窓口"],
99:   },
100:   program_rule: {
101:     question: "この制度では、みなし大企業や大企業の関係会社をどのように扱いますか。",
102:     documents: ["最新の公募要領・交付要綱・FAQ"],
103:     specialists: ["実施機関の相談窓口"],
104:   },
105:   research_and_development_costs: {
106:     question: "人件費、外注費、試作費、ソフトウェア開発費などのうち、制度上の研究開発費へ算入できる費用はどれですか。また、対象期間と売上高の計算方法は正しいですか。",
107:     documents: [
108:       "直近の決算書",
109:       "研究開発に関係する費用の内訳",
110:       "開発担当者と開発期間が分かる資料",
111:       "外注契約書・請求書・試作や実証の支出資料",
112:     ],
113:     specialists: ["税理士または公認会計士", "実施機関の相談窓口"],
114:   },
115:   partnership_structure: {
116:     question: "制度上必須となる連携先の役割、代表申請者、契約・合意書の要件を現在の協力体制で満たせますか。特定の候補企業以外でも代替できますか。",
117:     documents: ["連携体制図", "役割分担案", "基本合意書・共同研究契約などの案"],
118:     specialists: ["中小企業診断士など補助金支援の専門家", "実施機関の相談窓口"],
119:   },
120: };
121: 
122: function unique(values: string[]) {
123:   return [...new Set(values.filter(Boolean))];
124: }
125: 
126: export function createProfessionalConsultationBrief(
127:   input: ProfessionalConsultationBriefInput,
128: ) {
129:   const guidance = input.issues.map((issue) => TOPIC_GUIDANCE[issue.topic]);
130:   const specialists = input.issues.length
131:     ? unique([
132:         "社会保険労務士など、継続的に相談している専門家（一次相談窓口）",
133:         ...guidance.flatMap((item) => item.specialists),
134:       ])
135:     : [];
136:   const questions = unique(guidance.map((item) => item.question));
137:   const documents = unique(guidance.flatMap((item) => item.documents));
138:   const facts = unique(input.confirmedFacts ?? []);
139:   const readyToSendMessage = input.issues.length ? {
140:     subject: `${input.subsidyName ?? "補助金候補"}の初期相談について`,
141:     body: [
142:       "お世話になっております。",
143:       `${input.companyName ? `${input.companyName}について、` : ""}${input.subsidyName ? `「${input.subsidyName}」を` : "補助金の活用を"}候補として検討しています。申請資格や採択が確定した段階ではなく、まず初期相談をお願いしたいと考えています。`,
144:       input.publicBusinessSummary ? `事業の概要：${input.publicBusinessSummary}` : null,
145:       input.sourceUrl ? `参照資料：${input.sourceUrl}` : null,
146:       facts.length ? `調査で確認できた事項：\n${facts.map((fact) => `・${fact}`).join("\n")}` : null,
147:       `確認したい事項：\n${input.issues.map((issue) => `・${issue.summary}\n  ${TOPIC_GUIDANCE[issue.topic].question}`).join("\n")}`,
148:       input.applicationDeadline ? `把握している申請締切：${input.applicationDeadline}（対象の公募回と最新日程もご確認ください）` : "申請締切は未確認です。現在の受付状況と準備が間に合うかも確認したいです。",
149:       input.consultBy ? `相談希望期限：${input.consultBy}` : null,
150:       `準備資料の候補：\n${documents.map((document) => `・${document}`).join("\n")}\n必要な資料と共有方法をご指定ください。非公開資料は、共有先・方法を確認したうえで別途お渡しします。`,
151:       "ご対応可能でしょうか。ご専門外の論点は、対応できる専門家や実施機関の窓口をご紹介いただけると助かります。初期相談の費用と進め方もお知らせください。",
152:     ].filter(Boolean).join("\n\n"),
153:   } : null;
154:   return {
155:     recommended: input.issues.length > 0,
156:     responseGuidance: RESPONSE_GUIDANCE,
157:     statusLabel: input.issues.length
158:       ? "専門家へ相談する論点を整理しました"
159:       : "現時点で個別の相談論点はありません",
160:     purpose:
161:       "AIの調査結果をもとに、人間の専門家が申請資格と対応方針を判断するための引き継ぎメモです。",
162:     subsidyName: input.subsidyName ?? null,
163:     sourceUrl: input.sourceUrl ?? null,
164:     confirmedFacts: facts,
165:     consultationPoints: input.issues.map((issue) => issue.summary),
166:     recommendedProfessionals: specialists,
167:     questions,
168:     documentsToPrepare: documents,
169:     readyToSendMessage,
170:     nextAction: readyToSendMessage
171:       ? "以下の相談文を確認し、顧問社労士など普段の相談先へコピーして送ってください。"
172:       : null,
173:     presentationGuidance: readyToSendMessage
174:       ? "利用者が候補の検討・専門家への相談に進む場合は、nextActionとreadyToSendMessageをコピーできる相談文として提示してください。『専門家へ相談してください』だけに要約せず、制度名・参照URL・確認事項を引き継いでください。候補探索中は長い相談文を毎回表示する必要はありません。自動送信はしません。"
175:       : null,
176:     applicationDeadline: input.applicationDeadline ?? null,
177:     consultBy: input.consultBy ?? null,
178:     schedulingGuidance:
179:       input.consultBy
180:         ? "表示された相談期限までに、確認事項と準備資料を専門家へ共有してください。"
181:         : "専門家への相談期限は未設定です。申請締切、社内決裁、資料取得に必要な期間から逆算して決めてください。",
182:     decisionBoundary:
183:       "このメモは検討材料です。申請可否、費用区分、提出内容の最終判断と責任は、申請者と担当する人間の専門家が負います。",
184:     dataHandling:
185:       "株主名簿、決算書、賃金台帳などの非公開資料は、このMCPやD1へ保存せず、利用者から専門家へ直接共有してください。",
186:   };
187: }