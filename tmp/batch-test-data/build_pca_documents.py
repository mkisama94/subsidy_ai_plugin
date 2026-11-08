from pathlib import Path
from xml.sax.saxutils import escape
import json, shutil, re, sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[2]
WORK=Path(__file__).resolve().parent
OUT=ROOT/'output/pdf/cocreate-application'
OUT.mkdir(parents=True,exist_ok=True)
D=json.loads((WORK/'data.json').read_text(encoding='utf-8'))
NAME=D['company']; CORP=D['corporateNumber']; CASE=D['caseId']
PERIOD='2025年4月1日～2026年3月31日'
pdfmetrics.registerFont(TTFont('JP','C:/Windows/Fonts/msgothic.ttc',subfontIndex=0))
base=ParagraphStyle('body',fontName='JP',fontSize=10,leading=15,textColor=HexColor('#243449'),wordWrap='CJK')

class Document:
    def __init__(self,name,title,pages):
        self.path=OUT/name; self.pages=pages
        self.c=canvas.Canvas(str(self.path),pagesize=(595,842),pageCompression=1)
        self.c.setTitle(title); self.c.setAuthor(''); self.c.setSubject(f'{NAME} / {CASE}')
        self.bottoms=[]
    def txt(self,x,y,s,size=10,color='#243449'):
        self.c.setFont('JP',size);self.c.setFillColor(HexColor(color));self.c.drawString(x,y,s)
    def start(self,n,title,subtitle='経理・申請準備資料',period=PERIOD,units=''):
        c=self.c;c.setFillColor(HexColor('#123246'));c.rect(0,740,595,102,fill=1,stroke=0)
        self.txt(36,813,subtitle,10,'#93E3D0')
        self.txt(36,781,title,22,'#FFFFFF')
        self.txt(36,758,f'管理番号 {CASE}  |  作成日 2026年11月7日',8,'#FFFFFF')
        self.txt(36,715,NAME,13);self.txt(36,694,f'法人番号 {CORP}',9)
        self.txt(36,675,period,9)
        if units:self.txt(36,656,units,9)
        self.txt(36,31,f'{CASE}  |  {NAME}',8,'#516273')
        self.txt(533,31,f'{n} / {self.pages}',8,'#516273')
        self.y=630 if units else 647
    def para(self,s,size=10,gap=10):
        p=Paragraph(s,ParagraphStyle('p',parent=base,fontSize=size,leading=size*1.5))
        _,h=p.wrap(523,700);assert self.y-h>=65,(self.path.name,s[:70],self.y,h)
        p.drawOn(self.c,36,self.y-h);self.y-=h+gap
    def section(self,title,body):
        self.para(escape(title),12,5);self.para(body)
    def table(self,headers,rows,widths,fs=9,pad=7):
        cells=[]
        for ri,row in enumerate([headers]+rows):
            cells.append([Paragraph(escape(str(v)).replace('\n','<br/>'),ParagraphStyle('cell',parent=base,fontSize=fs,leading=fs*1.4)) for v in row])
        t=Table(cells,colWidths=widths,hAlign='LEFT')
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#E6F2F0')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),pad),('BOTTOMPADDING',(0,0),(-1,-1),pad),('LINEBELOW',(0,0),(-1,-1),.4,HexColor('#D6E2E7'))]))
        _,h=t.wrap(523,700);assert self.y-h>=65,('table overflow',self.path.name,self.y,h)
        t.drawOn(self.c,36,self.y-h);self.y-=h+14
    def end(self):self.bottoms.append(self.y);self.c.showPage()
    def save(self):
        self.c.save();r=PdfReader(self.path)
        assert len(r.pages)==self.pages
        content='\n'.join(p.extract_text() for p in r.pages)+str(r.metadata)
        assert not re.search(r'TEST|テスト|架空|模擬|合成|デモ',content,re.I), self.path
        return {'file':self.path.name,'pages':self.pages,'bottoms':self.bottoms}

def num(v):return f'{v:,.1f}' if isinstance(v,float) and v%1 else f'{int(v):,}'

