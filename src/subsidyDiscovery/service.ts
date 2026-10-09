import { z } from 'zod';
import { D1PublicApiCache, createPrivateCacheKey, type PublicApiCache } from '../cache';
import { getSubsidyDetail, searchSubsidies, type JGrantsCacheOptions } from '../jgrants';
import { CatalogRepository } from '../officialSubsidyCatalog/repository';
import { DAY, CatalogError, digest, enabled, iso, normalize, payloadSchema, type CandidatePayload, type CatalogEnv, type VersionRow } from '../officialSubsidyCatalog/types';

export const searchInputSchema=z.object({
  query:z.string().trim().min(2).max(255),target_area:z.string().trim().min(1).max(100).optional(),
  purpose_tags:z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  sources:z.array(z.enum(['jgrants','mhlw'])).min(1).max(2).default(['jgrants','mhlw']),
  status_scope:z.enum(['active_and_scheduled','active_only','all']).default('active_and_scheduled'),
  limit:z.number().int().min(1).max(50).default(10),cursor:z.string().max(1500).optional(),
}).strict();
export const detailInputSchema=z.object({candidate_id:z.string().min(1).max(150).regex(/^[a-zA-Z0-9_-]+$/),
  version_id:z.string().min(1).max(150).regex(/^[a-zA-Z0-9_-]+$/).optional(),event_date:z.string().date().optional(),
  event_type:z.enum(['training_start','hiring','conversion','leave_start','other']).optional()}).strict();
const candidateSchema=z.object({candidateId:z.string(),versionId:z.string(),source:z.enum(['mhlw','jgrants']),title:z.string(),
  courseName:z.string().nullable(),fiscalYear:z.number().nullable(),summary:z.string(),state:z.enum(['active','scheduled','closed','unknown']),
  applicationType:z.string(),officialUrl:z.string(),matchReasons:z.array(z.string()),detailStatus:z.string(),
  freshness:z.enum(['fresh','stale','unknown']),lastVerifiedAt:z.string().nullable(),freshUntil:z.string().nullable(),
  sourceWarnings:z.array(z.string()),jgrantsId:z.string().nullable(),score:z.number()});
type Candidate=z.infer<typeof candidateSchema>;
const coverageSchema=z.object({status:z.enum(['success','partial','failed','not_queried']),reasonCode:z.string().nullable(),
  registeredCourses:z.number().nullable(),publishedCourses:z.number().nullable(),fetchedCount:z.number(),upstreamCount:z.number().nullable(),
  unparsedDocuments:z.number().nullable(),warnings:z.array(z.string())});
type Coverage=z.infer<typeof coverageSchema>;
export const searchOutputSchema=z.object({schemaVersion:z.literal('1'),catalogReleaseId:z.string().nullable(),
  candidates:z.array(candidateSchema),uncertainCandidates:z.array(candidateSchema),coverage:z.object({jgrants:coverageSchema,mhlw:coverageSchema}),
  counts:z.object({fetched:z.number(),deduplicated:z.number(),filtered:z.number(),matching:z.number(),returned:z.number()}),
  hasMore:z.boolean(),nextCursor:z.string().nullable(),servedAt:z.string(),responseGuidance:z.string(),warnings:z.array(z.string())});
export const detailOutputSchema=z.object({schemaVersion:z.literal('1'),status:z.string(),candidateId:z.string(),versionId:z.string().nullable(),
  catalogReleaseId:z.string().nullable(),data:z.record(z.string(),z.unknown()).nullable(),missingFacts:z.array(z.string()),
  warnings:z.array(z.string()),responseGuidance:z.string(),servedAt:z.string()});

