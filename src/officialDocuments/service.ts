import { z } from "zod";
import { DocumentRepository } from "./repository";
import { DocumentError, DOCUMENT_TYPES, DAY, enabled, hash, inputSchema, iso, policySchema, refreshInterval, roundHash,
  type Document, type DocumentEnv, type DocumentsInput, type Round, type Source } from "./types";
import { permittedUrl } from "./sourcePolicy";

const labels = { available:"登録済みの公式資料があります",partial:"一部の資料情報は確認中です",stale:"資料情報の再確認が必要です",
  not_indexed:"資料情報はまだ登録・収集されていません",round_selection_required:"公募回を選択してください",no_documents_found:"登録済みの掲載箇所では資料が見つかりませんでした",
  expired:"資料情報の確認期限を過ぎています",unavailable:"資料情報を現在提供できません" };
const guidance={scope:"登録済みの公式掲載ページで確認した資料一覧です。申請に必要な資料がすべて揃ったことを保証するものではありません。",
  classification:"用途説明は掲載名や周辺説明に基づく整理です。原本の内容や利用者ごとの必要性を確認した結果ではありません。AIによる説明と公式原文を区別してください。",
  dates:"掲載確認日時とリンク確認日時を区別し、未収集・古い情報を最新確認済みと説明しないでください。"};
