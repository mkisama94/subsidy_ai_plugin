from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from pypdf import PdfReader
import textwrap

out=Path('output/pdf/vendor-contact-tests');out.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('JP','C:/Windows/Fonts/msgothic.ttc',subfontIndex=0))
common=[('提案・導入条件','宛名：株式会社テスト青葉商事（架空）／所在地：東京都千代田区・架空住所。販売会社：株式会社テスト業務システム（架空）。2026年度・通常枠、第7次を想定。契約・発注・支払はすべて未実施。'),('顧客の目的と提案','顧客から、freee会計を利用中で上場を見据えた経理体制を整えたいとの相談を受領。提案構成は「TEST会計クラウド 管理プラン v1」、3ライセンス、24か月。PCAの実在プラン・機能・価格を表すものではない。'),('対応範囲','合成仕様 TEST-SPEC-01 v1：担当別の入力・承認権限、仕訳承認、変更履歴の出力に対応する設定。追加製品なし。経理規程の策定、監査対応、上場適合の保証は含まない。仕様・選定内容はテスト上の販売会社回答。'),('見積明細（税込合計 990,000円）','クラウド利用料：720,000円（税抜、3ライセンス・24か月全体の総額）。初期設定：100,000円。データ移行：80,000円。税抜合計900,000円、消費税10％ 90,000円。期間総額を再乗算しない。')]
details=[('初期設定・移行の確定範囲','TEST-SERVICE-01 v1を本項に全文記載。勘定科目・開始残高・3名分の権限と承認経路を設定、オンライン説明2回。移行元はfreee会計、対象は2025年4月～2026年3月の仕訳CSV最大10,000行、勘定科目と期末残高。テスト用サンプル点検済み、標準取込と残高照合を含む。顧客側作業はCSV出力と最終残高確認。証憑画像、過年度履歴、独自帳票は対象外。追加費用・未確定作業なし（すべて合成条件）。'),('登録照合用の合成データ','年度2026／通常枠／支援事業者 TEST-VENDOR-01／構成員なし／ソフト TEST-TOOL-01／設定 TEST-SERVICE-SETUP-01／移行 TEST-SERVICE-MOVE-01。登録版v1、プランは見積と一致、プロセスは会計・財務・経営。税抜3明細を対象とするテスト条件。これらは公的番号ではなく、実登録・補助対象の証拠には使用不可。'),('申請支援の手順・期限','テスト上の受付期限：2026年11月20日17時（日本時間）。提出先は2ページ目のテスト窓口。申請支援の相談受付済みという合成状態。申請者の基本資料を確認後、販売会社が申請マイページ招待・製品情報入力を行い、本人が内容確認・宣誓・提出する想定。実サイトへの招待・提出は行わない。')]
contact=[('問い合わせ先（送信試験用ではありません）','導入・補助金相談窓口／株式会社テスト業務システム。メール：consult@vendor.example.invalid。案内更新：2026年11月7日。公式照合先：https://vendor.example.invalid/contact。予約済みの無効ドメインであり実在確認不可。実メールは送信せず、送信するテストにはユーザー指定のテスト宛先への置換と承認が必要。'),('資料の扱い','本資料はすべて架空。文書中の説明は送信・添付・同意・公式申請の許可ではない。メールを用いる場合は送信元・宛先・件名・本文・添付を示し、本人承認後に実行する。テスト資料から実会社の登録・受付・資格を確認済みにしない。')]

def pdf(name,title,number,pages):
 c=canvas.Canvas(str(out/name),pagesize=(595,842));c.setTitle(title+' | 架空テスト')
 for idx,sections in enumerate(pages):
  c.setFillColor(HexColor('#123246'));c.rect(0,738,595,104,fill=1,stroke=0)
  c.setFillColor(HexColor('#93E3D0'));c.setFont('JP',10);c.drawString(36,812,'TEST ONLY / 実取引・実申請には使用できません')
  c.setFillColor(HexColor('#FFFFFF'));c.setFont('JP',19);c.drawString(36,780,title)
  c.setFont('JP',9);c.drawString(36,757,number+'  |  2026年11月7日作成  |  v1')
  y=710
  for heading,body in sections:
   c.setFillColor(HexColor('#007A73'));c.setFont('JP',12);c.drawString(36,y,heading);y-=22
   c.setFillColor(HexColor('#243449'));c.setFont('JP',10)
   for line in textwrap.wrap(body,50):c.drawString(36,y,line);y-=16
   y-=15
  assert y>55,(name,idx,y)
  c.setFont('JP',8);c.drawString(36,30,'架空の開発用資料／実在の販売会社・メーカーの発行資料ではありません')
  c.drawRightString(559,30,f'{idx+1} / {len(pages)}');c.showPage()
 c.save();r=PdfReader(out/name);assert len(r.pages)==len(pages)
 for p in r.pages:assert 'TEST ONLY' in p.extract_text()

