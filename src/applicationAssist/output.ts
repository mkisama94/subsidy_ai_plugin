import { caseSchema, type AssistCase } from './schema';
import { usable, validateCase } from './engine';
import { NTA_NOTICE } from '../nta';
import { transcriptionValue } from './transcription';

const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function generatePackage(input: unknown) {
  const c = caseSchema.parse(input), report = validateCase(c);
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
<p class="status">${report.state === 'readyForTranscription' ? '転記準備完了' : '未完成・要確認'} / ${escape(report.state)}${report.testOnly ? ' / 合成テスト用・実申請には使用不可' : ''}</p>
<p>GビズIDは本人認証、gBizINFOは公開法人情報の補完、申請マイページは申請先です。本人認証・宣誓・最終確認・提出は本人が行います。</p>
<p>規則 ${escape(c.rulePack.version)} / 画面対応 ${escape(c.fieldMap.version)} / 商品 ${escape(c.product.version)}</p>
<h2>先に確認する事項</h2><ul>${questions.slice(0, 5).map(i => `<li>${escape(i.reason)}（${escape(i.obtainFrom)}）</li>`).join('')}</ul>${questions.length > 5 ? `<details><summary>残りの確認事項 ${questions.length - 5}件を表示</summary><ul>${questions.slice(5).map(i => `<li>${escape(i.reason)}（${escape(i.obtainFrom)}）</li>`).join('')}</ul></details>` : ''}
${actor === 'applicant' && report.notices.length ? `<p>${report.notices.map(n => escape(n.reason)).join(' ')}</p>` : ''}
${values.length ? values.map((r, i) => `<section><small>${escape(r.screenId)}</small><h2>${escape(r.officialLabel)}</h2><pre id="value-${i}">${escape(r.copyable ? r.value : '')}</pre><button data-copy="value-${i}" ${r.copyable ? '' : 'disabled'}>値だけコピー</button><p>単位：${escape(r.unit)} / 状態：${escape(r.state)}${r.inputType === 'declaration' ? ' / 宣誓・同意は本人の操作待ち' : ''}</p><p>転記候補（入力単位、未確定の場合は転記不可）：${escape(r.candidate)}</p><p>根拠値：${escape(r.sourceValue)} ${escape(r.sourceUnit)} / 変換：${escape(r.conversion?.formula)} / 丸め：${escape(r.conversion?.rounding)}</p><p>根拠：${escape(r.sourceId)} / 物理ページ：${escape(r.page)}</p>${r.choices.length ? `<p>公式選択肢：${r.choices.map(o => `${escape(o.id)}：${escape(o.label)}`).join('、')}</p>` : ''}</section>`).join('') : '<section>公式画面の項目対応は未確認です。架空の入力欄を生成していません。</section>'}
<h2>正式添付の対応</h2>${attachments.filter(a => actor === 'applicant' || (a.visibility !== 'applicantOnly' && a.source?.visibility !== 'applicantOnly')).map(a => `<section><strong>${escape(a.screenId)} / ${escape(a.officialLabel)}</strong><p>対象期 ${escape(a.periodEnd)} / 形式 ${escape(a.format)} / ${a.exportFile ? '確認済み原本（申請者保管フォルダ内）' : '未確認・添付不可'}</p>${actor === 'applicant' && a.exportFile ? `<p>ファイル：${escape(a.exportFile)}</p>` : ''}</section>`).join('') || '<p>正式添付先と必要資料を確認してください。</p>'}
${actor === 'applicant' ? `<h2>読取り候補・根拠台帳（公式転記欄ではありません）</h2>${c.fields.map(f => `<section><strong>${escape(f.fieldId)}</strong><pre>${escape(f.value)}</pre><p>${escape(f.state)} / ${escape(f.originalLabel)} / 根拠 ${escape(f.sourceId)} / 物理ページ ${escape(f.page)} / ${escape(f.periodStart)} ～ ${escape(f.periodEnd)}</p></section>`).join('')}` : ''}
<p>国税庁出典：国税庁法人番号公表サイト</p><p>${escape(NTA_NOTICE)}</p>
<p>旧版との混同を避け、変更後は再生成してください。未確認の商品・画面・添付がある場合は準備完了になりません。</p>
<script>document.addEventListener('click',async e=>{const b=e.target.closest('button[data-copy]');if(!b||b.disabled)return;const t=document.getElementById(b.dataset.copy).textContent;try{await navigator.clipboard.writeText(t);b.textContent='コピー済み'}catch{const r=document.createRange();r.selectNodeContents(document.getElementById(b.dataset.copy));const s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='値を選択しました。コピーしてください'}});</script></html>`;
  };
  return { report, applicantHtml: html('applicant'), vendorHtml: html('vendor'),
    fieldValues: { outputSchemaVersion: '2', caseId: c.caseId, revision: c.revision, ruleVersion: c.rulePack.version, fieldMapVersion: c.fieldMap.version,
      applicant: rows('applicant'), vendor: rows('vendor'), evidence: c.fields },
    missingItems: report.issues,
    attachmentIndex: attachments,
  };
}
