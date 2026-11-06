# PCA会計 申請準備のローカル実装

2026-11-07。最初の縦通しを実装。公開Workerの受付口・新規MCPツール・外部公開・プラグイン配布版の更新は含まない。

## 実行

PowerShellで、Gitリポジトリ外の非公開保存先を指定する。内部資料はこの保存先にだけ出力する。親ディレクトリやジャンクション経由でリポジトリ内になる保存先は拒否する。

```powershell
$env:SUBSIDY_ASSIST_PRIVATE_DIR = 'D:/private/application-assist'
npm run application-assist:import -- 'D:/private/case-manifest.json' 2026-11-07
npm run application-assist -- export 'D:/private/case.json'
```

台帳形式は今回の内部case-manifest.json。取込みは原本ハッシュ・PDF物理ページ数を実ファイルから確認する。既存の読取り台帳の数値をextracted候補として読み、reviewerやAPI取得時刻を創作しない。架空DOCXは本文だけを参考データとして取り込み、実績へ転用しない。実会社の財務値・名称・住所・法人番号・ハッシュ・API生データを公開リポジトリへ保存しない。

各出力フォルダにcase.json、applicant-guide.html、vendor-guide.html、field-values.json、missing-items.json、attachment-index.json、validation-report.json、attachments/を保存する。case.json、JSON一式、申請者用ガイドは私有情報を含む。**支援事業者へ渡せるのはvendor-guide.html単体**。JSON一式や出力フォルダ全体を共有しない。支援事業者用のZIPは作らない。

出力フォルダは入力内容のSHA256・revision・生成時刻で識別し、旧ガイドを上書きしない。原本のハッシュが変わった場合は出力を停止し、再取込み・再レビューする。正式添付として個別に指定し、検証済みの原本のみattachments/へコピーする。40ページの報告書を自動共有しない。

## ローカルOCR

Pythonのpypdfium2とPillow、Nodeのtesseract.js、日本語・英語の学習データをローカルに用意する。ランタイムのパスは環境に合わせて指定する。

```powershell
$env:SUBSIDY_ASSIST_PYTHON = 'D:/runtime/python.exe'
$env:SUBSIDY_ASSIST_NODE_MODULES = 'D:/runtime/node_modules'
$env:SUBSIDY_ASSIST_OCR_LANG_DIR = 'D:/private/ocr-models'
npm run application-assist:ocr -- 'D:/private/case.json' PRIVATE-001-original 1 3
```

言語ディレクトリにはjpn.traineddata.gzとeng.traineddata.gzを事前配置する。実行中のモデルダウンロード・クラウドOCRへのフォールバックは行わない。指定した物理ページをPNGにレンダリングし、原本ハッシュ・ページ・画像パス・OCR文字列・座標・信頼度を派生JSONへ保存する。OCR結果はextracted。自動で財務値を確定したりverifiedに昇格したりしない。今回の取込み候補値は内部台帳からの読取り再利用であり、OCRからの科目別自動抽出の精度評価とは別である。

## 法人照会

原本画像で確認した法人番号のFieldEvidenceをverifiedにし、originalChecked、reviewer、reviewedAtを実際の確認に基づいて記録する。その後、既存APIクライアントで照会できる。

```powershell
# 秘密は環境設定。コマンドやケースへ直接記載しない。
npm run application-assist -- enrich 'D:/private/page1-reviewed-case.json'
```

NTA_APPLICATION_ID、GBIZINFO_API_TOKENを再利用する。接続済みプラグインで照会した場合は、実取得日時とツール結果を内部ファイルに保存し、同じ処理へ取り込める。

```powershell
npm run application-assist:import-api -- 'D:/private/page1-reviewed-case.json' 'D:/private/api-live.json'
```

スナップショット形式は `{retrievedAt, nta: toolResult, gbizinfo: toolResult}`。API現在値はpublic.*の別レコードになり、原本・過年度値を上書きしない。公開情報でも照合・採用レビューを経ずに公式転記値へ採用しない。取得失敗はprovider/codeとして保存し、秘密や上流エラー本文を通常ログへ出さない。更新日時のタイムゾーン付き表記を保持し、更新日を値の基準日と同一視しない。

## 適用版とレビュー

src/applicationAssist/schema.tsがデータ契約、draft.tsが未確認の制度・商品・画面対応の初期値。初期マニフェストは未有効で、当年度PCA登録・画面対応・必要年度が確定するまで完成判定できない。公式URL・SHA256・取得日・改訂・物理ページ・検証担当を記録してrulePackを更新する。fieldMapはマニュアル確認と実画面確認を別に持つ。未確認の正式項目名・選択肢・文字数を生成しない。

