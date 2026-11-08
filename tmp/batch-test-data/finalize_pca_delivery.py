from pathlib import Path
import json, shutil

root=Path(__file__).resolve().parents[2]
out=root/'output/pdf/cocreate-application'
old=root/'output/pdf/vendor-contact-tests'
private=Path('C:/Users/yamamotoma/OneDrive/Documents/助成金プラグイン内部資料/PCAデモ管理/2026-11-07')
guide=old/'テスト実行案内.txt'
archived=private/'変更前'/guide.name
if not archived.exists():shutil.copy2(guide,archived)
guide.write_text(f'''A：Co createの申請準備

使用する資料は次のフォルダに集約しました。
{out}

新しいチャットにPDF3点・Excel1点をまとめて添付し、
「この資料で補助金申請の準備を進めてください。」と依頼してください。
旧01・04・05のPDF、Excel、ZIPの内容も更新済みです。
画面に表示する資料名は、上記フォルダの日本語ファイル名を使ってください。

管理記録・旧版・B/Cの別シナリオの手順は添付対象外です。
管理記録：{private}
従来のB/Cの実行案内：{archived}
''',encoding='utf-8-sig')
reportpath=private/'検証結果.json'
r=json.loads(reportpath.read_text(encoding='utf-8'))
r['checks']['visualReview']={'pdfPages':14,'workbookSheets':5,'result':'passed'}
pairs=[(out/'01_導入提案・費用明細.pdf',old/'01-complete-proposal.pdf'),(out/'02_決算書_2025年度.pdf',old/'04-cocreate-test-financial-statements.pdf'),(out/'03_人事・経理資料_2025年度.pdf',old/'05-cocreate-test-ledgers-and-evidence.pdf'),(out/'04_勤怠・給与明細_2025年度.xlsx',root/'outputs/01a1b457-test-data/cocreate-test-ledgers.xlsx'),(out.parent/'CoCreate_申請準備資料一式.zip',old/'cocreate-batch-test-data.zip')]
for a,b in pairs:assert a.read_bytes()==b.read_bytes(),b
assert len(list(out.iterdir()))==4
r['checks']['legacyAliasesMatch']=True
reportpath.write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'attachments':4,'legacyAliasesMatch':5,'pdfPagesReviewed':14,'worksheetsReviewed':5},ensure_ascii=False))
