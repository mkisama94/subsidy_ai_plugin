from pathlib import Path
import json,re,html,csv,hashlib,shutil
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT=Path(__file__).resolve().parents[1]
E=ROOT/'evidence'
D=json.loads((E/'repository-evidence.json').read_text(encoding='utf-8'))
SHA=D['head']; REPO=D['repository']; BLOB=f'{REPO}/blob/{SHA}'
def src(path,line=None,label=None):
    return f'[{label or path}]({BLOB}/{path}'+(f'#L{line}' if line else '')+')'
def commit(prefix):
    c=next(c for c in D['commits'] if c['sha'].startswith(prefix))
    return f'[{prefix}]({REPO}/commit/{c["sha"]})'
pages=[]
def page(title):
    items=[];pages.append({'title':title,'items':items});return items
def p(items,text): items.append(('p',text))
def h(items,text): items.append(('h',text))
def table(items,headers,rows,widths):items.append(('table',headers,rows,widths))

x=page('日本の補助金検索\nソースコード価値算定レポート')
p(x,'公開ソースとコミット履歴に基づく再開発費用の概算評価')
table(x,['評価項目','内容'],[
 ['評価基準日','2026年9月9日 日本時間'],['想定読者','PCAおよびCOクリエイトの技術責任者・事業判断者'],
 ['対象','subsidy_ai_plugin 公開mainブランチ v0.10.0'],['対象コミット',SHA],['作成','OpenAI CodexによるAI分析'],['金額の単位','日本円 税別。会社の株式価値は算定対象外']], [90,378])
h(x,'評価結論')
p(x,'**同等機能を新規に受託開発する場合の標準概算は約630万円。** 低位約360万円、高位約1,060万円と試算した。既存コードの購入価格ではなく、要件整理・設計・実装・検証・引き渡しを含む再開発費用である。全ケースでAIによる開発支援を利用する前提とした。')
p(x,'**公開コードを再利用する導入・引き継ぎ費用は、別途約90万〜180万円。** 既存の公開機能を利用する第三者にはこの選択肢があるため、630万円をそのままソースコードの売買価格や出資先企業の評価額と解釈してはならない。')
p(x,'本プロジェクトには、3系統の公的データ連携、13のMCPツール、業務上の誤断定を避ける処理、80件の自動テストが存在する。機能のある初期サービス基盤として評価できる一方、広範な実データ検証、運用実績、採択見通しの精度は確認できていない。')
p(x,'本書は公開証拠を用いた技術・費用分析であり、独立した人間の鑑定人による鑑定書、会計上の時価評価、受注を約束する見積書ではない。工数・単価・予備費は分析上の仮定である。')
p(x,f'GitHub [{REPO}]({REPO})\n[評価対象の固定版]({REPO}/tree/{SHA})')

x=page('1 評価対象と調査方法')
p(x,'評価時点のGitHub公開mainブランチをネットワーク経由で新規取得し、参照先HEADとの一致を確認した。評価対象は以下の固定コミットである。ローカル作業フォルダに存在する未コミットの変更、未追跡ファイルおよび将来構想は対象に含めていない。')
p(x,f'**{SHA}**\nコミット表示日時 2026年9月5日20時35分56秒 +09:00\n件名 OpenAI 初回申請版　{commit("8d1d45f")}')
table(x,['確認指標','公開版の実測値','解釈'],[
 ['Git管理対象','52ファイル','依存パッケージを含めない'],['実装ソース','13ファイル 6,099行','src内のTypeScript。空行・コメント込み'],['テストソース','17ファイル 2,853行','test内のTypeScript。空行・コメント込み'],['DB変更定義','3ファイル 276行','migrations内のSQL'],['MCPツール','13件','registerToolの登録を抽出'],['到達可能な履歴','37コミット','うちマージ7件・非マージ30件'],['履歴上の著者名','1種類','Masaki Yamamoto。実作業者数の証明ではない'],['履歴の期間','2026年8月31日〜9月5日','初回から対象版まで約5日4時間']], [94,151,223])
