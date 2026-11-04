1: import { z } from 'zod';
2: import { policySchema } from '../officialDocuments/types';
3: 
4: export const DAY = 86_400_000;
5: export const EXTRACTOR_VERSION = 'mhlw-html-v1';
6: export const enabled = (value?: string) => value === 'true';
7: export const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\u200b]+/g, '');
8: export const iso = (n: number) => new Date(n).toISOString();
9: export async function digest(data: string | Uint8Array): Promise<string> {
10:   const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
11:   return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(b => b.toString(16).padStart(2,'0')).join('');
12: }
13: export class CatalogError extends Error {
14:   constructor(readonly code: string, readonly retryAfterMs?: number) { super(code); }
15: }
16: const id = z.string().min(1).max(150).regex(/^[a-zA-Z0-9_-]+$/);
17: export const courseSchema = z.object({
18:   id: z.string().uuid(), key: id, name: z.string().min(2).max(200),
19:   aliases: z.array(z.string().min(1).max(100)).max(20).default([]),
20:   purposeTags: z.array(z.string().min(1).max(100)).max(20).default([]),
21: }).strict();
22: export const sourceSchema = z.object({
23:   id, programName: z.string().min(2).max(200), publisher: z.literal('厚生労働省'),
24:   url: z.string().url(), selector: z.string().min(1).max(300),
25:   requiredText: z.array(z.string().min(2).max(200)).min(1).max(10),
26:   policy: policySchema, courses: z.array(courseSchema).min(1).max(50),
27:   termsUrl: z.string().url(), termsCheckedOn: z.string().date(),
28:   intervalHours: z.number().int().min(6).max(168).default(24),
29:   maxDocuments: z.number().int().min(1).max(100).default(40),
30:   dependencyPages: z.array(z.string().url()).max(5).default([]),
31: }).strict();
32: export const sourceFileSchema = z.object({ schemaVersion: z.literal(1), sources: z.array(sourceSchema).min(1).max(100) }).strict().refine(v=>{
33:   const ids=v.sources.flatMap(s=>s.courses.map(c=>c.id));
34:   return new Set(ids).size===ids.length&&new Set(v.sources.map(s=>s.id)).size===v.sources.length;
35: },'情報源IDとコースIDは重複できません。');
36: export type SourceConfig = z.infer<typeof sourceSchema>;
37: export type SourceRow = { id: string; config_json: string; revision: number; status: 'approved'|'paused'; next_refresh_at: number;
38:   lease_token: string|null; lease_until: number|null; last_success_at: number|null; last_attempt_at: number|null; last_error: string|null; failures: number };
39: export type RecordRow = { id: string; source_id: string; url: string; content_hash: string; mime_type: string; byte_length: number;
40:   retrieved_at: number; last_verified_at: number; etag: string|null; last_modified: string|null; extractor_version: string };
41: export const evidenceSchema = z.object({
42:   id: z.string().min(1), recordId: z.string().min(1), field: z.string().min(1).max(100),
43:   locator: z.string().min(1).max(300), excerpt: z.string().min(1).max(1000),
44:   verification: z.enum(['extracted','reviewed']),
45: }).strict();
46: export const factSchema = z.object({
47:   kind: z.enum(['amount','rate','eligibility','deadline','procedure','combination']),
48:   text: z.string().min(1).max(1000), unit: z.string().max(100).nullable(),
49:   conditions: z.string().min(1).max(1000), evidenceIds: z.array(z.string()).min(1).max(10),
50:   status: z.enum(['unconfirmed','reviewed','conflict']),
51: }).strict();
52: export const documentSchema = z.object({ title: z.string().max(300), url: z.string().url(),
53:   sourcePageUrl: z.string().url(), association: z.enum(['course','common','unconfirmed']) }).strict();
54: export const payloadSchema = z.object({
55:   candidateId: z.string().uuid(), sourceId: id, programName: z.string(), courseKey: id, courseName: z.string(),
56:   title: z.string().min(2).max(400), summary: z.string().max(1000),
57:   officialUrl: z.string().url(), fiscalYear: z.number().int().min(2000).max(2200).nullable(),
58:   state: z.enum(['active','scheduled','closed','unknown']), applicationType: z.enum(['event_based','fixed','unknown']),
59:   effectiveFrom: z.string().date().nullable(), effectiveTo: z.string().date().nullable(),
60:   eventType: z.enum(['training_start','hiring','conversion','leave_start','other','unknown']),
61:   applicabilityNote: z.string().max(1000),
62:   aliases: z.array(z.string()).max(20), purposeTags: z.array(z.string()).max(20), areas: z.array(z.string()).min(1).max(50),
63:   facts: z.array(factSchema).max(50), documents: z.array(documentSchema).max(100),
64:   evidence: z.array(evidenceSchema).min(1).max(100),
65:   detailLevel: z.enum(['overview_only','conditions_reviewed']),
66: }).strict();
67: export type CandidatePayload = z.infer<typeof payloadSchema>;
68: export type Evidence = z.infer<typeof evidenceSchema>;
69: export type Fact = z.infer<typeof factSchema>;
70: export type VersionRow = { id: string; candidate_id: string; run_id: string; source_revision: number;
71:   payload_json: string; content_hash: string; review_status: string; created_at: number };
72: export type DocumentJob = { id: string; source_id: string; source_revision: number; url: string; title: string;
73:   status: string; record_id: string|null; fragments_json: string|null; next_refresh_at: number; lease_token: string|null;
74:   lease_until: number|null; attempts: number; last_error: string|null; last_seen_at: number };
75: export const jobMessageSchema = z.object({ jobId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
76: export type CatalogEnv = {
77:   subsidy_ai_relations?: D1Database; PUBLIC_CACHE?: D1Database; CACHE_KEY_SECRET?: string;
78:   MHLW_INGESTION_ENABLED?: string; MHLW_AI_EXTRACTION_ENABLED?: string;
79:   MHLW_CATALOG_SERVING_ENABLED?: string; SUBSIDY_DISCOVERY_TOOLS_ENABLED?: string; MHLW_DISCOVERY_GUIDANCE_ENABLED?: string;
80:   MHLW_PDF_QUEUE?: Queue<{jobId:string}>; MHLW_AI?: {run(model:string,input:Record<string,unknown>):Promise<unknown>};
81:   MHLW_AI_MODEL?: string; MHLW_AI_DAILY_CALL_LIMIT?: string;
82: };