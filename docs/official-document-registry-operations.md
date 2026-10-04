# 公式資料ナビ：実装・運用手順

コードのバージョン：0.12.0。本番への配備は未実施。`OFFICIAL_DOCUMENTS_ENABLED`が`true`の場合だけ新しい資料取得ツールを登録する。未設定・falseでは既存15ツールのみを公開し、新ツールの直接呼出しも拒否する。有効時は16ツール。収集設定は公開設定と独立している。

## 実装した範囲

`get_subsidy_documents`、D1の4テーブル、公式HTML／Jグランツ添付メタデータ抽出、URLとDNS・転送先の検査、リンク確認、分類と再利用、日次AI呼出上限、15分間隔の定期処理、更新履歴・公開切替、登録・再実行・停止・復旧の管理コマンドを追加した。

ファイル本体は保存・代理配信しない。Jグランツ添付のBase64をDB・応答へ残さない。公開ツールはD1の読取のみであり、収集やモデル呼出しを起動しない。企業別の必要書類判定を行わない。

本番への配備、対象公募回の運営承認、AIモデルの実データ評価はこのコード変更の検証とは別である。既定の掲載元設定は空で、架空の制度や未確認の公募回を自動登録しない。

## 仕様の物理実装上の補足

- `official_documents`の索引・参照に必要な項目は専用列、残りの型付きメタデータは`metadata_json`へ保存する。論理項目は仕様を維持する。全文やBase64を格納する汎用キャッシュにはしない。
- HTML解析はWorkerとNodeの両方で検証できる`linkedom`を使用する。JavaScriptは実行しない。
- 掲載ページとWeb資料のURLを分離するため、通常Web資料には`webPageUrl`を追加した。`sourcePageUrl`はリンクが実際に掲載されていたページを保持する。
- AIはWorkers AIのバインディングを接続可能にした。既定モデル名は`@cf/meta/llama-3.3-70b-instruct-fp8-fast`、日次100呼出し上限、1回の出力400トークンまで。既定では無効で課金呼出しは行わない。金額上限ではなく、DBで原子的に予約する呼出回数上限である。
- 分類が済んだ資料は収集途中でも非公開の進捗として保存する。失敗したrunも分類根拠・版が一致する検証済み分類を再利用できるが、一覧公開には全体の正常完了が必要。
- 1回の定期処理は180秒・最大5掲載元・外部HTTP要求200回まで。残り枠が少ない場合は次の掲載元を次回へ送る。各要求ではDNSの追加照会が発生するため、運用プランのCPU・サブリクエスト制限を確認する。
- 過去90日を超えた完了runは回収する。現行スナップショットは保持する。期限切れの実行は次回の収集または定期処理の後処理で失敗状態に確定する。

## ローカルでの開始

以下はリポジトリのルートから実行する。WindowsでWranglerの設定領域に権限がない場合は、`XDG_CONFIG_HOME`をリポジトリ内の`.wrangler/xdg`へ設定する。

```powershell
$env:XDG_CONFIG_HOME = Join-Path (Get-Location) '.wrangler\xdg'
npm install
npm test
npm run typecheck
npx wrangler d1 migrations apply subsidy_ai_relations --local --persist-to .wrangler/documents-validation
```

`config/official-document-sources.example.json`は架空の設定例で、`pending`のため収集されない。これをコピーして実在する制度と公募回に置き換える。

```powershell
npm run documents:import -- --file config/official-document-sources.example.json
```

上のコマンドは検証だけを行う。適用する場合は宛先と`--apply`を指定する。

```powershell
npm run documents:import -- --file config/official-document-sources.json --apply --local --database subsidy_ai_relations --persist-to .wrangler/documents-validation
npx wrangler dev --local --port 8799 --persist-to .wrangler/documents-validation --var OFFICIAL_DOCUMENTS_ENABLED:true --var DOCUMENT_DISCOVERY_ENABLED:true
```

ローカルの定期処理は`http://localhost:8799/cdn-cgi/handler/scheduled`へGETして起動できる（このリポジトリのWrangler 4.135.0で確認）。本番のHTTPエンドポイントとして公開する管理APIではない。MCPの確認先は`http://localhost:8799/mcp`。

## 掲載元の登録