h(x,'実施した確認')
p(x,'全ファイルの一覧・行数・ハッシュを集計し、13実装モジュールの責務と主要な処理経路を確認した。全37件の履歴を取得し、法人照合、EDINET、DB保存、キャッシュ、採択実績、相談支援の主要変更を差分とテストから照合した。コミット件数や追加行数に単価を掛ける手法は採用していない。')
p(x,'公開版のロックファイルに従って依存関係を導入し、自動テストと型チェックを実行した。加えて、出典本文と入力件数の対応について、外部通信と本番書き込みを行わない模擬検証を1件実施した。')
h(x,'証拠の区分')
p(x,'**確認事実**は公開ソース・履歴・実行結果に基づく。**技術評価**はそれらの解釈であり、網羅的監査を意味しない。**金額試算**は作業別工数と単価の仮定に基づく。売上、利用者数、実労働時間、権利帰属の証明資料は確認していない。')

x=page('2 実装済み機能と技術的な蓄積')
p(x,'構成は、MCPクライアントからCloudflare Workers上のサーバーを呼び出し、Jグランツ・gBizINFO・EDINETを照会し、必要に応じてD1へ公開情報を保存するもの。独自の学習済みAIモデルではなく、AIクライアントから利用するツール群と業務ロジックである。')
table(x,['機能領域','確認した実装と評価対象','主な根拠'],[
 ['MCPと実行基盤','13ツール、入力検証、エラー応答、ヘルス確認、公開設定',src('src/index.ts',142,'index.ts')],
 ['補助金検索と詳細','地域・全国検索の統合、重複排除、受付期間、詳細整形、文書メタデータ',src('src/jgrants.ts',324,'jgrants.ts')],
 ['企業の特定と補完','法人番号・名称検索、候補の曖昧性、利用者入力の優先と矛盾の表示',src('src/companyMatching.ts',152,'companyMatching.ts')],
 ['法人活動情報','8種類の専用API、並行取得、種類別の失敗と件数差分の表示',src('src/gbizinfoActivities.ts',296,'gbizinfoActivities.ts')],
 ['資本関係の確認','親会社候補の特定、EDINET書類検索、CSV内の名称と関係文脈・比率の抽出',src('src/edinet.ts',532,'edinet.ts')],
 ['適合判定と相談','構造化条件との照合、制度別の大企業関係ルール、相談事項・準備資料・文面',src('src/deemedLargeEnterprise.ts',66,'制度条件の照合処理')],
 ['採択実績と参考値','出典ドメインと本文の照合、同一範囲の件数計算、最大3回の実績から参考値',src('src/selectionStatistics.ts',144,'selectionStatistics.ts')],
 ['データと耐障害性','D1保存、更新処理、出典情報、HMAC検索キー、障害時限定の古いキャッシュ利用',src('src/cache.ts',146,'cache.ts')],
 ],[80,273,115])
h(x,'工数評価で重視した点')
p(x,'価値の中心は、APIの接続本数そのものより、欠損・曖昧性・名称や住所の表記差・部分障害・根拠の保存を整合的に扱う処理にある。例えば、親会社の提出書類で対象社が見つからない場合に、資本関係が存在しないと断定しない設計が実装されている。')
p(x,'制度の公募要領を全面的に自動解釈する機能、全国の企業関係を自動探索する機能、個別企業の採択確率を予測する学習モデルとしては評価していない。')

