import { WorkerEntrypoint } from 'cloudflare:workers';
import { getCorporateIdentity, searchCorporateIdentities } from './nta';
import { getSubsidyDetail, searchSubsidies } from './jgrants';
import { D1PublicApiCache } from './cache';
import type { HistoryEnv } from './publicHistory/service';
import { recordObservation } from './publicHistory/service';
type InternalEnv = HistoryEnv & { NTA_APPLICATION_ID?:string; PUBLIC_CACHE?:D1Database; CACHE_KEY_SECRET?:string };
// Only callable through an explicitly bound named entrypoint; no fetch/HTTP route.
export class InternalPublicData extends WorkerEntrypoint<InternalEnv> {
  private db() { if(this.env.PUBLIC_HISTORY_ENABLED!=='true'||!this.env.subsidy_ai_relations) throw new Error('PUBLIC_HISTORY_DISABLED'); return this.env.subsidy_ai_relations; }
  async readPublicFacts(input:{entityRef:string;versionId?:string}) {
    if(typeof input.entityRef!=='string'||input.entityRef.length>1000) throw new Error('INVALID_INPUT');
    const row=await this.db().prepare(`SELECT v.*,h.version_id current_version_id,h.last_verified_at,h.source_id,h.entity_id,h.round_id FROM public_entity_heads h JOIN public_fact_versions v ON v.entity_key=h.entity_key AND v.expired_at IS NULL JOIN public_source_policies p ON p.id=v.policy_id AND p.status='approved' AND p.allow_redistribution=1 AND EXISTS(SELECT 1 FROM public_source_policies latest WHERE latest.source_id=h.source_id AND latest.version=(SELECT MAX(version) FROM public_source_policies WHERE source_id=h.source_id) AND latest.status='approved' AND latest.allow_redistribution=1) WHERE h.entity_key=? AND v.id=?`).bind(input.entityRef,input.versionId??(await this.db().prepare('SELECT version_id FROM public_entity_heads WHERE entity_key=?').bind(input.entityRef).first<{version_id:string}>())?.version_id??'').first();
    if(!row) return {state:'unavailable'};
    return {state:row.id!==row.current_version_id?'superseded':Date.now()-Number(row.last_verified_at)>172800000?'stale':'verified', versionId:row.id, entityRef:input.entityRef, programId:row.entity_id, roundId:row.round_id, facts:JSON.parse(String(row.facts_json)),evidence:JSON.parse(String(row.evidence_json)), observedAt:row.observed_at,lastVerifiedAt:row.last_verified_at,ruleVersion:'unstructured.v1'};
  }
  async readPublicChanges(input:{afterSequence:number;limit?:number}) {
    const db=this.db();
    if(!Number.isSafeInteger(input.afterSequence)||input.afterSequence<0) throw new Error('INVALID_CURSOR');
    const minimum=await db.prepare("SELECT minimum_sequence FROM public_history_retention WHERE id='main'").first<{minimum_sequence:number}>();
    if(input.afterSequence<(minimum?.minimum_sequence??0)) return {state:'resync_required',events:[],resumeSequence:(await db.prepare('SELECT MAX(sequence) n FROM public_change_events').first<{n:number}>())?.n??0};
    const events=(await db.prepare("SELECT e.* FROM public_change_events e JOIN public_fact_versions v ON v.id=e.version_id JOIN public_source_policies p ON p.id=v.policy_id AND p.status='approved' AND p.allow_redistribution=1 AND EXISTS(SELECT 1 FROM public_source_policies latest WHERE latest.source_id=p.source_id AND latest.version=(SELECT MAX(version) FROM public_source_policies WHERE source_id=p.source_id) AND latest.status='approved' AND latest.allow_redistribution=1) WHERE sequence>? ORDER BY sequence LIMIT ?").bind(input.afterSequence,Math.min(50,Math.max(1,input.limit??50))).all()).results;
    return {state:'ok',events,nextSequence:events.at(-1)?.sequence??input.afterSequence};
  }
  async readCoverage() {
    if(!this.env.subsidy_ai_relations) return {state:'unavailable',sources:[]};
    return {state:this.env.PUBLIC_HISTORY_ENABLED==='true'?'enabled':'disabled',sources:(await this.env.subsidy_ai_relations.prepare("SELECT p.id,p.source_id,p.version,p.status,p.terms_url,p.purpose,p.reviewed_at,p.allow_storage,p.allow_derivatives,p.allow_redistribution,MAX(h.last_verified_at) last_success_at FROM public_source_policies p LEFT JOIN public_entity_heads h ON h.source_id=p.source_id WHERE p.version=(SELECT MAX(p2.version) FROM public_source_policies p2 WHERE p2.source_id=p.source_id) GROUP BY p.id").all()).results};
  }
  async configureSource(input:{operationId:string;sourceId:string;termsUrl:string;purpose:string;status:string;allowStorage:boolean;allowDerivatives:boolean;allowRedistribution:boolean}) {
    const db=this.env.subsidy_ai_relations;
    if(!db||!/^[-\w]{8,100}$/.test(input.operationId)||input.sourceId!=='jgrants'||!['approved','paused'].includes(input.status)||typeof input.purpose!=='string'||!input.purpose.trim()||input.purpose.length>2000) throw new Error('INVALID_POLICY');
    const url=new URL(input.termsUrl);if(url.protocol!=='https:'||url.username||url.password) throw new Error('INVALID_POLICY');
    if(input.status==='approved'&&[input.allowStorage,input.allowDerivatives,input.allowRedistribution].some(v=>v!==true)) throw new Error('POLICY_REVIEW_REQUIRED');
    const existing=await db.prepare('SELECT * FROM public_source_policies WHERE id=?').bind(input.operationId).first();
    if(existing) {
      if(existing.source_id!==input.sourceId||existing.terms_url!==url.href||existing.purpose!==input.purpose||existing.status!==input.status) throw new Error('POLICY_CONFLICT');
      return {id:existing.id,version:existing.version,status:existing.status};
    }
    await db.prepare("INSERT INTO public_source_policies SELECT ?,?,COALESCE(MAX(version),0)+1,?,?,?,?,?,?,400,? FROM public_source_policies WHERE source_id=?").bind(input.operationId,input.sourceId,url.href,Date.now(),input.purpose,input.allowStorage?1:0,input.allowDerivatives?1:0,input.allowRedistribution?1:0,input.status,input.sourceId).run();
    const saved=await db.prepare('SELECT id,version,status FROM public_source_policies WHERE id=?').bind(input.operationId).first();return saved;
  }
  async searchCompanies(input:{query:string;page?:number}) {
    if(typeof input.query!=='string'||input.query.length>200) throw new Error('INVALID_INPUT');
    return /^\d{13}$/.test(input.query)?getCorporateIdentity(input.query,this.env.NTA_APPLICATION_ID):searchCorporateIdentities({name:input.query,page:input.page},this.env.NTA_APPLICATION_ID);
  }
  async resolveCompany(input:{corporateNumber:string}) { return getCorporateIdentity(input.corporateNumber,this.env.NTA_APPLICATION_ID); }
  async searchPrograms(input:{keyword:string;targetArea?:string;page?:number}) {
    if(typeof input.keyword!=='string'||!input.keyword.trim()||input.keyword.length>255) throw new Error('INVALID_INPUT');
    const db=this.env.PUBLIC_CACHE??this.env.subsidy_ai_relations;
    if(input.page && input.page!==1) throw new Error('COVERAGE_INCOMPLETE');
    const result=await searchSubsidies({keyword:input.keyword,targetArea:input.targetArea,limit:50,acceptingOnly:false,sort:'created_date',order:'DESC'},{cache:db?new D1PublicApiCache(db):undefined,searchCacheKeySecret:this.env.CACHE_KEY_SECRET});
    const incomplete=(reason:string)=>({...result,scanComplete:false,coverageReason:reason});
    if(result.cache.isStale||result.hasMore||result.upstreamCount!==result.returnedCount) return incomplete('検索結果の一部または古い情報のため、全件取得を確認できません。');
    // Bound a scan's request budget. Larger searches stay incomplete, never "zero new".
    if(result.subsidies.length>5) return incomplete('候補が取得予算を超えています。監視条件を絞ってください。');
    if(this.env.PUBLIC_HISTORY_ENABLED!=='true'||!this.env.subsidy_ai_relations) return incomplete('公開情報の確認履歴が未接続です。');
    const policy=await this.env.subsidy_ai_relations.prepare("SELECT id FROM public_source_policies WHERE source_id='jgrants' AND status='approved' AND allow_storage=1 AND allow_derivatives=1 AND allow_redistribution=1 ORDER BY version DESC LIMIT 1").first();
    if(!policy) return incomplete('情報源の利用条件が未承認です。');
    const rounds=[];
    for(const program of result.subsidies) {
      const detail=await this.programDetail({id:program.id});
      if(detail.cache.isStale||!detail.subsidy.workflows.length||detail.subsidy.workflows.some(r=>!r.id)) return incomplete('公募回または情報の鮮度が未確認です。');
      for(const history of detail.publicHistory) {
        if(!history.versionId) return incomplete('公募回の確認履歴を保存できません。');
        const fact=await this.readPublicFacts({entityRef:history.entityRef});
        if(fact.state!=='verified') return incomplete('根拠を最新状態で確認できません。');
        rounds.push({...fact,id:JSON.stringify([program.id,history.roundId]),title:program.title,discoveryReason:`保存したキーワード「${input.keyword}」による検索候補です。申請資格・事業との相性は未確認です。`,publishedAt:null});
      }
      if(detail.publicHistory.length!==detail.subsidy.workflows.length) return incomplete('確認できない公募回があります。');
    }
    return {...result,scanComplete:true,rounds,coverageReason:'保存した検索条件で全件と公募回を取得しました。全国の全制度を網羅するものではありません。'};
  }
  async programDetail(input:{id:string}) {
    if(!/^[a-zA-Z0-9]{1,18}$/.test(input.id)) throw new Error('INVALID_INPUT');
    const db=this.env.PUBLIC_CACHE??this.env.subsidy_ai_relations;
    const detail=await getSubsidyDetail(input.id,{cache:db?new D1PublicApiCache(db):undefined});
    const publicHistory:{entityRef:string;roundId:string;versionId?:string;state:string}[]=[];
    if(this.env.PUBLIC_HISTORY_ENABLED==='true'&&this.env.subsidy_ai_relations&&!detail.cache.isStale) {
      const policy=await this.env.subsidy_ai_relations.prepare("SELECT id FROM public_source_policies WHERE source_id='jgrants' AND status='approved' ORDER BY version DESC LIMIT 1").first<{id:string}>();
      if(policy) for(const round of detail.subsidy.workflows) {
        if(!round.id) continue;
        const facts={title:detail.subsidy.title,deadline:round.acceptanceEnd,round};
        const observation=await recordObservation(this.env,{sourceId:'jgrants',entityId:input.id,roundId:round.id,facts,evidence:[{url:detail.subsidy.detailUrl,field:'round',excerpt:JSON.stringify(round)}],policyId:policy.id,schemaVersion:'jgrants.round.v1',extractorVersion:'existing.v1',observedAt:Date.parse(detail.retrievedAt),result:detail.cache.status==='hit'?'cache_hit':'fetched'});
        publicHistory.push({...observation,entityRef:JSON.stringify(['jgrants',input.id,round.id]),roundId:round.id});
      }
    }
    return {...detail,publicHistory};
  }
}
