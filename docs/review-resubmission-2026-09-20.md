# 補助金AI 再審査用修正・検証記録

確認日: 2026-09-20（日本時間）

## 対象と本番反映

- MCP URL: https://subsidy.ai-orchestration.jp/mcp （変更なし）
- サーバー／リポジトリ／Codexプラグイン版: 0.11.0
- OpenAI審査画面のアプリ版「1.0.0」は別管理。サーバー版と混同しないこと。
- CloudflareデプロイID: `d565dd94-242b-438d-8f3a-6778292ac129`
- 変更前のデプロイID: `17059820-fbfb-4899-bb79-2554b266b8af`

## 指摘に対する修正

全15ツールについて `readOnlyHint`、`destructiveHint`、`openWorldHint`、`idempotentHint` を明示的なbooleanにした。必須3ヒントだけでなく、任意の冪等性ヒントも省略・nullにしていない。

公開政府API・公式資料を取得する11ツールは、読み取りだけであっても `openWorldHint: true` とした。入力からの計算および内部D1のみを扱う4ツールは `false` とした。キャッシュを更新する4ツールは `readOnlyHint: false`、証拠・統計・推計を上書きし得る3ツールは `destructiveHint: true` を維持し、条件・対象・復元機能の有無を説明した。

キャッシュ更新時に失効猶予期限を過ぎた最大100行を削除する挙動も明記した。`destructiveHint: false` の理由は、対象が再取得可能な公開情報の一時キャッシュに限られ、利用者の業務記録や証拠テーブルを変更しないこと。過去のキャッシュ内容そのものの復元を保証するものではない。

申請用JSONに不足していた国税庁の2ツールを追加した。名称検索、番号照会、同名候補の確認、出典・非保証表示を含む審査シナリオを追加した。ツールごとの4ヒントの理由は [説明資料](tool-annotation-justifications.md) と [申請用JSON](../chatgpt-app-submission.json) に記載。

## 併せて反映・修正した内容

- 国税庁API対応と、Jグランツの検索範囲・資金試算・申請延期・採用研修相談に関する既存の回答指針を含めて配布した。これらの一部は変更前の本番にも存在していたため、すべてを今回初公開とは扱わない。
- 国税庁APIは変更前に2ツールとも接続エラー。Workersランタイムで `new Request(..., { redirect: "error" })` が通信前に例外になることを、外部通信もSecretも使わないローカルWorkerで再現した（`Invalid redirect value, must be one of "follow" or "manual"`）。`manual` に変更し、3xxは明示拒否してIDを転送しない処理へ修正した。反映後は同じ本番Secretで名称検索・番号照会が成功。
- 採択実績機能に必要な `0003_subsidy_research_schema.sql` が本番未適用であることを確認し適用した。既存テーブルの削除・データ変更はせず、5テーブルと索引を追加した。適用前に失敗していた採択実績の読み取りは適用後に成功。
- README、プラグイン説明、プライバシーポリシーを国税庁対応・15ツールに更新した。
- Wranglerを4.135.0へ更新し、依存関係監査の既知の脆弱性3件を解消した。

## 検証結果

公開MCPの検証結果は [実行記録JSON](production-verification-2026-09-20.json) に保存した。

- `npm test`: 91件成功。
- `npm run typecheck`: 成功。
- `wrangler deploy --dry-run`: 成功。
- 依存関係更新時の監査: 既知の脆弱性0件。
- 実際のMCP `tools/list`: 本番15ツールの全4注釈と申請JSONが一致。
- 本番の国税庁番号照会・名称検索: 成功。法人番号1180301018771からトヨタ自動車株式会社、愛知県豊田市トヨタ町１番地を取得し、非保証表示も確認。
- 本番のgBizINFO企業プロフィール、Jグランツ検索、相談文生成、保存済み採択実績の読み取り: 成功。
- 破壊的注釈を持つ証拠・統計・推計の保存は、既存のモック／SQLiteテストで検証。本番に架空の統計を投入していない。

本番検証はMCPプロトコル経由の確認であり、ChatGPT上の自然言語シナリオ全件の実行完了を意味しない。

## 再申請時の操作

1. Platformの対象アプリの再申請用ドラフトで、同じMCP URLに対して **Scan Tools** を実行する。
2. 15ツールが取得され、注釈が [申請用JSON](../chatgpt-app-submission.json) と一致することを確認する。理由説明はツールごとに転記する。画面に冪等性の理由欄がなければ、その説明は補足欄へ記載する。
3. 国税庁を含む新しいアプリ説明・テストケース、公開済みのプライバシーポリシーURLを確認する。
4. 対応するChatGPT画面で正例・負例のシナリオを再実行し、実際の出力を確認して再申請する。

この作業ではPlatformのScan Tools操作と再審査の送信は実施していない。

## 再申請の補足説明（英語・転記用）

We audited all 15 MCP tools against their actual execution paths and deployed the corrected metadata to the existing production endpoint. Every tool now explicitly supplies boolean readOnlyHint, destructiveHint, openWorldHint and idempotentHint values, with no omitted or null hint values. Public government API and official webpage retrieval is marked open-world, including read-only retrieval. Cache-writing tools remain non-read-only; tools that can overwrite stored evidence, statistics or estimates remain marked destructive. The per-tool justifications describe the exact data sources, conditional writes, overwrite scope, limitations and retry effects. We also added the two National Tax Agency tools to the submission inventory and verified that production tools/list matches the submission metadata. National Tax Agency lookups and the previously missing production statistics schema were checked and repaired. The endpoint has not changed.

## 公式根拠

- [OpenAI: MCP server review requirements](https://developers.openai.com/plugins/deploy/app-review)
- [OpenAI: Define tools](https://developers.openai.com/plugins/plan/tools)
- [国税庁: 法人番号システムWeb-API](https://www.houjin-bangou.nta.go.jp/webapi/)

審査画面はスキャン時点の注釈を保存するため、申請文の修正だけでは不十分。デプロイ済みの本番を再スキャンしてから提出する。
