# スキルの小事例評価

## 販売会社別手順の評価（2026-11-07追加）

V22は版2へ更新し、既知の製品・現状・目標・手元資料を与えたうえで、資料一覧・説明案・コピー用引継ぎメモを必須とします。project adapter 1.2ではR1〜R5のレビュー判定も必要です。`project/requirementReview.mjs`は各条件の理由・実回答の引用を検査しますが、意味の合否は担当者が確認します。旧V22の質問だけの応答と合格記録は保存し、新しい試験の合格根拠に使いません。[修正と追加評価](../../docs/vendor-workflow-v22-v2-evaluation-2026-11-07.md)を参照してください。

`project/vendor-workflow-scenarios.json`にV01〜V25を定義しています。V01〜V23・V25は`project/cases/Vxx/`の24件で、既存adapter・出典ID完全一致検査・意味レビューを使用します。V24は実際のホストの導入・質問UI・ファイル読取り等の確認であり、本文供給ケースへ変換しません。手順は[ホスト確認](../../docs/vendor-workflow-host-acceptance.md)を参照してください。

```powershell
# シナリオ定義を編集した場合にfixtureを再生成（過去の固定証拠は変更しない）
node scripts/prepare-vendor-workflow-cases.mjs
node evaluation/skill/cli.mjs plan --suite affected --change vendor-workflow --max-trials 24
node evaluation/skill/cli.mjs run --suite affected --change vendor-workflow --max-trials 24 --model gpt-6.1-sol
# 従来4件も含む全28件。予算とモデルは実行者が明示する
node evaluation/skill/cli.mjs run --suite all --max-trials 28 --model gpt-6.1-sol
```

このモデル名は今回の利用者指定で、既定モデルへの変更ではありません。requestedモデルとobservedモデルは別々に記録します。機械PASSと、実装者による意味レビュー、独立した受入、ホスト確認を混同しません。評価器自体のテストでは従来の4件をfixtureとして分離し、新業務ケースの追加で偽ホストの起動数・異常処理テストが膨らまないようにしています。実際の28件の選択とfixture整合は`test/vendorWorkflow.test.ts`で検査します。

スキル更新候補の作成は`node scripts/vendor-workflow-package.mjs`。参照リンクとJSON/YAMLを検査し、実バイトの一覧・hashとZIP展開一致を保存します。成果物は部分更新用で、インストール・OpenAI申請・公開は行いません。

## 販売会社別手順の評価（2026-11-07追加）

`project/vendor-workflow-scenarios.json`にV01〜V25を定義しています。V01〜V23・V25は`project/cases/Vxx/`の24件で、既存adapter・出典ID完全一致検査・意味レビューを使用します。V24は実際のホストの導入・質問UI・ファイル読取り等の確認であり、本文供給ケースへ変換しません。手順は[ホスト確認](../../docs/vendor-workflow-host-acceptance.md)を参照してください。

```powershell
# シナリオ定義を編集した場合にfixtureを再生成（過去の固定証拠は変更しない）
node scripts/prepare-vendor-workflow-cases.mjs
node evaluation/skill/cli.mjs plan --suite affected --change vendor-workflow --max-trials 24
node evaluation/skill/cli.mjs run --suite affected --change vendor-workflow --max-trials 24 --model gpt-6.1-sol
# 従来4件も含む全28件。予算とモデルは実行者が明示する
node evaluation/skill/cli.mjs run --suite all --max-trials 28 --model gpt-6.1-sol
```

このモデル名は今回の利用者指定で、既定モデルへの変更ではありません。requestedモデルとobservedモデルは別々に記録します。機械PASSと、実装者による意味レビュー、独立した受入、ホスト確認を混同しません。評価器自体のテストでは従来の4件をfixtureとして分離し、新業務ケースの追加で偽ホストの起動数・異常処理テストが膨らまないようにしています。実際の28件の選択とfixture整合は`test/vendorWorkflow.test.ts`で検査します。

スキル更新候補の作成は`node scripts/vendor-workflow-package.mjs`。参照リンクとJSON/YAMLを検査し、実バイトの一覧・hashとZIP展開一致を保存します。成果物は部分更新用で、インストール・OpenAI申請・公開は行いません。