const GUIDANCE='Jグランツと登録済み厚労省公式情報の検索です。0件を制度不存在とせず、coverage、適用時期、確認日時を示してください。厚労省のcandidateIdはget_discovered_subsidy_detailに渡し、Jグランツ専用の詳細・適合度評価へ渡さないでください。現行制度でも個別の申請可否は未判定です。';
export const DISCOVERY_GUIDANCE='採用・研修等では、discover_subsidiesが利用可能なら厚労省カタログも検索してください。利用できなければ従来どおり標準Web検索で公式情報を補完し、未確認の範囲を明示してください。';
const emptyCoverage=(status:Coverage['status'],reasonCode:string|null=null):Coverage=>({status,reasonCode,registeredCourses:null,publishedCourses:null,
  fetchedCount:0,upstreamCount:null,unparsedDocuments:null,warnings:[]});
type Snapshot={catalogReleaseId:string|null;candidates:Candidate[];coverage:{jgrants:Coverage;mhlw:Coverage};counts:{fetched:number;deduplicated:number;filtered:number;matching:number};
  warnings:string[];queryHash:string;expiresAt:number};
type Resolver={id:string;versionId:string;title:string;acceptanceStart:string|null;acceptanceEnd:string|null;expiresAt:number};
export type DiscoveryOptions={now?:()=>number;search?:typeof searchSubsidies;detail?:typeof getSubsidyDetail;cache?:PublicApiCache};
const queryIdentity=(q:z.infer<typeof searchInputSchema>)=>({query:q.query,target_area:q.target_area??null,purpose_tags:[...q.purpose_tags].sort(),sources:[...new Set(q.sources)].sort(),status_scope:q.status_scope,limit:q.limit});

export function matchCandidate(payload:CandidatePayload,query:string,tags:string[]) {
  const q=normalize(query),name=normalize(payload.title),aliases=payload.aliases.map(normalize),purposes=payload.purposeTags.map(normalize);
  if(name===q||normalize(payload.courseName)===q)return {score:100,reasons:['正式名称一致']};
  if(aliases.includes(q))return {score:90,reasons:['確認対象の別名一致']};
  if(name.includes(q))return {score:80,reasons:['制度名・コース名に一致']};
  const terms=[...query.split(/[\s、,・]+/),...tags].map(normalize).filter(x=>x.length>=2);
  const dictionary:Record<string,string[]>={ai研修:['ai','研修','人材育成'],採用:['雇入れ','採用'],正社員化:['正社員','転換'],リスキリング:['リスキリング','研修']};
  terms.push(...(dictionary[q]??[]));
  const matched=terms.filter(t=>[name,...aliases,...purposes].some(x=>x.includes(t)||t.includes(x)&&x.length>=2));
  if(matched.length)return {score:40+Math.min(20,matched.length*3),reasons:['目的・名称の語句一致（申請資格は未判定）']};
  return null;
}

async function observe(repo:CatalogRepository,v:VersionRow,p:CandidatePayload,now:number) {
  const records=await repo.evidenceRecords(v.id),source=await repo.source(p.sourceId),warnings:string[]=[];
  const checked=records.length?Math.min(...records.map(r=>r.last_verified_at)):null;
  let pending=source?.revision!==v.source_revision;
  for(const record of records) {
    const latest=await repo.latestRecord(p.sourceId,record.url);if(latest&&latest.content_hash!==record.content_hash)pending=true;
  }
  if(source?.last_error)warnings.push(`source_${source.last_error}`);
  if(!source||source.status==='paused')warnings.push('source_paused');
  const stale=checked===null||checked+2*DAY<=now;
  return {detailStatus:!source||source.status==='paused'?'unavailable':pending?'update_pending':stale?'stale':p.detailLevel==='conditions_reviewed'?'available':'overview_only',
    freshness:(checked===null?'unknown':stale?'stale':'fresh') as Candidate['freshness'],lastVerifiedAt:checked===null?null:iso(checked),freshUntil:checked===null?null:iso(checked+2*DAY),sourceWarnings:warnings};
}
function cacheFor(env:CatalogEnv,options:DiscoveryOptions) {return options.cache??((env.PUBLIC_CACHE??env.subsidy_ai_relations)?new D1PublicApiCache((env.PUBLIC_CACHE??env.subsidy_ai_relations)!):undefined);}
function cacheOptions(env:CatalogEnv,options:DiscoveryOptions):JGrantsCacheOptions{return {cache:cacheFor(env,options),searchCacheKeySecret:env.CACHE_KEY_SECRET,now:options.now};}

