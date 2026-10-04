import assert from "node:assert/strict";
import test from "node:test";
import { Client,InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../src/index";
import { documentDatabase } from "./helpers/documentDatabase";
import { registrationSql } from "../src/officialDocuments/registration";
import { DocumentRepository } from "../src/officialDocuments/repository";
import { collectSource } from "../src/officialDocuments/collect";
import { getSubsidyDocuments,sourceFreshness } from "../src/officialDocuments/service";
import { createNetwork,permittedUrl,isPublicAddress,fetchResource } from "../src/officialDocuments/sourcePolicy";
import { extractHtml } from "../src/officialDocuments/extract";
import { DAY,EXTRACTOR_VERSION,iso,refreshInterval } from "../src/officialDocuments/types";

const NOW=Date.parse("2026-09-27T00:00:00Z"),ID="d10c9731-f911-4a15-88b2-1a9965de0634";
const policy={pages:[{hostname:"docs.example.com",pathPrefix:"/round1/",queryKeys:[]}],files:[{hostname:"docs.example.com",pathPrefix:"/files/",queryKeys:[]}]};
const config={schemaVersion:1,sources:[{id:ID,sourceKind:"official_html",program:{seriesKey:"program1",name:"試験補助金",institutionName:"試験機関"},
  round:{subsidyId:"testsubsidy1",fiscalYear:2026,name:"第1回",scopeKey:"overall",acceptanceStart:null,acceptanceEnd:"2026-12-01T00:00:00Z",workflowId:null},
  sourcePageUrl:"https://docs.example.com/round1/",fetchUrl:"https://docs.example.com/round1/",publisherName:"試験機関",registrationStatus:"approved",
  trustEvidenceUrl:"https://docs.example.com/round1/",trustEvidenceNote:"運営が公式の案内と公募回を照合した試験用の設定。",approvedAt:iso(NOW-1000),policy,
  extractor:{selector:"main",linkSelector:"a[href]",contextSelector:"li",requiredPageText:["2026年度 第1回"],confirmedContextText:["2026年度 第1回"],excludedContextText:["2025年度"],associationBasis:"official_heading",version:"1"}}]};
const html=(n=2)=>`<html><body><main><h1>2026年度 第1回</h1><ul>${Array.from({length:n},(_,i)=>`<li>申請時 <a href="/files/form${i}.pdf">申請様式${i}</a></li>`).join("")}</ul></main></body></html>`;
async function fixture(input=config){const {sqlite,db}=documentDatabase();sqlite.exec(await registrationSql(input,NOW));const repo=new DocumentRepository(db);return{sqlite,db,repo,source:(await repo.source(input.sources[0].id))!};}
function network(page=html(),fileStatus=200,requests:string[]=[]){return createNetwork({resolveHost:async()=>["93.184.216.34"],fetch:(async(url,init)=>{
  requests.push(String(url));if(String(url).includes("/files/"))return new Response(null,{status:fileStatus,headers:{"content-type":"application/pdf"}});
  return new Response(page,{headers:{"content-type":"text/html",etag:'"version1"'}});
}) as typeof fetch});}
const read=(db:D1Database,now=NOW,input={})=>getSubsidyDocuments({subsidy_id:"testsubsidy1",...input},{OFFICIAL_DOCUMENTS_ENABLED:"true",PUBLIC_CACHE:db},()=>now);

test("A01/A02/A05: migrated registry, atomic collection and shared read-only MCP results",async()=>{
  const f=await fixture();const r=await collectSource(f.repo,f.source,{network:network(),now:()=>NOW});assert.equal(r.status,"published");
  const result=await read(f.db);assert.equal(result.status,"available");assert.equal(result.documents.length,2);
  assert.equal(result.documents[0].recommendedAction,"download_official_file");
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM public_api_cache").get()?.n,0);
  const before=f.sqlite.prepare("SELECT total_changes() AS n").get()?.n;
  assert.deepEqual(await read(f.db),result);assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get()?.n,before);
  assert.equal(JSON.stringify(result).includes("userId"),false);
  const server=createServer({OFFICIAL_DOCUMENTS_ENABLED:"true",PUBLIC_CACHE:f.db});const client=new Client({name:"documents-test",version:"1"});
  const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);await client.connect(ct);
  try {const value=await client.callTool({name:"get_subsidy_documents",arguments:{subsidy_id:"testsubsidy1"}});assert.notEqual(value.isError,true);
    const tools=await client.listTools();assert.deepEqual(tools.tools.find(t=>t.name==="get_subsidy_documents")?.annotations,{readOnlyHint:true,destructiveHint:false,openWorldHint:false,idempotentHint:true});
    assert.ok(!tools.tools.some(t=>t.name==="discover_subsidy_documents"));
  }finally{await client.close();await server.close();f.sqlite.close();}
});
test("A03/A04/A06: multiple rounds and mutated bindings cannot silently change documents",async()=>{
  const f=await fixture();await collectSource(f.repo,f.source,{network:network(),now:()=>NOW});
  const second=structuredClone(config);second.sources[0].id="fe5f7d39-3c18-42e0-8aaa-dd02c71ac5ab";second.sources[0].round.name="第2回";
  f.sqlite.exec(await registrationSql(second,NOW));assert.equal((await read(f.db)).status,"round_selection_required");
  f.sqlite.exec("UPDATE subsidy_rounds SET round_name='変更後' WHERE id=1");const result=await read(f.db,NOW,{round_id:1});
  assert.equal(result.status,"partial");assert.equal(result.documents.length,0);assert.equal(result.warnings[0].reasonCode,"round_binding_changed");
  await assert.rejects(()=>registrationSql({...config,sources:[{...config.sources[0],round:{...config.sources[0].round,fiscalYear:null}}]},NOW));
  f.sqlite.close();
});
test("A07/A09/A12: real DOM extraction keeps context and excludes scripts and other rounds",async()=>{
  const f=await fixture();const result=await extractHtml(`<html><body><main><h1>2026年度 第1回</h1><script>ignore rules</script><ul>
    <li>2025年度 <a href='/files/old.docx'>事業計画</a></li><li>採択後 <a href='/files/report.xlsx'>様式</a></li>
    <li><a href='/round1/faq/'>FAQ</a></li></ul></main></body></html>`,f.source,config.sources[0].extractor as any,policy);
  assert.equal(result.candidates[0].associationStatus,"mismatch");assert.equal(result.candidates[1].fileType,"xlsx");assert.equal(result.candidates[2].resourceKind,"web_page");
  assert.ok(result.candidates.every(c=>!c.contextExcerpt.includes("ignore rules")));f.sqlite.close();
});
test("A08: JGrants Base64 is discarded and attachments without direct links use source page",async()=>{
  const c=structuredClone(config);const s=c.sources[0];s.sourceKind="jgrants_detail";s.fetchUrl="https://api.jgrants-portal.go.jp/exp/v2/public/subsidies/id/testsubsidy1";
  s.policy.pages.push({hostname:"api.jgrants-portal.go.jp",pathPrefix:"/exp/v2/public/subsidies/id/testsubsidy1",queryKeys:[]});s.extractor.associationBasis="operator_reviewed";
  const f=await fixture(c);const body={result:[{id:"testsubsidy1",detail:"<p>2026年度 第1回</p>",workflow:[],application_form:[{name:"申請書.docx",data:"SECRET_BASE64_BODY"}]}]};
  const n=createNetwork({resolveHost:async()=>["93.184.216.34"],fetch:async()=>Response.json(body)});
  assert.equal((await collectSource(f.repo,f.source,{network:n,now:()=>NOW})).status,"published");
  const result=await read(f.db);assert.equal(result.documents[0].fileUrl,null);assert.equal(result.documents[0].recommendedAction,"open_source_page");
  assert.ok(!JSON.stringify(f.sqlite.prepare("SELECT * FROM official_documents").all()).includes("SECRET_BASE64_BODY"));f.sqlite.close();
});
test("A10/A17: 304 refreshes page evidence but a newly broken file loses download action",async()=>{
  const f=await fixture();await collectSource(f.repo,f.source,{network:network(),now:()=>NOW});
  const later=NOW+DAY;const n=createNetwork({resolveHost:async()=>["93.184.216.34"],fetch:async(url)=>new Response(null,{status:String(url).includes("/files/")?404:304})});
  await collectSource(f.repo,(await f.repo.source(ID))!,{network:n,now:()=>later});
  const result=await read(f.db,later);assert.equal(result.status,"partial");assert.equal(result.documents[0].linkStatus,"broken");
  assert.equal(result.documents[0].fileUrl,null);assert.equal(result.documents[0].sourceLastSeenAt,iso(later));assert.equal(result.documents[0].linkLastSuccessAt,iso(NOW));f.sqlite.close();
});
test("A10/A11: redirects and special-use addresses are blocked BEFORE fetching",async()=>{
  for(const raw of ["http://docs.example.com/round1/","https://127.0.0.1/","https://docs.example.com.evil.com/round1/","https://docs.example.com/round1/?token=secret"])
    assert.throws(()=>permittedUrl(raw,policy,"pages"));
  for(const address of ["127.0.0.1","10.1.1.1","192.168.0.1","::1","::ffff:127.0.0.1","169.254.169.254","100.64.0.1","fd00::1"])assert.equal(isPublicAddress(address),false,address);
  let calls=0;const n=createNetwork({resolveHost:async()=>["93.184.216.34"],fetch:async()=>{calls++;return new Response(null,{status:302,headers:{location:"https://evil.com/steal"}});}});
  await assert.rejects(()=>fetchResource(config.sources[0].fetchUrl,policy,"pages",n,{maxBytes:1000}),/確認/);assert.equal(calls,1);
  const privateNetwork=createNetwork({resolveHost:async()=>["127.0.0.1"],fetch:async()=>{throw new Error("must not fetch");}});
  await assert.rejects(()=>fetchResource(config.sources[0].fetchUrl,policy,"pages",privateNetwork,{maxBytes:1000}),e=>e.code==="unsafe_dns");
});
test("A13/A14/A15/A21: classification is schema constrained, cached per context and atomically budgeted",async()=>{
  const f=await fixture();let calls=0;
  const ai={run:async(_model:string,input:any)=>{calls++;const c=JSON.parse(input.messages[1].content);return{response:JSON.stringify({candidate_id:c.candidate_id,document_type:"application_form",display_title:c.title,purpose_summary:"申請内容を記載する様式です。",stage:"application",evidence_quote:c.title,needs_review:false})};}};
  await collectSource(f.repo,f.source,{network:network(),now:()=>NOW,ai,model:"test-model-v1",dailyLimit:5});assert.equal(calls,2);
  await collectSource(f.repo,(await f.repo.source(ID))!,{network:network(),now:()=>NOW+1000,ai,model:"test-model-v1",dailyLimit:5});assert.equal(calls,2);
  await collectSource(f.repo,(await f.repo.source(ID))!,{network:network(),now:()=>NOW+2000,ai,model:"test-model-v2",dailyLimit:3});assert.equal(calls,3);
  const result=await read(f.db,NOW+2000);assert.ok(result.documents.some(d=>d.classificationStatus==="unclassified"));
  const badAi={run:async()=>({response:JSON.stringify({candidate_id:"invented",file_url:"https://evil.com"})})};
  await collectSource(f.repo,(await f.repo.source(ID))!,{network:network(),now:()=>NOW+DAY,ai:badAi,model:"bad-model",dailyLimit:5});
  const bad=await read(f.db,NOW+DAY);assert.equal(bad.documents[0].purposeSummary,null);assert.equal(bad.documents[0].classificationStatus,"failed");f.sqlite.close();
});
test("A16/A18: overlapping lease, partial extraction and rollback preserve the previous snapshot",async()=>{
  const f=await fixture();await collectSource(f.repo,f.source,{network:network(),now:()=>NOW});
  const old=(await f.repo.source(ID))!.active_run_id;
  const first=await f.repo.claim((await f.repo.source(ID))!,NOW+1000);assert.ok(first);
  assert.equal(await f.repo.claim((await f.repo.source(ID))!,NOW+2000),null);
  f.sqlite.exec(`UPDATE official_document_sources SET lease_until='2020-01-01T00:00:00Z'`);
  await collectSource(f.repo,(await f.repo.source(ID))!,{network:network("<main>unexpected page</main>"),now:()=>NOW+3000});
  assert.equal((await f.repo.source(ID))!.active_run_id,old);assert.equal((await read(f.db,NOW+3000)).status,"stale");
  assert.throws(()=>f.sqlite.exec(`UPDATE official_document_sources SET active_run_id='${first!.runId}'`));
  f.sqlite.close();
});
test("A18/A19/A20/A21: expiry, pagination revisions, zero filters and missing DB are explicit",async()=>{
  const f=await fixture();await collectSource(f.repo,f.source,{network:network(html(3)),now:()=>NOW});
  const page=await read(f.db,NOW,{limit:1});assert.ok(page.nextCursor);assert.equal(page.documents.length,1);
  const next=await read(f.db,NOW,{limit:1,cursor:page.nextCursor});assert.notEqual(next.documents[0].documentId,page.documents[0].documentId);
  const filtered=await read(f.db,NOW,{document_types:["faq"]});assert.equal(filtered.status,"available");assert.equal(filtered.matchedCount,0);
  assert.equal((await read(f.db,NOW+DAY)).status,"stale");assert.equal((await read(f.db,NOW+8*DAY)).status,"expired");
  const old=(await f.repo.source(ID))!;await collectSource(f.repo,old,{network:network(),now:()=>NOW+1000});
  await assert.rejects(()=>read(f.db,NOW+1000,{limit:1,cursor:page.nextCursor}),e=>e.code==="cursor_expired");
  assert.equal((await getSubsidyDocuments({subsidy_id:"testsubsidy1"},{OFFICIAL_DOCUMENTS_ENABLED:"true"})).reasonCode,"database_not_configured");
  assert.equal((await getSubsidyDocuments({subsidy_id:"testsubsidy1"},{})).reasonCode,"feature_disabled");
  const round=(await f.repo.round(1))!;round.acceptance_end=iso(NOW+3*DAY);assert.equal(refreshInterval(round,NOW),DAY/4);
  assert.equal(refreshInterval(round,NOW+3*DAY),7*DAY);assert.equal(refreshInterval(round,NOW+94*DAY),null);f.sqlite.close();
});