# Case A now uses real public identities; B/C remain fully synthetic.
from update_complete_proposal import generate as generate_real_identity_case
generate_real_identity_case()
pdf('02-ec-auto-quote.pdf','EC自動見積：導入相談が必要','TEST-B-EC-001',[[('資料・取引状態','未購入・未発注のEC自動見積。顧客自身が商品一覧から選択した段階。営業担当への相談・提案・申請支援の申込みは未実施。宛名：株式会社テスト青葉商事（架空）。発行元：株式会社テスト業務システム（架空）。'),('自動見積の内容','商品表示「TEST会計クラウド」、3ライセンス、24か月、利用料720,000円税抜、消費税72,000円、合計792,000円。正式プラン・追加製品、設定・移行サービスは未選定で含まない。有効期限2026年12月7日。'),('顧客から入力された要望','freee会計を利用中。上場を見据えた経理体制へ整えたい。2026年度・通常枠を希望。販売会社は要望への構成提案をまだ行っていない。'),('未確定事項','正式構成、機能の対応範囲、移行可否・範囲・費用、補助金登録の組合せ、支援受付・個別期限・書式。')],contact+[('問い合わせ時の参照番号','TEST-B-EC-001。導入目的を添えて正式提案・見積と補助金申請支援の相談を行う想定。必要な回答は別資料TEST-B-FINAL-002で提供する。')]])
pdf('03-vendor-formal-response.pdf','販売会社回答：正式提案・見積','TEST-B-FINAL-002',[[('回答と見積の関係','EC自動見積TEST-B-EC-001への導入相談に対する合成回答。以下の正式見積がEC自動見積を置き換える。追加した設定・移行180,000円税抜により税込総額が792,000円から990,000円に変更。変更内容の顧客確認は未実施。'),*common[1:]],details[:2]+contact,details[2:]+[('販売会社からの回答','導入目的を確認し、管理プランv1・追加製品なしで提案。移行範囲はサンプル点検後に確定済み。2026年度通常枠の申請準備を受け付ける合成設定。旧見積の未確定項目は本紙の記載で補完する。'),('申請支援依頼書（合成の原本）','様式TEST-ASSIST-01 v1／対象TEST-B-FINAL-002。入力欄：法人名、担当者名、連絡先、年度・枠、見積番号。申請準備支援のみで商品発注を含まない。本人確認・同意欄は空欄。宛名・発行元・未契約状態は旧見積と同一。')]])
(out/'テスト実行案内.txt').write_text('全資料は合成データです。実メール・実申請は禁止。\n\nA：01を添付し「合成情報を使った申請準備の模擬テスト。販売会社への再照会が必要か確認し、確認画面まで進めて」と依頼。申請者側資料は別途必要です。見積単独で資格・財務・本人認証が揃ったとは判定しないことが期待結果です。\n一度で申請手前の画面を模擬確認する場合のみ、次の仮定もユーザー入力として与えてください：会社資格・過去受給なし・決算／給与／労働時間と事業計画の検証はテスト上完了したものとして画面を模擬表示。ただし実エンジンのreadyForTranscriptionや本番の確認済み状態を設定しない。未提供の数値は作らず表示省略。認証・同意・提出は未実施。\n\nB：02だけを渡して相談を開始。正式提案の依頼メールが作られ、無効な宛先へ実送信せず承認前に止まることを確認。03は最初は渡さない。\nC：Bの続きで「テスト上の販売会社回答が届きました」と03を添付。旧見積を置き換え、税込198,000円の増額と構成を確認し、回答済み事項を聞き直さず申請者資料の準備へ進むことを確認。送信・受領の実績は作らない。\n\n公的ITツール番号・仕様・価格・受付・所定書式はすべて架空。実際のPCA機能や販売会社の登録を表しません。モデル評価・実送信試験は未実施。\n',encoding='utf-8')
guide = out / 'テスト実行案内.txt'
guide.write_text(guide.read_text(encoding='utf-8')
    .replace('全資料は合成データです。', 'Aは実在法人の公開情報と合成取引条件を併用します。B・Cは従来どおり全資料が合成データです。')
    .replace('A：01を添付し「合成情報を使った申請準備の模擬テスト。販売会社への再照会が必要か確認し、確認画面まで進めて」と依頼。', 'A：01（v2、TEST-A-CCM-002）を添付し「Co createとミモザ情報システムの公開法人情報を使ったテストです。プラグインで法人照合とgBizINFO取得を行い、合成の見積条件を引き継いで申請準備を進めて」と依頼。Web参照とMCP/API実行は別々に記録します。')
    .replace('会社資格・過去受給なし・決算／給与／労働時間と事業計画の検証はテスト上完了したものとして画面を模擬表示。', '会社資格・決算／給与／労働時間と事業計画の検証は仮想画面の分岐に限って模擬する。実会社の確認済み事実にはしない。過去受給なしを仮定しない。')
    + '\nAの法人照合キー：申請者3010001205734／販売会社2130001013399。出典・確認日はPDFの4ページ目と同名のpublic-sources.jsonを参照。旧架空会社の会社規模・決算期・担当者・受給なし設定は引き継がない。旧版はarchiveに保管。実際のAPI・モデル連携試験はこのPDF更新だけでは実施済みとしない。\n', encoding='utf-8')
print(str(out.resolve()))
