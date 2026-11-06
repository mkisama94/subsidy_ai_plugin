export type HistoryEnv = Partial<Pick<Cloudflare.Env,'PUBLIC_HISTORY_ENABLED'|'subsidy_ai_relations'>>;
export type Observation = { sourceId: string; entityId: string; roundId: string; facts: Record<string, unknown>; evidence: { url: string; field: string; excerpt: string }[]; policyId: string; schemaVersion: string; extractorVersion: string; sourceRecordId?: string; observedAt: number; result: 'fetched' | 'not_modified' | 'cache_hit' | 'failed'; failureCode?: string };
function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map(normalize).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,normalize(v)]));
  return value;
}
export const canonicalFacts = (facts: Record<string, unknown>) => JSON.stringify(normalize(facts));
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function recordObservation(env: HistoryEnv, input: Observation): Promise<{state: string; versionId?: string}> {
  if (env.PUBLIC_HISTORY_ENABLED !== 'true' || !env.subsidy_ai_relations) return {state:'disabled'};
  const db = env.subsidy_ai_relations;
  const policy = await db.prepare("SELECT * FROM public_source_policies WHERE id=? AND source_id=? AND status='approved' AND allow_storage=1 AND allow_derivatives=1 AND allow_redistribution=1 AND version=(SELECT MAX(version) FROM public_source_policies WHERE source_id=?)").bind(input.policyId,input.sourceId,input.sourceId).first();
  if (!policy) return {state:'policy_blocked'};
  if (!input.entityId || !input.roundId || !input.evidence.length || input.evidence.some(e=>!/^https:\/\//.test(e.url)) || JSON.stringify(input).length>100000) return {state:'review_required'};
  const key=JSON.stringify([input.sourceId,input.entityId,input.roundId]);
  for (let attempt=0;attempt<3;attempt++) {
    const head=await db.prepare('SELECT h.*,v.facts_json,v.extractor_version,v.schema_version FROM public_entity_heads h JOIN public_fact_versions v ON v.id=h.version_id WHERE h.entity_key=?').bind(key).first<{version_id:string;revision:number;facts_json:string;extractor_version:string;schema_version:string;last_verified_at:number}>();
    if (input.result==='cache_hit') return {state:'cache_hit',versionId:head?.version_id};
    if (head && input.observedAt<head.last_verified_at) return {state:'out_of_order',versionId:head.version_id};
    if (input.result==='failed' || (!Object.keys(input.facts).length && input.result!=='not_modified')) {
      await db.prepare('INSERT INTO public_observations VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),key,head?.version_id??null,input.observedAt,'failed',input.failureCode??'invalid_extraction').run(); return {state:'review_required'};
    }
    const facts=canonicalFacts(input.facts);
    if (head && (input.result==='not_modified' || head.facts_json===facts)) {
      await db.batch([
        db.prepare('UPDATE public_entity_heads SET last_verified_at=MAX(last_verified_at,?) WHERE entity_key=? AND version_id=?').bind(input.observedAt,key,head.version_id),
        db.prepare("INSERT INTO public_observations SELECT ?,entity_key,version_id,?,'verified',NULL FROM public_entity_heads WHERE entity_key=? AND version_id=?").bind(crypto.randomUUID(),input.observedAt,key,head.version_id)
      ]); return {state:'unchanged',versionId:head.version_id};
    }
    if (input.result==='not_modified') return {state:'review_required'};
    // Extractor/schema changes require review, rather than pretending the publisher changed facts.
    if (head && (head.extractor_version!==input.extractorVersion || head.schema_version!==input.schemaVersion)) return {state:'extractor_review_required'};
    const previous=head?JSON.parse(head.facts_json):{};
    if(head && Object.keys(previous).some(k=>previous[k]!=null && input.facts[k]==null)) return {state:'missing_fields_review_required'};
    const versionId=crypto.randomUUID(), revision=(head?.revision??0)+1;
    const changed=Object.keys({...previous,...input.facts}).filter(k=>canonicalFacts({v:previous[k]})!==canonicalFacts({v:input.facts[k]}));
    const values=[versionId,key,head?.version_id??null,revision,await sha(facts),facts,JSON.stringify(input.evidence),input.sourceRecordId??null,input.schemaVersion,input.extractorVersion,input.policyId,input.observedAt,null,null];
    try {
      if (!head) {
        await db.batch([
          db.prepare('INSERT INTO public_entity_heads VALUES(?,?,?,?,?,?,?)').bind(key,input.sourceId,input.entityId,input.roundId,versionId,revision,input.observedAt),
          db.prepare('INSERT INTO public_fact_versions(id,entity_key,previous_version_id,revision,content_hash,facts_json,evidence_json,source_record_id,schema_version,extractor_version,policy_id,observed_at,effective_from,effective_to) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(...values),
          db.prepare("INSERT INTO public_change_events(id,entity_key,version_id,previous_version_id,kind,changed_fields_json,published_at) VALUES(?,?,?,NULL,'baseline',?,?)").bind(crypto.randomUUID(),key,versionId,JSON.stringify(changed),input.observedAt),
          db.prepare("INSERT INTO public_observations VALUES(?,?,?,?,'fetched',NULL)").bind(crypto.randomUUID(),key,versionId,input.observedAt)
        ]);
      } else {
        const result=await db.batch([
          db.prepare('INSERT INTO public_fact_versions(id,entity_key,previous_version_id,revision,content_hash,facts_json,evidence_json,source_record_id,schema_version,extractor_version,policy_id,observed_at,effective_from,effective_to) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM public_entity_heads WHERE entity_key=? AND revision=?').bind(...values,key,head.revision),
          db.prepare("INSERT INTO public_change_events(id,entity_key,version_id,previous_version_id,kind,changed_fields_json,published_at) SELECT ?,entity_key,?,version_id,'change',?,? FROM public_entity_heads WHERE entity_key=? AND revision=?").bind(crypto.randomUUID(),versionId,JSON.stringify(changed),input.observedAt,key,head.revision),
          db.prepare("INSERT INTO public_observations SELECT ?,entity_key,?,?,'fetched',NULL FROM public_entity_heads WHERE entity_key=? AND revision=?").bind(crypto.randomUUID(),versionId,input.observedAt,key,head.revision),
          db.prepare('UPDATE public_entity_heads SET version_id=?,revision=revision+1,last_verified_at=? WHERE entity_key=? AND revision=?').bind(versionId,input.observedAt,key,head.revision)
        ]);
        if(result.at(-1)?.meta.changes!==1) continue;
      }
      return {state:head?'changed':'baseline',versionId};
    } catch(error) {
      const winner=await db.prepare('SELECT revision FROM public_entity_heads WHERE entity_key=?').bind(key).first<{revision:number}>();
      if (!winner || winner.revision===(head?.revision??0)) throw error;
    }
  }
  return {state:'conflict_retry_required'};
}
export async function expirePublicHistory(env:HistoryEnv,now=Date.now()) {
  if(env.PUBLIC_HISTORY_ENABLED!=='true'||!env.subsidy_ai_relations) return;
  const db=env.subsidy_ai_relations,cutoff=now-400*86400000;
  await db.batch([
    db.prepare("UPDATE public_fact_versions SET facts_json='{}',evidence_json='[]',expired_at=? WHERE id IN (SELECT v.id FROM public_fact_versions v JOIN public_source_policies p ON p.id=v.policy_id WHERE v.expired_at IS NULL AND v.observed_at<?-MIN(400,MAX(0,p.retention_days))*86400000 LIMIT 200)").bind(now,now),
    db.prepare('DELETE FROM public_observations WHERE observed_at<?').bind(cutoff),
    db.prepare("UPDATE public_history_retention SET minimum_sequence=MAX(minimum_sequence,COALESCE((SELECT MAX(sequence) FROM public_change_events WHERE published_at<?),0)) WHERE id='main'").bind(cutoff),
    db.prepare('DELETE FROM public_change_events WHERE published_at<?').bind(cutoff)
  ]);
}
