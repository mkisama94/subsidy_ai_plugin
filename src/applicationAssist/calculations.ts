export function normalizeAmount(text: string, unit: 'JPY' | 'thousandJPY') {
  let s = text.normalize('NFKC').trim().replace(/,/g, '');
  if (!s) return null;
  const negative = /^[△▲]/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/^[△▲]/, '').replace(/^\((.*)\)$/, '$1');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error('Invalid amount');
  const n = Number(s) * (unit === 'thousandJPY' ? 1000 : 1) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(n)) throw new Error('Amount must be safe integer yen');
  return n;
}
export function timeSaving(count: number, beforeMinutes: number, afterMinutes: number) {
  if (![count, beforeMinutes, afterMinutes].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Invalid time input');
  return { beforeMinutes: count * beforeMinutes, afterMinutes: count * afterMinutes, savedMinutes: count * (beforeMinutes - afterMinutes) };
}
export function productivity(profit: number | null, personnel: number | null, depreciation: number | null, annualTotalHours: number | null) {
  if ([profit, personnel, depreciation, annualTotalHours].some(n => n === null || !Number.isFinite(n)) || annualTotalHours! <= 0) return null;
  const value = (profit! + personnel! + depreciation!) / annualTotalHours!;
  return Number.isFinite(value) ? value : null;
}
export function growth(base: number, next: number) {
  return Number.isFinite(base) && Number.isFinite(next) && base > 0 && Number.isFinite(next / base) ? (next / base - 1) * 100 : null;
}
export function compound(base: number, annualRate: number, years: number) {
  if (!Number.isFinite(base) || !Number.isFinite(annualRate) || !Number.isInteger(years) || years < 0 || years > 20) throw new Error('Invalid plan');
  const values = Array.from({ length: years + 1 }, (_, i) => base * (1 + annualRate) ** i);
  if (!values.every(Number.isFinite)) throw new Error('Non-finite plan');
  return values.map(raw => ({ raw, display: Math.round(raw), rounding: 'nearest integer; raw retained' }));
}
export type QuoteLine = { netYen: number; taxYen: number; quantity: number; months: number;
  basis: 'periodTotal' | 'monthly'; eligible: boolean | null; registrationVerified: boolean };
export function quote(lines: QuoteLine[], rule: { rateNumerator: number; rateDenominator: number; maxMonths: number; grantMinYen: number; grantMaxExclusiveYen: number }) {
  let netYen = 0, taxYen = 0, eligibleYen = 0;
  const blockers: string[] = [];
  if (![rule.rateNumerator, rule.rateDenominator, rule.maxMonths, rule.grantMaxExclusiveYen].every(n => Number.isSafeInteger(n) && n > 0) || rule.rateNumerator > rule.rateDenominator) throw new Error('Invalid rule');
  for (const l of lines) {
    if (![l.netYen, l.taxYen, l.quantity, l.months].every(n => Number.isSafeInteger(n) && n >= 0) || !l.quantity || !l.months) throw new Error('Invalid quote');
    const factor = l.quantity * (l.basis === 'monthly' ? l.months : 1);
    netYen += l.netYen * factor; taxYen += l.taxYen * factor;
    if (l.eligible === null || !l.registrationVerified || l.months > rule.maxMonths) blockers.push('対象経費・登録・期間を確認');
    else if (l.eligible) eligibleYen += l.netYen * factor;
  }
  if (![netYen, taxYen, eligibleYen, eligibleYen * rule.rateNumerator].every(Number.isSafeInteger)) throw new Error('Unsafe amount');
  const rawGrantYen = eligibleYen * rule.rateNumerator / rule.rateDenominator;
  const displayGrantYen = Math.floor(rawGrantYen);
  if (displayGrantYen < rule.grantMinYen || displayGrantYen >= rule.grantMaxExclusiveYen) blockers.push('補助額は対応範囲外');
  return { netYen, taxYen, eligibleYen, rawGrantYen, displayGrantYen, rounding: 'floor yen', blockers };
}