x=page('3 コミット履歴から確認できる開発経緯')
p(x,'履歴は、検索機能から企業照合・資本関係・出典保存へ段階的に対象を広げ、テストと誤断定の防止を追加したことを示している。以下は価値算定との関係が強い変更の抜粋である。全37件は添付CSVに収録した。')
table(x,['日時','コミット','差分から確認した変更'],[
 ['8月31日',commit('61be063'),'Jグランツ対応。検索APIとの接続を追加'],
 ['9月2日',commit('47b9a80'),'企業プロフィールとの照合と初期テストを追加'],
 ['9月2日',commit('be94bef'),'gBizINFOの企業情報連携を追加'],
 ['9月3日',commit('9b85632'),'法人名検索と企業情報不足の補完を拡張'],
 ['9月3日',commit('8801641'),'住所の階層比較、法人状態未提供、検索上限時の候補誤認を修正'],
 ['9月3日',commit('e58f575'),'活動別APIの取得・件数整理とテストを追加'],
 ['9月3日',commit('76e1389'),'EDINET連携と書類・提出日の検証を追加'],
 ['9月3日',commit('3d778c9'),'EDINETの根拠抽出範囲を絞り込み、回帰テストを追加'],
 ['9月3日',commit('d577f4e')+' / '+commit('d093513'),'D1アクセス層と、確認済み資本関係の保存連携を追加'],
 ['9月3日',commit('e9c5883'),'公開情報キャッシュと再利用・障害時動作のテストを追加'],
 ['9月3日',commit('3e8e5c6')+' / '+commit('0be5d0d'),'制度別のみなし大企業判定と採択実績・参考見通しを追加'],
 ['9月5日',commit('e0768e0')+' / '+commit('8d1d45f'),'相談支援の改善、公開申請版への整備'],
 ],[50,106,312])
h(x,'履歴を金額に換算する際の限界')
p(x,'約6暦日の集中開発という事実は、AI活用などによって実装期間を圧縮できる可能性と整合する。ただし、履歴だけではAIの利用率、事前の調査時間、並行作業、実労働時間を特定できない。非マージ30件を30日分の作業と扱うことも、公開期間をそのまま受託工数に置き換えることも適切ではない。')
p(x,'著者名が1種類であるため、公開履歴からは複数の独立メンテナーによる継続運営実績は確認できない。マージコミットの存在のみを、第三者による品質監査の証拠とは扱わない。')

x=page('4 品質確認と評価を制限する事項')
p(x,'**公開版の自動テストは80件中80件成功。型チェックも成功した。** Node.js v24.18.1、npm 11.14.1でロックファイルから依存関係を導入した。テスト用データと模擬APIを用いる確認が中心で、SQLはメモリ上のSQLiteによるD1互換アダプターで検証されている。')
h(x,'評価できる品質上の特徴')
p(x,'入力スキーマとエラー区分があり、同名候補や欠損情報を明示する。gBizINFOの活動別取得では一部失敗でも取得済み結果を返す。キャッシュ障害が公的API照会を止めない設計、出典と取得日時を返す設計、相談先に渡す論点を整理する設計がある。')
h(x,'出典本文と件数の対応は追加検証が必要')
p(x,f'{src("src/selectionStatistics.ts",144,"出典検証関数")}は公式ドメインと根拠文の存在を確認するが、別に入力された申請件数・採択件数がその本文の数値と一致するかは検証していない。{src("src/index.ts",558,"登録ツール")}でも件数と根拠文は別項目で渡される。')
p(x,'模擬検証では、本文を「申請100件・採択40件」としながら計算入力を「申請100件・採択90件」にすると、出典検証が成功し、計算関数は90%を返した。これは関数単位の再現結果であり、本番データの誤りや本番への不正登録を実証したものではない。機械的な本文照合だけで公式件数の正確性まで保証できるとは評価しない。')
h(x,'参考見通しと資本関係抽出の限界')
p(x,f'採択見通しの補正係数と幅はコードで定められたルールであり、統計的な信頼区間ではない。実データでの精度検証やバックテストは確認できない。{src("src/selectionStatistics.ts",711,"参考見通しの算定処理")}')
p(x,f'EDINETは書類内の名称・関係語・比率の抽出である。対象企業行の解釈や間接保有などの複雑な関係について、包括的な構造解析としては評価しない。みなし大企業判定は入力された制度基準と企業情報を照合するため、入力の正確性と鮮度に依存する。{src("src/edinet.ts",443,"根拠抽出処理")}')
h(x,'運用成熟度')
p(x,'Git管理されたCI設定、負荷試験、長期の障害・利用実績、実運用の監視・復旧手順は確認できない。コード上は公開MCPへの受付処理があり、利用者ごとの書き込み権限や流量制御は確認できないが、外部のCloudflare設定の有無は未調査である。商用運営の完成度は追加確認を要する。')

