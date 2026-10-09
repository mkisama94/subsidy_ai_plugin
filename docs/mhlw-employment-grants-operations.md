# 厚労省雇用関係助成金：実装・運用手順

基準仕様：[改善仕様案](mhlw-employment-grants-mcp-spec-2026-10-09.md)。この実装はMCPを先行配備できる追加機能であり、既存プラグインZIPの更新を起動条件にしない。初期設定は全追加フラグfalse。本番配備・本番DB公開・OpenAIでの利用確認は別工程。

## 実装範囲

初期登録は人材開発支援助成金7コース、キャリアアップ助成金6コース、特定求職者雇用開発助成金4コース。公式6ページと登録済み共通要領2ページを対象にする。再帰的な全サイト巡回は行わない。

HTMLから制度・コース名と公式リンクを取得し、確認日時・実バイトのSHA-256・根拠位置を保存する。候補版は公開版とは分離され、収集だけで利用者向け公開版を変更しない。PDFは別Workerで解析し、ページ・位置・短い抜粋を未確認の根拠候補として保存する。HTML/PDF原本、全文、従業員情報、相談本文は保存しない。

新ツールは `discover_subsidies` と `get_discovered_subsidy_detail`。Jグランツに結果があっても厚労省を併せて検索し、片方の障害はcoverageに分けて返す。Jグランツの既存ツールのID・結果へ厚労省データを混ぜない。適用が不明な候補は `uncertainCandidates` に分ける。

PDF抽出結果から受給条件を自動確定しない。初期の自動抽出は `overview_only`、受付状態・年度・適用日は未確認。条件を公開するには運営者が資料を照合して、適用開始日、起算イベント、根拠位置、条件別の金額・単位を登録する。OCRと複雑表の自動確定、相対期限の自動計算は含まない。概要検索と条件情報の公開を区別する。

## ファイル

| 対象 | 役割 |
|---|---|
| `config/mhlw-sources.json` | 情報源・17コース・恒久ID・許可範囲・共通要領 |
| `src/officialSources/mhlw/` | robots・通信制御・HTML/PDF解析・定期収集 |
| `src/officialSubsidyCatalog/` | D1、履歴、根拠検証、公開版切替 |
| `src/subsidyDiscovery/` | 統合検索、詳細、出典・鮮度、cursor |
| `migrations/0005_mhlw_discovery_catalog.sql` | カタログ・取得履歴・キュー管理 |
| `migrations/0006_discovery_release_activation.sql` | 公開に成功した版の記録。競合した未公開版を詳細で取得させない |
| `scripts/mhlw-admin.ts` | 非公開の運営コマンド |
| `scripts/mhlw-config.ts` | 収集・公開段階の配備設定生成。配備は実行しない |
| `wrangler.mhlw-pdf.jsonc` | PDFキュー消費Worker |

## ローカル検証

Node.js 22以降を使用する。`node:sqlite` を使う実地検証は一時DBを終了時に破棄する。

```sh
npm ci
npm test
npm run typecheck
npm run mhlw:verify-contract
npx wrangler deploy --dry-run
npm run mhlw:pdf:build
npx wrangler d1 migrations apply subsidy-ai-relations --local
npm run mhlw:admin -- register --local --file config/mhlw-sources.json
npm run mhlw:admin -- collect --local
npm run mhlw:admin -- report --local
npm run mhlw:verify-live -- --pdf --output .wrangler/mhlw-live.json
```

最後のコマンドは公式GETを行う。公開サイトへアクセスしない試験は `npm test`。実地検証の `status: passed` は概要・根拠・検索の成功を表し、PDFの全件解析・条件の正しさ・本番公開を意味しない。PDF別のstatusとwarningsを確認する。

## MCP先行リリース

### A：機能非公開で先行配備

既存の配備環境のフラグ・Secret・ルートを記録し、標準 `wrangler.jsonc` の追加5フラグをfalseのまま配備する。新テーブル・Queueの未準備で既存MCPを停止させない。プラグイン・申請定義は現行のまま維持する。

`mhlw:verify-contract` は実装前コミット `f1027e2` の `tools/list` 全定義と完全比較する。資料・比較機能の無効時N=15、有効時N=17を確認する。将来の基準変更時は承認済み契約を確認して比較基準を更新する。

### B：DBと収集のみを有効化

次のコマンドは**本番を変更する運用手順**。今回の実装作業では実行していない。

```sh
npx wrangler d1 migrations apply subsidy-ai-relations --remote
npm run mhlw:admin -- register --remote --file config/mhlw-sources.json
npx wrangler queues create subsidy-ai-mhlw-pdf
npx wrangler deploy --config wrangler.mhlw-pdf.jsonc --var MHLW_INGESTION_ENABLED:true
npm run mhlw:config
npx wrangler deploy --config .wrangler/mhlw-collection.json
npm run mhlw:admin -- report --remote
```

