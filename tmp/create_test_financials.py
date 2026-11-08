from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from pypdf import PdfReader

p=Path('output/pdf/vendor-contact-tests/04-cocreate-test-financial-statements.pdf')
pdfmetrics.registerFont(TTFont('JP','C:/Windows/Fonts/msgothic.ttc',subfontIndex=0))
c=canvas.Canvas(str(p),pagesize=(595,842))
c.setTitle('Co create 読取り試験用・架空決算書')
c.setAuthor('補助金AIテスト資料作成用／会社発行ではありません')
def txt(x,y,s,size=10,color='#243449'):
 c.setFont('JP',size);c.setFillColor(HexColor(color));c.drawString(x,y,s)
def base(n,title,period):
 c.setFillColor(HexColor('#123246'));c.rect(0,730,595,112,fill=1,stroke=0)
 txt(36,810,'TEST ONLY / 金額・決算期はすべて架空',11,'#93E3D0')
 txt(36,775,title,24,'#FFFFFF');txt(36,747,'TEST-FIN-CC-001 v1 | 作成日 2026-11-07',9,'#FFFFFF')
 txt(36,702,'対象法人：株式会社Ｃｏ　ｃｒｅａｔｅ',13)
 txt(36,680,'法人番号：3010001205734（法人識別用）')
 txt(36,658,period)
 txt(36,636,'単位：千円　／　単体の架空データ　／　確定決算を想定した読取り試験')
 txt(36,53,'実会社の決算・資本金・決算期・実績を示すものではありません。',9)
 txt(36,37,'会社・税理士の発行資料ではなく、実申請・税務申告には使用できません。',9)
 txt(520,20,f'{n} / 3',9)
def rows(items,start=600):
 y=start
 for label,value in items:
  if value is None:
   c.setFillColor(HexColor('#E6F2F0'));c.rect(36,y-8,523,25,fill=1,stroke=0)
  txt(46,y,label,10)
  if value is not None:
   c.setFont('JP',10);c.drawRightString(548,y,f'{value:,}')
  y-=28
base(1,'貸借対照表（テスト用）','基準日：2026年3月31日（テスト上の仮定）')
rows([('資産の部',None),('現金及び預金',18000),('売掛金',12000),('前払費用',1000),('流動資産合計',31000),('有形固定資産（償却後）',4000),('ソフトウェア（償却後）',5000),('資産合計',40000),('負債・純資産の部',None),('買掛金',6000),('未払費用',2000),('未払法人税等',2000),('長期借入金',15000),('負債合計',25000),('資本金（架空）',10000),('利益剰余金（架空）',5000),('純資産合計',15000),('負債・純資産合計',40000)])
c.showPage()
base(2,'損益計算書（テスト用）','対象期間：2025年4月1日～2026年3月31日（12か月・架空）')
rows([('損益の内訳',None),('売上高',100000),('売上原価',35000),('売上総利益',65000),('販売費及び一般管理費',57000),('営業利益',8000),('受取利息（営業外収益）',100),('支払利息（営業外費用）',600),('経常利益',7500),('特別利益',0),('特別損失',0),('税引前当期純利益',7500),('法人税等',2500),('当期純利益',5000)])
txt(36,165,'前期末利益剰余金を0、配当・その他増減なしと仮定。',10)
txt(36,145,'当期純利益5,000千円を、貸借対照表の利益剰余金へ反映。',10)
c.showPage()
base(3,'販売費及び一般管理費の明細','対象期間：2025年4月1日～2026年3月31日（12か月・架空）')
rows([('科目別明細（合成データ）',None),('給与手当',24000),('賞与',3000),('役員報酬',6000),('法定福利費',5000),('福利厚生費',1000),('旅費交通費',1000),('減価償却費',3000),('地代家賃',6000),('通信費',2000),('広告宣伝費',4000),('支払手数料',2000),('販売費及び一般管理費合計',57000)])
txt(36,185,'科目の識別と読取り用の明細です。制度上の人件費は未算定。',10)
txt(36,163,'給与支給総額・人数・総労働時間・賃上げ計画は別資料で確認します。',10)
txt(36,141,'移行対象期間とは独立したテスト決算期です。実際の決算期は未確認。',10)
txt(36,119,'法人識別出典：gBizINFO（公開情報確認日 2026-11-07）',9)
url='https://info.gbiz.go.jp/hojin/ichiran?hojinBango=3010001205734'
txt(36,101,url,8);c.linkURL(url,(36,96,559,113))
c.save()
assert 18000+12000+1000+4000+5000==25000+15000==40000
assert sum([24000,3000,6000,5000,1000,1000,3000,6000,2000,4000,2000])==57000
assert 100000-35000-57000+100-600-2500==5000
d=PdfReader(p);assert len(d.pages)==3
assert all('TEST ONLY' in page.extract_text() for page in d.pages)
print(p.resolve())