x=page('5 再開発費用の積み上げ')
p(x,'現在の公開機能と同程度の検証を備えた成果物を、新規に作り直す費用を積み上げる。全ケースで一般的なOSSとAI開発支援を利用する。公開コードの再利用費用は次章で別計上する。')
rows=[
 ['要件整理と公的仕様の調査',6,10,14,'業務フロー・例外条件・対象APIを定義'],
 ['MCP基盤とツール定義',5,8,12,'13ツールのスキーマ・応答・設定'],
 ['Jグランツの検索と詳細',5,8,11,'検索統合・期間判定・詳細の正規化'],
 ['gBizINFOと法人照合',10,15,20,'基本情報・名称・住所・8種活動API'],
 ['EDINETの根拠抽出',10,16,24,'コード一覧・書類探索・CSV・根拠'],
 ['制度適合と相談支援',7,11,16,'条件照合・不足・専門家向け整理'],
 ['採択実績と参考見通し',7,11,16,'出典照合・件数計算・ルール算定'],
 ['D1と公開情報キャッシュ',6,9,13,'3変更定義・保存層・障害時動作'],
 ['結合検証と引き渡し',10,16,22,'横断シナリオ・修正・資料・説明'],
]
totals=[sum(r[i] for r in rows) for i in (1,2,3)]
assert totals==[66,104,148]
table(x,['作業区分','低位','標準','高位','見積範囲'],rows+[['合計 人日',*totals,'1人日8時間 1人月20人日']], [143,34,34,34,223])
p(x,'各機能行に設計・実装・単体テストを含め、最終行は横断検証と納品作業に限定した。打合せ・管理工数は各行に配賦し、公開審査・販売活動は計上しない。')
table(x,['計算項目','低位','標準','高位'],[
 ['延べ工数', '66人日 3.3人月','104人日 5.2人月','148人日 7.4人月'],
 ['請求単価 万円／人日','5.0','5.5','6.5'],
 ['人月換算単価 万円','100','110','130'],
 ['工数×単価 万円','330.0','572.0','962.0'],
 ['固定価格の予備費 10%','33.0','57.2','96.2'],
 ['合計 万円','363.0','629.2','1,058.2'],
 ['丸めた概算 万円','約360','約630','約1,060'],
 ],[156,104,104,104])
p(x,'単価には開発会社の一般管理費・利益を含む。予備費10%は固定価格で請け負う際の小規模な手戻りへの分析上の仮定で、市場統計ではない。成果物はソース、テスト、設定、データ構造、導入説明を含む。大規模な機能拡張、厳格なSLA、長期保守は含まない。')

x=page('6 価格の感度と公開コードの再利用')
p(x,'**低位**はAPIとMCPに習熟した少人数体制で手戻りが少ない場合。**標準**は仕様確認、外部API差異の調整、レビュー、横断検証、引き渡しを含む場合。**高位**は習熟・外部応答差異・受入調整で工数が増える場合である。')
p(x,'金額幅は信頼区間ではなく仮定別の見積もり。同じ機能範囲を前提とし、1,000万円という出資希望額から逆算していない。')
h(x,'単価と工数を変えた場合')
table(x,['工数','100万円／人月','110万円／人月','130万円／人月'],[
 ['4人月','440万円','484万円','572万円'],['5.2人月','572万円','629.2万円','743.6万円'],['7人月','770万円','847万円','1,001万円']], [96,124,124,124])