async function mhlwCandidates(env:CatalogEnv,q:z.infer<typeof searchInputSchema>,now:number) {
  if(!enabled(env.MHLW_CATALOG_SERVING_ENABLED))return {items:[] as Candidate[],releaseId:null,coverage:emptyCoverage('not_queried','catalog_disabled')};
  if(!env.subsidy_ai_relations)return {items:[] as Candidate[],releaseId:null,coverage:emptyCoverage('failed','database_not_configured')};
  try {
    const repo=new CatalogRepository(env.subsidy_ai_relations),releaseId=await repo.activeId(),sources=await repo.sources();
    const registered=sources.reduce((n,s)=>n+JSON.parse(s.config_json).courses.length,0);
    if(!releaseId)return {items:[] as Candidate[],releaseId:null,coverage:{...emptyCoverage('partial','not_indexed'),registeredCourses:registered,publishedCourses:0}};
    const versions=await repo.published(releaseId),items:Candidate[]=[];
    for(const v of versions) {
      const p=payloadSchema.parse(JSON.parse(v.payload_json)),match=matchCandidate(p,q.query,q.purpose_tags);
      if(!match)continue;
      if(q.target_area&&!p.areas.includes('全国')&&!p.areas.some(a=>normalize(q.target_area!).includes(normalize(a))))continue;
      const observed=await observe(repo,v,p,now);if(observed.detailStatus==='unavailable')continue;
      const mapping=await repo.db.prepare('SELECT jgrants_id FROM discovery_candidates WHERE id=?').bind(p.candidateId).first<{jgrants_id:string|null}>();
      items.push({candidateId:p.candidateId,versionId:v.id,source:'mhlw',title:p.title,courseName:p.courseName,fiscalYear:p.fiscalYear,
        summary:p.summary,state:p.state,applicationType:p.applicationType,officialUrl:p.officialUrl,matchReasons:match.reasons,score:match.score,jgrantsId:mapping?.jgrants_id??null,...observed});
    }
    const jobs=(await repo.jobs()).filter(j=>sources.some(s=>s.id===j.source_id&&s.revision===j.source_revision)),unparsed=jobs.filter(j=>j.status!=='ready').length;
    const partial=versions.length<registered||unparsed>0||sources.some(s=>s.last_error||s.status!=='approved')||items.some(i=>i.detailStatus!=='available');
    return {items,releaseId,coverage:{status:partial?'partial':'success',reasonCode:null,registeredCourses:registered,publishedCourses:versions.length,
      fetchedCount:versions.length,upstreamCount:null,unparsedDocuments:unparsed,warnings:['registered_sources_only','document_discovery_bounded','eligibility_not_assessed']} as Coverage};
  }catch{return {items:[] as Candidate[],releaseId:null,coverage:emptyCoverage('failed','catalog_database_unavailable')};}
}

