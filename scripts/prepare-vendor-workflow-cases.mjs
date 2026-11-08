import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const vendorScenarios = JSON.parse(await fs.readFile(path.join(root, 'evaluation/skill/project/vendor-workflow-scenarios.json'), 'utf8'));
const quoteScenarios = JSON.parse(await fs.readFile(path.join(root, 'evaluation/skill/project/quote-onboarding-scenarios.json'), 'utf8'));
const financialScenarios = JSON.parse(await fs.readFile(path.join(root, 'evaluation/skill/project/financial-document-scenarios.json'), 'utf8'));
const quoteRegressions = new Set(['V02', 'V18', 'V19', 'V22']);
const scenarios = [...vendorScenarios, ...quoteScenarios, ...financialScenarios];
for (const scenario of scenarios.filter(s => s.mode !== 'installed_host')) {
  const quoteCase = scenario.id.startsWith('Q');
  const financialCase = scenario.id.startsWith('F');
  const tags = financialCase ? ['financial-documents'] : quoteCase ? ['quote-entry'] : ['vendor', ...(quoteRegressions.has(scenario.id) ? ['quote-entry'] : []), ...(scenario.id === 'V22' ? ['financial-documents'] : [])];
  const allowedSources = quoteCase || financialCase ? ['scenario'] : ['scenario', 'M01', 'M03'];
  const folder = path.join(root, 'evaluation/skill/project/cases', scenario.id);
  await fs.mkdir(path.join(folder, 'input'), { recursive: true });
  const write = (name, value) => fs.writeFile(path.join(folder, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  await write('case.json', { id: scenario.id, version: scenario.version ?? '1', title: scenario.title, tags, skill: scenario.skill ?? 'pca-it-application-assist', request_file: 'request.txt', input_dir: 'input', rubric_file: 'rubric.json', required_capabilities: ['text_answer', 'tool_events'], allowed_loading_modes: ['supplied_candidate_text'], critical: true });
  await write('request.txt', scenario.request + '\n' + (scenario.response_instruction ?? '次の一つの操作と、必要ならそのまま使える説明案・依頼文を示してください。') + '\n');
  const context = quoteCase || financialCase
    ? '出典ID: scenario\n区分: 独立した合成入力。私有原本・実案件の実績ではない。ホスト状態はこのケースの仮定であり、実際の導入・表示の証拠ではない。\n' + scenario.context + '\n'
    : '出典ID: scenario\n区分: 独立した合成入力。実会社の申請実績ではない。会社未確定と明記した場合以外は架空A社が選択済み。\n' + scenario.context + '\n\n出典ID: M01\n公開ガイドの参照情報：2026年度の通常枠・インボイス対応類型。見積・同社発行の申込同意書を受け渡し、本人入力・販売会社補完後に本人が最終提出。会社別期限は別途確認。個別登録・書式本文・受付承諾はこの情報では未確認。\n\n出典ID: M03\n公開見積依頼ページ：https://www.mimosa.gr.jp/pca/cloud_estimate.html 。ページは確認できるが埋込みフォームの項目・送信は未確認。\n';
  await write('input/context.txt', context);
  await write('rubric.json', { version: scenario.version ?? '1', required: scenario.required, alternatives: ['同じ境界を保つ別表現・別順序の簡潔な案内'], failures: scenario.failures, allowed_sources: allowedSources, review_checks: ['correctness', 'scope', 'evidence'], evidence: scenario.evidence ?? '回答本文を固定入力と要求に照合し、既知情報の再質問・不要な提案書要求・回答待ち中の独立作業・使える下書きを確認。機械PASSのみで意味合格にしない。' });
}
console.log(`Prepared ${scenarios.filter(s => s.mode !== 'installed_host').length} supplied-text cases; V24 requires installed-host evidence.`);
