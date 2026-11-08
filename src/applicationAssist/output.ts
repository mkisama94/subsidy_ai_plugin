import { caseSchema, type AssistCase } from './schema';
import { usable, validateCase } from './engine';
import { NTA_NOTICE } from '../nta';
import { transcriptionValue } from './transcription';

const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function generatePackage(input: unknown) {
  const c = caseSchema.parse(input), report = validateCase(c);
  const ready = report.state === 'readyForTranscription';
  const statusLabel = ready ? (report.testOnly ? '模擬の入力ガイド完成' : '転記準備完了') : '未完成・要確認';
  const attachments = c.attachments.map((a, i) => ({ ...a, source: c.sources.find(s => s.sourceId === a.sourceId) ?? null,
    exportFile: a.verified && !report.issues.some(issue => issue.id === `attachment:${a.attachmentId}`) ? `attachments/attachment-${i + 1}.${a.format.toLowerCase()}` : null }));
  const rows = (actor: 'applicant' | 'vendor') => c.fieldMap.fields.filter(m => m.actor === actor).sort((a, b) => a.order - b.order).flatMap(m => {
    const f = c.fields.find(f => f.fieldId === m.fieldId);
    // Allowlist BEFORE formatting, never serialize applicant evidence in vendor output.
    if (actor === 'vendor' && (!f || f.visibility === 'applicantOnly' || c.sources.find(s => s.sourceId === f.sourceId)?.visibility === 'applicantOnly')) return [];
    const transcription = f && m.inputType !== 'declaration' ? transcriptionValue(f, m) : null;
    const copyable = usable(f) && transcription?.ok === true && !report.issues.some(i => i.id === 'review') && m.inputType !== 'declaration' && m.manualChecked && !!m.screenCheckedAt &&
      !report.issues.some(i => i.fieldId === m.fieldId);
    return [{ screenId: m.screenId, officialLabel: m.officialLabel, inputType: m.inputType, unit: m.unit,
      value: copyable && transcription?.ok ? transcription.value : null, candidate: transcription?.ok ? transcription.value : null,
      sourceValue: f?.value ?? null, sourceUnit: f?.unit ?? null,
      conversion: transcription?.ok ? { formula: transcription.formula, rounding: transcription.rounding, rawValue: transcription.rawValue, targetUnit: transcription.targetUnit, fieldMapVersion: c.fieldMap.version } : null,
      copyable, state: f?.state ?? 'unknown',
      choices: m.choices, sourceId: f?.sourceId ?? null, page: f?.page ?? null }];
  });
  const html = (actor: 'applicant' | 'vendor') => {
    const values = rows(actor);
    const questions = actor === 'applicant' ? report.issues : report.issues.filter(i => i.owner === 'vendor' && !i.fieldId);
    return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>PCA申請準備ガイド</title><style>body{font:16px/1.7 system-ui;max-width:1000px;margin:40px auto;padding:0 24px;color:#173042;background:#f4f7fa}h1{font-size:28px}section{background:white;padding:20px;margin:16px 0;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ccd5dc;padding:12px}button{padding:8px 20px}small{color:#526778}.status{border-left:5px solid #ce861e;padding:12px;background:#fff3d8}</style>
<h1>PCA会計 申請準備ガイド</h1><p>${actor === 'applicant' ? '申請者用' : '支援事業者用'} · revision ${c.revision}</p>
<p class="status">${statusLabel}${report.testOnly ? ' / 合成テスト用・実申請には使用不可' : ''}</p>
<p>GビズIDは本人認証、gBizINFOは公開法人情報の補完、申請マイページは申請先です。本人認証・宣誓・最終確認・提出は本人が行います。</p>
<p>規則 ${escape(c.rulePack.version)} / 画面対応 ${escape(c.fieldMap.version)} / 商品 ${escape(c.product.version)}</p>
<h2>先に確認する事項</h2>${questions.length ? `<ul>${questions.slice(0, 5).map(i => `<li>${escape(i.reason)}（${escape(i.obtainFrom)}）</li>`).join('')}</ul>` : '<p>このガイドで追加確認する事項はありません。</p>'}${questions.length > 5 ? `<details><summary>残りの確認事項 ${questions.length - 5}件を表示</summary><ul>${questions.slice(5).map(i => `<li>${escape(i.reason)}（${escape(i.obtainFrom)}）</li>`).join('')}</ul></details>` : ''}
${actor === 'applicant' && report.notices.length ? `<p>${report.notices.map(n => escape(n.reason)).join(' ')}</p>` : ''}
${values.length ? values.map((r, i) => `<section><small>${escape(r.screenId)}</small><h2>${escape(r.officialLabel)}</h2><pre id="value-${i}">${escape(r.copyable ? r.value : '')}</pre><button data-copy="value-${i}" ${r.copyable ? '' : 'disabled'}>値だけコピー</button><p>単位：${escape(r.unit)} / 状態：${escape(r.state)}${r.inputType === 'declaration' ? ' / 宣誓・同意は本人の操作待ち' : ''}</p><p>転記候補（入力単位、未確定の場合は転記不可）：${escape(r.candidate)}</p><p>根拠値：${escape(r.sourceValue)} ${escape(r.sourceUnit)} / 変換：${escape(r.conversion?.formula)} / 丸め：${escape(r.conversion?.rounding)}</p><p>根拠：${escape(r.sourceId)} / 物理ページ：${escape(r.page)}</p>${r.choices.length ? `<p>公式選択肢：${r.choices.map(o => `${escape(o.id)}：${escape(o.label)}`).join('、')}</p>` : ''}</section>`).join('') : '<section>公式画面の項目対応は未確認です。架空の入力欄を生成していません。</section>'}
<h2>${report.testOnly ? '模擬添付の対応' : '正式添付の対応'}</h2>${attachments.filter(a => actor === 'applicant' || (a.visibility !== 'applicantOnly' && a.source?.visibility !== 'applicantOnly')).map(a => `<section><strong>${escape(a.screenId)} / ${escape(a.officialLabel)}</strong><p>対象期 ${escape(a.periodEnd)} / 形式 ${escape(a.format)} / ${a.exportFile ? (report.testOnly ? '模擬原本の対応確認済み' : '確認済み原本（申請者保管フォルダ内）') : '未確認・添付不可'}</p>${actor === 'applicant' && a.exportFile ? `<p>ファイル：${escape(a.exportFile)}</p>` : ''}</section>`).join('') || (actor === 'vendor' ? '<p>このガイドには共有対象の添付資料を含めていません。</p>' : '<p>添付先と必要資料を確認してください。</p>')}
${actor === 'applicant' ? `<details><summary>読取り候補・根拠台帳（公式転記欄ではありません）</summary>${c.fields.map(f => `<section><strong>${escape(f.fieldId)}</strong><pre>${escape(f.value)}</pre><p>${escape(f.state)} / ${escape(f.originalLabel)} / 根拠 ${escape(f.sourceId)} / 物理ページ ${escape(f.page)} / ${escape(f.periodStart)} ～ ${escape(f.periodEnd)}</p></section>`).join('')}</details>` : ''}
<p>国税庁出典：国税庁法人番号公表サイト</p><p>${escape(NTA_NOTICE)}</p>
<p>旧版との混同を避け、変更後は再生成してください。未確認の商品・画面・添付がある場合は準備完了になりません。</p>
<script>document.addEventListener('click',async e=>{const b=e.target.closest('button[data-copy]');if(!b||b.disabled)return;const t=document.getElementById(b.dataset.copy).textContent;try{await navigator.clipboard.writeText(t);b.textContent='コピー済み'}catch{const r=document.createRange();r.selectNodeContents(document.getElementById(b.dataset.copy));const s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='値を選択しました。コピーしてください'}});</script></html>`;
  };
  const summaryHtml = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>申請準備の確認結果</title><style>body{font:16px/1.8 system-ui;color:#173042;background:#f4f7fa;max-width:960px;margin:40px auto;padding:0 24px}section{background:white;padding:24px;margin:20px 0;border-radius:12px}h1{font-size:28px}h2{font-size:21px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #dce4ea}a{color:#125da7}.status{font-size:20px;font-weight:bold}small{color:#526778}</style>
<h1>申請準備の確認結果</h1><p class="status">${statusLabel}</p><p>${report.testOnly ? 'TEST ONLY · 模擬の資料・登録・手続・画面対応に基づく成果物です。実申請には使用不可。署名・外部送信・申請提出は行っていません。' : '申請者本人による最終確認・認証・宣誓・提出が必要です。'}</p>
<section><h2>1. 確認結果</h2>${report.issues.length ? `<ul>${report.issues.map(i => `<li>${escape(i.reason)}<br><small>確認先：${escape(i.obtainFrom)}</small></li>`).join('')}</ul>` : '<p>このケースの検証条件を満たしました。追加資料の質問はありません。</p>'}
<p>補助申請額${report.testOnly ? '（模擬）' : ''}：${escape(c.scope.requestedGrantYen?.toLocaleString('ja-JP'))}円</p></section>
<section><h2>2. 3年間の労働生産性</h2><p>基準値：${report.productivity.baseline === null ? '未確定' : escape(report.productivity.baseline.toFixed(2))} 円／時間</p>
<table><tr><th>計画期末</th><th>円／時間</th><th>基準年比</th><th>年平均成長率</th></tr>${report.productivity.projection.map(p => `<tr><td>${escape(p.periodEnd)}</td><td>${p.productivity.toFixed(2)}</td><td>${p.growthPercent.toFixed(2)}％</td><td>${p.annualizedGrowthPercent.toFixed(2)}％</td></tr>`).join('')}</table></section>
<section><h2>3. 入力と添付</h2><p><a href="applicant-guide.html">申請者用の入力ガイドを開く</a> · <a href="vendor-guide.html">販売会社用のガイドを開く</a></p>
<table><tr><th>${report.testOnly ? '模擬の添付欄' : '添付欄'}</th><th>対応ファイル</th></tr>${attachments.map(a => `<tr><td>${escape(a.officialLabel)}</td><td>${a.exportFile ? `<a href="${escape(a.exportFile)}">${escape(a.exportFile)}</a>` : '確認待ち'}</td></tr>`).join('')}</table>
<p>この確認結果と申請者用資料は内部保管用です。販売会社へ共有する場合は、確認済みの共有範囲に限ります。</p></section>
<section><h2>4. 次の操作</h2><p>${ready && report.testOnly ? 'この正常系テストは、模擬の入力ガイド・添付対応表の出力まで完了です。実運用へ移す場合は、実際の原本・登録・公式画面との対応を別途確認します。' : ready ? '入力ガイドと添付を最終確認し、本人が公式画面で認証・宣誓・提出します。' : '上の未充足項目を解消した場合に、根拠と計画を更新して再生成します。テストでは、この停止理由を確認結果として扱えます。'}</p></section></html>`;
  return { report, summaryHtml, applicantHtml: html('applicant'), vendorHtml: html('vendor'),
    fieldValues: { outputSchemaVersion: '2', caseId: c.caseId, revision: c.revision, ruleVersion: c.rulePack.version, fieldMapVersion: c.fieldMap.version,
      applicant: rows('applicant'), vendor: rows('vendor'), evidence: c.fields },
    missingItems: report.issues,
    attachmentIndex: attachments,
  };
}
