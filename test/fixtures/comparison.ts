import type { ComparisonInput } from "../../src/comparison/data";

export function comparisonFixture(): ComparisonInput {
  const sources = [{ title: "検証用公式ページ（URLのみのサンプル）", url: "https://www.chusho.meti.go.jp/" }];
  const common = { status: "available" as const, note: null, sources };
  return {
    title: "補助金候補比較", demo: true,
    rows: [
      { subsidyId: "demoA", name: "設備更新支援（架空）", round: "2026年度・第1回（架空）",
        pastRate: { ...common, value: 40, round: "2025年度・第2回（架空）", applications: 1000, selected: 400 },
        maximumGrant: { ...common, value: 10000000, label: "一般枠（架空）" },
        grantRate: { ...common, label: "1/2（架空）" }, fit: { ...common, label: "所在地は一致／従業員数は未確認", note: "申請資格を確定するものではありません。" },
        deadline: { ...common, value: "2026-12-18T17:00:00+09:00", label: null }, details: ["設備の種類・費用区分は要確認。", "本データはUI検証専用です。"] },
      { subsidyId: "demoB", name: "省力化支援（架空）", round: "2026年度・第2回（架空）",
        pastRate: { ...common, value: 60, round: "2025年度・第1回（架空）", applications: 500, selected: 300 },
        maximumGrant: { ...common, value: 15000000, label: "通常枠（架空）" },
        grantRate: { ...common, label: "2/3（架空）" }, fit: { status: "unconfirmed", label: null, note: "対象業種は未確認です。", sources: [] },
        deadline: { ...common, value: "2026-11-10T12:00:00+09:00", label: null }, details: ["事業との相性と申請資格を分けて確認してください。"] },
      { subsidyId: "demoC", name: "地域実証支援（架空）", round: "2026年度（架空）",
        pastRate: { status: "not_registered", value: null, round: null, applications: null, selected: null, note: null, sources: [] },
        maximumGrant: { status: "fetch_failed", value: null, label: null, note: "上限額の取得に失敗しました。再確認が必要です。", sources: [] },
        grantRate: { status: "unconfirmed", label: null, note: null, sources: [] }, fit: { ...common, label: "事業内容は未確認", note: "必要条件の確認が必要です。" },
        deadline: { status: "unconfirmed", value: null, label: null, note: "締切日時を公式資料で確認してください。", sources: [] }, details: [] },
    ],
  };
}
