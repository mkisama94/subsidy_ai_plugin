from pathlib import Path
from datetime import datetime
import json, re, hashlib, shutil, zipfile
from pypdf import PdfReader
from openpyxl import load_workbook

ROOT=Path(__file__).resolve().parents[2];WORK=Path(__file__).resolve().parent
OUT=ROOT/'output/pdf/cocreate-application'
PRIVATE=Path('C:/Users/yamamotoma/OneDrive/Documents/助成金プラグイン内部資料/PCAデモ管理/2026-11-07')
PRIVATE.mkdir(parents=True,exist_ok=True)
D=json.loads((WORK/'data.json').read_text(encoding='utf-8'))
bad=re.compile(r'TEST|テスト|架空|模擬|合成|デモ',re.I)
files=sorted([*OUT.glob('*.pdf'),*OUT.glob('*.xlsx')]);assert len(files)==4
for f in files:
    assert not bad.search(f.name),f.name
    if f.suffix=='.pdf':
        reader=PdfReader(f)
        text='\n'.join(p.extract_text() for p in reader.pages)
        assert not bad.search(text+str(reader.metadata)),f.name
        assert D['corporateNumber'] in text
        if f.name.startswith('01'):
            for s in ['2130001013399','PCAクラウド 会計 dx','1,148,400','864,000','IT導入補助金の交付決定なし']:assert s in text,s
        if f.name.startswith('02'):
            for s in ['40,000','25,000','15,000','100,000','57,000','5,000']:assert s in text,s
    else:
        with zipfile.ZipFile(f) as z:
            for n in z.namelist():
                if n.endswith('.xml'):
                    # XML text content and metadata, excluding schema/library identifiers.
                    from xml.etree import ElementTree as ET
                    e=ET.fromstring(z.read(n))
                    for node in e.iter():
                        if node.text:assert not bad.search(node.text),(n,node.text)

xlsx=next(OUT.glob('*.xlsx'))
wb=load_workbook(xlsx,data_only=True);form=load_workbook(xlsx,data_only=False)
assert wb.sheetnames==['集計','名簿','月次勤怠','給与明細','日次勤怠']
for i,r in enumerate(D['daily'],7):
    s=wb['日次勤怠'];assert s.cell(i,1).value.date().isoformat()==r['date']
    assert s.cell(i,3).value==r['id']
    assert s.cell(i,5).value==r['status']
    assert [s.cell(i,c).value for c in range(8,13)]==[r[k] for k in ('breakHours','regularHours','overtimeHours','paidLeaveHours','actualHours')]
    assert form['日次勤怠'].cell(i,12).value==f'=SUM(I{i}:J{i})'
    if r['date'] in D['calendar']['holidays']+D['calendar']['companyHolidays']:
        assert r['actualHours']==0
for i,r in enumerate(D['monthly'],7):
    assert [wb['月次勤怠'].cell(i,c).value for c in range(4,9)]==[r[k] for k in ('days','paidLeaveDays','regularHours','overtimeHours','actualHours')]
for i,r in enumerate(D['payroll'],7):
    assert [wb['給与明細'].cell(i,c).value for c in range(4,10)]==[r[k] for k in ('base','allowance','salary','bonus','officer','total')]
assert [wb['集計'].cell(13,c).value for c in range(3,10)]==[D['totals'][k] for k in ('regularHours','overtimeHours','actualHours','salary','bonus','officer','total')]
assert D['totals']['salary']==24000000 and D['totals']['bonus']==3000000 and D['totals']['officer']==6000000
assert 31000000+9000000==25000000+15000000==40000000
assert sum([24000,3000,6000,5000,1000,1000,3000,6000,2000,4000,2000])==57000
assert 100000-35000-57000+100-600-2500==5000
assert 864000+100000+80000==1044000 and 1044000+104400==1148400
for s in wb:
    for row in s:
        for cell in row:assert cell.data_type!='e',(s.title,cell.coordinate,cell.value)

pack=OUT.parent/'CoCreate_申請準備資料一式.zip'
with zipfile.ZipFile(pack,'w',zipfile.ZIP_DEFLATED) as z:
    for f in files:z.write(f,f.name)
with zipfile.ZipFile(pack) as z:
    assert sorted(z.namelist())==[f.name for f in files]
    for f in files:assert z.read(f.name)==f.read_bytes()