2026-11-07：Project adapterを1.1へ更新しました。評価用の`response`・`sources`・`actions`の出力仕様をプロンプトと回答スキーマの両方へ明記しています。`sources`には実際に使用した固定入力中の出典IDだけを完全一致で記載し、説明・項目との対応・基準日・更新日・取得日・未確認事項は`response`へ記載します。転記用の値と注記を分け、外部操作のない本文供給試験の`actions`は空配列とします。

出典の機械検査は完全一致を維持し、部分一致・自動抽出・未知IDの無視は行いません。許可出典一覧やrubricはモデルへ渡しません。出典の省略や主張と根拠の対応は意味レビューでも確認します。機械PASSだけで根拠が十分とは判定しません。

新しい実行記録の`evaluator.project_adapter`にadapterの版と実バイトhash、`evaluator.answer_schema_sha256`とtrialの`answer_schema_sha256`にスキーマの実バイトhashを保存します。候補スキルの一覧・hashとtrialの`candidate_sha256`はこれらと別です。出力仕様変更後は新しいrunで試験し、過去の原回答や不合格判定は変更しません。前後のプロンプト・スキーマ・評価器が異なる結果は、同条件のスキル改善比較とは扱いません。

スキルの指示文を変更し、小さく固定した依頼で判断の差を確認する開発専用の仕組みです。製品のビルド、梱包、インストール、公開から独立しています。Node.js 24を使用し、追加のnpm依存はありません。

共通設計の出典は Open Estimate の `docs/implementation/SKILL-EVALUATION-PORTABLE-DESIGN-2026-11-05.md`（SKILL-EVAL-PORTABLE-1.0）です。その業務固有の計数ルールは移植していません。

## 最初に使う

```powershell
# モデルを起動しない準備確認
npm run eval:skill -- plan --case C001
npm run eval:skill -- plan --suite affected --change company-research --max-trials 2

# 評価器そのものを検証。モデル接続やAPIキーは不要
npm run test:skill-eval

# ローカル設定（Git対象外）。model.requested_id を使用するモデルIDへ変更する
Copy-Item evaluation/skill/config.example.json evaluation/skill/config.local.json

# 実モデルを1回だけ起動
npm run eval:skill -- run --config evaluation/skill/config.local.json --case C001
# または --model <使用するモデルID> を明示する
```

`SET_EXPLICITLY`のままrunは起動できません。モデルを自動選択しません。既存のCodex CLI接続を利用し、モデル名、推論設定、時間、起動数を設定します。Codexの実行フラグと使い捨てプロセスの停止能力を起動前に検査し、不足すると開始しません。ケースの入力は合成データだけです。実データの持込みには対応していません。

設定内のパス、およびCLIで上書きする設定パスは、設定ファイルのディレクトリが基準です。`--config`、`--reviews`、exportの`--output`自体は呼出元が基準です。優先順位はCLI、指定設定、既定の`config.example.json`です。秘密情報を設定へ書かないでください。

既定では`candidate_exclude`で同じディレクトリにある配布済み`subsidy-consultation.zip`を除外し、編集対象の本文と参照資料を固定します。除外は相対ファイル名の明示列挙です。本文供給にバイナリが混入すると準備段階で拒否します。

## 変更前後を比較する

1. 失敗と変更仮説を1つに絞り、変更前のスキルで1事例を実行する。
2. `review-template`でレビュー雛形を取得し、保存した回答、固定入力、rubricを読み合わせる。
3. 全チェックの判定、理由、回答中の証拠箇所、レビュアー、独立性、方式版、日時を記入して`regrade`へ渡す。
4. スキルを編集し、同じケース・モデル・予算でもう一度実行する。変更後も意味レビューを行う。
5. `compare`で条件差と退行を確認する。必要な関連事例と未調整事例を追加する。

```powershell
npm run eval:skill -- show RUN_ID
# JSON出力をUTF-8のレビュー用ファイルへ保存し、各項目を記入する
npm run eval:skill -- review-template RUN_ID
npm run eval:skill -- regrade RUN_ID --reviews path/to/reviews.json
npm run eval:skill -- compare BASELINE_RUN CANDIDATE_RUN --assessment-policy original
npm run eval:skill -- compare BASELINE_RUN CANDIDATE_RUN --assessment-policy latest-compatible
npm run eval:skill -- compare RUN_ID RUN_ID --baseline-assessment PASS_ASSESSMENT_ID --candidate-assessment FAIL_ASSESSMENT_ID
npm run eval:skill -- run --case C001 --model MODEL_ID --compare BASELINE_RUN
```