1. Jグランツの制度ID、公式の年度・公募回・申請枠を確認する。既存の制度・回と整合しない場合、登録処理は既存値を上書きしない。
2. 公式実施機関からの案内を根拠に、掲載ページ、必要なファイル配信ホスト、パスを指定する。登録できるURLでも公式性を自動承認したことにはならない。
3. ページを特定する文言と抽出セレクターを設定する。混在する旧回は除外語または領域分割で分ける。分類不能を隠すために全ページを`operator_reviewed`としない。
4. ファイルのクエリ文字列は確認した公開キーだけを許可する。新事業進出の資料URLなど、リクエストごとに変わる空値・8桁16進数の更新識別子には、該当する配信ホスト・パスの規則だけに`allowEmptyHexCacheBust: true`を設定できる。既定はfalse。任意のクエリや署名・セッションURLを許可する設定ではない。
5. 運営が回・公式性・抽出範囲を確認したら`registrationStatus=approved`、`approvedAt`に実際の確認日時を入れて適用する。
6. 設定再適用は承認版を進めて再収集する。新しい版で正常収集されるまで旧版を現行情報として表示しない。

受付期間はJグランツと公式公募ページで意味が異なることがある。今回の実地調査でも、ものづくり補助金23次のJグランツ上の終了日時と公式ページの応募締切は一致しなかった。機械的に同一視せず、公募回の登録根拠を確認する。検索結果の日付だけから「現在応募可能」と判断しない。

## 分類モデルの接続

Wrangler設定にWorkers AIのバインディングを追加し、分類を有効にする。

```json
{
  "ai": { "binding": "DOCUMENT_AI" },
  "vars": {
    "DOCUMENT_CLASSIFICATION_ENABLED": "true",
    "DOCUMENT_CLASSIFICATION_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "DOCUMENT_AI_DAILY_CALL_LIMIT": "100"
  }
}
```

上記は追加項目の例であり、既存の`vars`やD1設定を丸ごと置き換えない。モデル名、利用条件、料金、実データでの分類品質を運営側で確認してから有効にする。AIの出力が不正、予算到達、タイムアウトの場合は原文名を残し、説明を空にする。リンク収集そのものを無効にする必要はない。

## 状態確認と復旧

```powershell
npm run documents:admin -- report --local --database subsidy_ai_relations --persist-to .wrangler/documents-validation
npm run documents:admin -- refresh --source-id <UUID> --apply --local --database subsidy_ai_relations --persist-to .wrangler/documents-validation
npm run documents:admin -- pause --source-id <UUID> --apply --local --database subsidy_ai_relations --persist-to .wrangler/documents-validation
npm run documents:admin -- restore --source-id <UUID> --run-id <UUID> --apply --local --database subsidy_ai_relations --persist-to .wrangler/documents-validation
```

`refresh`は次の定期処理で再確認する予約。`pause`は即時に公開・収集を停止する。`revoke`も指定可能。再開は根拠を確認して登録設定を再適用する。

`restore`は現在の承認版・公募回に一致する過去の正常runに限定する。取得日時は過去のままで、要再確認状態にする。設定自体を変えた後は旧runへの復帰ではなく新しい版で収集する。

管理コマンドは対象DB・ローカル／本番・操作時刻・結果を出力する。運用記録として保存する。既定では外部へ通知しない。

## 本番への導入

1. DBの復旧点と実際のバインディングを確認する。
2. 全機能フラグをfalseのまま、対象DBへ`0004`を適用しコードを配備する。新設DBなら`0001`～`0004`が必要。
3. 対象を3～5制度に絞って、運営が確認した掲載元を登録する。
4. 収集を有効にし、結果と費用を確認してから公開取得を有効にする。
5. 非公開の先行配備では`npm run verify:production -- --ipv4-first`で既存15ツールを照合する。公開後は`--documents-enabled`を追加して16ツールを照合する。期待する公開状態を明示的に選び、実サーバーの状態から自動判定しない。
6. 公開後、`--documents-enabled --smoke`、`DOCUMENT_VERIFY_REQUIRE_AVAILABLE=true`、登録した`DOCUMENT_VERIFY_SUBSIDY_ID`を指定して資料が実際に返ることも確認する。単なる`unavailable`応答を稼働成功とはしない。`--ipv4-first`は検証プロセスのDNS優先順位のみを変更する。

本番配備やDB変更は本書を追加しただけでは実施されない。

## 検証資料

- `test/officialDocuments.test.ts`：回の混在、URL拒否、AI出力検証、分類再利用、予算、リース、失敗保持、鮮度、MCP契約。
- `docs/document-sources-live-probe-2026-09-27.json`：実際の公式ページからの抽出・リンク疎通。公募回の承認・必要資料の網羅・AI品質の検証とは区別する。
- `docs/document-registry-local-verification-2026-09-27.json`：ローカルのWorkerとD1で40件を収集し、MCP取得・304応答による再確認・過去runへの復旧・停止後の非表示を確認。公募回の対応を未確認とした架空の試験用IDを使用し、40件すべてを参考情報に隔離した。実在する公募回の承認結果ではない。
- 再調査：`node --import tsx scripts/verify-document-sources.mjs --report <保存先.json>`。全文・原本を保存せず、抽出とファイル種別ごとの少数リンクだけを確認する。