既にQueueがある場合は再作成しない。設定生成はルートの `wrangler.jsonc` を基に、PDF producerと収集フラグを加える。現在の本番設定に差分がある場合は生成設定へ反映してから配備する。生成物は `.wrangler` に置きGit管理しない。PDF WorkerのCPU設定は有料Workersの資源枠を前提とする。Secretを設定ファイルへコピーしない。

Cronは既存の15分間隔を共用。1回最大3情報源・5PDFジョブを処理対象にし、各情報源とPDFは原則24時間間隔。PDF Workerは同時実行1、バッチ1。ホスト単位の日次500回・並列1・最小2秒間隔・Retry-AfterをD1で共有する。処理遅延時の24時間検知は保証しない。キュー滞留をreportで確認する。

### C：候補検証と公開版の準備

```sh
npm run mhlw:admin -- report --remote --output .wrangler/catalog-report.json
npm run mhlw:admin -- review-template --remote --version-id VERSION_ID --output .wrangler/review.json
```

`review.json` は元のpayloadと、解析済みPDFのrecordId・断片を含む。出典を実際に確認して編集する。単なる概要確認ならpayloadを変更せず `validate --version-id VERSION_ID --note "照合対象と判断を10文字以上で記載"` を使える。金額・率・資格等を追加する場合は `validate --file .wrangler/review.json` を使う。payloadを編集すると新しい不変版を作る。注記が10文字以上あるだけでは内容検証の代わりにならない。

条件公開では `detailLevel=conditions_reviewed`、factsの `status=reviewed`、根拠の `verification=reviewed`、`field=applicability` の適用根拠、開始日、金額・率の単位、共通資料の根拠を必須にする。`evidenceIds` はpayload内の根拠ID、`recordId` は実取得済み資料のID。PDFのlocatorにはページ・位置、excerptには対応箇所を記す。参照資料が差し替わった・48時間を過ぎた版は新規公開しない。画像・表・大容量で未解析の資料を確認済みと扱わない。

公開リストは**公開版全体の置換**。既存コースを残す場合は、そのversionIdも含める。次のJSONを `.wrangler/release.json` に用意する。

```json
{"versionIds":["検証済みの版ID"],"expectedReleaseId":null,"note":"初期概要版。条件情報は未確認として提供。"}
```

```sh
npm run mhlw:admin -- publish --remote --file .wrangler/release.json
```

2回目以降のexpectedReleaseIdは現在の公開版ID。競合時は失敗し、ポインタを変更しない。公開版をDBに用意しても提供フラグfalseなら外部へ提供しない。

### D〜F：新ツール公開、旧スキルの確認、後続プラグイン更新

```sh
npm run mhlw:config -- --tools
npx wrangler deploy --config .wrangler/mhlw-collection.json
```

新2ツールはツール登録フラグで初めて `tools/list` に現れる。OpenAIのRescan等で新ツールのLive状態を確認し、旧配布ZIP・旧スキルの実会話を別途確認する。サーバー配備の成功とOpenAIで利用可能になった状態を混同しない。新ツールが使えなくても既存Jグランツと標準Web補完を維持する。

新ツール利用の実確認後に限り `npm run mhlw:config -- --tools --guidance` で旧検索応答からの条件付き案内を有効にする。プラグインのスキル・説明・申請定義の更新は、その後の独立した審査工程とする。この実装では既存の `plugins/subsidy-ai/` と `chatgpt-app-submission.json` を変更していない。

## 停止・復旧・更新

```sh
npm run mhlw:admin -- pause --remote --source-id mhlw-training
npm run mhlw:admin -- resume --remote --source-id mhlw-training
npm run mhlw:admin -- refresh --remote --source-id mhlw-training
npm run mhlw:admin -- rollback --remote --release-id PREVIOUS_ID --expected-release CURRENT_ID
```

収集停止は本体とPDF Worker両方の `MHLW_INGESTION_ENABLED=false`。公開カタログは継続して読めるが時間経過でstaleになる。提供停止は案内とカタログ提供をfalseとし、承認済みツールは登録を維持して理由付き応答を返す。緊急の登録フラグfalseではキャッシュされた呼出しがTool not foundになることを記録する。

公開版を戻しても、旧資料と最新取得資料に差があればupdate_pendingとして条件値を抑制する。ロールバックによって古い条件を現在の確定条件に変えない。source pauseはcursor経由でも即時反映する。