results=[]
q=Document('01_導入提案・費用明細.pdf','PCAクラウド 会計 dx 導入提案・費用明細',3)
# The quotation page uses an ordinary seller's layout. Application-specific
# information belongs to the attachments, linked by the quotation number.
c=q.c
c.setFillColor(HexColor('#202020'));c.setFont('JP',24)
c.drawCentredString(297.5,788,'御 見 積 書')
c.setStrokeColor(HexColor('#5E5E5E'));c.setLineWidth(.7);c.line(42,770,553,770)
q.txt(360,748,f'見積番号：{CASE}',9,'#202020')
q.txt(360,732,'発行日：2026年11月7日',9,'#202020')
q.txt(42,738,'株式会社Co create 御中',16,'#202020')
c.line(42,727,302,727)
q.txt(42,708,'東京都千代田区神田鍛冶町3丁目7番地21',9,'#202020')
q.txt(42,693,'天翔神田駅前ビル808',9,'#202020')
q.txt(333,693,'株式会社ミモザ情報システム',13,'#202020')
q.txt(333,674,'京都府京都市山科区大塚森町12番19号',8.8,'#202020')
q.txt(333,660,'ステア211・2F',9,'#202020')
q.txt(333,644,'法人番号：2130001013399',8.5,'#202020')
q.txt(42,660,'下記のとおり、お見積り申し上げます。',9,'#202020')
q.txt(42,620,'件名：PCAクラウド 会計 dx 導入',11,'#202020')
c.setFillColor(HexColor('#F5F5F5'));c.rect(42,553,511,49,fill=1,stroke=0)
c.setStrokeColor(HexColor('#404040'));c.setLineWidth(.8);c.rect(42,553,511,49,fill=0,stroke=1)
q.txt(55,574,'御見積金額',12,'#202020')
c.setFont('JP',26);c.setFillColor(HexColor('#202020'));c.drawRightString(478,567,'¥ 1,148,400')
q.txt(492,572,'税込',10,'#202020')
q.txt(42,530,'納入時期：別途協議',9,'#202020')
q.txt(310,530,'支払条件：別途協議',9,'#202020')
q.txt(453,510,'金額単位：円',8,'#404040')
headers=['No.','品名・仕様','数量','単位','単価','金額']
rows=[['1','PCAクラウド 会計 dx\n3CAL・24か月プリペイド','1','式','864,000','864,000'],
      ['2','初期設定・操作説明','1','式','100,000','100,000'],
      ['3','会計データ移行・残高照合','1','式','80,000','80,000']]
cells=[]
for ri,row in enumerate([headers]+rows):
    cells.append([Paragraph(escape(str(v)).replace('\n','<br/>'),ParagraphStyle('quote',parent=base,fontSize=9,leading=14,textColor=HexColor('#202020'),alignment=(1 if ri==0 or j in (0,2,3) else 2 if j in (4,5) else 0))) for j,v in enumerate(row)])
t=Table(cells,colWidths=[28,235,35,35,88,90],rowHeights=[27,51,37,37])
t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#EEEEEE')),('GRID',(0,0),(-1,-1),.5,HexColor('#777777')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7)]))
_,h=t.wrap(511,700);t.drawOn(c,42,501-h)
summary=Table([['小計','1,044,000'],['消費税（10％）','104,400'],['合計（税込）','1,148,400']],colWidths=[152,106],rowHeights=[26,26,29])
summary.setStyle(TableStyle([('FONTNAME',(0,0),(-1,-1),'JP'),('FONTSIZE',(0,0),(-1,-1),10),('TEXTCOLOR',(0,0),(-1,-1),HexColor('#202020')),('ALIGN',(1,0),(1,-1),'RIGHT'),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('BACKGROUND',(0,-1),(-1,-1),HexColor('#EEEEEE')),('GRID',(0,0),(-1,-1),.5,HexColor('#777777')),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9)]))
summary.wrap(258,100);summary.drawOn(c,295,258)
q.txt(42,224,'備考',10,'#202020')
c.setLineWidth(.4);c.line(42,215,553,215)
q.txt(42,196,'クラウド利用料は、ソフトウェア・サーバー利用料を含む24か月分の総額です。',9,'#202020')
q.txt(42,178,'初期設定・移行作業の詳細は別紙1をご参照ください。',9,'#202020')
q.txt(42,39,f'見積番号 {CASE}',8,'#666666')
q.txt(524,39,'1 / 3',8,'#666666')
q.y=162
q.end()
q.start(2,'別紙1｜導入目的・作業範囲',f'御見積書 {CASE} の添付資料',period='対象製品：PCAクラウド 会計 dx　／　利用者：経理入力・経理承認・管理責任者の3名')
q.section('導入の目的','現在のfreee会計から会計データを移行し、入力・承認の担当区分、仕訳の承認、操作履歴の確認を含む経理体制を整備します。上場を見据え、月次決算と確認作業を標準化することを目的とします。')
q.section('初期設定・操作説明','勘定科目・部門・開始残高、3名分の利用権限、仕訳承認の運用を設定します。オンラインでの操作説明を2回実施する範囲です。')
q.table(['項目','対象範囲'],[
 ['移行元','freee会計から出力したCSV'],['移行対象期間','2025年4月1日～2026年3月31日'],
 ['データ量','仕訳CSV 最大10,000行、勘定科目、期末残高'],
 ['対応作業','項目の対応付け、標準取込、試算表残高の照合'],
 ['導入先の作業','移行元データの出力、勘定科目の確認、最終残高の確認'],
 ['対象外','証憑画像、上記期間より前の履歴、独自帳票の開発'],
 ],[115,408])