p(x,'上表はいずれも予備費10%込み。単価の参照情報は開発会社の公開目安であり、同種プラグインの成約統計ではない。SIAは小規模チーム受託100万〜180万円／人月、Stella Creationは中堅・中小60万〜100万円／人月を提示している。標準110万円は本件の統合作業を考慮した分析上の設定である。[S1][S2]')
h(x,'公開コードをそのまま利用する場合の別試算')
table(x,['導入と引き継ぎの作業','想定人日'],[
 ['コード・設定・ライセンス条件の確認','3〜6'],['実行環境・APIキー・DBの設定','2〜4'],['優先課題の限定修正と再検証','4〜8'],['実データでの導入確認','3〜6'],['運用説明とリリース確認','3〜6'],['合計','15〜30']], [354,114])
p(x,'15〜30人日 × 5.5万円 × 1.10 ＝ 90.75万〜181.5万円。概算約90万〜180万円。小規模な導入を前提とし、企業向けの権限・監査基盤、大規模移行、独占利用権の対価は含めない。これは追加費用の試算であり、再開発費との差額を直ちに資産価値とすることはできない。')

x=page('7 オープンソースと出資判断への適用')
h(x,'開発費相当額と取得価格の区別')
p(x,f'公開リポジトリはAGPL-3.0-onlyを明記している。ライセンス条件を守る第三者がソースへアクセスし再利用できるため、コード入手のための希少性に高額な対価を置く根拠は弱い。一方、設計済みの業務ロジック、回帰テスト、保守可能な構成には、再利用者が新たに作る作業を減らす価値がある。{src("package.json",4,"ライセンス表記")}　{src("LICENSE",None,"ライセンス本文")}')
p(x,'AGPL本文では、条件が守られる限り許諾は取消不能であり、一定の改変版をネットワーク越しに利用させる場合のソース提供条件も定められている。したがって、公開済みコードを後の取引で完全な独占資産にできるという前提は置かない。本書は契約ごとの法的適合性を判定していない。[S3]')
h(x,'本書が算定するものと算定しないもの')
table(x,['評価対象','本書の扱い'],[
 ['同等機能の新規受託開発','標準約630万円。工数法で試算'],['既存OSSの導入・引き継ぎ','約90万〜180万円。限定した導入条件で試算'],['著作権や事業の譲渡価格','未算定。権利範囲・契約・買手の便益を別途確認'],['会社の株式価値','未算定。既存事業・財務・株式条件が必要'],['公開審査通過のプレミアム','未算定。承認の証拠・継続公開・承継条件を本書で検証していない'],['将来の送客・顧客・売上','未算定。利用・商談・継続率・利益の実績が必要']], [166,302])
h(x,'1,000万円の共同運営出資との関係')
p(x,'本書は、出資検討の出発点となる具体的な技術成果がすでに存在することを示す。出資額1,000万円が適正であることや、特定の持株比率が妥当であることまでは示さない。開発費相当額は会社に投入された現金や会計上の資産額ではなく、株式価値へ自動的に加算できない。')
p(x,'共同運営の対価を説明するには、既存成果の証拠に加え、資金使途、メンテナーの稼働、公開方針、PCAの実証・普及の役割、商用連携の範囲を定める必要がある。公開履歴の著者名は権利帰属を証明しないため、会社との関係および第三者由来の部分は別途確認対象となる。')
p(x,'オープンソースへの継続的な資金提供は、コードを入手する権利に加えて、改善を続ける体制と運営成果を支えるものとして説明できる。その成果は、安定稼働、実データでの品質、継続利用、導入実証などで測定するのが適切である。')

x=page('8 総合評価と次の検証事項')
p(x,'**総合評価は、業務上の例外処理とテストを備えた初期のサービス基盤である。** 機能の存在と主要な回帰テストについては根拠がある。企業で長期運用する際の品質、公開データからの判断精度、事業収益性については証拠が不足している。')
table(x,['評価軸','確認結果','価値算定への反映'],[
 ['機能の実在性','13ツールと関連ソースを確認','実装済み範囲のみを計上'],['例外処理と検証','80件成功。欠損・曖昧性等を検証','設計・テストを再開発工数に含める'],['制度判断の精度','入力・表記・公式資料の解釈に依存','資格判定の保証価値を加算しない'],['参考見通しの精度','固定ルール。統計的検証は未確認','予測モデルの独自資産価値を加算しない'],['運用と継続性','運用実績・多人数保守は未確認','成熟した商用サービスの価格にしない'],['独占性と収益','AGPL公開。収益資料は未確認','独占権・収益倍率での評価を行わない']], [110,178,180])
