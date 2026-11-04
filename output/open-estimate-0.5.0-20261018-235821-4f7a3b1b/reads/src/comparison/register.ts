1: import type { McpServer } from "@modelcontextprotocol/server";
2: import { buildComparison, comparisonInputSchema, comparisonOutputSchema } from "./data";
3: import { COMPARISON_MIME, COMPARISON_URI, comparisonHtml } from "../ui/comparison";
4: 
5: export function registerComparison(server: McpServer) {
6:   server.registerResource("subsidy-comparison", COMPARISON_URI, { mimeType: COMPARISON_MIME }, async () => ({
7:     contents: [{ uri: COMPARISON_URI, mimeType: COMPARISON_MIME, text: comparisonHtml,
8:       _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }],
9:   }));
10:   server.registerTool("render_subsidy_comparison", {
11:     title: "補助金候補を比較する",
12:     description: "利用者が候補の比較を依頼した場合に使う表示専用ツール。先にsearch_subsidies/get_subsidy_detail、必要に応じevaluate_subsidy_fit/get_official_selection_statisticsで情報を取得し、1〜5制度の比較行を渡してください。採択率は過去の同一公募回の公式件数から得た割合だけを使い、企業別確率・適合度スコアや今回の見通しを入れないでください。確認済みの各項目に出典を付け、未確認・実績未登録・取得失敗はstatusで区別しvalue/labelをnullにします。期限に時刻が不明なら推測せずunconfirmedにしてnoteへ公式表記を残してください。デモは明示要求された検証用架空データだけに使います。情報の再取得、保存、外部送信はしません。",
13:     inputSchema: comparisonInputSchema,
14:     outputSchema: comparisonOutputSchema,
15:     annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
16:     _meta: { ui: { resourceUri: COMPARISON_URI }, "openai/outputTemplate": COMPARISON_URI },
17:   }, async input => {
18:     const result = buildComparison(input);
19:     return { structuredContent: result.data, content: [{ type: "text" as const, text: result.table }] };
20:   });
21: }