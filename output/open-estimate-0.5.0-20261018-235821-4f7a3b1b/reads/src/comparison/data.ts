1: import { z } from "zod";
2: import { isOfficialResearchHostname } from "../selectionStatistics";
3: 
4: const text = z.string().trim().min(1).max(2000);
5: const source = z.object({
6:   title: text,
7:   url: z.url().refine(value => { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; }, "出典は認証情報を含まないHTTPS URLで指定してください"),
8: }).strict();
9: const status = z.enum(["available", "unconfirmed", "not_registered", "fetch_failed"]);
10: const baseCell = { status, note: text.nullable(), sources: z.array(source).max(10) };
11: const amount = z.object({ ...baseCell, value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), label: text.nullable() }).strict();
12: const rate = z.object({
13:   ...baseCell,
14:   value: z.number().min(0).max(100).nullable(),
15:   round: text.nullable(),
16:   applications: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
17:   selected: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
18: }).strict();
19: const labelCell = z.object({ ...baseCell, label: text.nullable() }).strict();
20: const deadline = z.object({ ...baseCell, value: z.iso.datetime({ offset: true }).nullable(), label: text.nullable() }).strict();
21: 
22: export const comparisonInputSchema = z.object({
23:   title: z.string().trim().min(1).max(100).default("補助金候補比較"),
24:   demo: z.boolean().default(false),
25:   rows: z.array(z.object({
26:     subsidyId: z.string().trim().min(1).max(18).regex(/^[A-Za-z0-9]+$/),
27:     name: z.string().trim().min(1).max(200),
28:     round: z.string().trim().min(1).max(200),
29:     pastRate: rate,
30:     maximumGrant: amount,
31:     grantRate: labelCell,
32:     fit: labelCell,
33:     deadline,
34:     details: z.array(text).max(20),
35:   }).strict()).min(1).max(5),
36: }).strict().superRefine((input, ctx) => {
37:   const ids = new Set<string>();
38:   input.rows.forEach((row, i) => {
39:     const key = `${row.subsidyId}:${row.round}`;
40:     if (ids.has(key)) ctx.addIssue({ code: "custom", path: ["rows", i], message: "同一制度・公募回が重複しています" });
41:     ids.add(key);
42:     for (const field of ["pastRate", "maximumGrant", "grantRate", "fit", "deadline"] as const) {
43:       const cell = row[field];
44:       const value = "value" in cell ? cell.value : cell.label;
45:       if (cell.status === "available") {
46:         if (value === null || (!input.demo && cell.sources.length === 0)) {
47:           ctx.addIssue({ code: "custom", path: ["rows", i, field], message: "確認済みの値と出典が必要です" });
48:         }
49:       } else if (value !== null || ("label" in cell && cell.label !== null)) {
50:         ctx.addIssue({ code: "custom", path: ["rows", i, field], message: "未確認・未登録・取得失敗の値はnullにしてください" });
51:       }
52:     }
53:     const r = row.pastRate;
54:     if (r.status === "available") {
55:       if (!input.demo && !r.sources.every(s => isOfficialResearchHostname(new URL(s.url).hostname))) {
56:         ctx.addIssue({ code: "custom", path: ["rows", i, "pastRate", "sources"], message: "公式採択率は既存の公式採択実績ツールが扱う公的機関ドメインの出典を指定してください" });
57:       }
58:       if (r.round === null || r.applications === null || r.selected === null || r.selected > r.applications || r.value === null || Math.abs(r.value - Math.round(r.selected / r.applications * 10000) / 100) > 0.011) {
59:         ctx.addIssue({ code: "custom", path: ["rows", i, "pastRate"], message: "同一公募回の申請件数・採択件数と採択率が一致していません" });
60:       }
61:     } else if (r.applications !== null || r.selected !== null) {
62:       ctx.addIssue({ code: "custom", path: ["rows", i, "pastRate"], message: "実績未確認時の件数はnullにしてください" });
63:     }
64:   });
65: });
66: 
67: export type ComparisonInput = z.infer<typeof comparisonInputSchema>;
68: export const comparisonOutputSchema = comparisonInputSchema.safeExtend({ schemaVersion: z.literal("1.0"), notice: text });
69: export const statusLabels = { available: "確認済み", unconfirmed: "未確認", not_registered: "実績未登録", fetch_failed: "取得失敗" } as const;
70: export const comparisonNotice = "過去の公式採択率は制度全体の実績であり、個別企業の採択確率ではありません。企業条件との照合は申請資格・採択の保証ではありません。";
71: 
72: export function formatCell(row: ComparisonInput["rows"][number], field: "pastRate" | "maximumGrant" | "grantRate" | "fit" | "deadline"): string {
73:   const c = row[field];
74:   if (c.status !== "available") return statusLabels[c.status];
75:   if (field === "pastRate") return `${row.pastRate.value}%（${row.pastRate.round}）`;
76:   if (field === "maximumGrant") return `${row.maximumGrant.value!.toLocaleString("ja-JP")}円${row.maximumGrant.label ? `（${row.maximumGrant.label}）` : ""}`;
77:   if (field === "deadline") return `${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(row.deadline.value!))}（日本時間）${row.deadline.label ? ` ${row.deadline.label}` : ""}`;
78:   return (c as z.infer<typeof labelCell>).label!;
79: }
80: 
81: export function buildComparison(input: unknown) {
82:   const data = comparisonInputSchema.parse(input);
83:   const escape = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
84:   const table = [
85:     `${data.demo ? "【デモデータ】" : ""}${data.title}`,
86:     "",
87:     "| 制度・公募回 | 過去の公式採択率 | 補助上限 | 補助率 | 企業条件との照合 | 締切 |",
88:     "|---|---|---|---|---|---|",
89:     ...data.rows.map(row => `| ${[`${row.name}（${row.round}）`, ...(["pastRate", "maximumGrant", "grantRate", "fit", "deadline"] as const).map(f => formatCell(row, f))].map(escape).join(" | ")} |`),
90:     "", comparisonNotice,
91:     ...data.rows.flatMap(row => [
92:       "", `${escape(row.name)}（${escape(row.round)}）の詳細：`,
93:       ...row.details.map(d => `- ${escape(d)}`),
94:       ...(["pastRate", "maximumGrant", "grantRate", "fit", "deadline"] as const).flatMap(field => {
95:         const c = row[field];
96:         return [
97:           ...(field === "pastRate" && row.pastRate.status === "available" ? [`- 採択実績：${row.pastRate.round}、申請${row.pastRate.applications}件／採択${row.pastRate.selected}件`] : []),
98:           ...(c.note ? [`- ${escape(c.note)}`] : []),
99:           ...c.sources.map(s => `- 出典：${escape(s.title)} ${s.url}`),
100:         ];
101:       }),
102:     ]),
103:   ].join("\n");
104:   return { data: { schemaVersion: "1.0", ...data, notice: comparisonNotice }, table };
105: }