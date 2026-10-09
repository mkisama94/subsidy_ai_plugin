import { z } from 'zod';
import { policySchema } from '../officialDocuments/types';

export const DAY = 86_400_000;
export const EXTRACTOR_VERSION = 'mhlw-html-v1';
export const enabled = (value?: string) => value === 'true';
export const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\u200b]+/g, '');
export const iso = (n: number) => new Date(n).toISOString();
export async function digest(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(b => b.toString(16).padStart(2,'0')).join('');
}
export class CatalogError extends Error {
  constructor(readonly code: string, readonly retryAfterMs?: number) { super(code); }
}
const id = z.string().min(1).max(150).regex(/^[a-zA-Z0-9_-]+$/);
export const courseSchema = z.object({
  id: z.string().uuid(), key: id, name: z.string().min(2).max(200),
  aliases: z.array(z.string().min(1).max(100)).max(20).default([]),
  purposeTags: z.array(z.string().min(1).max(100)).max(20).default([]),
}).strict();
export const sourceSchema = z.object({
  id, programName: z.string().min(2).max(200), publisher: z.literal('厚生労働省'),
  url: z.string().url(), selector: z.string().min(1).max(300),
  requiredText: z.array(z.string().min(2).max(200)).min(1).max(10),
  policy: policySchema, courses: z.array(courseSchema).min(1).max(50),
  termsUrl: z.string().url(), termsCheckedOn: z.string().date(),
  intervalHours: z.number().int().min(6).max(168).default(24),
  maxDocuments: z.number().int().min(1).max(100).default(40),
  dependencyPages: z.array(z.string().url()).max(5).default([]),
}).strict();
export const sourceFileSchema = z.object({ schemaVersion: z.literal(1), sources: z.array(sourceSchema).min(1).max(100) }).strict().refine(v=>{
  const ids=v.sources.flatMap(s=>s.courses.map(c=>c.id));
  return new Set(ids).size===ids.length&&new Set(v.sources.map(s=>s.id)).size===v.sources.length;
},'情報源IDとコースIDは重複できません。');
export type SourceConfig = z.infer<typeof sourceSchema>;
export type SourceRow = { id: string; config_json: string; revision: number; status: 'approved'|'paused'; next_refresh_at: number;
  lease_token: string|null; lease_until: number|null; last_success_at: number|null; last_attempt_at: number|null; last_error: string|null; failures: number };
export type RecordRow = { id: string; source_id: string; url: string; content_hash: string; mime_type: string; byte_length: number;
  retrieved_at: number; last_verified_at: number; etag: string|null; last_modified: string|null; extractor_version: string };
export const evidenceSchema = z.object({
  id: z.string().min(1), recordId: z.string().min(1), field: z.string().min(1).max(100),
  locator: z.string().min(1).max(300), excerpt: z.string().min(1).max(1000),
  verification: z.enum(['extracted','reviewed']),
}).strict();
export const factSchema = z.object({
  kind: z.enum(['amount','rate','eligibility','deadline','procedure','combination']),
  text: z.string().min(1).max(1000), unit: z.string().max(100).nullable(),
  conditions: z.string().min(1).max(1000), evidenceIds: z.array(z.string()).min(1).max(10),
  status: z.enum(['unconfirmed','reviewed','conflict']),
}).strict();
export const documentSchema = z.object({ title: z.string().max(300), url: z.string().url(),
  sourcePageUrl: z.string().url(), association: z.enum(['course','common','unconfirmed']) }).strict();
export const payloadSchema = z.object({
  candidateId: z.string().uuid(), sourceId: id, programName: z.string(), courseKey: id, courseName: z.string(),
  title: z.string().min(2).max(400), summary: z.string().max(1000),
  officialUrl: z.string().url(), fiscalYear: z.number().int().min(2000).max(2200).nullable(),
  state: z.enum(['active','scheduled','closed','unknown']), applicationType: z.enum(['event_based','fixed','unknown']),
  effectiveFrom: z.string().date().nullable(), effectiveTo: z.string().date().nullable(),
  eventType: z.enum(['training_start','hiring','conversion','leave_start','other','unknown']),
  applicabilityNote: z.string().max(1000),
  aliases: z.array(z.string()).max(20), purposeTags: z.array(z.string()).max(20), areas: z.array(z.string()).min(1).max(50),
  facts: z.array(factSchema).max(50), documents: z.array(documentSchema).max(100),
  evidence: z.array(evidenceSchema).min(1).max(100),
  detailLevel: z.enum(['overview_only','conditions_reviewed']),
}).strict();
export type CandidatePayload = z.infer<typeof payloadSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Fact = z.infer<typeof factSchema>;
export type VersionRow = { id: string; candidate_id: string; run_id: string; source_revision: number;
  payload_json: string; content_hash: string; review_status: string; created_at: number };
export type DocumentJob = { id: string; source_id: string; source_revision: number; url: string; title: string;
  status: string; record_id: string|null; fragments_json: string|null; next_refresh_at: number; lease_token: string|null;
  lease_until: number|null; attempts: number; last_error: string|null; last_seen_at: number };
export const jobMessageSchema = z.object({ jobId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type CatalogEnv = {
  subsidy_ai_relations?: D1Database; PUBLIC_CACHE?: D1Database; CACHE_KEY_SECRET?: string;
  MHLW_INGESTION_ENABLED?: string; MHLW_AI_EXTRACTION_ENABLED?: string;
  MHLW_CATALOG_SERVING_ENABLED?: string; SUBSIDY_DISCOVERY_TOOLS_ENABLED?: string; MHLW_DISCOVERY_GUIDANCE_ENABLED?: string;
  MHLW_PDF_QUEUE?: Queue<{jobId:string}>; MHLW_AI?: {run(model:string,input:Record<string,unknown>):Promise<unknown>};
  MHLW_AI_MODEL?: string; MHLW_AI_DAILY_CALL_LIMIT?: string;
};