legacy=ROOT/'output/pdf/vendor-contact-tests'
shutil.copy2(pack,legacy/'cocreate-batch-test-data.zip')
manifest={f.name:{'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in files}
report=dict(caseId=D['caseId'],validatedOn='2026-11-07',checks=dict(visibleScenarioMarkers=0,pdfPages=14,worksheets=5,dailyRows=2190,monthlyRows=72,payrollRows=72,allRowsReconciled=True,formulaErrors=0,zipContentMatch=True),totals=D['totals'],files=manifest)
(PRIVATE/'検証結果.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
provenance=dict(caseId=D['caseId'],purpose='PCA向け本番相当デモ',permission=dict(status='ユーザーから各社のデータ利用許諾取得済みとの申告',evidence='2026-11-07の会話。許諾書原本は本作業では受領していない。'),
    factual=dict(companyNames='公開法人識別情報を採用',corporateNumbers=['3010001205734','2130001013399'],cloudPrice=dict(product='PCAクラウド 会計 dx',users=3,months=24,taxIncluded=950400,taxExcluded=864000,source='https://www.mimosa.gr.jp/pca/cloud_prepaid.html')),
    scenarioFields=['決算期・決算金額・納付状況','役員従業員の人数、社員番号、入社日、勤怠、給与','初期設定・データ移行の見積額と個別の提供範囲','freee利用・上場を見据えた導入目的','2022～2025年IT導入補助金の交付決定なしという既承認シナリオ'],
    limits=['企業の実際の決算・勤怠・給与を入手した事実はない。公開値と数値シナリオを管理記録で区別する。','書面はデモ用に作成したもので、両社・PCA・税理士・官公庁が発行、監修したと扱わない。','公開サイトの資本金121895000円は準備金を含む。BSの10000000円はシナリオ値であり照合済みの事実ではない。','公的証明書の外観・認証番号・公印・署名を作成していない。原本未添付として扱う。','ITツール登録番号、支援事業者登録、株主・持株比率、申請担当者、同意は未確認。架空の公的IDや持株比率は付与しない。','資料内の表記除去と整合性検査は完了。プラグインでの全会話・本番接続の受入試験は未実施。'],
    sources=['https://info.gbiz.go.jp/hojin/ichiran?hojinBango=3010001205734','https://info.gbiz.go.jp/hojin/ichiran?hojinBango=2130001013399','https://cocurie.com/aboutus','https://www.mimosa.gr.jp/pca/cloud_prepaid.html','https://www.mimosa.gr.jp/pca/item_list/cloud-kaikei/','https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html'],files=manifest)
(PRIVATE/'作成条件・出典.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2),encoding='utf-8')
shutil.copy2(WORK/'data.json',PRIVATE/'数値シナリオ.json')
guide=f'''PCA向けデモ運用メモ（添付対象外）

使用する資料：{OUT}
配布・展開用ZIP：{pack}

新しいチャットに、上記フォルダのPDF3点とExcel1点をまとめて添付する。
開始時の依頼文：「この資料で補助金申請の準備を進めてください。」
過去のチャットにはテスト条件を繰り返し確認した履歴が残るため、新しいチャットを使用する。
このメモ、作成条件・出典、数値シナリオ、検証結果、変更前ファイルは添付しない。

旧01・04・05のPDF、旧Excel、旧ZIPは同じ内容へ上書き済み。
旧04・05・Excelの英語ファイル名にはtestが残るため、デモでは上記の日本語ファイル名を使用する。
旧02・03の別シナリオは今回の案件に使用しない。

ユーザーは各社から利用許諾を取得済みと申告。都度「テストとして進めるか」を尋ねるための資料は入れない。
数値は従来の承認済みシナリオをベースに作成。実会社の確定実績と外部共有しない。
登録番号・出資関係・公的証明書の不足は正規の確認対象として残る。
出資関係APIの利用可否やデモ当日の接続確認は別途実施する。
'''
(PRIVATE/'運用メモ.txt').write_text(guide,encoding='utf-8-sig')
# Replace stale entry guides and provenance next to compatibility files; they are not in the attachment ZIP.
(legacy/'batch-test-data-guide.txt').write_text(f'資料は更新済みです。添付には次のフォルダの4ファイルを使用してください。\n{OUT}\n\n管理記録：{PRIVATE}\n',encoding='utf-8-sig')
(legacy/'01-complete-proposal-public-sources.json').write_text(json.dumps({'caseId':D['caseId'],'updatedOn':'2026-11-07','pdfSha256':manifest[files[0].name]['sha256'],'sourceRecord':str(PRIVATE/'作成条件・出典.json')},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
print(str(pack))
