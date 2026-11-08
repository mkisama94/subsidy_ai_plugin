from pathlib import Path
p=Path(__file__).with_name('build_workbook.mjs')
s=p.read_text(encoding='utf-8')
replacements={
"path.join(root,'outputs','01a1b457-test-data')":"path.join(root,'output','pdf','cocreate-application')",
'TEST ONLY：人物・人数・勤怠・給与は架空。会社発行資料・公式提出用ではありません。':'人事・経理資料 / 管理番号 CC-20261107-01 / 作成日 2026-11-07',
"color:'#9A3412'":"color:'#516273'",
'（合成）':'', '（テスト用）':'', '架空氏名':'表示名',
'退任・退社日は空欄＝対象期末まで在籍。全員、対象期全12か月在籍する架空設定。':'退任・退社日は空欄＝対象期末まで在籍。全員、対象期の全12か月在籍。',
'O01は常勤の架空役員。E01～E05は正社員。3ライセンスと従業員数は別条件。':'氏名は社員番号で管理。O01は常勤役員、E01～E05は正社員。',
'日次勤怠は土日休、平日に毎月1日有休・休務。祝日等の個別設定なし。':'休日：土日祝日、8/13～15、12/29～1/2。有休・休務は日次明細に記録。',
'給与は控除前。諸手当は時間外手当等を含む架空の定額。控除額は収録しない。':'給与は控除前の支給額。本人負担の社会保険・税などの控除は別管理。',
'原資料：同梱テストPDF。決算書は千円、本Excelは円。実会社の実績ではない。':'対応資料：2025年度決算書・人事経理資料。決算書は千円、本Excelは円。',
"path.join(out,'cocreate-test-ledgers.xlsx')":"path.join(out,'04_勤怠・給与明細_2025年度.xlsx')",
}
for a,b in replacements.items():
    assert a in s,a
    s=s.replace(a,b)
s=s.replace("await output.save(dest);", "await output.save(dest);\nawait fs.copyFile(dest,path.join(root,'outputs','01a1b457-test-data','cocreate-test-ledgers.xlsx'));")
p.write_text(s,encoding='utf-8')