export async function discoverSubsidies(raw:unknown,env:CatalogEnv,options:DiscoveryOptions={}) {
  const q=searchInputSchema.parse(raw),now=(options.now??Date.now)(),cache=cacheFor(env,options),secret=env.CACHE_KEY_SECRET;
  const queryHash=secret?await createPrivateCacheKey('discovery-query-v1',queryIdentity(q),secret):await digest(JSON.stringify(queryIdentity(q)));
  let snapshot:Snapshot,offset=0,snapshotId:string=crypto.randomUUID();
  if(q.cursor) {
    if(!cache||!secret)throw new CatalogError('cursor_unavailable');
    let c:{id:string;offset:number;signature:string};
    try{c=JSON.parse(atob(q.cursor));}catch{throw new CatalogError('invalid_cursor');}
    if(!z.object({id:z.string().uuid(),offset:z.number().int().min(0).max(10000),signature:z.string()}).strict().safeParse(c).success)throw new CatalogError('invalid_cursor');
    if(c.signature!==await createPrivateCacheKey('discovery-cursor-v1',[c.id,c.offset,queryHash],secret))throw new CatalogError('cursor_query_mismatch');
    const stored=await cache.get<Snapshot>(`discovery:snapshot:${c.id}`);
    if(!stored||stored.expiresAt<=now||stored.value.queryHash!==queryHash)throw new CatalogError('cursor_expired');
    snapshot=stored.value;snapshotId=c.id;offset=c.offset;
    if(q.sources.includes('mhlw')&&!enabled(env.MHLW_CATALOG_SERVING_ENABLED))throw new CatalogError('catalog_disabled');
  } else {
    const [m,j]=await Promise.allSettled([
      q.sources.includes('mhlw')?mhlwCandidates(env,q,now):Promise.resolve({items:[] as Candidate[],releaseId:null,coverage:emptyCoverage('not_queried')}),
      q.sources.includes('jgrants')?(options.search??searchSubsidies)({keyword:q.query,targetArea:q.target_area,acceptingOnly:false,sort:'acceptance_end_datetime',order:'ASC',limit:50},cacheOptions(env,options)):Promise.resolve(null),
    ]);
    const mh=m.status==='fulfilled'?m.value:{items:[] as Candidate[],releaseId:null,coverage:emptyCoverage('failed','catalog_unavailable')};
    const jg=j.status==='fulfilled'?j.value:null,jgItems:Candidate[]=[],warnings:string[]=[];
    let jcov=q.sources.includes('jgrants')?emptyCoverage('failed','upstream_error'):emptyCoverage('not_queried');
    if(jg) {
      jcov={...emptyCoverage(jg.hasMore||jg.cache.isStale?'partial':'success'),fetchedCount:jg.returnedCount,upstreamCount:jg.upstreamCount,warnings:jg.hasMore?['upstream_results_truncated']:[]};
      for(const s of jg.subsidies) {
        const candidateId='jg_'+(await digest(s.id)).slice(0,40),versionId=await digest(JSON.stringify([s.title,s.acceptanceStart,s.acceptanceEnd]));
        jgItems.push({candidateId,versionId,source:'jgrants',title:s.title,courseName:null,fiscalYear:null,summary:'Jグランツの公開検索結果。詳細条件は詳細取得で確認してください。',
          state:s.acceptanceStatus==='open'?'active':s.acceptanceStatus,applicationType:'fixed',officialUrl:s.detailUrl,matchReasons:['Jグランツ検索一致'],
          detailStatus:jg.cache.isStale?'stale':'overview_only',freshness:jg.cache.isStale?'stale':'fresh',lastVerifiedAt:jg.retrievedAt,freshUntil:jg.cache.expiresAt,
          sourceWarnings:jg.cache.isStale?['upstream_cache_stale']:[],jgrantsId:s.id,score:normalize(s.title)===normalize(q.query)?100:50});
        if(cache)try{await cache.put<Resolver>(`discovery:resolver:${candidateId}:${versionId}`,'jgrants','discovery_resolver',{
          value:{id:s.id,versionId,title:s.title,acceptanceStart:s.acceptanceStart,acceptanceEnd:s.acceptanceEnd,expiresAt:now+30*60_000},fetchedAt:now,expiresAt:now+30*60_000,staleUntil:now+30*60_000});}
        catch{warnings.push('detail_context_not_saved');}
      }
    }
    const mapped=new Set(mh.items.map(i=>i.jgrantsId).filter(Boolean));
    const all=[...mh.items,...jgItems.filter(i=>!mapped.has(i.jgrantsId))];
    const filtered=all.filter(c=>q.status_scope==='all'||c.state==='unknown'||c.state==='active'||q.status_scope==='active_and_scheduled'&&c.state==='scheduled');
    filtered.sort((a,b)=>b.score-a.score||a.candidateId.localeCompare(b.candidateId));
    snapshot={catalogReleaseId:mh.releaseId,candidates:filtered,coverage:{mhlw:mh.coverage,jgrants:jcov},
      counts:{fetched:mh.coverage.fetchedCount+jgItems.length,deduplicated:mh.items.length+jgItems.length-all.length,filtered:all.length-filtered.length,matching:filtered.length},
      queryHash,expiresAt:now+30*60_000,warnings:[...new Set(warnings)]};
    if(cache&&secret)try{await cache.put(`discovery:snapshot:${snapshotId}`,'discovery','search_snapshot',{value:snapshot,fetchedAt:now,expiresAt:snapshot.expiresAt,staleUntil:snapshot.expiresAt});}
    catch{snapshot.warnings.push('pagination_unavailable');}
    else if(filtered.length>q.limit)snapshot.warnings.push('pagination_requires_cache_and_secret');
  }
  const slice=await Promise.all(snapshot.candidates.slice(offset,offset+q.limit).map(async c=>{
    if(q.cursor&&c.source==='mhlw') {
      try{if(!env.subsidy_ai_relations)throw new Error();const repo=new CatalogRepository(env.subsidy_ai_relations),v=await repo.version(c.versionId);
        if(!v)throw new Error();return {...c,...await observe(repo,v,payloadSchema.parse(JSON.parse(v.payload_json)),now)};
      }catch{return {...c,detailStatus:'unavailable',sourceWarnings:['catalog_database_unavailable']};}
    }
    return c.freshUntil&&Date.parse(c.freshUntil)<=now?{...c,freshness:'stale' as const,detailStatus:['unavailable','update_pending'].includes(c.detailStatus)?c.detailStatus:'stale'}:c;
  }));
  const more=offset+q.limit<snapshot.candidates.length,canPage=!!cache&&!!secret&&!snapshot.warnings.some(w=>w.startsWith('pagination_'));
  const nextCursor=more&&canPage?btoa(JSON.stringify({id:snapshotId,offset:offset+q.limit,signature:await createPrivateCacheKey('discovery-cursor-v1',[snapshotId,offset+q.limit,queryHash],secret!)})):null;
  return searchOutputSchema.parse({schemaVersion:'1',catalogReleaseId:snapshot.catalogReleaseId,candidates:slice.filter(c=>c.state!=='unknown'),uncertainCandidates:slice.filter(c=>c.state==='unknown'),
    coverage:snapshot.coverage,counts:{...snapshot.counts,returned:slice.length},hasMore:!!nextCursor,nextCursor,servedAt:iso(now),responseGuidance:GUIDANCE,warnings:snapshot.warnings});
}