reviewでは`status`と`checks`へ`PASS`または`FAIL`を記入します。`kind`は`human`または`model`、`reviewed_at`はタイムゾーン付き日時、`evidence`は回答中の検証箇所の配列です。レビュアーの本人性や独立性は申告として記録し、認証済みとは扱いません。意味レビューは正しさ、依頼範囲、根拠を確認し、rubricにある必須判断・別解・失敗条件を照合します。機械検査のPASSだけでDEV_PASSにはなりません。

異なる実行同士では、`original`は初回採点、`latest-compatible`は同じ採点器・rubric・レビュー方式に対応する最新の組合せを選びます。揃わなければ条件差を表示し、同条件と見なしません。同じ実行IDを左右に指定した場合は、どちらのpolicyでも初回→最新を比較します（`assessment_selection: FIRST_TO_LATEST`）。履歴が1件だけなら両側のIDは同一になります。

レビュー後のPASS→FAILなど、途中の採点を比較するには`--baseline-assessment`と`--candidate-assessment`で左右の採点IDを指定します。IDはrun・regrade・showの`cases[].assessment_id`に表示します。指定IDはその側の実行履歴から検索し、そのケースだけを比較します。片側を省略すると、その側は上記のpolicyまたは初回→最新の既定値を使います。両側に異なるケースのIDを指定した場合や存在しないIDはエラーになります。明示したIDを互換性選択で置き換えません。

同じtrialの再採点は`SAME_ANSWER_REASSESSMENT`です。`before`・`after`・左右の採点ID・`regression`で採点の変化を表示します。これは採点判断の変化であり、スキル変更の効果ではありません。別trialで同じ回答が出ても再採点とは扱いません。

rubricや採点器の修正後は、同じ原回答へ新しい採点を追加できます。`review-template`は現在のrubricのhashを返します。新しいrubricに基づくレビューを用意してください。依頼・入力・回答スキーマ・ケース定義を変更した場合は新しいtrialが必要です。元の実行条件、観測済みの汚染、不変性違反は再採点で解除できません。

## ケースと責務

| ケース | 対象 | 主な判断 |
|---|---|---|
| C001 | 補助金相談 | 必須資格の未確認と事業との相性を分ける |
| C002 | 補助金比較 | 同じ公募回・範囲の公式採択率だけを使う |
| C003 | 企業調査 | 補助金相談へ広げず、法人番号の先頭0を保持する |
| C004 | 企業転記 | 未登録を0にせず、空欄と確認事項を分ける |

`core/`は固定コピー、実行制御、証拠、レビュー取込み、再採点、比較を担当します。`project/adapter.mjs`が事例選択、プロンプト、回答の解析、業務の機械検査、レビュー要求を担当します。`hosts/codex.mjs`と`hosts/process.mjs`がホストの起動・停止・イベントの読取りを担当します。coreには補助金・企業の正解分岐を置きません。

case.jsonの`required_capabilities`と`allowed_loading_modes`を準備時に検証します。未知の変更タグや共通変更は小事例一式を選びます。選択件数より`max_trials`が小さければ開始前に失敗します。小事例から代表案件を自動起動しません。追加の未調整事例や代表案件は、採用判断に応じて別に用意します。

## 証拠と判定

通常の保存先はGit対象外の`tmp/skill-eval/<run-id>/`です。

```text
plan.json                         # 選択理由・設定・候補inventory
journal.jsonl                     # 状態遷移の追記ログ
run.json                          # 実行記録。原記録を再採点で更新しない
assessment-head.json              # 履歴とは別の件数・最新セットID・最新hash
assessment-write.lock             # 採点保存中だけ存在する排他ファイル
evidence/
  candidate/                      # スキルと参照資料の固定コピー
  trials/<trial-id>/
    frozen/case/                  # 固定依頼・入力・rubric（モデル作業領域外）
    frozen/answer.schema.json
    workspace/artifacts/          # 本文供給試験では変更禁止
    prompt.txt
    answer.raw.txt
    events.jsonl
    stderr.log
    start-inventory.json
    end-inventory.json
    trial.json
assessments/<set-id>.json          # 原回答hashに結び付く追記型採点履歴
comparisons/<comparison-id>.json
```