const terminalErrors=new Set(["source_gone","source_blocked","unsafe_url","unsafe_dns","redirect_limit","round_binding_changed"]);
export function sourceFreshness(source:Source,round:Round,now:number):"fresh"|"stale"|"expired"|"unknown" {
  if (!source.last_success_at) return "unknown";
  const last=Date.parse(source.last_success_at), interval=refreshInterval(round,now);
  if (interval===null || !Number.isFinite(last) || now>=last+(interval??DAY)+7*DAY) return "expired";
  if (now>=last+interval || source.last_error_code || ["failed","partial"].includes(source.last_attempt_status??"")) return "stale";
  return "fresh";
}
function roundView(r:Round) { return {id:r.id,programName:r.canonical_name,fiscalYear:r.fiscal_year,roundName:r.round_name,scopeKey:r.scope_key}; }
const revisionOf=(sources:Source[],round:Round)=>hash([round,sources.map(s=>[s.id,s.active_run_id,s.registration_status,s.approval_revision,s.round_binding_hash,s.last_attempt_status,s.last_error_code,s.last_success_at])]);
const cursorSchema=z.object({revision:z.string().length(64),filter:z.string().length(64),at:z.number().finite(),offset:z.number().int().min(0).max(100000)}).strict();
function encodeCursor(value:unknown) { return btoa(JSON.stringify(value)); }
function decodeCursor(value:string) { try { return cursorSchema.parse(JSON.parse(atob(value))); } catch { throw new DocumentError("invalid_input","ページの継続情報が不正です。"); } }
export async function getSubsidyDocuments(raw:DocumentsInput,env:DocumentEnv,clock:()=>number=Date.now) {
  const parsed=inputSchema.safeParse(raw);
  if (!parsed.success) throw new DocumentError("invalid_input","制度IDや公募回などの入力を確認してください。");
  const input=parsed.data,now=clock();
  const base={schemaVersion:"1.0",subsidyId:input.subsidy_id,documents:[] as unknown[],referenceDocuments:[] as unknown[],sources:[] as unknown[],warnings:[] as {reasonCode:string;message:string}[],
    coverage:{scope:"registered_sources_only",requiredSetVerified:false,registeredSourceCount:0,successfulSourceCount:0,completeExtractionSourceCount:0,warningSourceCount:0},
    matchedCount:0,servedAt:iso(now),nextCursor:null as string|null,responseGuidance:guidance};
  const state=(status:keyof typeof labels,extra:Record<string,unknown>={})=>({...base,status,statusLabel:labels[status],...extra});
  if (!enabled(env.OFFICIAL_DOCUMENTS_ENABLED)) return state("unavailable",{reasonCode:"feature_disabled"});
  const db=env.PUBLIC_CACHE??env.subsidy_ai_relations;
  if (!db) return state("unavailable",{reasonCode:"database_not_configured"});
  try {
    const repository=new DocumentRepository(db), rounds=await repository.rounds(input.subsidy_id);
    let round=rounds.find(r=>r.id===input.round_id);
    if (input.round_id && !round) throw new DocumentError("round_mismatch","指定した制度と公募回の対応を確認できません。");
    if (!round) {
      const choices:Round[]=[];
      for(const r of rounds) if ((await repository.sources(r.id)).some(s=>s.registration_status==="approved")) choices.push(r);
      if(choices.length>1) return state("round_selection_required",{roundCandidates:choices.map(roundView)});
      round=choices[0];
    }
    if (!round) return state("not_indexed");
    const sources=await repository.sources(round.id);
    if (!sources.length) return state("not_indexed",{round:roundView(round)});
    if(sources.length>50) return state("unavailable",{reasonCode:"source_count_limit"});
    const revision=await revisionOf(sources,round), filter=await hash([input.subsidy_id,round.id,input.document_types??null,input.include_reference,input.limit]);
    const cursor=input.cursor?decodeCursor(input.cursor):{revision,filter,at:now,offset:0};
    if(cursor.revision!==revision || cursor.filter!==filter || cursor.at>now || now-cursor.at>=300_000) throw new DocumentError("cursor_expired","資料一覧が更新されました。先頭から取得してください。");
    const items:{reference:boolean;value:ReturnType<typeof project>;key:string}[]=[];
    let successful=0,complete=0,warnSources=0,staleSources=0,expiredSources=0,candidateCount=0,activeCount=0;
    for(const source of sources) {
      if(source.registration_status!=="approved") continue;
      activeCount++;
      const mismatch=await roundHash(round,source.jgrants_workflow_id)!==source.round_binding_hash;
      if(mismatch) {base.warnings.push({reasonCode:"round_binding_changed",message:"公募回の対応が変更されたため資料の公開を保留しています。"});warnSources++;continue;}
      const policy=policySchema.parse(JSON.parse(source.fetch_policy_json));
      try {permittedUrl(source.source_page_url,policy,"pages");} catch {warnSources++;continue;}
      base.sources.push({sourcePageUrl:source.source_page_url,lastAttemptAt:source.last_attempt_at,lastSuccessAt:source.last_success_at,latestAttemptStatus:source.last_attempt_status});
      const freshness=sourceFreshness(source,round,cursor.at),realFreshness=sourceFreshness(source,round,now);
      if(freshness==="stale") staleSources++;
      if(freshness==="expired") expiredSources++;
      if(source.last_error_code && terminalErrors.has(source.last_error_code)) {warnSources++;base.warnings.push({reasonCode:source.last_error_code,message:"掲載元を再確認できないため現行の資料一覧から除外しています。"});continue;}
      if(!source.active_run_id) {if(source.last_attempt_status)warnSources++;continue;}
      const run=await repository.run(source.active_run_id);
      if(!run || run.approval_revision!==source.approval_revision || run.round_binding_hash!==source.round_binding_hash) {warnSources++;continue;}
      successful++; if(run.extraction_complete)complete++;
      const warnings:string[]=JSON.parse(run.warnings_json);
      if(warnings.length || ["failed","partial"].includes(source.last_attempt_status??"")) {
        warnSources++;base.warnings.push({reasonCode:source.last_error_code??warnings[0]??"verification_pending",message:"一部の資料・説明・掲載情報は確認中です。"});
      }
      const current=await repository.documents(source.active_run_id),currentKeys=new Set(current.map(d=>d.document_key));
      const records=input.include_reference?[...current,...(await repository.history(source.id)).filter(d=>!currentKeys.has(d.document_key))]:current;
      candidateCount+=current.length;
      for(const record of records) {
        const doc:Document=JSON.parse(record.metadata_json);
        if(doc.linkStatus==="unsafe") continue;
        try { permittedUrl(doc.sourcePageUrl,policy,"pages"); if(doc.webPageUrl)permittedUrl(doc.webPageUrl,policy,"pages"); if(doc.fileUrl)permittedUrl(doc.fileUrl,policy,"files"); } catch {continue;}
        const reference=record.run_id!==source.active_run_id || doc.associationStatus!=="confirmed" || freshness==="expired" || freshness==="unknown";
        if(reference&&!input.include_reference) continue;
        const reason=record.run_id!==source.active_run_id?"removed_from_source":doc.associationStatus!=="confirmed"?"round_association_unconfirmed":freshness;
        items.push({reference,value:project(doc,freshness,realFreshness,now,reference,reason),key:`${reference?1:0}:${String(DOCUMENT_TYPES.indexOf(doc.documentType)).padStart(2,"0")}:${doc.originalTitle}:${doc.documentKey}`});
      }
    }
    const currentItems=items.filter(x=>!x.reference);
    let status:keyof typeof labels;
    if(!activeCount)status="not_indexed";
    else if(currentItems.length && currentItems.every(x=>x.value.freshness==="stale"))status="stale";
    else if(warnSources || candidateCount && !currentItems.length && !expiredSources)status="partial";
    else if(expiredSources && !currentItems.length)status="expired";
    else if(!successful)status=sources.some(s=>s.last_attempt_at)?"unavailable":"not_indexed";
    else if(!candidateCount && successful===activeCount)status="no_documents_found";
    else if(successful!==activeCount)status="partial";
    else status="available";
    const filtered=items.filter(x=>!input.document_types || input.document_types.includes(x.value.documentType)).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
    const page=filtered.slice(cursor.offset,cursor.offset+input.limit);
    const freshRound=await repository.round(round.id);
    if(!freshRound || await revisionOf(await repository.sources(round.id),freshRound)!==revision) throw new DocumentError("cursor_expired","資料一覧が更新されました。先頭から取得してください。");
    return state(status,{round:roundView(round),documents:page.filter(x=>!x.reference).map(x=>x.value),referenceDocuments:page.filter(x=>x.reference).map(x=>x.value),matchedCount:filtered.length,
      coverage:{...base.coverage,registeredSourceCount:activeCount,successfulSourceCount:successful,completeExtractionSourceCount:complete,warningSourceCount:warnSources},
      nextCursor:cursor.offset+page.length<filtered.length?encodeCursor({...cursor,offset:cursor.offset+page.length}):null});
  } catch(error) {
    if(error instanceof DocumentError)throw error;
    return state("unavailable",{reasonCode:"database_unavailable"});
  }
}
function project(doc:Document,freshness:string,realFreshness:string,now:number,reference:boolean,reason:string) {
  const download=!reference&&realFreshness==="fresh"&&doc.linkStatus==="reachable"&&doc.fileUrl&&doc.linkFreshUntil&&Date.parse(doc.linkFreshUntil)>now;
  return {documentId:doc.documentKey,originalTitle:doc.originalTitle,title:doc.displayTitle,documentType:doc.documentType,purposeSummary:doc.purposeSummary,
    classificationStatus:doc.classificationStatus,classificationBasis:"link_context",stage:doc.stage,associationStatus:doc.associationStatus,
    fileType:doc.fileType,fileTypeBasis:doc.fileTypeBasis,fileUrl:download?doc.fileUrl:null,sourcePageUrl:doc.sourcePageUrl,webPageUrl:doc.webPageUrl,
    sourceUpdatedAt:doc.sourceUpdatedAt,sourceLastSeenAt:doc.sourceLastSeenAt,linkStatus:doc.linkStatus,linkLastCheckedAt:doc.linkLastCheckedAt,
    linkLastSuccessAt:doc.linkLastSuccessAt,freshness,recommendedAction:download?"download_official_file":"open_source_page",
    ...(reference?{referenceReason:reason}:{})};
}
