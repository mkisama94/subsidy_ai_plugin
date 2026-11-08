from pathlib import Path
from datetime import date, timedelta
from collections import defaultdict
import json, calendar, shutil
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/pdf/vendor-contact-tests'
WORK = Path(__file__).resolve().parent
CASE = 'TEST-A-CCM-002'
CORP = '3010001205734'
NAME = '株式会社Ｃｏ　ｃｒｅａｔｅ'
PERIOD = '2025年4月1日～2026年3月31日'
months = [(2025, m) for m in range(4,13)] + [(2026,m) for m in range(1,4)]
people = [
    dict(id='O01', name='テスト役員01', role='役員', employment='常勤役員', gross=500000, allowance=0, overtime=0),
    dict(id='E01', name='テスト従業員01', role='従業員', employment='正社員', gross=500000, allowance=20000, overtime=2),
    dict(id='E02', name='テスト従業員02', role='従業員', employment='正社員', gross=400000, allowance=12000, overtime=1),
    dict(id='E03', name='テスト従業員03', role='従業員', employment='正社員', gross=350000, allowance=16000, overtime=1.5),
    dict(id='E04', name='テスト従業員04', role='従業員', employment='正社員', gross=450000, allowance=5000, overtime=.5),
    dict(id='E05', name='テスト従業員05', role='従業員', employment='正社員', gross=300000, allowance=0, overtime=0),
]
for p in people:
    p.update(joined='2020-04-01', left=None, monthly_end_employed=12)

daily, monthly, payroll = [], [], []
for year,month in months:
    days=[date(year,month,d) for d in range(1,calendar.monthrange(year,month)[1]+1)]
    weekdays=[d for d in days if d.weekday()<5]
    for ix,p in enumerate(people):
        leave=weekdays[5+ix]
        rows=[]
        for day in days:
            status='休日' if day.weekday()>=5 else ('休務' if ix==0 else '有休') if day==leave else '業務従事' if ix==0 else '勤務'
            active=status in ('勤務','業務従事')
            base=7 if ix==0 else 8
            ot=p['overtime'] if active and day==weekdays[0] else 0
            actual=(base+ot) if active else 0
            end=(17 if ix==0 else 18)+ot
            row=dict(date=day.isoformat(), month=f'{year}-{month:02}', id=p['id'], role=p['role'], status=status,
                     start='09:00' if active else '', end=f'{int(end):02}:{round((end-int(end))*60):02}' if active else '',
                     breakHours=1 if active else 0, regularHours=base if active else 0, overtimeHours=ot,
                     paidLeaveHours=8 if status=='有休' else 0, actualHours=actual)
            rows.append(row)
        daily.extend(rows)
        monthly.append(dict(month=f'{year}-{month:02}',id=p['id'],role=p['role'],days=sum(r['actualHours']>0 for r in rows),
                            paidLeaveDays=sum(r['status']=='有休' for r in rows),regularHours=sum(r['regularHours'] for r in rows),
                            overtimeHours=sum(r['overtimeHours'] for r in rows),actualHours=sum(r['actualHours'] for r in rows)))
        payroll.append(dict(month=f'{year}-{month:02}',id=p['id'],role=p['role'],
                            base=p['gross']-p['allowance'] if ix else 0,allowance=p['allowance'] if ix else 0,
                            salary=p['gross'] if ix else 0,bonus=int(p['gross']*.75) if ix and month in (6,12) else 0,
                            officer=p['gross'] if ix==0 else 0))
        payroll[-1]['total']=sum(payroll[-1][k] for k in ('salary','bonus','officer'))

annual=[]
for p in people:
    ms=[r for r in monthly if r['id']==p['id']]
    ps=[r for r in payroll if r['id']==p['id']]
    annual.append(dict(id=p['id'],role=p['role'],days=sum(r['days'] for r in ms),paidLeaveDays=sum(r['paidLeaveDays'] for r in ms),
                       regularHours=sum(r['regularHours'] for r in ms),overtimeHours=sum(r['overtimeHours'] for r in ms),
                       actualHours=sum(r['actualHours'] for r in ms),
                       **{k:sum(r[k] for r in ps) for k in ('salary','bonus','officer','total')}))