ファイルのhashは実バイトのSHA-256です。構造のhashは`sorted-json-v1`（オブジェクトのキーを再帰的に並べ、配列順は保持）です。core・host・projectの版と実ファイルのinventoryを記録します。保存後の追加・削除・変更、履歴の改変や分岐、未知のschemaは読取り・再採点時に拒否します。hashは改変検出のためであり、第三者による署名や証拠の本人性を保証するものではありません。

採点履歴の連鎖に加えて、別ファイルの`assessment-head.json`と件数・最新セットID・最新hashを照合し、最新1件・末尾複数件の削除も拒否します。採点ファイルを保存してからheadを原子的に更新し、排他ファイルで同時更新を防ぎます。中断で履歴とheadが不一致になった場合や排他ファイルが残った場合は、読込みを拒否します。残存ファイルからheadを自動再構成しません。

headがない旧記録も`ASSESSMENT_HEAD_REQUIRED`として拒否します。過去の末尾が揃っていると証明できないため、自動移行して再認定しません。履歴とheadをまとめて過去の状態へ戻す操作の検知には、別の信頼できる保管先が必要です。この実装のローカルhashだけでは、その保証を提供しません。

実行状態、機械検査、意味レビュー、証拠の状態を別に保持します。確認済みの失敗は、時間切れやレビュー待ちがあってもDEV_FAILです。停止を確認できなければ同じsuiteの後続試行を始めません。自動再試行は行いません。意味レビュー待ち・未実行・時間切れはDEV_INCONCLUSIVEです。

| 終了コード | 意味 |
|---|---|
| 0 | 操作完了。実行評価の場合は予定した全件DEV_PASS |
| 2 | DEV_FAILあり |
| 3 | 判定不能、比較除外・条件差、未実行あり |
| 4 | 設定・証拠・内部エラー |

優先順位は4、2、3、0です。planやreview-templateの終了0は品質合格を示しません。日時はUTCで記録します。日本時間の確認にはUTCへ9時間を加えます。

異常中断でrun.jsonが完成しなかった場合は、次の操作で残存証拠のinventoryとINTERRUPTEDを別記録へ保存します。停止済みとは推定しません。モデルを再実行せず、欠落した終了時証拠も補完しません。

```powershell
npm run eval:skill -- recover RUN_ID
npm run eval:skill -- export RUN_ID --redacted --output tmp/skill-eval-share
```

exportは許可したメタデータだけのJSONを新規保存します。依頼、回答、入力、ログ、実パス、レビュアーの自由記述を含めません。原記録hash・原証拠inventory hashと共有版hashを別に記録します。この共有版から再採点はできません。生の証拠一式を共有する機能はありません。

## 実装範囲と採用時の確認

現在のホストは`supplied_candidate_text`だけに対応します。2つのスキルの固定本文と合成入力を新規Codexセッションへ明示供給します。ネットワーク、外部接続、通常のスキル・プラグイン設定、複数エージェントを無効にする設定を要求し、読取り専用で起動します。観測されたツール利用は本文供給ケースの失敗にします。パス指定での探索、ネイティブなスキル選択、MCP実応答、保存・表示操作は試していません。

ホストが管理する指示や作業領域外への読取りまで隔離できたとは保証しません。採点基準へのアクセスが観測されたtrialは比較から除外し、「未観測」を隔離証明へ置き換えません。実モデル名・推論設定・実ロードhashはホストから観測できない場合nullです。比較は通常LIMITEDとなり、スキル単独の効果の確定とは扱いません。起動数と時間を制限し、観測できない金額上限は保証しません。

候補採用時には`evidence/candidate`のファイル一覧とhash、runとassessment ID、試験条件、未確認事項を渡し、配布候補の対象スキルと照合してください。評価基盤は既存の配布用allowlistの外にあり、製品から参照していないことを固定テストで確認します。package.jsonやlockfile全体を製品の識別から除外する変更は行っていません。

GitHub Actionsは評価器の固定テストと全ケースのplanだけを実行します。実モデルの自動起動ジョブは設けていません。DEV_PASSはDEVELOPMENTの結果で、正式受入は常にNOT_REQUESTEDです。梱包、インストール、実ホスト、認証、保存、表示、公開後確認は既存の正式受入で別に行います。
