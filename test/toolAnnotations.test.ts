import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../src/index";

const submission = JSON.parse(readFileSync(new URL("../chatgpt-app-submission.json", import.meta.url), "utf8"));
// Independent review inventory: read-only, destructive, open-world, idempotent.
const expected: Record<string, boolean[]> = {
  search_corporate_identities: [true, false, true, true],
  get_corporate_identity: [true, false, true, true],
  search_companies: [true, false, true, true],
  get_company_profile: [true, false, true, true],
  get_company_activities: [true, false, true, true],
  search_subsidies: [false, false, true, false],
  get_subsidy_detail: [false, false, true, false],
  evaluate_subsidy_fit: [false, false, true, false],
  evaluate_subsidy_fit_for_company: [false, false, true, false],
  verify_corporate_relationship: [false, true, true, false],
  record_official_selection_statistics: [false, true, true, false],
  get_official_selection_statistics: [true, false, false, true],
  estimate_program_selection_outlook: [false, true, false, false],
  assess_deemed_large_enterprise_eligibility: [true, false, false, true],
  prepare_professional_consultation: [true, false, false, true],
};
const keys = ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"] as const;

test("実際のMCP tools/listの全15ツール・4注釈が審査用定義と一致する", async () => {
  const server = createServer({});
  const client = new Client({ name: "review-contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), Object.keys(expected).sort());
    assert.deepEqual(Object.keys(submission.tools).sort(), Object.keys(expected).sort());
    for (const tool of tools) {
      const annotations = tool.annotations!;
      keys.forEach((key, i) => {
        assert.equal(typeof annotations[key], "boolean", `${tool.name}.${key}`);
        assert.equal(annotations[key], expected[tool.name][i], `${tool.name}.${key}`);
      });
      assert.deepEqual(annotations, submission.tools[tool.name].annotations, tool.name);
      for (const field of ["read_only_justification", "destructive_justification", "open_world_justification", "idempotent_justification"]) {
        assert.ok(submission.tools[tool.name].justifications[field]?.length > 40, `${tool.name}.${field}`);
      }
    }
    for (const item of [...submission.test_cases, ...submission.negative_test_cases]) {
      for (const name of item.tools_triggered?.split(/,\s*/) ?? []) assert.ok(expected[name], name);
    }
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(client.getServerVersion()?.version, packageJson.version);
  } finally {
    await client.close();
    await server.close();
  }
});

test("国税庁ツールはMCP経由でも不正入力を拒否し、未設定時は設定エラーを返す", async () => {
  const server = createServer({});
  const client = new Client({ name: "nta-contract-test", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  try {
    const invalid = await client.callTool({ name: "get_corporate_identity", arguments: { corporate_number: "123" } });
    assert.equal(invalid.isError, true);
    const missing = await client.callTool({ name: "get_corporate_identity", arguments: { corporate_number: "1180301018771" } });
    assert.equal(missing.isError, true);
    assert.match(JSON.stringify(missing.content), /configuration_error/);
  } finally {
    await client.close();
    await server.close();
  }
});