totals={k:sum(r[k] for r in annual) for k in ('days','paidLeaveDays','regularHours','overtimeHours','actualHours','salary','bonus','officer','total')}
totals['employeeHours']=sum(r['actualHours'] for r in annual if r['role']=='従業員')
totals['officerHours']=sum(r['actualHours'] for r in annual if r['role']=='役員')
assert totals['salary']==24000000 and totals['bonus']==3000000 and totals['officer']==6000000
assert len(daily)==365*6 and len(monthly)==len(payroll)==72
assert len({(r['date'],r['id']) for r in daily})==2190
assert all(r['actualHours']==r['regularHours']+r['overtimeHours'] for r in daily)
data=dict(caseId=CASE, company=NAME, corporateNumber=CORP, periodStart='2025-04-01',periodEnd='2026-03-31',
          synthetic=True, people=people,daily=daily,monthly=monthly,payroll=payroll,annual=annual,totals=totals,
          finance=dict(salary=24000000,bonus=3000000,officer=6000000,statutoryWelfare=5000000,welfare=1000000,depreciation=3000000,
                       operatingProfit=8000000,assets=40000000,liabilities=25000000,equity=15000000,netIncome=5000000))
(WORK/'data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')

pdfmetrics.registerFont(TTFont('JP','C:/Windows/Fonts/msgothic.ttc',subfontIndex=0))
pdf=OUT/'05-cocreate-test-ledgers-and-evidence.pdf'
c=canvas.Canvas(str(pdf),pagesize=(595,842))
c.setTitle('Co create 一括添付テスト用 帳簿・模擬確認資料')
c.setAuthor('補助金AI検証用・会社または行政機関の発行物ではありません')
style=ParagraphStyle('body',fontName='JP',fontSize=9,leading=14,textColor=HexColor('#243449'),wordWrap='CJK')
y=0
page_count=8
def text(x,y,s,size=10,color='#243449'):
    c.setFont('JP',size);c.setFillColor(HexColor(color));c.drawString(x,y,s)
def para(s,size=9,gap=8):
    global y
    st=ParagraphStyle('p',parent=style,fontSize=size,leading=size*1.55)
    p=Paragraph(s,st);_,h=p.wrap(523,700)
    assert y-h>60,(s[:50],y,h)
    p.drawOn(c,36,y-h);y-=h+gap
def start(n,title,units='人数：人　時間：時間　金額：円'):
    global y
    c.setFillColor(HexColor('#123246'));c.rect(0,740,595,102,fill=1,stroke=0)
    text(36,814,'TEST ONLY / 人物・実績・発行日はすべて架空',10,'#93E3D0')
    text(36,782,title,21,'#FFFFFF');text(36,758,f'{CASE} / TEST-LEDGER-CC-001 v1 / 作成日 2026-11-07',8,'#FFFFFF')
    text(36,716,NAME,13);text(36,696,f'法人番号：{CORP}（公開法人識別情報）',9)
    text(36,677,f'対象期間：{PERIOD}（テスト上の仮定）',9)
    text(36,658,units,9)
    text(36,42,'全ページが合成テスト資料です。実会社の実績・登記・納税を証明しません。',8)
    text(36,27,'実申請・税務申告には使用不可。会社・税理士・行政機関の発行資料ではありません。',8)
    text(535,15,f'{n}/{page_count}',8)
    y=633
