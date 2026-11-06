import { z } from 'zod';
import { caseSchema } from '../../src/applicationAssist/schema';
import { enrichCompany } from '../../src/applicationAssist/company';
import type { getCorporateIdentity } from '../../src/nta';
import type { getCompanyProfile } from '../../src/gbizinfo';
import { readJson, writePackage } from './storage';

const row = z.object({ corporateNumber: z.string().regex(/^\d{13}$/), name: z.string().nullable(), location: z.string().nullable(), updateDate: z.string().nullable() }).passthrough();
function unwrap(result: { isError?: boolean; content?: { type: string; text?: string }[]; structuredContent?: unknown }) {
  if (result.isError) throw new Error('Upstream tool failed');
  return result.structuredContent ?? JSON.parse(result.content?.find(b => b.type === 'text')?.text ?? 'null');
}
// Snapshot is an internal local file written from actual connected-tool results.
// The reviewed original corporateNumber is still required; never infer it from the API.
export async function importApi(casePath: string, snapshotPath: string) {
  const c = caseSchema.parse(await readJson(casePath));
  const snapshot = z.object({ retrievedAt: z.iso.datetime(), nta: z.any(), gbizinfo: z.any() }).parse(await readJson(snapshotPath));
  const nta = z.object({ corporations: z.array(row.extend({ addressImageId: z.string().nullable() })) }).passthrough().parse(unwrap(snapshot.nta));
  const gbiz = z.object({ company: row.extend({ capitalStockYen: z.number().nullable(), employeeNumber: z.number().nullable() }) }).passthrough().parse(unwrap(snapshot.gbizinfo));
  return writePackage(await enrichCompany(c, {}, {
    nta: async () => nta as Awaited<ReturnType<typeof getCorporateIdentity>>,
    gbiz: async () => gbiz as Awaited<ReturnType<typeof getCompanyProfile>>,
  }, snapshot.retrievedAt));
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/import-api.ts')) {
  try { const [casePath, snapshotPath] = process.argv.slice(2); process.stdout.write(JSON.stringify(await importApi(casePath, snapshotPath)) + '\n'); }
  catch { process.stderr.write('法人API記録の取込みを停止しました。原本番号の照合・スナップショット形式を確認してください。\n'); process.exitCode = 1; }
}
