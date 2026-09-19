# 評価レポートの検証資料

対象リポジトリ https://github.com/mkisama94/subsidy_ai_plugin

対象コミット `8d1d45fda938dcdc62132affa2790d96dbcce9aa`

確認日 2026年9月9日 日本時間

## 内容

- repository-evidence.json: 対象SHA、全Git管理ファイル、全コミット、ツール登録位置。
- file-metrics.csv: 改行変換前のGitオブジェクト本文を対象としたSHA-256・バイト数・行数。実装行数はsrc、テスト行数はtestを集計。空行・コメントを含む物理行数。
- commit-history.csv: 全37件のコミット。parentsの要素が2個以上のものをマージとして集計。著者メールは収録しない。
- valuation-model.csv: 各作業の低位・標準・高位の人日、日単価、予備費率、総額。税別。
- dependency-install.txt、test-results.txt、typecheck-results.txt: 公開版の検証結果。
- source-validation-probe.mtsとsource-validation-probe-result.json: 出典本文と数値の対応に関するローカル模擬検証。
- public-head.txt: 完了前に再確認したGitHub mainのSHA。
- verification-summary.json: ページ数、リンク、集計、金額等の照合結果。

## 再現手順

新しい作業フォルダに本資料を展開し、Node.js v24系とGitが使える環境で実行する。

```text
git clone https://github.com/mkisama94/subsidy_ai_plugin public-repo
git -C public-repo checkout --detach 8d1d45fda938dcdc62132affa2790d96dbcce9aa
cd public-repo
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
cd ..
node --import ./public-repo/node_modules/tsx/dist/loader.mjs source-validation-probe.mts
```

本調査の実行環境はWindows、Node.js v24.18.1、npm 11.14.1。
模擬検証はfetchを置換し、関数を呼び出す。本番サービスへの通信・データベース書き込みを行わない。
公式本文の存在検証と件数計算が分離していることを示すもので、本番での誤登録や攻撃の成功を示すものではない。

低位66人日×50,000円×1.10＝3,630,000円。
標準104人日×55,000円×1.10＝6,292,000円。
高位148人日×65,000円×1.10＝10,582,000円。
既存OSSの導入・引き継ぎは15〜30人日×55,000円×1.10＝907,500〜1,815,000円。
工数・単価・予備費はいずれも見積もりの仮定で、実労働時間や取引実績ではない。

分析対象の公開ソースは変更していない。依存関係導入と検証は別途取得した作業用コピーで行った。
PDFの全11ページを画像で確認し、文字・表・改ページ・リンクを点検した。