def table(headers,rows,widths,fs=9):
    global y
    cells=[]
    for row in [headers]+rows:
        cells.append([Paragraph(escape(str(v)).replace('\n','<br/>'),ParagraphStyle('cell',parent=style,fontSize=fs,leading=fs*1.35)) for v in row])
    t=Table(cells,colWidths=widths,hAlign='LEFT')
    t.setStyle(TableStyle([('FONTNAME',(0,0),(-1,-1),'JP'),('BACKGROUND',(0,0),(-1,0),HexColor('#E6F2F0')),
          ('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),
          ('LINEBELOW',(0,0),(-1,-1),.4,HexColor('#D6E2E7'))]))
    _,h=t.wrap(523,700);assert y-h>60,('table overflow',y,h)
    t.drawOn(c,36,y-h);y-=h+13
def end():c.showPage()
def num(v):return f'{v:,.1f}' if isinstance(v,float) and v%1 else f'{int(v):,}'

start(1,'役員・従業員一覧（テスト用）')
para('対象期を通じて在籍する常勤役員1名・正社員5名の設定です。実在する人物の氏名・個人情報は含みません。見積の3ライセンスと、この一覧の人数は別の条件です。')
table(['ID','架空氏名','区分・雇用形態','就任・入社日','退任・退社'],
      [[p['id'],p['name'],p['employment'],'2020-04-01','なし'] for p in people],[43,135,115,115,115])
para('全員、対象期の期首・期末とも在籍。兼務役員・パート・派遣・出向者はこのテストでは0名。O01は代表取締役を想定した架空の役員です。役員を従業員5名に含めません。')
para('勤怠・給与資料の結合キーはIDです。雇用条件、役員・従業員の集計対象、対象時点は制度の適用定義に照らして判断してください。代表者名や在籍情報の実際の公開値を上書きするデータではありません。')
end()

start(2,'月次勤務記録（テスト用）','単位：時間　／　休憩・有給休暇を除く実働時間')
rows=[]
for yr,mo in months:
    key=f'{yr}-{mo:02}';ms=[r for r in monthly if r['month']==key]
    rows.append([key]+[num(r['actualHours']) for r in ms]+[num(sum(r['actualHours'] for r in ms))])
rows.append(['年間']+[num(r['actualHours']) for r in annual]+[num(totals['actualHours'])])
table(['月','O01\n役員','E01','E02','E03','E04','E05','合計'],rows,[67,62,62,62,62,62,62,84],8)
para('O01は役員の業務従事時間です。従業員の労働時間と区別して記録しています。合計は読取り照合用の単純合計であり、そのまま制度上の分母に採用する指定ではありません。')
para('日別の出退勤・休憩・有休・時間外の明細は、同梱Excelの「日次勤怠」にあります。全365日×6名、欠月なし。')
end()

start(3,'勤務実績の内訳（テスト用）')
table(['ID','従事・\n勤務日数','有休日数','通常実働','時間外','実働合計'],
      [[r['id'],num(r['days']),num(r['paidLeaveDays']),num(r['regularHours']),num(r['overtimeHours']),num(r['actualHours'])] for r in annual],
      [50,100,85,96,96,96])
para(f'従業員5名の実働合計：{num(totals["employeeHours"])}時間。役員1名の業務従事：{num(totals["officerHours"])}時間。両区分の合計：{num(totals["actualHours"])}時間。')
para('合成勤務カレンダー：土日を休日、平日を勤務予定日とし、祝日・年末年始等の個別設定は置いていません。各従業員は毎月1日を有休、役員は毎月1日を休務と設定しています。実会社の就業規則や法令上の適否を表すものではありません。')
para('勤務日は従業員9:00～18:00・休憩1時間、役員9:00～17:00・休憩1時間を基本とし、各月最初の勤務日にID別の架空時間外を加えています。有休は従業員1日8時間として別列に記録し、実働時間には含めません。給与額から労働時間は逆算していません。')
end()

start(4,'給与・役員報酬の年間集計','単位：円　／　税・社会保険等の控除前支給額')
table(['ID','給与手当','賞与','役員報酬','合計'],
      [[r['id']]+[num(r[k]) for k in ('salary','bonus','officer','total')] for r in annual]+[['合計']+[num(totals[k]) for k in ('salary','bonus','officer','total')]],
      [43,120,115,120,125])
para('対象期の給与・報酬は全て同期間に費用計上・支給したテスト設定です。賞与は従業員に6月・12月の2回、各回月額給与手当の0.75か月分。役員賞与は0円です。')
para('給与手当には諸手当を含みます。Excelには基本給・諸手当・賞与・役員報酬を区別した月別72行を収録。通勤手当・退職金・現物給与は0円。社会保険の本人負担・源泉税・振込額は本試験の範囲外で、控除欄を創作していません。')
para('これは支給額の読取り用「給与集計表」です。法定の賃金台帳一式ではありません。各種手当や時間外の法定計算を検証する資料ではありません。')
end()

start(5,'給与の月別集計（テスト用）','単位：円　／　月次は同梱ExcelのID別明細から集計')
rows=[]
for yr,mo in months:
    key=f'{yr}-{mo:02}';ps=[r for r in payroll if r['month']==key]
    rows.append([key]+[num(sum(r[k] for r in ps)) for k in ('salary','bonus','officer','total')])
rows.append(['年間']+[num(totals[k]) for k in ('salary','bonus','officer','total')])
table(['月','給与手当','賞与','役員報酬','合計'],rows,[67,114,114,114,114],8.5)
para('04-cocreate-test-financial-statements.pdf の販管費明細にある給与手当24,000千円・賞与3,000千円・役員報酬6,000千円と一致します。本紙とExcelは円、決算書は千円です。')
end()

start(6,'決算内訳の補足（テスト用）','単位：円　／　全額を販管費に計上する合成設定')
table(['科目','内訳','金額'],[
    ['法定福利費','社会保険等の会社負担分（架空集計）','5,000,000'],
    ['福利厚生費','共通福利厚生費（架空集計）','1,000,000'],
    ['減価償却費','有形固定資産分','1,000,000'],
    ['減価償却費','ソフトウェア分','2,000,000'],
    ['減価償却費合計','有形固定資産＋ソフトウェア','3,000,000'],
],[115,283,125])
table(['償却対象','期首帳簿価額','当期償却額','期末帳簿価額'],[
    ['有形固定資産','5,000,000','1,000,000','4,000,000'],
    ['ソフトウェア','7,000,000','2,000,000','5,000,000'],
    ['合計','12,000,000','3,000,000','9,000,000'],
],[145,126,126,126])
para('取得・売却・除却・減損・その他増減は対象期に0円という合成設定。固定資産の期末合計9,000千円は既存テスト貸借対照表に一致します。税法上の償却方法や耐用年数を確定する資料ではありません。')
para('売上原価35,000,000円は外部仕入・外注からなる仮定とし、上記給与・福利・減価償却との重複計上はありません。給与手当・賞与・役員報酬の合計33,000,000円と、法定福利費・福利厚生費を含む科目合計39,000,000円は意味が異なります。制度上の人件費・給与支給総額の定義は別途適用します。')
end()

start(7,'登記確認項目の模擬データ','公的証明書ではありません　／　原本未受領・未照合')
para('履歴事項全部証明書の読取り項目を想定した<strong>テスト用データシート</strong>です。証明書の外観・公印・認証番号は再現していません。以下の模擬日付や資本金等は公的な記録ではありません。',10)
table(['項目','値','性質'],[
    ['法人名',NAME,'既存見積の公開識別値'],
    ['法人番号',CORP,'既存見積の公開識別値'],
    ['本店所在地','東京都千代田区神田鍛冶町３丁目７番地２１','既存見積の公開識別値'],
    ['模擬発行日','2026-11-01','架空。実発行を示さない'],
    ['資本金','10,000,000円','架空。テストBSとの照合用'],
    ['代表者','テスト役員01（O01）','架空。実代表者を上書きしない'],
    ['原本の状態','未受領・未照合','公式提出の要件は未充足'],
],[100,258,165],8.5)
para('公開法人識別情報は既存テスト見積の出典記録を引き継いでいます。今回、登記事項証明書の取得や公開情報の再取得は行っていません。正式添付済み・証明済み・提出準備完了として扱わないでください。')
end()

start(8,'納税確認項目の模擬データ','公的証明書ではありません　／　原本未受領・未照合')
para('法人税納税証明書「その1」の項目読取りを想定した<strong>テスト用データシート</strong>です。税務署が発行した証明書ではなく、以下の金額は実会社の納税実績ではありません。',10)
table(['項目','合成設定'],[
    ['法人名・法人番号',f'{NAME} / {CORP}'],
    ['対象事業年度',PERIOD],
    ['税目','法人税（地方税等を含まない合成値）'],
    ['模擬発行日','2026-11-01'],
    ['納付すべき税額','1,800,000円'],
    ['納付済額','1,800,000円（模擬納付日 2026-05-29）'],
    ['未納額','0円（合成値。実際の未納なしを証明しない）'],
    ['原本の状態','未受領・未照合。公式添付の要件は未充足'],
],[145,378])
para('テストPLの法人税等2,500,000円は、法人税1,800,000円とその他の税700,000円からなる仮定。期中納付500,000円、期末未払2,000,000円とし、期末未払分を翌期2026年5月29日に納付した設定です。BS基準日の未払額と、その後の模擬証明日時点の未納額は区別します。')
para('この資料は「模擬書類でも正式証明書がそろったと誤判定しない」ことの確認にも使います。実際の税務情報、税務署への照会、証明書取得、公式申請は行っていません。')
end();c.save()
reader=PdfReader(pdf)
assert len(reader.pages)==page_count
assert all('TEST ONLY' in p.extract_text() for p in reader.pages)
assert '3010001205734' in reader.pages[0].extract_text()
print(json.dumps(dict(pdf=str(pdf),pages=page_count,records=len(daily),totals=totals),ensure_ascii=False))
