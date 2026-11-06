import { caseSchema, type AssistCase, type FieldEvidence } from './schema';
import { transcriptionValue } from './transcription';

export type Issue = { id: string; reason: string; owner: 'applicant' | 'vendor' | 'maintainer';
  obtainFrom: string; screens: string[]; priority: 'blocking' | 'review'; fieldId?: string };
const labels: Record<string, string> = { corporateNumber: '法人番号', companyName: '正式法人名', location: '登記所在地', capitalStockYen: '現在の資本金', employeeNumber: '従業員数',
  assets: '資産合計', liabilities: '負債合計', netAssets: '純資産合計', sales: '売上高', costOfSales: '売上原価', grossProfit: '売上総利益', sellingGeneralAdministrative: '販売費及び一般管理費',
  operatingProfit: '営業利益', personnelCosts: '制度定義に基づく人件費', depreciation: '減価償却費', annualTotalHours: '年間総労働時間', wageTotal: '給与支給総額',
  businessSummary: '事業内容', improvementPlan: '改善計画', productivityPlan: '労働生産性計画', wagePlan: '賃金計画', quoteConfirmed: '見積と対象経費', eligibilityConfirmed: '申請要件の確認',
  gbizIdReady: 'GビズID取得状況', securityActionReady: 'SECURITY ACTION実施状況', priorGrantChecked: '過去受給歴', periodEnd: '決算対象期' };
export const requiredFacts = ['corporateNumber', 'companyName', 'location', 'capitalStockYen', 'employeeNumber',
  'assets', 'liabilities', 'netAssets', 'sales', 'costOfSales', 'grossProfit', 'sellingGeneralAdministrative', 'operatingProfit',
  'personnelCosts', 'depreciation', 'annualTotalHours', 'wageTotal',
  'businessSummary', 'improvementPlan', 'productivityPlan', 'wagePlan', 'quoteConfirmed', 'eligibilityConfirmed',
  'gbizIdReady', 'securityActionReady', 'priorGrantChecked'] as const;
