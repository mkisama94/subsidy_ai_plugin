import { DocumentRepository } from "./repository";
import { DocumentError, EXTRACTOR_VERSION, enabled, extractorSchema, hash, iso, policySchema, refreshInterval, roundHash,
  type Candidate, type Document, type DocumentEnv, type Source } from "./types";
import { createNetwork, fetchResource, type Network } from "./sourcePolicy";
import { extractApi, extractHtml } from "./extract";
import { checkLink } from "./linkCheck";
import { classify } from "./classify";

export async function collectSource(repository: DocumentRepository, source: Source, options: {
  now?: () => number; network?: Network; ai?: DocumentEnv["DOCUMENT_AI"]; model?: string; dailyLimit?: number;
} = {}) {
  const now = options.now ?? Date.now, network = options.network ?? createNetwork(), requestStart=network.requests;
  const round = await repository.round(source.subsidy_round_id);
  if (!round) return { sourceId:source.id,status:"round_missing" };
  const interval = refreshInterval(round,now());
  if (interval === null) return {sourceId:source.id,status:"archived"};
  const claim = await repository.claim(source,now());
  if (!claim) return {sourceId:source.id,status:"busy"};
  const {runId,token} = claim;
  try {
    if (await roundHash(round,source.jgrants_workflow_id) !== source.round_binding_hash) throw new DocumentError("round_binding_changed");
    const policy = policySchema.parse(JSON.parse(source.fetch_policy_json)), config = extractorSchema.parse(JSON.parse(source.extractor_config_json));
    const previous = source.active_run_id ? await repository.run(source.active_run_id) : null;
    const previousDocs: Document[] = source.active_run_id ? (await repository.documents(source.active_run_id)).map(x=>JSON.parse(x.metadata_json)) : [];
    const previousByKey = new Map(previousDocs.map(d=>[d.documentKey,d]));
    const headers: Record<string,string> = { Accept:source.source_kind === "official_html"?"text/html,application/xhtml+xml":"application/json" };
    if (previous?.approval_revision === source.approval_revision && previous.extractor_version === EXTRACTOR_VERSION && previous.round_binding_hash === source.round_binding_hash) {
      if (previous.etag) headers["If-None-Match"] = previous.etag;
      else if (previous.last_modified) headers["If-Modified-Since"] = previous.last_modified;
    }
    const maxBytes=source.source_kind === "official_html"?2*1024*1024:10*1024*1024;
    let response = await fetchResource(source.fetch_url,policy,"pages",network,{headers,maxBytes});
    if (response.status === 304 && (!previous || !previous.extraction_complete || !(headers["If-None-Match"] || headers["If-Modified-Since"]))) {
      response = await fetchResource(source.fetch_url,policy,"pages",network,{maxBytes});
    }
    if (response.status !== 304 && !(response.status >= 200 && response.status < 300)) {
      const retry=response.headers.get("retry-after");
      const delay=retry ? /^\d+$/.test(retry)?Number(retry)*1000:Math.max(0,Date.parse(retry)-now()):undefined;
      throw new DocumentError([404,410].includes(response.status)?"source_gone":[401,403].includes(response.status)?"source_blocked":"upstream_error",undefined,Number.isFinite(delay)?delay:undefined);
    }
    const observedAt=iso(now());
    let candidates: Candidate[], bodyHash=previous?.page_body_hash ?? null, ignoredCount=0, explicitEmpty=false;
    if (response.status === 304) candidates=previousDocs;
    else if (source.source_kind === "official_html") {
      if (!/text\/html|application\/xhtml/.test(response.headers.get("content-type") ?? "")) throw new DocumentError("unexpected_content_type");
      const extracted=await extractHtml(response.body,source,config,policy,response.url);
      ({candidates,ignoredCount,explicitEmpty}=extracted); bodyHash=await hash(response.body);
    } else {
      if (!source.fetch_url.startsWith("https://api.jgrants-portal.go.jp/exp/v2/public/subsidies/id/") || !round.jgrants_subsidy_id ||
        new URL(source.fetch_url).pathname.split("/").pop() !== round.jgrants_subsidy_id) throw new DocumentError("invalid_api_source");
      const extracted=await extractApi(JSON.parse(response.body),source,config,policy,round.jgrants_subsidy_id);
      ({candidates,ignoredCount,explicitEmpty}=extracted); bodyHash=await hash(extracted.metadata);
    }
    if (!candidates.length && (previousDocs.length || ignoredCount) && !explicitEmpty) throw new DocumentError("empty_after_nonempty");
    const documents: Document[]=[], warnings:string[]=ignoredCount?["unapproved_links_omitted"]:[];
    for (const candidate of candidates) {
      if (Date.now() >= network.deadline) throw new DocumentError("processing_limit");
      const old=previousByKey.get(candidate.documentKey);
      const currentCandidate: Candidate={ documentKey:candidate.documentKey, resourceKind:candidate.resourceKind,fileUrl:candidate.fileUrl,
        sourcePageUrl:candidate.sourcePageUrl,webPageUrl:candidate.webPageUrl,originalTitle:candidate.originalTitle,fileName:candidate.fileName,fileType:candidate.fileType,
        fileTypeBasis:candidate.fileTypeBasis,contextExcerpt:candidate.contextExcerpt,sectionLocator:candidate.sectionLocator,
        associationStatus:candidate.associationStatus,associationBasis:candidate.associationBasis,typeHint:candidate.typeHint };
      const link = old?.linkStatus === "reachable" && old.linkFreshUntil && Date.parse(old.linkFreshUntil)>now() && old.fileUrl===candidate.fileUrl ? {
        linkStatus:old.linkStatus,linkLastCheckedAt:old.linkLastCheckedAt,linkLastSuccessAt:old.linkLastSuccessAt,linkFreshUntil:old.linkFreshUntil,
        linkHttpStatus:old.linkHttpStatus,linkCheckMethod:old.linkCheckMethod,resolvedUrl:old.resolvedUrl,mimeType:old.mimeType,
      } : await checkLink(candidate,policy,network,now(),interval);
      if (!link.linkLastSuccessAt && old) link.linkLastSuccessAt=old.linkLastSuccessAt;
      const classification=await classify(currentCandidate,source,round,repository,{ai:options.ai,model:options.model,dailyLimit:options.dailyLimit??0,runId,token,now});
      const document:Document={...currentCandidate,...classification,...link,discoveredAt:old?.discoveredAt??observedAt,sourceLastSeenAt:observedAt,sourcePublishedAt:null,sourceUpdatedAt:null};
      // Persist validated progress without publishing it. Retried jobs reuse expensive classifications.
      await repository.stage(runId,round,[document]);
      documents.push(document);
    }
    if (documents.some(d=>["broken","blocked","unverified","unsafe"].includes(d.linkStatus))) warnings.push("link_check_incomplete");
    if (documents.some(d=>d.associationStatus!=="confirmed")) warnings.push("round_association_unconfirmed");
    if (documents.some(d=>["failed","unclassified"].includes(d.classificationStatus))) warnings.push("classification_incomplete");
    const published=await repository.publish(source,round,runId,token,now(),{status:response.status===304?"not_modified":"succeeded",observedAt,
      httpStatus:response.status,finalUrl:response.url,bodyHash,linkHash:await hash(candidates.map(c=>[c.documentKey,c.originalTitle,c.contextExcerpt])),
      etag:response.headers.get("etag")??(response.status===304?previous?.etag:null)??null,lastModified:response.headers.get("last-modified")??(response.status===304?previous?.last_modified:null)??null,
      count:documents.length,published:documents.filter(d=>d.associationStatus==="confirmed").length,
      unclassified:documents.filter(d=>["unclassified","failed"].includes(d.classificationStatus)).length,warnings,requests:network.requests-requestStart,nextRefresh:now()+interval});
    return {sourceId:source.id,runId,status:published?"published":"superseded",count:documents.length,warnings};
  } catch(error) {
    const safe = error instanceof DocumentError?error:new DocumentError("collection_failed");
    await repository.fail(source,runId,token,now(),safe,network.requests-requestStart);
    return {sourceId:source.id,runId,status:"failed",reasonCode:safe.code};
  }
}
export async function collectDueSources(env: DocumentEnv) {
  if (!enabled(env.DOCUMENT_DISCOVERY_ENABLED)) return {status:"disabled",results:[]};
  const db=env.PUBLIC_CACHE??env.subsidy_ai_relations;
  if (!db) return {status:"unavailable",results:[]};
  const repo=new DocumentRepository(db), results=[];
  const deadline=Date.now()+180_000,network=createNetwork({deadline,maxRequests:200});
  for (const source of await repo.due(Date.now())) {
    if (Date.now()>=deadline || network.requests>network.maxRequests-105) break;
    results.push(await collectSource(repo,source,{network,
      ai:enabled(env.DOCUMENT_CLASSIFICATION_ENABLED)?env.DOCUMENT_AI:undefined,
      model:enabled(env.DOCUMENT_CLASSIFICATION_ENABLED)?env.DOCUMENT_CLASSIFICATION_MODEL:undefined,
      dailyLimit:Number(env.DOCUMENT_AI_DAILY_CALL_LIMIT??0)}));
  }
  await repo.cleanup(Date.now());
  return {status:"finished",results};
}