export async function getDiscoveredSubsidyDetail(raw:unknown,env:CatalogEnv,options:DiscoveryOptions={}) {
  const input=detailInputSchema.parse(raw),now=(options.now??Date.now)();
  const result={schemaVersion:'1' as const,status:'unavailable',candidateId:input.candidate_id,versionId:input.version_id??null,catalogReleaseId:null as string|null,
    data:null as Record<string,unknown>|null,missingFacts:[] as string[],warnings:[] as string[],responseGuidance:GUIDANCE,servedAt:iso(now)};
  if(input.candidate_id.startsWith('jg_')) {
    const cache=cacheFor(env,options);
    const resolver=input.version_id&&cache?await cache.get<Resolver>(`discovery:resolver:${input.candidate_id}:${input.version_id}`):null;
    if(!resolver||resolver.expiresAt<=now)return {...result,status:'candidate_context_expired',missingFacts:['制度を再検索してください。']};
    try {
      const detail=await (options.detail??getSubsidyDetail)(resolver.value.id,cacheOptions(env,options));
      const data=detail as Record<string,unknown>;
      // Compare the fields the current JGrants normalizer exposes, retaining both observation times.
      const d=(data.subsidy??data) as Record<string,unknown>;
      const changed=typeof d.title==='string'&&d.title!==resolver.value.title ||
        Array.isArray(d.workflows)&&!d.workflows.some(w=>w.acceptanceStart===resolver.value.acceptanceStart&&w.acceptanceEnd===resolver.value.acceptanceEnd);
      const stale=detail.cache.isStale;
      return {...result,status:changed?'changed_since_search':stale?'stale':'available',data:{...data,searchObservation:resolver.value},warnings:[...(changed?['検索時から名称・受付期間が変わったか、期間の対応を確認できません。']:[]),...(stale?['upstream_cache_stale']:[])]};
    }catch{return {...result,warnings:['jgrants_fetch_failed']};}
  }
  if(!enabled(env.MHLW_CATALOG_SERVING_ENABLED))return {...result,warnings:['catalog_disabled']};
  if(!env.subsidy_ai_relations)return {...result,warnings:['database_not_configured']};
  try {
    const repo=new CatalogRepository(env.subsidy_ai_relations),release=await repo.activeId();result.catalogReleaseId=release;
    const all=await repo.db.prepare(`SELECT DISTINCT v.* FROM discovery_candidate_versions v JOIN discovery_release_items i ON i.version_id=v.id JOIN discovery_release_activations a ON a.release_id=i.release_id WHERE v.candidate_id=? ORDER BY v.created_at DESC`)
      .bind(input.candidate_id).all<VersionRow>();
    let versions=all.results;
    if(input.version_id)versions=versions.filter(v=>v.id===input.version_id);
    else if(input.event_date)versions=versions.filter(v=>{
      const p=payloadSchema.parse(JSON.parse(v.payload_json));return p.effectiveFrom&&p.effectiveFrom<=input.event_date!&&(!p.effectiveTo||p.effectiveTo>=input.event_date!)&&input.event_type&&p.eventType===input.event_type;
    });
    else versions=[]; // Exact version or an applicable event is required; don't silently use the latest year.
    if(!versions.length)return {...result,status:all.results.length?'version_selection_required':'not_indexed',missingFacts:all.results.length?['検索結果のversionId、または取組日と取組の種類を指定してください。']:[]};
    if(versions.length>1)return {...result,status:'version_selection_required',data:{versions:versions.map(v=>({versionId:v.id,...((p)=>({title:p.title,effectiveFrom:p.effectiveFrom,effectiveTo:p.effectiveTo,eventType:p.eventType}))(payloadSchema.parse(JSON.parse(v.payload_json)))}))},missingFacts:['適用する資料版を選択してください。']};
    const v=versions[0],p=payloadSchema.parse(JSON.parse(v.payload_json)),observation=await observe(repo,v,p,now);result.versionId=v.id;
    if(input.event_date&&(!p.effectiveFrom||p.effectiveFrom>input.event_date||p.effectiveTo&&p.effectiveTo<input.event_date||!input.event_type||input.event_type!==p.eventType))
      return {...result,status:'applicability_unconfirmed',missingFacts:['指定した取組日・種類への適用を、この版の根拠では確認できません。']};
    if(observation.detailStatus==='unavailable')return {...result,warnings:observation.sourceWarnings};
    const verifiedFacts=observation.detailStatus==='available'?p.facts.filter(f=>f.status==='reviewed'):[];
    const records=await repo.evidenceRecords(v.id);
    return {...result,status:observation.detailStatus,data:{...p,facts:verifiedFacts,...observation,
      sourceRecords:records.map(r=>({id:r.id,url:r.url,contentHash:r.content_hash,retrievedAt:iso(r.retrieved_at),lastVerifiedAt:iso(r.last_verified_at)})),
      attribution:'厚生労働省の公式情報を補助金AIが整理・加工。受給資格は未判定です。'},
      missingFacts:['取組日と事前手続きの状況を確認してください。',...(verifiedFacts.length?[]:['金額・期限・個別条件は公式資料で確認してください。'])],warnings:observation.sourceWarnings};
  }catch{return {...result,warnings:['catalog_database_unavailable']};}
}
