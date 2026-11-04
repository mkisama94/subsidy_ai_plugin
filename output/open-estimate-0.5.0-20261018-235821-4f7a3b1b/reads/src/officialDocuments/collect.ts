1: import { DocumentRepository } from "./repository";
2: import { DocumentError, EXTRACTOR_VERSION, enabled, extractorSchema, hash, iso, policySchema, refreshInterval, roundHash,
3:   type Candidate, type Document, type DocumentEnv, type Source } from "./types";
4: import { createNetwork, fetchResource, type Network } from "./sourcePolicy";
5: import { extractApi, extractHtml } from "./extract";
6: import { checkLink } from "./linkCheck";
7: import { classify } from "./classify";
8: 
9: export async function collectSource(repository: DocumentRepository, source: Source, options: {
10:   now?: () => number; network?: Network; ai?: DocumentEnv["DOCUMENT_AI"]; model?: string; dailyLimit?: number;
11: } = {}) {
12:   const now = options.now ?? Date.now, network = options.network ?? createNetwork(), requestStart=network.requests;
13:   const round = await repository.round(source.subsidy_round_id);
14:   if (!round) return { sourceId:source.id,status:"round_missing" };
15:   const interval = refreshInterval(round,now());
16:   if (interval === null) return {sourceId:source.id,status:"archived"};
17:   const claim = await repository.claim(source,now());
18:   if (!claim) return {sourceId:source.id,status:"busy"};
19:   const {runId,token} = claim;
20:   try {
21:     if (await roundHash(round,source.jgrants_workflow_id) !== source.round_binding_hash) throw new DocumentError("round_binding_changed");
22:     const policy = policySchema.parse(JSON.parse(source.fetch_policy_json)), config = extractorSchema.parse(JSON.parse(source.extractor_config_json));
23:     const previous = source.active_run_id ? await repository.run(source.active_run_id) : null;
24:     const previousDocs: Document[] = source.active_run_id ? (await repository.documents(source.active_run_id)).map(x=>JSON.parse(x.metadata_json)) : [];
25:     const previousByKey = new Map(previousDocs.map(d=>[d.documentKey,d]));
26:     const headers: Record<string,string> = { Accept:source.source_kind === "official_html"?"text/html,application/xhtml+xml":"application/json" };
27:     if (previous?.approval_revision === source.approval_revision && previous.extractor_version === EXTRACTOR_VERSION && previous.round_binding_hash === source.round_binding_hash) {
28:       if (previous.etag) headers["If-None-Match"] = previous.etag;
29:       else if (previous.last_modified) headers["If-Modified-Since"] = previous.last_modified;
30:     }
31:     const maxBytes=source.source_kind === "official_html"?2*1024*1024:10*1024*1024;
32:     let response = await fetchResource(source.fetch_url,policy,"pages",network,{headers,maxBytes});
33:     if (response.status === 304 && (!previous || !previous.extraction_complete || !(headers["If-None-Match"] || headers["If-Modified-Since"]))) {
34:       response = await fetchResource(source.fetch_url,policy,"pages",network,{maxBytes});
35:     }
36:     if (response.status !== 304 && !(response.status >= 200 && response.status < 300)) {
37:       const retry=response.headers.get("retry-after");
38:       const delay=retry ? /^\d+$/.test(retry)?Number(retry)*1000:Math.max(0,Date.parse(retry)-now()):undefined;
39:       throw new DocumentError([404,410].includes(response.status)?"source_gone":[401,403].includes(response.status)?"source_blocked":"upstream_error",undefined,Number.isFinite(delay)?delay:undefined);
40:     }
41:     const observedAt=iso(now());
42:     let candidates: Candidate[], bodyHash=previous?.page_body_hash ?? null, ignoredCount=0, explicitEmpty=false;
43:     if (response.status === 304) candidates=previousDocs;
44:     else if (source.source_kind === "official_html") {
45:       if (!/text\/html|application\/xhtml/.test(response.headers.get("content-type") ?? "")) throw new DocumentError("unexpected_content_type");
46:       const extracted=await extractHtml(response.body,source,config,policy,response.url);
47:       ({candidates,ignoredCount,explicitEmpty}=extracted); bodyHash=await hash(response.body);
48:     } else {
49:       if (!source.fetch_url.startsWith("https://api.jgrants-portal.go.jp/exp/v2/public/subsidies/id/") || !round.jgrants_subsidy_id ||
50:         new URL(source.fetch_url).pathname.split("/").pop() !== round.jgrants_subsidy_id) throw new DocumentError("invalid_api_source");
51:       const extracted=await extractApi(JSON.parse(response.body),source,config,policy,round.jgrants_subsidy_id);
52:       ({candidates,ignoredCount,explicitEmpty}=extracted); bodyHash=await hash(extracted.metadata);
53:     }
54:     if (!candidates.length && (previousDocs.length || ignoredCount) && !explicitEmpty) throw new DocumentError("empty_after_nonempty");
55:     const documents: Document[]=[], warnings:string[]=ignoredCount?["unapproved_links_omitted"]:[];
56:     for (const candidate of candidates) {
57:       if (Date.now() >= network.deadline) throw new DocumentError("processing_limit");
58:       const old=previousByKey.get(candidate.documentKey);
59:       const currentCandidate: Candidate={ documentKey:candidate.documentKey, resourceKind:candidate.resourceKind,fileUrl:candidate.fileUrl,
60:         sourcePageUrl:candidate.sourcePageUrl,webPageUrl:candidate.webPageUrl,originalTitle:candidate.originalTitle,fileName:candidate.fileName,fileType:candidate.fileType,
61:         fileTypeBasis:candidate.fileTypeBasis,contextExcerpt:candidate.contextExcerpt,sectionLocator:candidate.sectionLocator,
62:         associationStatus:candidate.associationStatus,associationBasis:candidate.associationBasis,typeHint:candidate.typeHint };
63:       const link = old?.linkStatus === "reachable" && old.linkFreshUntil && Date.parse(old.linkFreshUntil)>now() && old.fileUrl===candidate.fileUrl ? {
64:         linkStatus:old.linkStatus,linkLastCheckedAt:old.linkLastCheckedAt,linkLastSuccessAt:old.linkLastSuccessAt,linkFreshUntil:old.linkFreshUntil,
65:         linkHttpStatus:old.linkHttpStatus,linkCheckMethod:old.linkCheckMethod,resolvedUrl:old.resolvedUrl,mimeType:old.mimeType,
66:       } : await checkLink(candidate,policy,network,now(),interval);
67:       if (!link.linkLastSuccessAt && old) link.linkLastSuccessAt=old.linkLastSuccessAt;
68:       const classification=await classify(currentCandidate,source,round,repository,{ai:options.ai,model:options.model,dailyLimit:options.dailyLimit??0,runId,token,now});
69:       const document:Document={...currentCandidate,...classification,...link,discoveredAt:old?.discoveredAt??observedAt,sourceLastSeenAt:observedAt,sourcePublishedAt:null,sourceUpdatedAt:null};
70:       // Persist validated progress without publishing it. Retried jobs reuse expensive classifications.
71:       await repository.stage(runId,round,[document]);
72:       documents.push(document);
73:     }
74:     if (documents.some(d=>["broken","blocked","unverified","unsafe"].includes(d.linkStatus))) warnings.push("link_check_incomplete");
75:     if (documents.some(d=>d.associationStatus!=="confirmed")) warnings.push("round_association_unconfirmed");
76:     if (documents.some(d=>["failed","unclassified"].includes(d.classificationStatus))) warnings.push("classification_incomplete");
77:     const published=await repository.publish(source,round,runId,token,now(),{status:response.status===304?"not_modified":"succeeded",observedAt,
78:       httpStatus:response.status,finalUrl:response.url,bodyHash,linkHash:await hash(candidates.map(c=>[c.documentKey,c.originalTitle,c.contextExcerpt])),
79:       etag:response.headers.get("etag")??(response.status===304?previous?.etag:null)??null,lastModified:response.headers.get("last-modified")??(response.status===304?previous?.last_modified:null)??null,
80:       count:documents.length,published:documents.filter(d=>d.associationStatus==="confirmed").length,
81:       unclassified:documents.filter(d=>["unclassified","failed"].includes(d.classificationStatus)).length,warnings,requests:network.requests-requestStart,nextRefresh:now()+interval});
82:     return {sourceId:source.id,runId,status:published?"published":"superseded",count:documents.length,warnings};
83:   } catch(error) {
84:     const safe = error instanceof DocumentError?error:new DocumentError("collection_failed");
85:     await repository.fail(source,runId,token,now(),safe,network.requests-requestStart);
86:     return {sourceId:source.id,runId,status:"failed",reasonCode:safe.code};
87:   }
88: }
89: export async function collectDueSources(env: DocumentEnv) {
90:   if (!enabled(env.DOCUMENT_DISCOVERY_ENABLED)) return {status:"disabled",results:[]};
91:   const db=env.PUBLIC_CACHE??env.subsidy_ai_relations;
92:   if (!db) return {status:"unavailable",results:[]};
93:   const repo=new DocumentRepository(db), results=[];
94:   const deadline=Date.now()+180_000,network=createNetwork({deadline,maxRequests:200});
95:   for (const source of await repo.due(Date.now())) {
96:     if (Date.now()>=deadline || network.requests>network.maxRequests-105) break;
97:     results.push(await collectSource(repo,source,{network,
98:       ai:enabled(env.DOCUMENT_CLASSIFICATION_ENABLED)?env.DOCUMENT_AI:undefined,
99:       model:enabled(env.DOCUMENT_CLASSIFICATION_ENABLED)?env.DOCUMENT_CLASSIFICATION_MODEL:undefined,
100:       dailyLimit:Number(env.DOCUMENT_AI_DAILY_CALL_LIMIT??0)}));
101:   }
102:   await repo.cleanup(Date.now());
103:   return {status:"finished",results};
104: }