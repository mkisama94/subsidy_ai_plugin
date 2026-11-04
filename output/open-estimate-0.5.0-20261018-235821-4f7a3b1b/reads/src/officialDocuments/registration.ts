1: import { z } from "zod";
2: import { extractorSchema, policySchema, roundHash, iso, type Round } from "./types";
3: import { permittedUrl } from "./sourcePolicy";
4: 
5: export const sourceRegistrationSchema=z.object({
6:   id:z.string().uuid(),sourceKind:z.enum(["official_html","jgrants_detail"]),
7:   program:z.object({seriesKey:z.string().min(1).max(150),name:z.string().min(1).max(300),institutionName:z.string().min(1).max(300)}).strict(),
8:   round:z.object({subsidyId:z.string().regex(/^[A-Za-z0-9]{1,18}$/),fiscalYear:z.number().int().min(2000).max(2200),
9:     name:z.string().min(1).max(100),scopeKey:z.string().min(1).max(100),acceptanceStart:z.string().datetime({offset:true}).nullable(),
10:     acceptanceEnd:z.string().datetime({offset:true}).nullable(),workflowId:z.string().max(100).nullable()}).strict(),
11:   sourcePageUrl:z.string().url(),fetchUrl:z.string().url(),publisherName:z.string().min(1).max(300),
12:   registrationStatus:z.enum(["pending","approved","paused","revoked"]),
13:   trustEvidenceUrl:z.string().url(),trustEvidenceNote:z.string().min(10).max(500),approvedAt:z.string().datetime({offset:true}).nullable(),
14:   policy:policySchema,extractor:extractorSchema,
15: }).strict();
16: export const registrationFileSchema=z.object({schemaVersion:z.literal(1),sources:z.array(sourceRegistrationSchema).max(100)}).strict();
17: const sql=(value:unknown):string=>value===null?"NULL":typeof value==="number"?String(value):`'${String(value).replaceAll("'","''")}'`;
18: export async function registrationSql(raw:unknown,now=Date.now()):Promise<string> {
19:   const file=registrationFileSchema.parse(raw),statements:string[]=[];
20:   const ids=new Set<string>();
21:   for(const s of file.sources) {
22:     if(ids.has(s.id))throw new Error("duplicate source ID"); ids.add(s.id);
23:     permittedUrl(s.sourcePageUrl,s.policy,"pages");permittedUrl(s.fetchUrl,s.policy,"pages");
24:     if(s.registrationStatus==="approved"&&!s.approvedAt)throw new Error("approved source needs approvedAt");
25:     if(new URL(s.trustEvidenceUrl).protocol!=="https:" || s.approvedAt&&Date.parse(s.approvedAt)>now)throw new Error("invalid approval evidence");
26:     if(s.sourceKind==="jgrants_detail"&&s.fetchUrl!==`https://api.jgrants-portal.go.jp/exp/v2/public/subsidies/id/${s.round.subsidyId}`)throw new Error("invalid jGrants endpoint");
27:     const round:Round={id:0,program_series_key:s.program.seriesKey,canonical_name:s.program.name,fiscal_year:s.round.fiscalYear,round_name:s.round.name,scope_key:s.round.scopeKey,
28:       jgrants_subsidy_id:s.round.subsidyId,acceptance_start:s.round.acceptanceStart,acceptance_end:s.round.acceptanceEnd};
29:     const binding=await roundHash(round,s.round.workflowId),at=iso(now);
30:     statements.push(`INSERT INTO subsidy_programs(program_series_key,canonical_name,institution_name) VALUES(${sql(s.program.seriesKey)},${sql(s.program.name)},${sql(s.program.institutionName)}) ON CONFLICT(program_series_key) DO NOTHING;`);
31:     statements.push(`INSERT INTO subsidy_rounds(program_id,jgrants_subsidy_id,fiscal_year,round_name,scope_key,acceptance_start,acceptance_end,last_checked_at)
32:       SELECT id,${sql(s.round.subsidyId)},${s.round.fiscalYear},${sql(s.round.name)},${sql(s.round.scopeKey)},${sql(s.round.acceptanceStart)},${sql(s.round.acceptanceEnd)},${sql(at)}
33:       FROM subsidy_programs WHERE program_series_key=${sql(s.program.seriesKey)} AND canonical_name=${sql(s.program.name)}
34:       ON CONFLICT(program_id,fiscal_year,round_name,scope_key) DO NOTHING;`);
35:     const fields={source_kind:s.sourceKind,source_page_url:s.sourcePageUrl,fetch_url:s.fetchUrl,publisher_name:s.publisherName,jgrants_workflow_id:s.round.workflowId,
36:       registration_status:s.registrationStatus,trust_evidence_url:s.trustEvidenceUrl,trust_evidence_note:s.trustEvidenceNote,approved_at:s.approvedAt,
37:       round_binding_hash:binding,fetch_policy_json:JSON.stringify(s.policy),extractor_config_json:JSON.stringify(s.extractor)};
38:     statements.push(`INSERT INTO official_document_sources(id,subsidy_round_id,${Object.keys(fields).join(",")},approval_revision,next_refresh_at,created_at,updated_at)
39:       SELECT ${sql(s.id)},r.id,${Object.values(fields).map(sql).join(",")},1,${sql(at)},${sql(at)},${sql(at)}
40:       FROM subsidy_rounds r JOIN subsidy_programs p ON p.id=r.program_id WHERE p.program_series_key=${sql(s.program.seriesKey)} AND p.canonical_name=${sql(s.program.name)}
41:       AND r.jgrants_subsidy_id=${sql(s.round.subsidyId)} AND r.fiscal_year=${s.round.fiscalYear} AND r.round_name=${sql(s.round.name)} AND r.scope_key=${sql(s.round.scopeKey)}
42:       AND r.acceptance_start IS ${sql(s.round.acceptanceStart)} AND r.acceptance_end IS ${sql(s.round.acceptanceEnd)}
43:       ON CONFLICT(id) DO UPDATE SET ${Object.keys(fields).map(f=>`${f}=excluded.${f}`).join(",")},approval_revision=official_document_sources.approval_revision+1,
44:       lease_token=NULL,lease_until=NULL,next_refresh_at=excluded.next_refresh_at,updated_at=excluded.updated_at,last_error_code=NULL
45:       WHERE official_document_sources.subsidy_round_id=excluded.subsidy_round_id;`);
46:   }
47:   return statements.join("\n");
48: }