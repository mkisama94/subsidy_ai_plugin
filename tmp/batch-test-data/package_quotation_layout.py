from pathlib import Path
import json, hashlib, zipfile, shutil, re
from pypdf import PdfReader

root=Path(__file__).resolve().parents[2]
out=root/'output/pdf/cocreate-application'
legacy=root/'output/pdf/vendor-contact-tests'
private=Path('C:/Users/yamamotoma/OneDrive/Documents/助成金プラグイン内部資料/PCAデモ管理/2026-11-07')
proposal=out/'01_導入提案・費用明細.pdf'
reader=PdfReader(proposal)
assert len(reader.pages)==3
first=reader.pages[0].extract_text()
for term in ['御 見 積 書','株式会社Co create 御中','株式会社ミモザ情報システム','CC-20261107-01','2026年11月7日','PCAクラウド 会計 dx','3CAL・24か月','864,000','100,000','80,000','1,044,000','104,400','1,148,400','数量','単価']:
    assert term in first,term
for term in ['補助金','申請','通常枠','交付決定','株主','決算','管理番号']:
    assert term not in first,term
for ix,title in [(1,'別紙1｜導入目的・作業範囲'),(2,'別紙2｜申請準備の確認事項')]:
    page=reader.pages[ix].extract_text()
    assert title in page and '御見積書 CC-20261107-01 の添付資料' in page
assert not re.search(r'TEST|テスト|架空|模擬|合成|デモ','\n'.join(p.extract_text() for p in reader.pages)+str(reader.metadata),re.I)

reportpath=private/'検証結果.json'
report=json.loads(reportpath.read_text(encoding='utf-8'))
files=sorted(out.iterdir());assert len(files)==4
for f in files:
    digest=hashlib.sha256(f.read_bytes()).hexdigest()
    if f!=proposal:assert digest==report['files'][f.name]['sha256'],('unrelated change',f.name)
report['files'][proposal.name]={'sha256':hashlib.sha256(proposal.read_bytes()).hexdigest(),'bytes':proposal.stat().st_size}
pack=out.parent/'CoCreate_申請準備資料一式.zip'
with zipfile.ZipFile(pack,'w',zipfile.ZIP_DEFLATED) as z:
    for f in files:z.write(f,f.name)
with zipfile.ZipFile(pack) as z:
    assert sorted(z.namelist())==[f.name for f in files]
    for f in files:assert z.read(f.name)==f.read_bytes()
assert proposal.read_bytes()==(legacy/'01-complete-proposal.pdf').read_bytes()
shutil.copy2(pack,legacy/'cocreate-batch-test-data.zip')
report['checks']['quotationLayout']={'pages':3,'ordinaryQuotePage':1,'appendixPages':[2,3],'amountsPreserved':True,'unrelatedFilesByteUnchanged':True,'visualReview':'passed'}
reportpath.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
provenancepath=private/'作成条件・出典.json'
provenance=json.loads(provenancepath.read_text(encoding='utf-8'))
provenance['files']=report['files']
provenance['quotationLayoutUpdate']='通常の見積書を先頭に置き、導入目的・作業範囲と申請準備情報を別紙1・2として見積番号で関連付けた。価格・数量・会社情報・他資料は変更していない。納入時期・支払条件は未決定のため別途協議と表記。'
provenancepath.write_text(json.dumps(provenance,ensure_ascii=False,indent=2),encoding='utf-8')
sourcepath=legacy/'01-complete-proposal-public-sources.json'
source=json.loads(sourcepath.read_text(encoding='utf-8'));source['pdfSha256']=report['files'][proposal.name]['sha256']
sourcepath.write_text(json.dumps(source,ensure_ascii=False,indent=2),encoding='utf-8')
memo=private/'運用メモ.txt'
text=memo.read_text(encoding='utf-8-sig')
text+='''
見積書の入口デモ：
1ページ目は一般的な見積書、2ページ目は別紙1（導入目的・作業範囲）、3ページ目は別紙2（申請準備の確認事項）。
既存の見積書を専用フォーマットに作り直す前提を置かず、補足情報を別紙で追加する運用を説明する。
説明例：「普段お使いの見積書を、そのままドラッグ・アンド・ドロップ。申請準備に足りない情報は別紙で補えます。販売会社に見積書の作り直しをお願いする必要はありません。」
見積書からの読取り開始と、申請資格確認・必要資料・本人提出の完了は区別して説明する。
'''
memo.write_text(text,encoding='utf-8-sig')
print(json.dumps({'pdf':str(proposal),'zip':str(pack),'pagesReviewed':3,'ordinaryQuotationPageVerified':True,'appendicesLinked':True,'otherFilesUnchanged':3,'sha256':report['files'][proposal.name]['sha256']},ensure_ascii=False))
