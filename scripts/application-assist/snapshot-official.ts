import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { privateRoot, writeJson, hash } from './storage';
import { writeFile } from 'node:fs/promises';

const urls = [
  'https://it-shien.smrj.go.jp/pdf/it2026_kaitei_koubo_tsujyo.pdf',
  'https://it-shien.smrj.go.jp/pdf/it2026_manual_kofu.pdf',
] as const;
// Fixed official sources only; requests never include case data or credentials.
export async function snapshotOfficial() {
  const folder = join(await privateRoot(), `official-sources-${Date.now()}`);
  await mkdir(folder);
  const references = [];
  for (const url of urls) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok || Number(response.headers.get('content-length')) > 30_000_000) throw new Error('Official source unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 30_000_000 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Invalid official PDF');
    const filename = new URL(url).pathname.split('/').pop()!;
    await writeFile(join(folder, filename), bytes, { flag: 'wx' });
    references.push({ url, sha256: hash(bytes), retrievedAt: new Date().toISOString(), revisedAt: null, page: null });
  }
  await writeJson(join(folder, 'source-manifest.json'), { year: 2026, roundFrom: 7, frame: 'normal',
    verified: false, reviewer: null, status: 'downloadedOnly; page-level rules and manual/live screens require review', references });
  return { folder, count: references.length, verified: false };
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/snapshot-official.ts')) {
  try { process.stdout.write(JSON.stringify(await snapshotOfficial()) + '\n'); }
  catch { process.stderr.write('公式資料の固定取得を停止しました。公式配布先を確認してください。\n'); process.exitCode = 1; }
}
