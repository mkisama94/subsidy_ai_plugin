import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { mkdir,readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url)),out=new URL('../node_modules/.history-runtime/',import.meta.url);await mkdir(out,{recursive:true});
await build({stdin:{contents:`export {InternalPublicData} from './src/internalPublicData.ts';import {recordObservation} from './src/publicHistory/service.ts';export default {async fetch(r,env){try{return Response.json(await recordObservation(env,await r.json()));}catch{return Response.json({state:'failed'}, {status:503});}}};`,resolveDir:root},bundle:true,format:'esm',platform:'browser',external:['cloudflare:*'],outfile:fileURLToPath(new URL('worker.mjs',out))});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[
  {name:'client',modules:true,compatibilityDate:'2026-08-30',script: `export default {async fetch(r,env){const path=new URL(r.url).pathname;if(path==='/policy') return Response.json(await env.POLICY.configureSource(await r.json()));if(path==='/facts') return Response.json(await env.POLICY.readPublicFacts(await r.json()));return env.HISTORY.fetch(r);}}`,serviceBindings:{POLICY:{name:'history',entrypoint:'InternalPublicData'},HISTORY:'history'}},
  {name:'history',modules:true,scriptPath:fileURLToPath(new URL('worker.mjs',out)),compatibilityDate:'2026-08-30',d1Databases:['subsidy_ai_relations'],bindings:{PUBLIC_HISTORY_ENABLED:'true'}}
]}));
try {
  const db=await mf.getD1Database('subsidy_ai_relations','history');
  for(const file of ['0007_public_history.sql','0008_public_history_retention.sql']) await db.exec((await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).trim());
  await db.prepare("INSERT INTO public_source_policies VALUES('policy','test',1,'https://example.com/terms',1,'test-only',1,1,1,400,'approved')").run();
  const input={sourceId:'test',entityId:'program',roundId:'2026',facts:{title:'A'},evidence:[{url:'https://example.com/source',field:'title',excerpt:'A'}],policyId:'policy',schemaVersion:'v1',extractorVersion:'v1',observedAt:Date.now(),result:'fetched'};
  const observe=facts=>mf.dispatchFetch('https://test.invalid/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,facts})});
  assert.equal((await (await observe({title:'A'})).json()).state,'baseline');
  const concurrent=await Promise.all([observe({title:'B'}),observe({title:'B'})]);assert.ok(concurrent.every(r=>r.status===200));
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM public_fact_versions').first()).n,2);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM public_change_events').first()).n,2);
  await db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON public_change_events BEGIN SELECT RAISE(ABORT,'fault'); END;");
  assert.equal((await observe({title:'C'})).status,503);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM public_fact_versions').first()).n,2);
  assert.equal((await db.prepare('SELECT revision FROM public_entity_heads').first()).revision,2);
  await db.exec('DROP TRIGGER fail_event;');
  const rpc=(path,input)=>mf.dispatchFetch('https://test.invalid/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const policy={operationId:'policy-check-1',sourceId:'jgrants',termsUrl:'https://example.com/terms',purpose:'test-only',status:'approved',allowStorage:true,allowDerivatives:true,allowRedistribution:true};
  assert.equal((await (await rpc('policy',policy)).json()).version,1);
  assert.equal((await (await rpc('policy',policy)).json()).version,1);
  const approved={...input,sourceId:'jgrants',policyId:policy.operationId};
  assert.equal((await (await mf.dispatchFetch('https://test.invalid/',{method:'POST',body:JSON.stringify(approved)})).json()).state,'baseline');
  const entityRef=JSON.stringify(['jgrants','program','2026']);assert.equal((await (await rpc('facts',{entityRef})).json()).state,'verified');
  await rpc('policy',{...policy,operationId:'policy-check-2',status:'paused'});
  assert.equal((await (await rpc('facts',{entityRef})).json()).state,'unavailable');
  console.log('PASS: workerd/local D1 public-history migrations, concurrent CAS, single event and transaction rollback. No government API or production DB access.');
} finally {await mf.dispose();}