q.para('経理規程の策定・監査対応は別途扱います。移行対象期間と決算対象期間は、それぞれの資料に基づいて確認します。',9)
q.end()
q.start(3,'別紙2｜申請準備の確認事項',f'御見積書 {CASE} の添付資料',period='対象年度・枠：2026年度・通常枠　／　公募回・期限：受付状況に合わせて確認')
q.table(['項目','現在の内容'],[
 ['契約・発注・支払','未実施'],['支援の範囲','導入資料の整理、申請書類の準備、事業計画・転記内容の作成支援'],
 ['当年度の登録情報','対象製品・契約期間・役務に対応するITツール登録番号と支援事業者登録を販売会社へ確認'],
 ['2022～2025年の履歴','IT導入補助金の交付決定なし'],
 ['決算資料','2025年4月1日～2026年3月31日の貸借対照表・損益計算書・販管費明細'],
 ['人事・経理資料','同期間の役員・従業員一覧、日次・月次勤怠、給与・役員報酬集計、決算内訳'],
 ['公的証明書','履歴事項全部証明書、法人税納税証明書の原本は別途取得'],
 ['出資・グループ関係','株主名簿・持株比率の資料は未添付。公開情報と照合のうえ、不足項目を確認'],
 ],[135,388],9,6)
q.para('申請準備後、本人による内容確認・認証・宣誓・提出へ進みます。商品の発注・支払は本資料では行っていません。',9)
q.para('価格参照：ミモザ情報システム「PCAクラウド プリペイド」同時接続3ユーザー・会計dx・24か月。クラウド利用料は税込950,400円を税抜換算。<br/><link href="https://www.mimosa.gr.jp/pca/cloud_prepaid.html" color="#007A73">https://www.mimosa.gr.jp/pca/cloud_prepaid.html</link>',8)
q.end();results.append(q.save())