h(x,'共同運営を具体化する際の優先事項')
p(x,'**第一に、出典と入力件数の対応を保証する手順を整備する。** 公式本文の存在確認に加え、件数・公募回・対象範囲の対応を検証し、誤登録の訂正責任と履歴を明確にする。自動化が難しい資料は確認担当者の承認を挟む。')
p(x,'**第二に、代表的な企業と制度で実データ検証を行う。** 同名企業、住所差、間接保有、EDINETの文書形式、締切や対象地域の例外を含むケースを定め、期待する出力を人が確認する。既存80件の成功をもって実環境の正確性としない。')
p(x,'**第三に、運用を引き継げる状態にする。** 公開者、ドメイン、実行環境、API利用契約、鍵、DB、障害時の連絡先、復旧手順を整理する。CI、依存関係の更新、書き込み制御、流量制御は運用条件に応じて検証・追加する。')
h(x,'評価額の利用方法')
p(x,'再開発費相当の代表値としては**約630万円**を提示し、同じ資料で低位・高位およびOSS再利用の試算を開示することを推奨する。既存コードの売却価格として提示する場合や、PCA側が自社体制で再利用する場合には、この再開発費の数字をそのまま適用しない。')
p(x,'本書の金額は精緻な工数実績や競争見積もりに基づく確定額ではない。正式な発注・出資判断では、相手方が本書の工数と単価を置き換えて再計算できる資料として用いる。')

x=page('付録A ツール一覧と再現方法')
descriptions=['法人候補検索','法人基本情報','8種類の法人活動情報','申告された親会社候補の根拠確認','専門家相談メモ','制度別のみなし大企業条件照合','公式採択実績の登録','登録済み採択実績の参照','制度全体の参考見通し','法人情報を使う適合判定','補助金検索','補助金詳細','入力プロフィールによる適合判定']
table(x,['公開MCPツール','役割'],[[src('src/index.ts',t['line'],t['name']),d] for t,d in zip(D['tools'],descriptions)],[280,188])
h(x,'公開版の再確認')
p(x,f'GitHubから取得後、対象コミット **{SHA}** を指定する。履歴一覧、src・test・migrationsのファイル一覧および登録ツールを比較すれば、本書と同じ評価対象かを確認できる。')
p(x,'検証手順は `npm ci --ignore-scripts --no-audit --no-fund`、`npm test`、`npm run typecheck`。本調査では依存導入、80件のテスト、型チェックが成功した。監査用途の依存脆弱性検査や実API照会はこの手順に含めていない。型チェック設定の対象はsrcであり、テストコード全体の静的型検査成功を意味しない。')
h(x,'添付データ')
table(x,['添付ファイル','内容'],[
 ['commit-history.csv','全37件のSHA・著者名・日時・親コミット・件名'],['file-metrics.csv','公開版52ファイルの行数・サイズ・SHA-256'],['valuation-model.csv','再開発費の工数表と計算条件'],['verification-evidence.zip','実行ログ、集計JSON、算定資料、模擬検証と再現手順']], [180,288])