資料・抽出器設定変更は `register` を再実行しrevisionを更新する。古い収集・PDFジョブは新revisionへ書き込めない。PDF抽出器の修正では `PDF_EXTRACTOR_VERSION` も更新して304による解析省略を解除する。

## 監視・保存境界・制限

`report` は公開版、情報源別の最終成功・失敗、版の検証状況、PDF状態、日次要求数、AI呼出し数、48時間超過の資料数、3回以上の継続失敗を返す。WorkerログはジョブID・件数・有限のエラーコードを出力する。Slack等への自動通知は設定していない。継続失敗・重要改正・キュー滞留を監視基盤で通知対象にし、変更のない取得を都度通知しない。

検索cursorは30分。検索条件の平文を保存せずHMACで条件を固定する。ページ送りには `CACHE_KEY_SECRET` とD1キャッシュが必要。未設定時は最初のページと明示的な警告を返す。MCP検索の応答上限は20秒で、超過時は `search_timeout`。検索から収集・PDF解析・AI・公開操作を起動しない。

HTML上限2MiB、PDF上限30MiB・600ページ・25万テキスト項目・解析時間120秒。PDFから最大150断片を保存。画像のOCRは行わず、文字不足・複雑表・上限超過を要確認にする。登録ページのPDFは最大40件、共通ページは見出しを絞って最大5件ずつで、全資料の収集を保証しない。coverageで登録範囲・未解析・取得打切りの可能性を説明する。

AIは初期無効。使う場合はPDF Workerへ `MHLW_AI` のWorkers AI binding、モデル名、1〜1000回の日次上限を明示的に設定する。抽出済み断片の分類だけに使い、原文・位置・ページを変更した候補は拒否する。AI出力で元のルール抽出を削除しない。AI処理の成功も条件確認済みを意味しない。

取得履歴は公開根拠を参照する版を保ち、未参照の実行履歴は90日後に清掃する。公開版の根拠は5年保管を想定し、この実装では保守的に保持する。5年後の廃棄・アーカイブは自動化していない。データ保持量を運営監視する。OSSライセンスと厚労省データの利用条件を混同せず、利用者には出典・加工・確認時点を表示する。

## 今回の検証と公開前の残項目

2026-10-09の[実地検証JSON](mhlw-live-verification-2026-10-09.json)に、実取得結果・検索評価集合・17詳細・PDF別結果を保存した。生の資料本文は含めていない。

最終自動試験は130件成功。型チェック、MCP本体・PDF Workerのdry-run、収集用producer設定のdry-run、ローカルmigration0005/0006の適用に成功した。既存ツール全定義のSHA-256は、15件構成で `8db1ea4e742ed5deab938aab1754f632c3f3751f69fec846dda53594e75e9009`、17件構成で `09a67d12043f9f39efb787dd15a6883f3b65b7f0907c7fd7b1aa5fe961ea9286`。いずれも基準コミットとの完全一致を確認した。

| 項目 | 結果・境界 |
|---|---|
| M01〜M03 | 実6ページから17コース。正式名17件と目的語3件で検索・概要詳細を確認 |
| M04・M20 | 両情報源に結果があるfixture、片方の障害を含む統合試験 |
| M05〜M07 | 不変版、根拠差替え、適用時期必須、未確認条件の抑制。実全コースの条件確認は未実施 |
| M08 | 実2ページPDFは23断片・表確認待ち。実20,215,433バイトの全体支給要領はページ上限で要確認。画像相当の文字なしfixtureも試験 |
| M09〜M12 | 取得失敗・Retry-After・304と独立添付・共通要領更新・危険URL・冪等性の自動試験 |
| M13・M14 | 実装前コミットとの全ツール定義比較、旧DBだけの起動、新ツール非登録・直接呼出し拒否 |
| M15〜M17 | プラグインファイル維持。OpenAI反映・旧プラグインでの実会話は本番公開工程で確認 |
| M18〜M21 | 公開競合、旧版復帰、停止、原本非保存、cursor条件・期限・停止反映を自動試験 |
| M22 | 全17コースの名称・出典を実取得で照合。年度別条件・経過措置・重要数値の実地照合とChatGPT会話は未完了 |

ローカルworkerdでも実978,632バイトの2ページPDFを解析し、23断片・表確認待ちとなることを確認した。検証専用の `test/fixtures/mhlw-pdf-runtime.ts` は本番設定から参照しない。ローカルの時間測定を本番p95、Queue運用、メモリ余裕の証明としない。

本番公開前に、配備対象コミット、migration0005/0006、公開版ID、全フラグ、ツール定義ハッシュ、配布プラグイン版、OpenAI Liveツールを記録する。実環境の遅延・Queue継続処理・旧プラグイン会話が確認できるまでは「本番提供完了」と扱わない。
