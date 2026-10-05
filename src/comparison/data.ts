import { z } from "zod";
import { isOfficialResearchHostname } from "../selectionStatistics";

const text = z.string().trim().min(1).max(2000);
const source = z.object({
  title: text,
  url: z.url().refine(value => { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; }, "出典は認証情報を含まないHTTPS URLで指定してください"),
}).strict();
const status = z.enum(["available", "unconfirmed", "not_registered", "fetch_failed"]);
const baseCell = { status, note: text.nullable(), sources: z.array(source).max(10) };
const amount = z.object({ ...baseCell, value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), label: text.nullable() }).strict();
const rate = z.object({
  ...baseCell,
  value: z.number().min(0).max(100).nullable(),
  round: text.nullable(),
  applications: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  selected: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict();
const labelCell = z.object({ ...baseCell, label: text.nullable() }).strict();
const deadline = z.object({ ...baseCell, value: z.iso.datetime({ offset: true }).nullable(), label: text.nullable() }).strict();

export const comparisonInputSchema = z.object({
  title: z.string().trim().min(1).max(100).default("補助金候補比較"),
  demo: z.boolean().default(false),
  rows: z.array(z.object({
    subsidyId: z.string().trim().min(1).max(18).regex(/^[A-Za-z0-9]+$/),
    name: z.string().trim().min(1).max(200),
    round: z.string().trim().min(1).max(200),
    pastRate: rate,
    maximumGrant: amount,
    grantRate: labelCell,
    fit: labelCell,
    deadline,
    details: z.array(text).max(20),
  }).strict()).min(1).max(5),
}).strict().superRefine((input, ctx) => {
  const ids = new Set<string>();
  input.rows.forEach((row, i) => {
    const key = `${row.subsidyId}:${row.round}`;
    if (ids.has(key)) ctx.addIssue({ code: "custom", path: ["rows", i], message: "同一制度・公募回が重複しています" });
    ids.add(key);
    for (const field of ["pastRate", "maximumGrant", "grantRate", "fit", "deadline"] as const) {
      const cell = row[field];
      const value = "value" in cell ? cell.value : cell.label;
      if (cell.status === "available") {
        if (value === null || (!input.demo && cell.sources.length === 0)) {
          ctx.addIssue({ code: "custom", path: ["rows", i, field], message: "確認済みの値と出典が必要です" });
        }
      } else if (value !== null || ("label" in cell && cell.label !== null)) {
        ctx.addIssue({ code: "custom", path: ["rows", i, field], message: "未確認・未登録・取得失敗の値はnullにしてください" });
      }
    }
    const r = row.pastRate;
    if (r.status === "available") {
      if (!input.demo && !r.sources.every(s => isOfficialResearchHostname(new URL(s.url).hostname))) {
        ctx.addIssue({ code: "custom", path: ["rows", i, "pastRate", "sources"], message: "公式採択率は既存の公式採択実績ツールが扱う公的機関ドメインの出典を指定してください" });
      }
      if (r.round === null || r.applications === null || r.selected === null || r.selected > r.applications || r.value === null || Math.abs(r.value - Math.round(r.selected / r.applications * 10000) / 100) > 0.011) {
        ctx.addIssue({ code: "custom", path: ["rows", i, "pastRate"], message: "同一公募回の申請件数・採択件数と採択率が一致していません" });
      }
    } else if (r.applications !== null || r.selected !== null) {
      ctx.addIssue({ code: "custom", path: ["rows", i, "pastRate"], message: "実績未確認時の件数はnullにしてください" });
    }
  });
});

export type ComparisonInput = z.infer<typeof comparisonInputSchema>;
export const comparisonOutputSchema = comparisonInputSchema.safeExtend({ schemaVersion: z.literal("1.0"), notice: text });
export const statusLabels = { available: "確認済み", unconfirmed: "未確認", not_registered: "実績未登録", fetch_failed: "取得失敗" } as const;
export const comparisonNotice = "過去の公式採択率は制度全体の実績であり、個別企業の採択確率ではありません。企業条件との照合は申請資格・採択の保証ではありません。";

export function formatCell(row: ComparisonInput["rows"][number], field: "pastRate" | "maximumGrant" | "grantRate" | "fit" | "deadline"): string {
  const c = row[field];
  if (c.status !== "available") return statusLabels[c.status];
  if (field === "pastRate") return `${row.pastRate.value}%（${row.pastRate.round}）`;
  if (field === "maximumGrant") return `${row.maximumGrant.value!.toLocaleString("ja-JP")}円${row.maximumGrant.label ? `（${row.maximumGrant.label}）` : ""}`;
  if (field === "deadline") return `${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(row.deadline.value!))}（日本時間）${row.deadline.label ? ` ${row.deadline.label}` : ""}`;
  return (c as z.infer<typeof labelCell>).label!;
}

export function buildComparison(input: unknown) {
  const data = comparisonInputSchema.parse(input);
  const escape = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  const table = [
    `${data.demo ? "【デモデータ】" : ""}${data.title}`,
    "",
    "| 制度・公募回 | 過去の公式採択率 | 補助上限 | 補助率 | 企業条件との照合 | 締切 |",
    "|---|---|---|---|---|---|",
    ...data.rows.map(row => `| ${[`${row.name}（${row.round}）`, ...(["pastRate", "maximumGrant", "grantRate", "fit", "deadline"] as const).map(f => formatCell(row, f))].map(escape).join(" | ")} |`),
    "", comparisonNotice,
    ...data.rows.flatMap(row => [
      "", `${escape(row.name)}（${escape(row.round)}）の詳細：`,
      ...row.details.map(d => `- ${escape(d)}`),
      ...(["pastRate", "maximumGrant", "grantRate", "fit", "deadline"] as const).flatMap(field => {
        const c = row[field];
        return [
          ...(field === "pastRate" && row.pastRate.status === "available" ? [`- 採択実績：${row.pastRate.round}、申請${row.pastRate.applications}件／採択${row.pastRate.selected}件`] : []),
          ...(c.note ? [`- ${escape(c.note)}`] : []),
          ...c.sources.map(s => `- 出典：${escape(s.title)} ${s.url}`),
        ];
      }),
    ]),
  ].join("\n");
  return { data: { schemaVersion: "1.0", ...data, notice: comparisonNotice }, table };
}