// Exact canonical snapshot detects edits even when a caller forgets to increment revision.
// This is change detection, not authentication of the human reviewer.
export function reviewSnapshot(c: AssistCase): string { return JSON.stringify(caseSchema.parse({ ...c, review: null })); }
export function usable(f: FieldEvidence | undefined): boolean {
  return !!f && f.state === 'verified' && f.value !== null && f.value !== '' &&
    !!f.reviewer && !!f.reviewedAt && (f.method !== 'document' || (f.originalChecked && !!f.fileSha256 && !!f.page)) &&
    (f.method !== 'publicApi' || (!!f.url && !!f.retrievedAt));
}
export function validateCase(input: unknown) {
  const c = caseSchema.parse(input);
  const issues: Issue[] = [];
  const notices: { id: string; reason: string; fieldId: string }[] = [];
  const add = (id: string, reason: string, owner: Issue['owner'] = 'applicant', fieldId?: string, priority: Issue['priority'] = 'blocking') =>
    issues.push({ id, reason: fieldId ? `${labels[fieldId.replace(/^latest\./, '')] ?? fieldId}：${reason}` : reason, owner, fieldId, priority, obtainFrom: owner === 'vendor' ? 'PCA・登録支援事業者' : owner === 'maintainer' ? '適用版公式資料・実画面' : '申請者の原本資料・本人確認',
      screens: c.fieldMap.fields.filter(m => !fieldId || m.fieldId === fieldId).map(m => m.screenId) });
  const f = (id: string) => c.fields.find(f => f.fieldId === id);
  const n = (id: string) => { const v = f(id)?.value; return typeof v === 'number' && Number.isFinite(v) ? v : null; };
  const unsupported = c.scope.year !== 2026 || c.scope.round < 7 || c.scope.frame !== 'normal' || !c.scope.standardRate ||
    c.scope.priorGrant === true || (c.scope.requestedGrantYen !== null && (c.scope.requestedGrantYen >= 1_500_000 || c.scope.requestedGrantYen < 50_000));
  if (unsupported) add('scope', '今回の実装範囲外。希望枠を変更せず担当者へ引継ぎ', 'maintainer');
  if (c.scope.requestedGrantYen === null || c.scope.priorGrant === null) add('scope-information', '申請額・過去受給を確認');
  if (!c.sources.length) add('sources', '原本資料未登録');
  for (const id of requiredFacts) {
    const v = f(id);
    if (!usable(v)) add(`field:${id}`, !v || v.value === null ? '必要な情報・資料が不足' : v.state === 'conflict' ? '資料間の値が競合' : '原本照合・根拠レビューが未完了', 'applicant', id,
      v?.value !== null && v?.value !== undefined && v.state !== 'conflict' ? 'review' : 'blocking');
    if (v && usable(v) && ['quoteConfirmed', 'eligibilityConfirmed', 'gbizIdReady', 'securityActionReady', 'priorGrantChecked'].includes(id) && v.value !== true)
      add(`confirmation:${id}`, '必要条件が未完了または不一致', 'applicant', id);
    if (v && usable(v) && v.method !== 'publicApi' && !v.applicantConfirmed) add(`applicant:${id}`, '申請者の事実・計画確認が必要', 'applicant', id, 'review');
  }
  for (const v of c.fields) {
    if (v.state === 'conflict') add(`conflict:${v.fieldId}`, '同じ時点・対象の値が一致するか確認（過年度値は上書きしない）', 'applicant', v.fieldId);
    if (v.calculation && (v.calculation.ruleVersion !== c.rulePack.version || v.calculation.inputFieldIds.some(id => !usable(f(id)))))
      add(`calculation:${v.fieldId}`, '計算根拠が未確認または規則版が不一致', 'applicant', v.fieldId);
  }
  const numericFacts = requiredFacts.slice(3, 17);
  for (const id of numericFacts) if (f(id) && (n(id) === null || f(id)!.unit !== (id === 'employeeNumber' ? 'persons' : id === 'annualTotalHours' ? 'hours' : 'JPY')))
    add(`number:${id}`, '数値または単位を確認', 'applicant', id);
  const equations = [
    ['assets', 'liabilities', 'netAssets', 1], ['sales', 'costOfSales', 'grossProfit', 1],
    ['grossProfit', 'sellingGeneralAdministrative', 'operatingProfit', 1],
  ] as const;
  for (const [a, b, d] of equations) {
    const values = [f(a), f(b), f(d)];
    if (values.some(v => v && (v.unit !== 'JPY' || v.periodEnd !== values[0]?.periodEnd))) add(`basis:${a}`, '金額単位または対象期が不一致', 'applicant', a);
    if ([n(a), n(b), n(d)].every(v => v !== null) && n(a)! - n(b)! !== n(d)!)
      add(`equation:${a}`, `財務不整合：${a} - ${b} ≠ ${d}。原文ラベルとページを再確認`, 'applicant', a);
  }
  for (const [id, label] of [['operatingProfit', '営業利益'], ['grossProfit', '売上総利益']] as const) {
    const v = f(id);
    if (v?.method === 'document' && !v.originalLabel.includes(label)) add(`label:${id}`, `原文科目が${label}と対応していない`, 'applicant', id);
  }
  const start = f('periodStart')?.value, end = f('periodEnd')?.value;
  if (typeof start === 'string' && typeof end === 'string') {
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
    if (!Number.isFinite(days) || days <= 0) add('invalid-period', '決算期間を確認');
    else if (days < 365) add('short-period', '短期決算。12か月実績への置換・自動年換算は行わない');
    if (end.slice(0, 4) < c.applicationDate.slice(0, 4)) notices.push({ id: 'historical-period', reason: '申請年より前の決算です。適合性は用途別の必要年度で判定します。', fieldId: 'periodEnd' });
  } else add('period', '決算開始日・終了日が不足');
  for (const [purpose, ids] of Object.entries({ latest: ['assets', 'sales'], productivity: ['operatingProfit', 'personnelCosts', 'depreciation', 'annualTotalHours'], wages: ['wageTotal'] })) {
    const expected = c.requiredPeriods[purpose as 'latest' | 'productivity' | 'wages'];
    if (!expected || c.requiredPeriods.ruleVersion !== c.rulePack.version) add(`period-rule:${purpose}`, `${purpose}の必要年度は適用マニュアルに基づく確認待ち`, 'maintainer');
    else for (const baseId of ids) {
      const id = purpose === 'latest' && f(`latest.${baseId}`) ? `latest.${baseId}` : baseId;
      if (!usable(f(id)) || f(id)?.periodEnd !== expected) add(`period:${purpose}:${id}`, `${purpose}には${expected}期の確認済み資料が必要`, 'applicant', id);
    }
  }
  if (n('annualTotalHours') !== null && n('annualTotalHours')! <= 0) add('hours', '年間総労働時間は正数が必要', 'applicant', 'annualTotalHours');
  if (['operatingProfit', 'personnelCosts', 'depreciation'].every(id => n(id) !== null) && n('operatingProfit')! + n('personnelCosts')! + n('depreciation')! <= 0)
    add('productivity-base', '基準生産性が0以下。成長率を自動確定せず適用規則を確認', 'applicant', 'productivityPlan');
  const p = c.rulePack;
  if (!p.verified || !p.reviewer || p.references.length === 0 || p.references.some(r => !r.sha256 || !r.retrievedAt) ||
      p.year !== c.scope.year || c.scope.round < p.roundFrom || c.applicationDate < p.effectiveFrom ||
      p.rateNumerator !== 1 || p.rateDenominator !== 2 || p.grantMinYen !== 50_000 || p.grantMaxExclusiveYen !== 1_500_000)
    add('rules', '適用公募・規則版・根拠ファイルを確認', 'maintainer');
  const product = c.product;
  if (!product.verified || !product.plan || !product.toolNumber || !product.vendorNumber ||
      product.year !== c.scope.year || product.frame !== c.scope.frame || !product.registrationReference?.sha256 || !product.featureReferences.length)
    add('product', 'PCAプラン・当年度登録ITツール・支援事業者・機能根拠を確認', 'vendor');
  if (!c.fieldMap.complete || !c.fieldMap.fields.length) add('mapping', '公式画面の全項目対応は未完了', 'maintainer');
  for (const m of c.fieldMap.fields) {
    if (!m.manualChecked || !m.screenCheckedAt || !m.reference.sha256 || !m.reference.page) add(`mapping:${m.fieldId}`, 'マニュアルと実画面の対応確認が必要', 'maintainer', m.fieldId);
    const v = f(m.fieldId);
    const transcription = v && v.value !== null && m.inputType !== 'declaration' ? transcriptionValue(v, m) : null;
    if (transcription && !transcription.ok) add(`unit:${m.fieldId}`, transcription.reason, 'maintainer', m.fieldId);
    if (m.inputType !== 'declaration' && m.requiredWhen === 'always' && !usable(v)) add(`mapped-value:${m.fieldId}`, '必須入力値が未確認', m.actor === 'vendor' ? 'vendor' : 'applicant', m.fieldId);
    if (transcription?.ok && m.maxLength && String(transcription.value ?? '').length > m.maxLength) add(`length:${m.fieldId}`, '公式文字数上限を超過', 'applicant', m.fieldId);
    if (v?.value !== null && m.inputType === 'select' && !m.choices.some(o => o.id === v?.value)) add(`choice:${m.fieldId}`, '公式選択肢に対応しない', 'applicant', m.fieldId);
  }
  if (!c.requiredAttachmentIds.length) add('attachments-unconfirmed', '必須添付一覧が未確認', 'maintainer');
  for (const id of c.requiredAttachmentIds) if (!c.attachments.some(a => a.attachmentId === id)) add(`attachment:${id}`, '必須原本が不足');
  for (const a of c.attachments) {
    const s = c.sources.find(s => s.sourceId === a.sourceId);
    if (!a.verified || !s?.sha256 || !s.path || a.mappingVersion !== c.fieldMap.version || a.bytes > a.maxBytes ||
        (a.expiresAt !== null && a.expiresAt < c.applicationDate) || a.periodEnd !== a.expectedPeriodEnd)
      add(`attachment:${a.attachmentId}`, '添付の原本・期限・年度・サイズ・対応版を確認');
  }
  const latestApi = c.apiChecks.filter((a, index, all) => !all.slice(index + 1).some(b => b.provider === a.provider));
  if (!latestApi.some(a => a.provider === 'nta' && a.status === 'matched')) add('identity', '法人番号・名称・原本の同定が未完了');
  for (const a of latestApi) {
    if (a.status !== 'matched' || (a.addressImageId && !a.addressImageVerified)) add(`api:${a.provider}`, a.addressImageId && !a.addressImageVerified ? '外字画像の公式表示を確認' : `法人照会：${a.status} ${a.code ?? ''}`);
  }
  if (!c.review || c.review.revision !== c.revision || c.review.inputSnapshot !== reviewSnapshot(c)) add('review', '最新版の担当レビューが必要（値・原本・規則・商品・対応表の変更を検出）', 'applicant', undefined, 'review');
  const manifestTestOnly = c.rulePack.testOnly || c.product.testOnly || c.fieldMap.testOnly;
  const testOnly = manifestTestOnly || c.dataClass !== 'private_actual';
  if ((manifestTestOnly && c.dataClass !== 'synthetic_test') || c.dataClass === 'fictional_example') add('test-only', '架空例・テスト用の制度・商品・画面対応は実案件に利用不可', 'maintainer');
  const state = unsupported ? 'unsupported' : issues.some(i => i.priority === 'blocking') ? 'needsInformation' : issues.length ? 'needsReview' : 'readyForTranscription';
  return { caseId: c.caseId, revision: c.revision, state, testOnly, issues, notices,
    pending: ['本人認証', '宣誓・同意', '最終確認', '本人による提出', '公式画面での操作受入（A15）'],
    rulesVersion: p.version, fieldMapVersion: c.fieldMap.version, productVersion: product.version };
}

/** All edits invalidate case and field reviews; old output remains identified by revision. */
export function reviseCase(c: AssistCase, patch: Partial<AssistCase>): AssistCase {
  return caseSchema.parse({ ...c, ...patch, caseId: c.caseId, companyId: c.companyId,
    revision: c.revision + 1, review: null,
    fields: (patch.fields ?? c.fields).map(f => ({ ...f, state: f.state === 'verified' ? 'extracted' : f.state,
      reviewer: null, reviewedAt: null, originalChecked: false, applicantConfirmed: false })) });
}