最新決算、労働生産性、給与計画の必要期末日はrequiredPeriodsで個別指定する。年度算定の制度解釈自体は現段階では人によるマニュアル確認が必要。基本の財務科目は基準年度を表す。最新決算が異なる場合はlatest.assets/latest.salesと最新の原本・必須添付を登録して分離する。

verifiedには実際の原本照合と担当者の記録が必要。本人の事実・計画確認はapplicantConfirmedで別管理する。final reviewはreviewSnapshot(case)とrevisionを記録し、最新版を確認した担当者と日時を付ける。これは変更検出であり、レビュー担当者の本人認証・電子署名ではない。reviseCaseを使わない直接JSON編集も最終レビューとの不一致で検出し、旧レビューでのコピー・完成判定を止める。

計算はcalculations.tsの純粋関数。人件費と給与支給総額は別入力、年間総労働時間を分母に使う。見積は期間総額と月額を区別し、税と対象外経費を分離する。文案テンプレートの根拠IDをnarrative.tsで追跡するが、文章の意味が根拠から導けるかは担当者のレビューが必要。正式様式への記入や自動の適合審査は未実装。

公式資料は `npm run application-assist:snapshot-official` で固定URLからPDFを取得し、原本・ハッシュ・取得日時を非公開保存先に残せる。ダウンロードだけではverifiedにせず、改訂日・該当ページ・適用要件のレビューを残す。

## 単位保証と過年度決算の修正

画面対応表のunitは根拠単位と必ず照合する。数値欄の単位未指定、未対応単位、異なる次元の単位は転記と準備完了を阻止する。JPY/円、thousandJPY/千円、persons/人、hours/時間を認識し、円と千円の相互変換だけを明示的にサポートする。財務計算用の根拠値は従来どおり円で保持する。

field-values.jsonのoutputSchemaVersionは2。各行のsourceValue/sourceUnitが根拠、candidateが入力単位へ変換した候補、valueがコピー可能な確定転記値である。変換できない候補・確定値はnull。conversionに式、丸め前の値、丸め規則、入力単位、対応表版を保存し、HTMLでも根拠値と転記値を分けて表示する。文字数制約は変換後の転記値へ適用する。

対応表のroundingは既定exact（単位換算後の整数が割り切れなければ阻止）。floor（負の無限大方向）、ceil（正の無限大方向）、halfAwayFromZero（ちょうど半分は絶対値が大きい方向）を指定できるが、公式入力条件の根拠・画面確認・最終レビューが必要。規則を推測して端数を切り捨てない。同じ単位は値を維持し、換算に整数演算を使って不安全な金額を拒否する。

申請年より前の決算であることはvalidation-report.jsonのnoticesへ記録する。この注意だけでは完成を阻止しない。必要年度の未確定・規則版不一致・各用途の対象期不一致は引き続きissuesとして完成を阻止する。過年度で必要期が一致しても、最終レビューなどの他条件は省略しない。

## 検証と残る条件

```powershell
npm run test:application-assist
npm test
npm run typecheck
npm run typecheck:application-assist
```

A01〜A14の論点を合成データで自動検査する。A14の完成例は独立したsynthetic_testで、制度・商品・画面のtestOnlyを明示する。同じ設定を実案件で使うと完成判定を拒否する。テスト合格は各受入項目全体の担当者承認とは異なる。

今回の内部実行では、実PDFと架空DOCXのハッシュ確認・分離取込み、実PDF物理ページ1〜3のローカルOCR、ページ1の番号・期間の画像確認、既存接続ツールでの法人再照会、未完成ガイド出力を実施した。全40ページの科目精査・申請者確認は未実施。APIで名称・所在地を取得しても、未登録値と外字表示確認を残す。

未完了：適用版の全要件・必要年度の自動算定、具体的PCA登録商品・見積、公式全画面マッピング、正式様式の記入出力、実モデル評価、インストール済みホストでの選択・動作確認、A15の実画面操作受入。最新資料・勤怠賃金・改善計画・証明書の不足も残る。「コピペとアップロードだけで完了」と対外表示できる状態ではない。

公式参照：[資料一覧](https://it-shien.smrj.go.jp/download/)、[第7次以降通常枠要領](https://it-shien.smrj.go.jp/pdf/it2026_kaitei_koubo_tsujyo.pdf)、[申請フロー](https://it-shien.smrj.go.jp/applicant/flow/)、[gBizINFO API](https://content.info.gbiz.go.jp/api/index.html)。
