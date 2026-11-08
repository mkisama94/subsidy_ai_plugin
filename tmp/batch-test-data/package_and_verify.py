from pathlib import Path
from datetime import datetime
import json, zipfile, hashlib
from openpyxl import load_workbook
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[2]
WORK=Path(__file__).resolve().parent
OUT=ROOT/'output/pdf/vendor-contact-tests'
data=json.loads((WORK/'data.json').read_text(encoding='utf-8'))
xlsx=ROOT/'outputs/01a1b457-test-data/cocreate-test-ledgers.xlsx'
book=load_workbook(xlsx,data_only=True,read_only=True)
assert book.sheetnames==['集計','名簿','月次勤怠','給与明細','日次勤怠']
totals=data['totals']
assert [book['集計'].cell(13,c).value for c in range(3,10)]==[totals[k] for k in ['regularHours','overtimeHours','actualHours','salary','bonus','officer','total']]
assert [[book['集計'].cell(r,c).value for c in (2,3)] for r in (17,18)]==[[1,1743],[5,10020]]
rows=list(book['日次勤怠'].iter_rows(min_row=7,max_row=2196,values_only=True))
assert len(rows)==2190
keys=set()
for row,raw in zip(rows,data['daily']):
    assert row[0].date().isoformat()==raw['date']
    assert row[2]==raw['id'] and row[4]==raw['status']
    assert row[11]==raw['actualHours'] and row[11]==row[8]+row[9]
    if row[11]>0:
        start=row[5].hour+row[5].minute/60
        end=row[6].hour+row[6].minute/60
        assert abs(end-start-row[7]-row[11])<1e-8
    else:
        assert row[5] is None and row[6] is None
    assert (row[0],row[2]) not in keys
    keys.add((row[0],row[2]))
for i,raw in enumerate(data['monthly'],7):
    assert [book['月次勤怠'].cell(i,c).value for c in range(4,9)]==[raw[k] for k in ['days','paidLeaveDays','regularHours','overtimeHours','actualHours']]
for i,raw in enumerate(data['payroll'],7):
    assert [book['給与明細'].cell(i,c).value for c in range(4,10)]==[raw[k] for k in ['base','allowance','salary','bonus','officer','total']]
book.close()
formulas=load_workbook(xlsx,data_only=False,read_only=True)
assert formulas['集計']['E13'].value=='=SUM(E7:E12)'
assert formulas['日次勤怠']['L2196'].value=='=SUM(I2196:J2196)'
formulas.close()
pdfs=[OUT/n for n in ['01-complete-proposal.pdf','04-cocreate-test-financial-statements.pdf','05-cocreate-test-ledgers-and-evidence.pdf']]
pages=[]
for p in pdfs:
    rd=PdfReader(p);pages.append(len(rd.pages))
    assert all('TEST ONLY' in pg.extract_text() for pg in rd.pages)
assert pages==[4,3,8]
fin='\n'.join(p.extract_text() for p in PdfReader(pdfs[1]).pages)
for v in ['24,000','3,000','6,000','57,000','40,000','5,000']:assert v in fin
assert totals['salary']/1000==24000 and totals['bonus']/1000==3000 and totals['officer']/1000==6000