if '--proposal-only' in sys.argv:
    shutil.copy2(q.path,ROOT/'output/pdf/vendor-contact-tests/01-complete-proposal.pdf')
    (WORK/'proposal-build.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(results,ensure_ascii=False))
    sys.exit(0)

f=Document('02_決算書_2025年度.pdf','2025年度 決算書',3)
f.start(1,'貸借対照表','2025年度 決算書',period='2026年3月31日現在',units='単位：千円')
f.table(['資産の部','金額','負債・純資産の部','金額'],[
 ['現金及び預金','18,000','買掛金','6,000'],['売掛金','12,000','未払費用','2,000'],['前払費用','1,000','未払法人税等','2,000'],
 ['流動資産合計','31,000','流動負債合計','10,000'],['有形固定資産（純額）','4,000','長期借入金','15,000'],['ソフトウェア（純額）','5,000','固定負債合計','15,000'],
 ['固定資産合計','9,000','負債合計','25,000'],['','','資本金','10,000'],['','','利益剰余金','5,000'],['','','純資産合計','15,000'],['資産合計','40,000','負債・純資産合計','40,000'],
 ],[176,78,191,78],9,9)
f.para('固定資産は減価償却累計額控除後の帳簿価額です。',9)
f.end()
f.start(2,'損益計算書','2025年度 決算書',units='単位：千円')
f.table(['科目','金額'],[
 ['売上高','100,000'],['売上原価','35,000'],['売上総利益','65,000'],['販売費及び一般管理費','57,000'],['営業利益','8,000'],
 ['受取利息（営業外収益）','100'],['支払利息（営業外費用）','600'],['経常利益','7,500'],['特別利益','0'],['特別損失','0'],['税引前当期純利益','7,500'],['法人税等','2,500'],['当期純利益','5,000'],
 ],[385,138],9,6)
f.para('利益剰余金：前期末0千円＋当期純利益5,000千円＝当期末5,000千円。配当・その他増減はありません。',9)
f.end()
f.start(3,'販売費及び一般管理費','2025年度 科目別明細',units='単位：千円')
f.table(['科目','金額'],[
 ['給与手当','24,000'],['賞与','3,000'],['役員報酬','6,000'],['法定福利費','5,000'],['福利厚生費','1,000'],['旅費交通費','1,000'],['減価償却費','3,000'],['地代家賃','6,000'],['通信費','2,000'],['広告宣伝費','4,000'],['支払手数料','2,000'],['販売費及び一般管理費合計','57,000'],
 ],[385,138],9,7)
f.para('給与・役員報酬の月次内訳、法定福利費・減価償却費の内訳は、同期間の人事・経理資料に記載しています。',9)
f.end();results.append(f.save())

l=Document('03_人事・経理資料_2025年度.pdf','2025年度 人事・経理資料',8)
l.start(1,'役員・従業員一覧','在籍者情報',units='人数：人　／　氏名は社員番号により管理')
l.table(['ID','表示名','区分・雇用形態','就任・入社日','退任・退社'],[[p['id'],p['name'],p['employment'],p['joined'],'なし'] for p in D['people']],[43,100,130,125,125])
l.para('対象期を通じて常勤役員1名・正社員5名が在籍しています。兼務役員・パート・派遣・出向者は0名です。役員と従業員は区分して集計しています。')
l.para('勤怠・給与資料はIDで照合できます。PCAクラウドの3ユーザーはシステムの利用者数です。役員・従業員の人数は本一覧に基づきます。')
l.end()
l.start(2,'月次勤務記録','実働時間の集計',units='単位：時間　／　休憩・有給休暇は実働時間に含めない')
rows=[]
months=sorted(set(r['month'] for r in D['monthly']))
for mo in months:
    ms=[r for r in D['monthly'] if r['month']==mo]
    rows.append([mo]+[num(r['actualHours']) for r in ms]+[num(sum(r['actualHours'] for r in ms))])
rows.append(['年間']+[num(r['actualHours']) for r in D['annual']]+[num(D['totals']['actualHours'])])
l.table(['月','O01\n役員','E01','E02','E03','E04','E05','合計'],rows,[67,62,62,62,62,62,62,84],8,6)
l.para('O01は役員の業務従事時間です。役員と従業員の集計対象は制度の定義に沿って選択します。日別の出退勤・休憩・有休・時間外の明細はExcelの「日次勤怠」に記載しています。',9)
l.end()
l.start(3,'勤務実績の内訳','年間実績と勤務カレンダー',units='単位：日・時間')
l.table(['ID','勤務・従事\n日数','有休日数','通常実働','時間外','実働合計'],[[r['id']]+[num(r[k]) for k in ('days','paidLeaveDays','regularHours','overtimeHours','actualHours')] for r in D['annual']],[50,100,85,96,96,96])
l.para(f'従業員5名の実働合計：{num(D["totals"]["employeeHours"])}時間。役員1名の業務従事：{num(D["totals"]["officerHours"])}時間。両区分の合計：{num(D["totals"]["actualHours"])}時間。')
l.section('勤務カレンダー','土日・祝日を休日とし、夏季休業は2025年8月13日～15日、年末年始休業は2025年12月29日～2026年1月2日です。従業員の有休と役員の休務は日次明細に記録しています。')
l.section('時間の扱い','従業員は9:00～18:00・休憩1時間、役員は9:00～17:00・休憩1時間を基本とします。時間外は勤務実績に加算し、有休は1日8時間を別列で管理しています。')
l.end()
l.start(4,'給与・役員報酬の年間集計','支給額の集計',units='単位：円　／　税・社会保険等の控除前')
l.table(['ID','給与手当','賞与','役員報酬','合計'],[[r['id']]+[num(r[k]) for k in ('salary','bonus','officer','total')] for r in D['annual']]+[['合計']+[num(D['totals'][k]) for k in ('salary','bonus','officer','total')]],[43,120,115,120,125],8.5)
l.para('給与・報酬は対象期中の費用計上額・支給額です。従業員賞与は6月・12月の年2回、各回月額給与手当の0.75か月分です。役員賞与はありません。')
l.para('給与手当には諸手当を含みます。Excelの「給与明細」には基本給・諸手当・賞与・役員報酬を区別した月別明細を収録しています。通勤手当・退職金・現物給与は0円です。')
l.para('本表は支給額の集計資料です。社会保険の本人負担・源泉税・控除後振込額は給与台帳で別管理しています。',9)
l.end()
l.start(5,'給与の月別集計','月次支給額',units='単位：円　／　ID別明細はExcel「給与明細」に記載')
rows=[]
for mo in months:
    ps=[r for r in D['payroll'] if r['month']==mo]
    rows.append([mo]+[num(sum(r[k] for r in ps)) for k in ('salary','bonus','officer','total')])
rows.append(['年間']+[num(D['totals'][k]) for k in ('salary','bonus','officer','total')])
l.table(['月','給与手当','賞与','役員報酬','合計'],rows,[67,114,114,114,114],8.5,6)
l.para('決算書の販管費明細：給与手当24,000千円・賞与3,000千円・役員報酬6,000千円に対応します。本資料とExcelは円、決算書は千円で記載しています。',9)
l.end()
l.start(6,'決算内訳の補足','人件費・固定資産の内訳',units='単位：円')
l.table(['科目','内訳','金額'],[['法定福利費','社会保険等の会社負担分','5,000,000'],['福利厚生費','共通福利厚生費','1,000,000'],['減価償却費','有形固定資産分','1,000,000'],['減価償却費','ソフトウェア分','2,000,000'],['減価償却費合計','有形固定資産＋ソフトウェア','3,000,000']],[115,283,125])
l.table(['償却対象','期首帳簿価額','当期償却額','期末帳簿価額'],[['有形固定資産','5,000,000','1,000,000','4,000,000'],['ソフトウェア','7,000,000','2,000,000','5,000,000'],['合計','12,000,000','3,000,000','9,000,000']],[145,126,126,126],8.5)
l.para('対象期の取得・売却・除却・減損・その他増減はありません。固定資産の期末合計9,000千円は貸借対照表に対応します。',9)
l.para('売上原価35,000,000円は外部仕入・外注費です。上記の給与・福利・減価償却は販管費に計上しており、売上原価には含めていません。',9)
l.end()
l.start(7,'法人基本情報・資料管理票','申請用の法人情報',period='情報整理日：2026年11月7日',units='会社情報の照合・書類準備用')
l.table(['項目','内容'],[['商号',NAME],['法人番号',CORP],['本店所在地','東京都千代田区神田鍛冶町３丁目７番地２１'],['所在地の補足','天翔神田駅前ビル808'],['公式サイト','https://cocurie.com/aboutus'],['事業内容','分散型ECプラットフォーム開発'],['当期末資本金','10,000,000円（添付貸借対照表）'],['履歴事項全部証明書','原本未添付・取得後に商号、本店、代表者、資本金、発行日を照合'],['株主・グループ関係','株主名簿・持株比率・関係会社の情報は別途確認']],[145,378],9,7)
l.para('公開サイトの「資本金（準備金含む）」と貸借対照表の資本金は、表示する範囲が異なります。転記時は必要な項目の定義に合わせて照合します。',9)
l.para('法人情報の参照先：<link href="https://info.gbiz.go.jp/hojin/ichiran?hojinBango=3010001205734" color="#007A73">gBizINFO 法人情報</link>。本票は社内の情報整理票です。登記事項証明書は別途用意します。',9)
l.end()
l.start(8,'法人税等の計上・納付整理票','経理資料と証明書の確認',units='単位：円')
l.table(['項目','金額・内容'],[['当期法人税','1,800,000'],['住民税・事業税等','700,000'],['当期法人税等合計','2,500,000'],['期中の中間納付額','500,000'],['期末未払法人税等','2,000,000'],['期末未払額の納付日','2026年5月29日'],['法人税の納付状況','当期分1,800,000円を納付済み'],['法人税の納税証明書','「その1」または「その2」の原本は未添付']],[240,283],9,8)
l.para('損益計算書の法人税等2,500千円、貸借対照表の未払法人税等2,000千円に対応します。期末残高は2026年3月31日現在の金額です。')
l.para('本票は経理上の計上・納付状況の整理資料です。納税証明書は取得後に対象税目、対象期間、発行日、証明額を照合します。',9)
l.end();results.append(l.save())

aliases={q.path:'01-complete-proposal.pdf',f.path:'04-cocreate-test-financial-statements.pdf',l.path:'05-cocreate-test-ledgers-and-evidence.pdf'}
for src,name in aliases.items():shutil.copy2(src,ROOT/'output/pdf/vendor-contact-tests'/name)
(WORK/'pdf-build.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False))