x=page('付録B 出典と算定上の前提')
h(x,'公開ソースと履歴')
p(x,f'[R1] [公開リポジトリ]({REPO})\n[R2] [対象コミット]({REPO}/commit/{SHA})\n[R3] [対象コミットまでの履歴]({REPO}/commits/{SHA})\n[R4] {src("README.md",None,"機能と計画の説明")}\n[R5] {src("package.json",None,"構成と検証コマンド")} / {src("package-lock.json",None,"依存関係固定")}\n[R6] {src("tsconfig.json",None,"型チェックの対象")} / {src("wrangler.jsonc",None,"実行基盤設定")}\n[R7] {src("test/migrations.test.ts",38,"SQLiteによる変更定義の検証")}\n[R8] {src("src/selectionStatistics.ts",144,"公式本文の検証")} / {src("src/selectionStatistics.ts",238,"採択率計算")} / {src("src/selectionStatistics.ts",711,"参考見通し")}\n[R9] {src("CONTRIBUTING.md",None,"貢献手順")} / {src("SECURITY.md",None,"セキュリティ方針")} / {src("PRIVACY.md",None,"公開プライバシー方針")}')
h(x,'外部参照資料')
p(x,'[S1] [SIA株式会社 受託開発の費用相場](https://www.siainc.jp/topic/outsourced-development-cost-factors-2025)。2026年9月6日更新。小規模チーム受託の単価目安を参照。同社は自社の見積・受注実績と協力会社の取引を基礎とし、統計平均ではないと説明している。')
p(x,'[S2] [株式会社Stella Creation AI自動化とシステム開発の費用相場](https://www.stellacreation.com/costs)。2026年8月時点の目安。中堅・中小の単価とAI活用による工数圧縮の考え方を参照。本プロジェクトに同社の料金や削減率を直接適用したものではない。')
p(x,f'[S3] [GNU AGPL v3 本文](https://www.gnu.org/licenses/agpl-3.0.de.html)。第2条の許諾条件、第13条のネットワーク利用に関する条件を参照。対象リポジトリの{src("LICENSE",None,"LICENSE")}も確認した。')
p(x,'外部参照資料の確認日は2026年9月9日。これらは単価とライセンスの背景資料であり、本プロジェクトの成約価格や工数を直接証明する資料ではない。各機能の根拠リンクは対象SHAを固定している。')
h(x,'算定上の共通前提')
p(x,'円建て・税別、1人日8時間、1人月20人日。全ケースでAI支援と既存の一般的なOSSを利用。AIを使用した実際の削減率は未計測。対象固有のソースをそのまま再利用する場合は導入費用の別試算を適用する。外部APIの利用権、インフラ料金、税務・法務費用、長期保守、独占権、会社評価、公開審査プレミアムは再開発額に含めない。')
p(x,'既知の検証課題を理由に根拠のない一律割引率を置くことはせず、機能と品質の評価範囲を限定した。追加の商用品質を求める際の作業は別途見積もる。公開コードの改変・デプロイ・GitHubへの投稿は本調査で実施していない。')

