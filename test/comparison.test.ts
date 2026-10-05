import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../src/index";
import { buildComparison, comparisonInputSchema } from "../src/comparison/data";
import { COMPARISON_URI, COMPARISON_MIME } from "../src/ui/comparison";
import { comparisonFixture } from "./fixtures/comparison";

test("比較データは過去実績・欠損・取得失敗をテキスト表にも維持する", () => {
  const { data, table } = buildComparison(comparisonFixture());
  assert.equal(data.schemaVersion, "1.0");
  assert.match(table, /【デモデータ】/);
  assert.match(table, /40%（2025年度・第2回（架空））/);
  assert.match(table, /実績未登録/); assert.match(table, /取得失敗/); assert.match(table, /未確認/);
  assert.match(table, /申請1000件／採択400件/);
  assert.match(table, /https:\/\/www.chusho.meti.go.jp/);
  assert.match(table, /個別企業の採択確率ではありません/);
});

test("採択率の不整合、欠損の数値化、出典欠落、危険なURLを拒否する", () => {
  const mutations = [
    (d: ReturnType<typeof comparisonFixture>) => { d.rows[0].pastRate.value = 85; },
    (d: ReturnType<typeof comparisonFixture>) => { d.rows[0].pastRate.selected = 1001; },
    (d: ReturnType<typeof comparisonFixture>) => { d.rows[0].pastRate.round = null; },
    (d: ReturnType<typeof comparisonFixture>) => { d.rows[2].pastRate.value = 0; },
    (d: ReturnType<typeof comparisonFixture>) => { d.rows[2].maximumGrant.label = "100万円"; },
    (d: ReturnType<typeof comparisonFixture>) => { d.demo = false; d.rows[0].maximumGrant.sources = []; },
    (d: ReturnType<typeof comparisonFixture>) => { d.rows[0].pastRate.sources = [{ title: "不正", url: "javascript:alert(1)" }]; },
    (d: ReturnType<typeof comparisonFixture>) => { d.demo = false; d.rows[0].pastRate.sources = [{ title: "民間の推測", url: "https://example.com/rate" }]; },
    (d: ReturnType<typeof comparisonFixture>) => { d.rows[0].deadline.value = "2026-12-18"; },
    (d: ReturnType<typeof comparisonFixture>) => { d.rows.push(d.rows[0]); },
  ];
  for (const mutate of mutations) { const data = comparisonFixture(); mutate(data); assert.equal(comparisonInputSchema.safeParse(data).success, false); }
  const empty = comparisonFixture(); empty.rows = []; assert.equal(comparisonInputSchema.safeParse(empty).success, false);
  const tooMany = comparisonFixture(); tooMany.rows = Array.from({ length: 6 }, (_, i) => ({ ...tooMany.rows[0], subsidyId: `id${i}` })); assert.equal(comparisonInputSchema.safeParse(tooMany).success, false);
});

test("MCP経由でUIメタデータ・リソース取得・構造化出力・入力検証が動く", async () => {
  const server = createServer({ SUBSIDY_COMPARISON_ENABLED: "true" });
  const client = new Client({ name: "comparison-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 16);
    const tool = tools.find(t => t.name === "render_subsidy_comparison")!;
    assert.deepEqual(tool._meta?.ui, { resourceUri: COMPARISON_URI });
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true });
    const { resources } = await client.listResources(); assert.ok(resources.some(r => r.uri === COMPARISON_URI));
    const resource = await client.readResource({ uri: COMPARISON_URI });
    assert.equal(resource.contents[0].mimeType, COMPARISON_MIME);
    assert.match(String(resource.contents[0].text), /ui\/initialize/);
    const result = await client.callTool({ name: tool.name, arguments: comparisonFixture() });
    assert.ok(!result.isError); assert.equal(result.structuredContent?.schemaVersion, "1.0");
    assert.match(JSON.stringify(result.content), /デモデータ/);
    const bad = comparisonFixture(); bad.rows[0].pastRate.value = 90;
    const rejected = await client.callTool({ name: tool.name, arguments: bad }); assert.equal(rejected.isError, true);
  } finally { await client.close(); await server.close(); }
});

test("比較UIは無効時に一覧・呼出し・リソースから非公開になり、資料ナビと独立して有効化できる", async () => {
  for (const flag of [undefined, "false", "invalid", "true"]) {
    const server = createServer({ SUBSIDY_COMPARISON_ENABLED: flag, OFFICIAL_DOCUMENTS_ENABLED: "true" });
    const client = new Client({ name: "comparison-flags", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st); await client.connect(ct);
    try {
      const { tools } = await client.listTools(); assert.equal(tools.length, flag === "true" ? 17 : 16);
      if (flag !== "true") {
        await assert.rejects(() => client.callTool({ name: "render_subsidy_comparison", arguments: comparisonFixture() }), /not found/);
        await assert.rejects(() => client.readResource({ uri: COMPARISON_URI }));
      }
    } finally { await client.close(); await server.close(); }
  }
});
