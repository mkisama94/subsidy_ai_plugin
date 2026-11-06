import type { AssistCase, FieldEvidence } from './schema';

type Mapping = AssistCase['fieldMap']['fields'][number];
const units: Record<string, string> = { JPY: 'JPY', '円': 'JPY', thousandJPY: 'thousandJPY', '千円': 'thousandJPY', persons: 'persons', '人': 'persons', hours: 'hours', '時間': 'hours' };
/** One conversion contract shared by validation and both output roles. */
export function transcriptionValue(f: FieldEvidence, m: Mapping) {
  const sourceUnit = f.unit !== null && Object.hasOwn(units, f.unit) ? units[f.unit] : null;
  const targetUnit = m.unit !== null && Object.hasOwn(units, m.unit) ? units[m.unit] : null;
  const rounding = m.rounding;
  const failure = (reason: string) => ({ ok: false as const, reason });
  if (typeof f.value !== 'number') {
    if (f.unit !== null || m.unit !== null || m.inputType === 'number') return failure('数値と単位の対応を確認してください');
    return { ok: true as const, value: f.value, rawValue: f.value, sourceValue: f.value, sourceUnit: f.unit, targetUnit: m.unit, formula: 'identity', rounding: 'exact' as const };
  }
  if (!Number.isFinite(f.value)) return failure('有限の数値を指定してください');
  if (!sourceUnit || !targetUnit) return failure('根拠単位または入力単位が未指定・未対応です');
  if (sourceUnit === targetUnit) {
    if ((sourceUnit === 'JPY' || sourceUnit === 'thousandJPY') && !Number.isSafeInteger(f.value)) return failure('金額は安全な整数で指定してください');
    return { ok: true as const, value: f.value, rawValue: f.value, sourceValue: f.value, sourceUnit: f.unit, targetUnit: m.unit, formula: 'identity', rounding: 'exact' as const };
  }
  if (!['JPY', 'thousandJPY'].includes(sourceUnit) || !['JPY', 'thousandJPY'].includes(targetUnit)) return failure('この単位の組合せは変換に未対応です');
  if (!Number.isSafeInteger(f.value)) return failure('金額は安全な整数で指定してください');
  const numerator = BigInt(f.value) * (sourceUnit === 'thousandJPY' ? 1000n : 1n);
  const denominator = targetUnit === 'thousandJPY' ? 1000n : 1n;
  const quotient = numerator / denominator, remainder = numerator % denominator;
  if (rounding === 'exact' && remainder !== 0n) return failure('端数が生じます。公式入力条件に基づく丸め規則の確認が必要です');
  let result = quotient;
  if (rounding === 'floor' && remainder < 0n) result--;
  if (rounding === 'ceil' && remainder > 0n) result++;
  if (rounding === 'halfAwayFromZero' && (remainder < 0n ? -remainder : remainder) * 2n >= denominator) result += numerator < 0n ? -1n : 1n;
  const value = Number(result);
  if (!Number.isSafeInteger(value)) return failure('変換後の金額が安全な数値範囲を超えます');
  return { ok: true as const, value, rawValue: Number(numerator) / Number(denominator), sourceValue: f.value,
    sourceUnit: f.unit, targetUnit: m.unit, formula: sourceUnit === 'JPY' ? 'source / 1000' : 'source * 1000', rounding };
}