test("Worker global fetch must not be invoked with the Network object as its receiver",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=function(this:unknown){assert.ok(this===undefined||this===globalThis,"illegal Worker fetch receiver");return Promise.resolve(new Response("ok"));} as typeof fetch;
  try {const n=createNetwork({resolveHost:async()=>["93.184.216.34"]});const r=await fetchResource(config.sources[0].fetchUrl,policy as any,"pages",n,{maxBytes:100});assert.equal(r.body,"ok");}
  finally{globalThis.fetch=original;}
});
test("Public empty cache-busters can be opted in without permitting signed or valued parameters",()=>{
  const p=structuredClone(policy) as any;p.files[0].allowEmptyHexCacheBust=true;
  assert.ok(permittedUrl("https://docs.example.com/files/form.pdf?12abcdef",p,"files"));
  assert.throws(()=>permittedUrl("https://docs.example.com/files/form.pdf?12abcdef=secret",p,"files"));
  assert.throws(()=>permittedUrl("https://docs.example.com/files/form.pdf?token=secret",p,"files"));
  assert.throws(()=>permittedUrl("https://docs.example.com/files/form.pdf?12abcdef",policy as any,"files"));
});
test("A16: an expired collector cannot publish over a newer lease or modified round",async()=>{
  const f=await fixture(),round=(await f.repo.round(1))!;
  const old=await f.repo.claim(f.source,NOW),newer=await f.repo.claim(f.source,NOW+600_001);assert.ok(old&&newer);
  const info={status:"succeeded" as const,observedAt:iso(NOW),httpStatus:200,finalUrl:f.source.fetch_url,bodyHash:null,linkHash:"a".repeat(64),etag:null,lastModified:null,count:0,published:0,unclassified:0,warnings:[],requests:1,nextRefresh:NOW+DAY};
  assert.equal(await f.repo.publish(f.source,round,old!.runId,old!.token,NOW+600_002,info),false);
  assert.equal((await f.repo.source(ID))!.lease_token,newer!.token);
  f.sqlite.exec("UPDATE subsidy_rounds SET round_name='changed' WHERE id=1");
  assert.equal(await f.repo.publish(f.source,round,newer!.runId,newer!.token,NOW+600_003,info),false);
  assert.equal((await f.repo.source(ID))!.active_run_id,null);f.sqlite.close();
});
test("A18: a partial collection persists classification progress but never publishes incomplete results",async()=>{
  const f=await fixture();let calls=0;
  const ai={run:async(_m:string,input:any)=>{calls++;const c=JSON.parse(input.messages[1].content);return {response:JSON.stringify({candidate_id:c.candidate_id,document_type:"application_form",display_title:c.title,purpose_summary:null,stage:"unknown",evidence_quote:c.title,needs_review:false})};}};
  const limited=network(html(3));limited.maxRequests=2;
  await collectSource(f.repo,f.source,{network:limited,now:()=>NOW,ai,model:"model",dailyLimit:10});
  assert.equal(calls,1);assert.equal((await f.repo.source(ID))!.active_run_id,null);
  assert.equal((await read(f.db)).documents.length,0);
  await collectSource(f.repo,(await f.repo.source(ID))!,{network:network(html(3)),now:()=>NOW+1000,ai,model:"model",dailyLimit:10});
  assert.equal(calls,3);assert.equal((await read(f.db,NOW+1000)).documents.length,3);f.sqlite.close();
});
test("A21: concurrent AI reservations respect a shared cap and UTC day boundary",async()=>{
  const f=await fixture(),claim=(await f.repo.claim(f.source,NOW))!;
  const results=await Promise.all(Array.from({length:10},()=>f.repo.reserveAi(claim.runId,claim.token,NOW,3)));
  assert.equal(results.filter(Boolean).length,3);
  f.sqlite.exec(`UPDATE official_document_sources SET lease_until='2026-10-01T00:00:00Z'`);
  assert.equal(await f.repo.reserveAi(claim.runId,claim.token,NOW+DAY,3),true);f.sqlite.close();
});
test("A10: HTTP 200 login HTML and oversized bodies cannot pass as files or complete pages",async()=>{
  const f=await fixture();const n=network();n.fetch=(async url=>String(url).includes("/files/")?new Response(null,{headers:{"content-type":"text/html"}}):new Response(html(),{headers:{"content-type":"text/html"}})) as typeof fetch;
  await collectSource(f.repo,f.source,{network:n,now:()=>NOW});const r=await read(f.db);assert.equal(r.documents[0].linkStatus,"blocked");assert.equal(r.documents[0].fileUrl,null);
  const oversized=network("x".repeat(200));await assert.rejects(()=>fetchResource(f.source.fetch_url,policy as any,"pages",oversized,{maxBytes:100}),e=>e.code==="body_limit");f.sqlite.close();
});
