1: import assert from 'node:assert/strict';
2: import fs from 'node:fs';
3: import { setDefaultResultOrder } from 'node:dns';
4: import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
5: 
6: // Reads metadata by default. --smoke also calls public lookups, a consultation
7: // calculation and subsidy lookups (which may refresh disposable caches).
8: // Never invokes evidence/estimate upserts against production.
9: const endpoint = new URL(process.env.MCP_VERIFY_URL ?? 'https://subsidy.ai-orchestration.jp/mcp');
10: if (process.argv.includes('--ipv4-first')) setDefaultResultOrder('ipv4first');
11: const documentsEnabled = process.argv.includes('--documents-enabled');
12: const comparisonEnabled = process.argv.includes('--comparison-enabled');
13: if (process.argv.includes('--comparison-smoke') && !comparisonEnabled) {
14:   throw new Error('--comparison-smoke requires --comparison-enabled');
15: }
16: if (process.env.DOCUMENT_VERIFY_REQUIRE_AVAILABLE === 'true' && !documentsEnabled) {
17:   throw new Error('DOCUMENT_VERIFY_REQUIRE_AVAILABLE requires --documents-enabled');
18: }
19: const submission = JSON.parse(fs.readFileSync(new URL('../chatgpt-app-submission.json', import.meta.url), 'utf8'));
20: const client = new Client({ name: 'subsidy-review-verification', version: '1.0.0' });
21: const report = { checkedAt: new Date().toISOString(), endpoint: endpoint.href, checks: [] };
22: await client.connect(new StreamableHTTPClientTransport(endpoint));
23: try {
24:   report.server = client.getServerVersion();
25:   const { tools } = await client.listTools();
26:   report.tools = tools.map(({name,annotations})=>({name,annotations}));
27:   if (!process.argv.includes('--snapshot')) {
28:     const expectedNames = Object.keys(submission.tools).filter(name => (documentsEnabled || name !== 'get_subsidy_documents') && (comparisonEnabled || name !== 'render_subsidy_comparison'));
29:     assert.deepEqual(tools.map(t=>t.name).sort(), expectedNames.sort());
30:     for(const tool of tools) assert.deepEqual(tool.annotations,submission.tools[tool.name].annotations,tool.name);
31:     report.checks.push({name:`${expectedNames.length} tools match configured release`,ok:true});
32:     if (comparisonEnabled) {
33:       const tool = tools.find(t => t.name === 'render_subsidy_comparison');
34:       assert.equal(tool._meta?.ui?.resourceUri, 'ui://subsidy-ai/comparison/v1.html');
35:       const resource = await client.readResource({uri:tool._meta.ui.resourceUri});
36:       assert.equal(resource.contents[0]?.mimeType, 'text/html;profile=mcp-app');
37:       assert.ok(resource.contents[0]?.text?.includes('ui/initialize'));
38:       report.checks.push({name:'comparison UI resource and metadata available (host rendering not verified)',ok:true});
39:       if (process.argv.includes('--comparison-smoke')) {
40:         const missing = {status:'unconfirmed',note:'UI検証用の架空データです。',sources:[],label:null};
41:         const rendered = await client.callTool({name:tool.name,arguments:{demo:true,title:'比較UI接続検証（架空）',rows:[{
42:           subsidyId:'demo1',name:'検証用制度（架空）',round:'検証用公募回（架空）',details:[],
43:           pastRate:{status:'not_registered',value:null,round:null,applications:null,selected:null,note:null,sources:[]},
44:           maximumGrant:{...missing,value:null},grantRate:missing,fit:missing,deadline:{...missing,value:null},
45:         }]}});
46:         assert.ok(!rendered.isError);
47:         assert.equal(rendered.structuredContent?.schemaVersion,'1.0');
48:         assert.equal(rendered.structuredContent?.demo,true);
49:         assert.ok(rendered.content.some(c => c.type === 'text' && c.text.includes('実績未登録')));
50:         report.checks.push({name:'comparison demo tool call returns structured data and fallback table',ok:true});
51:       }
52:     }
53:   }
54:   if(process.argv.includes('--smoke')) {
55:     async function call(name,args,validate) {
56:       const result=await client.callTool({name,arguments:args},undefined,{timeout:60000});
57:       const content=result.content.find(x=>x.type==='text')?.text;
58:       let value;
59:       try { value=JSON.parse(content); } catch { value={}; }
60:       if(result.isError) {
61:         report.checks.push({name,ok:false,error:value.error?.code ?? 'tool_error',message:value.error?.message ?? 'MCP call failed'});
62:         return null;
63:       }
64:       try { validate(value); report.checks.push({name,ok:true}); }
65:       catch(e) { report.checks.push({name,ok:false,error:'unexpected_response',message:e.message}); }
66:       return value;
67:     }
68:     const identity=await call('get_corporate_identity',{corporate_number:'1180301018771'},v=>{
69:       assert.equal(v.corporation.corporateNumber,'1180301018771');
70:       assert.match(v.corporation.name,/トヨタ/);
71:       assert.match(v.notice,/国税庁/);
72:     });
73:     if (identity?.corporation) report.nta={name:identity.corporation.name,location:identity.corporation.location,notice:identity.notice};
74:     await call('search_corporate_identities',{name:'トヨタ自動車株式会社'},v=>assert.ok(v.corporations.some(c=>c.corporateNumber==='1180301018771')));
75:     await call('get_company_profile',{corporate_number:'1180301018771'},v=>assert.ok(JSON.stringify(v).includes('1180301018771')));
76:     const result=await call('search_subsidies',{keyword:'省エネ',limit:3},v=>{
77:       assert.ok(v.searchGuidance); assert.ok(v.responseGuidance);
78:     });
79:     if (result) report.subsidySearchKeys=Object.keys(result);
80:     await call('prepare_professional_consultation',{issues:[{topic:'official_guidelines',summary:'最新の公募要領を実施機関に確認したい'}]},v=>{
81:       assert.equal(v.recommended,true); assert.ok(v.readyToSendMessage); assert.ok(v.responseGuidance);
82:     });
83:     await call('get_official_selection_statistics',{jgrants_subsidy_id:'a0WJ200000CDdtlMAD'},v=>assert.ok(Array.isArray(v.statistics)));
84:     if (documentsEnabled) await call('get_subsidy_documents',{subsidy_id:process.env.DOCUMENT_VERIFY_SUBSIDY_ID ?? 'a0WJ200000CDdtMMAT'},v=>{
85:       assert.equal(v.schemaVersion,'1.0'); assert.equal(v.coverage.requiredSetVerified,false);
86:       assert.ok(Array.isArray(v.documents));
87:       if(process.env.DOCUMENT_VERIFY_REQUIRE_AVAILABLE==='true') {
88:         assert.ok(['available','partial'].includes(v.status));
89:         assert.ok(v.documents.length>0,'A confirmed document must be returned; an empty or reference-only response does not prove availability.');
90:       }
91:       report.documentRegistry={status:v.status,reasonCode:v.reasonCode??null,count:v.documents.length};
92:     });
93:   }
94:   if(process.env.MCP_VERIFY_REPORT) fs.writeFileSync(process.env.MCP_VERIFY_REPORT,JSON.stringify(report,null,2)+'\n');
95:   console.log(JSON.stringify(report,null,2));
96:   if (report.checks.some(c=>!c.ok)) process.exitCode=1;
97: } finally {
98:   await client.close();
99: }