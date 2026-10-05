# 補助金比較テーブル（0.13.0）

## 実装範囲

既存の検索・詳細・企業条件照合・公式採択実績取得の後に `render_subsidy_comparison` を呼び、最大5制度を会話内のMCP Apps UIに表示する。情報取得は既存ツール、表示は新しいツールが担当する。描画ツールは入力の形・数値整合性・出典ドメインを検証するが、出典本文の取得・再検証は行わない。数値の事実確認は先行の情報取得工程で行う。

- 表示：制度名、対象年度・公募回、過去の公式採択率、補助上限、補助率、企業条件との照合、締切。
- 操作：採択率降順、補助上限降順、締切昇順、会話で選んだ順への復帰、詳細・出典の行展開。
- 欠損：未確認、実績未登録、取得失敗を区別し、欠損値は並び替えで最後に置く。
- 出典：各項目のリンク、注記、同一公募回の申請件数・採択件数を詳細に表示する。
- 保護：外部スクリプトや通信を使わず、入力テキストはDOMのtextContentで描画。HTTPSリンクのみ許可する。
- 代替：UI非対応クライアントでもcontentに同じ項目・注記・件数・出典のテキスト表を返す。
- 非対象：グラフ、今回の採択見通し、個別企業の確率や適合度スコア、相談・見積フォーム、データ保存。

## 変更ファイル

| ファイル | 役割 |
|---|---|
| `src/comparison/data.ts` | 入力スキーマ、整合性検証、テキスト表 |
| `src/comparison/register.ts` | 表示ツール・リソース登録 |
| `src/ui/comparison.ts` | 自己完結HTML、MCP Appsブリッジ、並び替え・詳細展開 |
| `src/index.ts` / `wrangler.jsonc` | 有効化フラグ |
| `test/comparison.test.ts` | MCP契約、欠損・不整合・出典・公開状態のテスト |
| `scripts/verify-comparison-ui.ts` | 模擬ホストでブラウザ検証とプレビュー生成 |
| `plugins/subsidy-ai/skills/subsidy-consultation/SKILL.md` | 情報取得から表示までの呼出し手順 |

## 入力契約

`title`、`demo`（既定false）、`rows`（1〜5件）。各行には `subsidyId`、`name`、`round`、`pastRate`、`maximumGrant`、`grantRate`、`fit`、`deadline`、`details` が必要。同一ID・公募回は重複できない。

各セル共通：`status`（available / unconfirmed / not_registered / fetch_failed）、`note`（文字列またはnull）、`sources`（titleとHTTPS URLの配列）。availableの場合は値と出典が必須。デモだけは出典省略が可能。欠損状態では値・ラベルをnullとする。

| セル | 追加フィールド |
|---|---|
| pastRate | value（百分率0〜100）、round、applications（正整数）、selected（非負整数）。availableの場合は公募回と両件数必須。率はselected/applicationsと小数第2位まで整合。出典ドメインは既存公式採択実績ツールと同じルール。 |
| maximumGrant | value（円の整数）、label（対象枠等、またはnull） |
| grantRate / fit | label（条件・短い説明、またはnull） |
| deadline | value（タイムゾーン付きISO日時）、label（表示用日時、またはnull） |

日付のみ判明している場合は締切時刻を推測せずunconfirmedにしてnoteに日付を残す。通常の締切表示はvalueから日本時間へ変換する。企業照合の未確認条件はlabelやnoteへ残し、資格確定とは説明しない。

成功出力は `structuredContent.schemaVersion="1.0"` と比較データ、`content` にテキスト表。UI URIは `ui://subsidy-ai/comparison/v1.html`、MIMEは `text/html;profile=mcp-app`。UI・データ契約を破壊的変更する場合はURIを更新する。

## ローカル起動・プレビュー

```powershell
npm run dev -- --var SUBSIDY_COMPARISON_ENABLED:true
npm run comparison:preview
```

プレビューは `.wrangler/comparison-qa/demo-preview.html` に出力され、通常のブラウザで開ける。架空の3制度を使い、親iframeのローカル模擬ホストが `ui/initialize` と `ui/notifications/tool-result` を処理する。ChatGPTでの実表示証拠ではない。

ブラウザ検証にはPlaywrightが必要。利用可能なモジュールのパスを `PLAYWRIGHT_MODULE_PATH`、既存Edgeを利用する場合は `COMPARISON_BROWSER_CHANNEL=msedge` に設定して `npm run comparison:verify-ui` を実行する。既定の出力先は `.wrangler/comparison-qa/`、`COMPARISON_QA_DIR` で変更できる。

## ChatGPT接続・受入確認

1. 比較UIを有効にした開発用MCPをHTTPSで到達可能にし、ChatGPTの開発用接続先へ登録・更新する。
2. tools/listに `render_subsidy_comparison`、resources/readに上記UIが存在することを確認する。
3. 「補助金比較テーブルのUIを、架空の3制度のデモデータで表示して」と依頼し、会話内の表示・並び替え・詳細・出典リンクを確認する。
4. 実データでは検索・詳細・必要に応じ企業条件照合・採択実績取得を先に呼び、元結果と表示を照合する。実績未登録・取得失敗が0%にならないことを確認する。
5. 幅の狭い画面・暗い配色・UI非対応クライアントのテキスト表を確認する。

現在の既定設定は比較UI無効。資料ナビも無効なら15ツール、どちらか一方のみ有効なら16、両方有効なら17。公開配備後の確認は `npm run verify:production -- --comparison-enabled`、資料ナビも有効なら `--documents-enabled` を追加する。リソース検査はホスト内の描画成功を保証しない。

`--comparison-enabled --comparison-smoke` では架空データで表示ツールも呼び、構造化出力とテキスト表を検査する。公開情報の再取得や業務データの書き込みは行わない。ローカルWorkerに対して検証する場合は `MCP_VERIFY_URL=http://127.0.0.1:8791/mcp` を設定する。Windows等の制限環境でWranglerのログ・レジストリ書き込みが失敗する場合は、`WRANGLER_LOG_PATH` と `WRANGLER_REGISTRY_PATH` をワークスペース内の `.wrangler/` 配下へ設定して起動する。

`chatgpt-app-submission.json` は最大17ツールの審査用定義を含む。比較UIを有効にする公開申請ではスキル・メタデータを含む新しいパッケージを作成・レビューする。既存ZIPやインストール済みスキルは更新されていない。本番配備・申請・ChatGPTでの実表示確認は今回のローカル実装とは別の工程。

## 検証記録（2026-10-05）

ローカルの全111テスト、TypeScript型検査、Wranglerの配備用バンドル生成（dry-run）、模擬ホスト＋Edgeでの表示・3種の並び替え・詳細展開・安全な文字列描画・出典リンク属性・狭い画面での横スクロール・不正データ時の代替案内を確認。起動したローカルWorkerのHTTP MCPでも0.13.0・16ツール・UIリソース取得・デモ表示ツールの構造化出力／テキスト表を確認した。デスクトップ・詳細・モバイル・暗い配色のスクリーンショットを生成する。本番配備とChatGPT実環境の受入確認は未実施。

公式実装資料：[Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)、[MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)。
