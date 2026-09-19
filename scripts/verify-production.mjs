import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

// Reads metadata by default. --smoke also calls public lookups, a consultation
// calculation and subsidy lookups (which may refresh disposable caches).
// Never invokes evidence/estimate upserts against production.
const endpoint = new URL(process.env.MCP_VERIFY_URL ?? 'https://subsidy.ai-orchestration.jp/mcp');
const submission = JSON.parse(fs.readFileSync(new URL('../chatgpt-app-submission.json', import.meta.url), 'utf8'));
const client = new Client({ name: 'subsidy-review-verification', version: '1.0.0' });
const report = { checkedAt: new Date().toISOString(), endpoint: endpoint.href, checks: [] };
await client.connect(new StreamableHTTPClientTransport(endpoint));
try {
  report.server = client.getServerVersion();
  const { tools } = await client.listTools();
  report.tools = tools.map(({name,annotations})=>({name,annotations}));
  if (!process.argv.includes('--snapshot')) {
    assert.deepEqual(tools.map(t=>t.name).sort(), Object.keys(submission.tools).sort());
    for(const tool of tools) assert.deepEqual(tool.annotations,submission.tools[tool.name].annotations,tool.name);
    report.checks.push({name:'tools/list matches submission',ok:true});
  }
  if(process.argv.includes('--smoke')) {
    async function call(name,args,validate) {
      const result=await client.callTool({name,arguments:args},undefined,{timeout:60000});
      const content=result.content.find(x=>x.type==='text')?.text;
      let value;
      try { value=JSON.parse(content); } catch { value={}; }
      if(result.isError) {
        report.checks.push({name,ok:false,error:value.error?.code ?? 'tool_error',message:value.error?.message ?? 'MCP call failed'});
        return null;
      }
      try { validate(value); report.checks.push({name,ok:true}); }
      catch(e) { report.checks.push({name,ok:false,error:'unexpected_response',message:e.message}); }
      return value;
    }
    const identity=await call('get_corporate_identity',{corporate_number:'1180301018771'},v=>{
      assert.equal(v.corporation.corporateNumber,'1180301018771');
      assert.match(v.corporation.name,/トヨタ/);
      assert.match(v.notice,/国税庁/);
    });
    if (identity?.corporation) report.nta={name:identity.corporation.name,location:identity.corporation.location,notice:identity.notice};
    await call('search_corporate_identities',{name:'トヨタ自動車株式会社'},v=>assert.ok(v.corporations.some(c=>c.corporateNumber==='1180301018771')));
    await call('get_company_profile',{corporate_number:'1180301018771'},v=>assert.ok(JSON.stringify(v).includes('1180301018771')));
    const result=await call('search_subsidies',{keyword:'省エネ',limit:3},v=>{
      assert.ok(v.searchGuidance); assert.ok(v.responseGuidance);
    });
    if (result) report.subsidySearchKeys=Object.keys(result);
    await call('prepare_professional_consultation',{issues:[{topic:'official_guidelines',summary:'最新の公募要領を実施機関に確認したい'}]},v=>{
      assert.equal(v.recommended,true); assert.ok(v.readyToSendMessage); assert.ok(v.responseGuidance);
    });
    await call('get_official_selection_statistics',{jgrants_subsidy_id:'a0WJ200000CDdtlMAD'},v=>assert.ok(Array.isArray(v.statistics)));
  }
  if(process.env.MCP_VERIFY_REPORT) fs.writeFileSync(process.env.MCP_VERIFY_REPORT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if (report.checks.some(c=>!c.ok)) process.exitCode=1;
} finally {
  await client.close();
}
