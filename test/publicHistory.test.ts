import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { recordObservation, expirePublicHistory } from '../src/publicHistory/service';
export function sqliteD1(db) {
  return {prepare(sql) {let args=[];const execute=()=>db.prepare(sql);return {bind(...values){args=values;return this;},async first(){return execute().get(...args)??null;},async all(){return {results:execute().all(...args)};},async run(){const r=execute().run(...args);return {meta:{changes:Number(r.changes)}};}};},async batch(statements){db.exec('BEGIN');try {const result=[];for(const statement of statements) result.push(await statement.run());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
}

const now=Date.parse('2026-11-05T00:00:00Z');
test('public history handles baseline, cache, whitespace, 304, A-B-A and batch rollback',async()=>{
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');
  for(const file of ['0007_public_history.sql','0008_public_history_retention.sql']) sqlite.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  const db=sqliteD1(sqlite);
  sqlite.exec("INSERT INTO public_source_policies VALUES('policy','test',1,'https://example.com/terms',1,'public',1,1,1,400,'approved')");
  const env={PUBLIC_HISTORY_ENABLED:'true',subsidy_ai_relations:db};
  const input={sourceId:'test',entityId:'program',roundId:'2026',facts:{title:'A  支援'},evidence:[{url:'https://example.com/source',field:'title',excerpt:'A 支援'}],policyId:'policy',schemaVersion:'v1',extractorVersion:'v1',observedAt:now,result:'fetched'};
  assert.equal((await recordObservation(env,input)).state,'baseline');
  assert.equal((await recordObservation(env,{...input,result:'cache_hit'})).state,'cache_hit');
  assert.equal((await recordObservation(env,{...input,facts:{title:'A 支援'}})).state,'unchanged');
  assert.equal((await recordObservation(env,{...input,result:'not_modified'})).state,'unchanged');
  assert.equal((await recordObservation(env,{...input,facts:{title:'B'}})).state,'changed');
  assert.equal((await recordObservation(env,input)).state,'changed');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM public_fact_versions').get().n,3);
  sqlite.exec("CREATE TRIGGER fail_event BEFORE INSERT ON public_change_events BEGIN SELECT RAISE(ABORT,'fault'); END;");
  await assert.rejects(recordObservation(env,{...input,facts:{title:'C'}}));
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM public_fact_versions').get().n,3);
  sqlite.exec('DROP TRIGGER fail_event');
  await expirePublicHistory(env,now+401*86400000);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM public_fact_versions WHERE facts_json!='{}'").get().n,0);
  sqlite.close();
});
