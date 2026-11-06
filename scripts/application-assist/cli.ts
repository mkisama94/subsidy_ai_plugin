import { readJson, writePackage } from './storage';
import { enrichCompany } from '../../src/applicationAssist/company';
import { caseSchema } from '../../src/applicationAssist/schema';

try {
  const [command, path] = process.argv.slice(2);
  if (!path || !['export', 'enrich'].includes(command)) throw new Error('Usage: application-assist <export|enrich> <private case.json>');
  let c = caseSchema.parse(await readJson(path));
  if (command === 'enrich') c = await enrichCompany(c, { ntaId: process.env.NTA_APPLICATION_ID, gbizToken: process.env.GBIZINFO_API_TOKEN });
  const result = await writePackage(c);
  process.stdout.write(JSON.stringify({ state: result.state, issueCount: result.issueCount, output: result.folder }) + '\n');
} catch {
  // No source values, paths, upstream messages, tokens, or validation dumps in normal logs.
  process.stderr.write('申請準備処理を停止しました。引数・非公開保存先・ケース形式・原本ハッシュを確認してください。\n');
  process.exitCode = 1;
}