guide='''補助金申請・一括添付テスト用データ
作成日：2026-11-07
案件：TEST-A-CCM-002 / 株式会社Ｃｏ　ｃｒｅａｔｅ × 株式会社ミモザ情報システム

1. 使い方
ZIPを展開し、「attach」フォルダーの4ファイルをまとめてチャットへ追加してください。
PDFのみを読む試験では3つのPDFを使用し、Excelは追加不要です。
Excelを読む試験では4ファイル全てを使います。PDF05とExcelは同じ勤怠・給与データの別表現です。
二つを別の実績として二重計上しないことを確認できます。
「tester」フォルダーは採点者用です。読取りを試すチャットには添付しないでください。

2. 一緒に入力する文面
この4ファイルで、補助金の申請準備をテストとして進めてください。
会社の識別情報は見積のものを使い、決算・人数・勤怠・給与等は架空のテスト値として扱ってください。
添付済みの資料から必要な項目を読み取り、残る不足をまとめて示してください。

3. 添付資料
01：見積・提案・移行条件・模擬申請支援依頼書。既存のテストPDF、4ページ。
04：貸借対照表・損益計算書・販管費明細。既存のテストPDF、3ページ。
05：役員従業員一覧、月次勤怠、年間内訳、給与集計、決算内訳、登記・納税の模擬データ、8ページ。
Excel：集計・名簿・月次勤怠・給与明細・日次勤怠。日別2,190行、月次勤怠と給与は各72行。

4. データの範囲
法人名・法人番号・本店所在地は、既存見積の公開識別情報を引き継ぎます。今回の再照会はしていません。
会社の人数・人物・決算期・財務・勤怠・給与・模擬発行日等はすべて架空です。
対象期間は2025-04-01～2026-03-31。この試験で作った帳簿の期間で、実会社の決算期ではありません。
勤怠は土日休、祝日等の個別設定なしの合成カレンダーです。実会社の就業規則ではありません。
支給額の読取り用給与集計であり、税・社会保険控除や時間外割増の法定計算は試験範囲外です。
給与・役員報酬は円、決算書は千円。金額単位を確認してください。

5. 正式書類・未確認事項
登記・納税は公的証明書の外観をまねない模擬データシートです。実証明書の原本は未受領です。
本データだけで正式添付済み、本人確認済み、公式転記準備完了、提出済みと扱うことはできません。
本人の同意・宣誓、担当者連絡先、実登録番号、実会社の資格・実績、将来の計画・目標等は確定しません。
過去の補助金情報とIT補助金の受給有無も同一視しません。
本試験は資料の一括読取り・照合・不足案内の確認用です。実申請や税務申告に使用しないでください。
'''
guide_path=OUT/'batch-test-data-guide.txt'
guide_path.write_text(guide,encoding='utf-8-sig')
expected={
 'caseId':data['caseId'],'synthetic':True,'period':{'start':data['periodStart'],'end':data['periodEnd']},
 'headcount':{'officers':1,'employees':5,'totalPersons':6,'quoteLicenses':3,'wholePeriodStable':True},
 'attendance':{'dailyRows':2190,'monthlyRows':72,'employeeActualHours':10020,'officerActivityHours':1743,'simpleCombinedHours':11763,'overtimeHours':60,'employeePaidLeaveDays':60,'paidLeaveIncludedInActualHours':False,'statutoryProductivityDenominatorDetermined':False},
 'payroll':{'currency':'JPY','monthlyRows':72,'salary':24000000,'bonus':3000000,'officerPay':6000000,'grossTotal':33000000,'duplicatesAcrossPdfAndWorkbook':True},
 'finance':data['finance'],
 'expectedRemaining':['実公的証明書は未受領・未照合','本人の同意・宣誓・最終提出は未実施','担当者連絡先・実登録番号等は実値未確認','制度定義による人数・時間・人件費の採用判断と将来計画は別途確認'],
 'checks':['PDFとExcelを重複計上しない','3ライセンスを従業員数にしない','千円と円を混同しない','休憩・有休を実働へ加算しない','役員の業務従事と従業員労働時間を区分','法定福利費・福利厚生費と給与総額を区分','模擬証明書を正式原本として認定しない','既読の名簿・勤怠・給与を理由なく再要求しない'],
 'validation':{'pdfPages':pages,'pdfAllPagesTestMarked':True,'xlsxCachedTotalsChecked':True,'allDailyRowsAndTimeArithmeticChecked':True,'allMonthlyAndPayrollRowsChecked':True,'xlsxFormulaRecalculationChangeRestoreChecked':True,'excelNativeAppNotRun':True,'pdfAndWorkbookVisualReview':True}
}
expected_path=WORK/'expected-results.json';expected_path.write_text(json.dumps(expected,ensure_ascii=False,indent=2),encoding='utf-8')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
mapping={**{f'attach/{p.name}':p for p in pdfs},f'attach/{xlsx.name}':xlsx,'START-HERE.txt':guide_path,'tester/expected-results.json':expected_path,
         'tester/public-identity-sources.json':OUT/'01-complete-proposal-public-sources.json'}
manifest={'createdOn':'2026-11-07','caseId':data['caseId'],'allFinancialAndLaborValuesSynthetic':True,
          'files':[{'path':name,'bytes':p.stat().st_size,'sha256':sha(p)} for name,p in mapping.items()]}
zip_path=OUT/'cocreate-batch-test-data.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
    for name,p in mapping.items():z.write(p,name)
    z.writestr('tester/manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
with zipfile.ZipFile(zip_path) as z:
    assert z.testzip() is None
    for item in manifest['files']:assert hashlib.sha256(z.read(item['path'])).hexdigest()==item['sha256']
(WORK/'validation.json').write_text(json.dumps({'zip':str(zip_path),'zipSha256':sha(zip_path),'files':len(mapping)+1,'validation':expected['validation']},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'zip':str(zip_path),'bytes':zip_path.stat().st_size,'files':len(mapping)+1,'dailyRows':len(rows),'pdfPages':pages,'status':'passed'},ensure_ascii=False))