# Source-controlled evidence is retained separately from deliverables.
model_headers=['work_item','low_person_days','standard_person_days','high_person_days','scope']
with (ROOT/'valuation-model.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f);w.writerow(model_headers);w.writerows(rows)
    w.writerow(['TOTAL_DAYS',*totals,'']);w.writerow(['DAILY_RATE_JPY',50000,55000,65000,'Includes overhead and profit'])
    w.writerow(['CONTINGENCY_RATE',.10,.10,.10,'Assumed fixed-price allowance'])
    w.writerow(['TOTAL_JPY',3630000,6292000,10582000,'Tax excluded'])
for name in ('commit-history.csv','file-metrics.csv'):shutil.copy2(E/name,ROOT/name)
(E/'report-content.json').write_text(json.dumps(pages,ensure_ascii=False,indent=2),encoding='utf-8')
md=[]
for num,pg in enumerate(pages):
    md += [('# ' if num==0 else '## ')+pg['title'].replace('\n',' '),'']
    for item in pg['items']:
        if item[0]=='p':md += [item[1],'']
        elif item[0]=='h':md += ['### '+item[1],'']
        else:
            _,heads,rs,widths=item
            md.append('| '+' | '.join(heads)+' |');md.append('| '+' | '.join('---' for _ in heads)+' |')
            for row in rs:md.append('| '+' | '.join(str(v).replace('\n','<br>') for v in row)+' |')
            md.append('')
(ROOT/'source-code-valuation-report.md').write_text('\n'.join(md),encoding='utf-8')

pdfmetrics.registerFont(TTFont('JP','C:/Windows/Fonts/meiryo.ttc',subfontIndex=0))
pdfmetrics.registerFont(TTFont('JPBold','C:/Windows/Fonts/meiryob.ttc',subfontIndex=0))
pdfmetrics.registerFontFamily('JP',normal='JP',bold='JPBold',italic='JP',boldItalic='JPBold')
styles={
 'p':ParagraphStyle('body',fontName='JP',fontSize=10.2,leading=16,spaceAfter=8,wordWrap='CJK'),
 'h':ParagraphStyle('heading2',fontName='JPBold',fontSize=12,leading=18,spaceBefore=8,spaceAfter=6,wordWrap='CJK',keepWithNext=True),
 'title':ParagraphStyle('title',fontName='JPBold',fontSize=24,leading=34,spaceAfter=18,wordWrap='CJK'),
 'section':ParagraphStyle('section',fontName='JPBold',fontSize=17,leading=26,spaceAfter=16,wordWrap='CJK'),
 'cell':ParagraphStyle('cell',fontName='JP',fontSize=8.7,leading=13,wordWrap='CJK'),
 'th':ParagraphStyle('th',fontName='JPBold',fontSize=8.7,leading=13,wordWrap='CJK'),
}
def markup(s):
    s=html.escape(str(s));s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<link href="\2" color="#264D73">\1</link>',s)
    s=re.sub(r'\*\*(.*?)\*\*',r'<b>\1</b>',s);s=s.replace('`','')
    return s.replace('\n','<br/>')
story=[]
for n,pg in enumerate(pages):
    if n:story.append(PageBreak())
    story.append(Paragraph(markup(pg['title']),styles['title' if n==0 else 'section']))
    for item in pg['items']:
        if item[0] in ('p','h'):story.append(Paragraph(markup(item[1]),styles[item[0]]))
        else:
            _,headers,rs,widths=item
            tab=Table([[Paragraph(markup(s),styles['th']) for s in headers]]+[[Paragraph(markup(s),styles['cell']) for s in row] for row in rs],colWidths=widths,repeatRows=1,hAlign='LEFT')
            tab.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'MIDDLE'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#F1F2F3')),('BOX',(0,0),(-1,-1),.4,colors.HexColor('#CCCCCC')),('INNERGRID',(0,0),(-1,-1),.3,colors.HexColor('#DADADA')),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)]))
            story.extend([tab,Spacer(1,10)])
    if isinstance(story[-1],Spacer): story.pop()
def furniture(c,d):
    c.saveState();c.setFont('JP',8);c.setFillColor(colors.HexColor('#777777'))
    c.drawRightString(540,759,'技術資産評価  |  2026年9月9日')
    c.drawString(72,38,'公開ソースに基づくAI分析  |  対象 '+SHA[:7]);c.drawRightString(540,38,str(d.page))
    if d.page==1:c.setFillColor(colors.black);c.rect(72,727,118,6,fill=1,stroke=0)
    c.restoreState()
pdf=ROOT/'source-code-valuation-report.pdf'
doc=SimpleDocTemplate(str(pdf),pagesize=(612,792),leftMargin=72,rightMargin=72,topMargin=84,bottomMargin=60,title='日本の補助金検索 ソースコード価値算定レポート',author='OpenAI Codex AI analysis',subject='Public source and commit history based redevelopment cost estimate')
doc.build(story,onFirstPage=furniture,onLaterPages=furniture)
(E/'artifact.md').write_text('Reference: Investment Committee Memo retained DOCX\nGeometry: Letter 612 x 792 points, 72-point side margins. Black title and headings, gray table headers, small running header and page footer. Japanese Meiryo substitutes Latin typeface.\nThe packaged DOCX renderer could not run because bundled LibreOffice is unavailable on Windows. PDF is authored directly with reference-derived layout; editable text is delivered as Markdown. No unverified DOCX is delivered.\n',encoding='utf-8')
print(str(pdf))
