import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const root=path.resolve(import.meta.dirname,'../..');
const data=JSON.parse(await fs.readFile(path.join(import.meta.dirname,'data.json'),'utf8'));
const out=path.join(root,'output','pdf','cocreate-application');
await fs.mkdir(out,{recursive:true});
const wb=Workbook.create();
const names=['集計','名簿','月次勤怠','給与明細','日次勤怠'];
const sheets=Object.fromEntries(names.map(n=>[n,wb.worksheets.add(n)]));
const jp='MS Gothic';
const last={daily:6+data.daily.length,monthly:6+data.monthly.length,payroll:6+data.payroll.length};
const dateVal=s=>new Date(`${s.length===7?s+'-01':s}T00:00:00Z`);
const timeVal=s=>s?Number(s.split(':')[0])/24+Number(s.split(':')[1])/1440:null;
function setup(s,title,heads,rows,widths){
  s.showGridLines=false;
  const end=String.fromCharCode(64+heads.length);
  s.getRange(`A1:${end}${rows+7}`).format.font={name:jp,size:10,color:'#243449'};
  s.getRange(`A1:${end}${rows+7}`).format.rowHeight=21;
  s.getRange(`A1:${end}${rows+7}`).format.verticalAlignment='center';
  s.getRange('A2').values=[[title]];s.getRange('A2').format.font={name:jp,size:15,bold:true,color:'#123246'};
  s.getRange('A3').values=[['人事・経理資料 / 管理番号 CC-20261107-01 / 作成日 2026-11-07']];
  s.getRange('A3').format.font={name:jp,size:10,color:'#516273'};
  s.getRange('A4').values=[['株式会社Ｃｏ　ｃｒｅａｔｅ / 3010001205734 / 2025-04-01～2026-03-31 / 円・時間']];
  s.getRange(`A6:${end}6`).values=[heads];
  s.getRange(`A6:${end}6`).format={fill:'#123246',font:{name:jp,size:10,bold:true,color:'#FFFFFF'},rowHeight:30,horizontalAlignment:'center'};
  widths.forEach((v,i)=>s.getRange(`${String.fromCharCode(65+i)}1:${String.fromCharCode(65+i)}${rows+7}`).format.columnWidth=v);
  s.getRange(`A6:${end}${rows+6}`).format.borders={insideHorizontal:{style:'thin',color:'#E0E7ED'}};
  if(rows>15)s.freezePanes.freezeRows(6);
}

setup(sheets['名簿'],'役員・従業員一覧',['ID','表示名','区分','雇用形態','就任・入社日','退任・退社日','対象期開始','対象期終了'],6,[11,24,14,17,18,18,18,18]);
sheets['名簿'].getRange('A7:H12').values=data.people.map(p=>[p.id,p.name,p.role,p.employment,dateVal(p.joined),null,dateVal(data.periodStart),dateVal(data.periodEnd)]);
sheets['名簿'].getRange('E7:H12').setNumberFormat('yyyy-mm-dd');
sheets['名簿'].getRange('A15').values=[['退任・退社日は空欄＝対象期末まで在籍。全員、対象期の全12か月在籍。']];
sheets['名簿'].getRange('A16').values=[['氏名は社員番号で管理。O01は常勤役員、E01～E05は正社員。']];

setup(sheets['日次勤怠'],'日次勤務記録',['日付','対象月','ID','区分','状態','出勤','退勤','休憩h','通常実働h','時間外h','有休h','実働h'],data.daily.length,[16,15,11,14,14,11,11,12,15,13,12,14]);
sheets['日次勤怠'].getRange(`A7:L${last.daily}`).values=data.daily.map(r=>[dateVal(r.date),dateVal(r.month),r.id,r.role,r.status,timeVal(r.start),timeVal(r.end),r.breakHours,r.regularHours,r.overtimeHours,r.paidLeaveHours,null]);
sheets['日次勤怠'].getRange(`L7:L${last.daily}`).formulas=data.daily.map((_,i)=>[`=SUM(I${i+7}:J${i+7})`]);
sheets['日次勤怠'].getRange(`A7:A${last.daily}`).setNumberFormat('yyyy-mm-dd');
sheets['日次勤怠'].getRange(`B7:B${last.daily}`).setNumberFormat('yyyy-mm');
sheets['日次勤怠'].getRange(`A7:C${last.daily}`).format.horizontalAlignment='center';
sheets['日次勤怠'].getRange(`F7:G${last.daily}`).setNumberFormat('hh:mm');
sheets['日次勤怠'].getRange(`H7:L${last.daily}`).setNumberFormat('#,##0.0');

setup(sheets['月次勤怠'],'月次勤務記録',['対象月','ID','区分','勤務・従事日','有休日','通常実働h','時間外h','実働h'],72,[16,11,14,18,15,19,18,19]);
sheets['月次勤怠'].getRange('A7:C78').values=data.monthly.map(r=>[dateVal(r.month),r.id,r.role]);
const d=`'日次勤怠'!`;
sheets['月次勤怠'].getRange('D7:H78').formulas=data.monthly.map((_,i)=>{
 const r=i+7,keys=`${d}$B$7:$B$${last.daily},$A${r},${d}$C$7:$C$${last.daily},$B${r}`;
 return [`=COUNTIFS(${keys},${d}$L$7:$L$${last.daily},">0")`,`=COUNTIFS(${keys},${d}$E$7:$E$${last.daily},"有休")`,
 `=SUMIFS(${d}$I$7:$I$${last.daily},${keys})`,`=SUMIFS(${d}$J$7:$J$${last.daily},${keys})`,`=SUM(F${r}:G${r})`];
});
sheets['月次勤怠'].getRange('A7:A78').setNumberFormat('yyyy-mm');
sheets['月次勤怠'].getRange('A7:B78').format.horizontalAlignment='center';
sheets['月次勤怠'].getRange('D7:E78').setNumberFormat('#,##0');
sheets['月次勤怠'].getRange('F7:H78').setNumberFormat('#,##0.0');

setup(sheets['給与明細'],'給与・役員報酬の月次明細',['対象月','ID','区分','基本給','諸手当','給与手当計','賞与','役員報酬','支給合計'],72,[16,11,14,19,18,19,18,19,20]);
sheets['給与明細'].getRange('A7:I78').values=data.payroll.map(r=>[dateVal(r.month),r.id,r.role,r.base,r.allowance,null,r.bonus,r.officer,null]);
sheets['給与明細'].getRange('F7:F78').formulas=data.payroll.map((_,i)=>[`=SUM(D${i+7}:E${i+7})`]);
sheets['給与明細'].getRange('I7:I78').formulas=data.payroll.map((_,i)=>[`=SUM(F${i+7}:H${i+7})`]);
sheets['給与明細'].getRange('A7:A78').setNumberFormat('yyyy-mm');
sheets['給与明細'].getRange('A7:B78').format.horizontalAlignment='center';
sheets['給与明細'].getRange('D7:I78').setNumberFormat('#,##0');

setup(sheets['集計'],'年間勤怠・給与集計',['ID','区分','通常実働h','時間外h','実働h','給与手当','賞与','役員報酬','支給合計'],7,[11,14,18,16,18,21,19,21,22]);
sheets['集計'].getRange('A7:B12').formulas=data.people.map((_,i)=>[`='名簿'!A${i+7}`,`='名簿'!C${i+7}`]);
sheets['集計'].getRange('C7:I12').formulas=data.people.map((_,i)=>{
 const r=i+7;
 return [`=SUMIFS('月次勤怠'!$F$7:$F$78,'月次勤怠'!$B$7:$B$78,$A${r})`,`=SUMIFS('月次勤怠'!$G$7:$G$78,'月次勤怠'!$B$7:$B$78,$A${r})`,`=SUM(C${r}:D${r})`,
 `=SUMIFS('給与明細'!$F$7:$F$78,'給与明細'!$B$7:$B$78,$A${r})`,`=SUMIFS('給与明細'!$G$7:$G$78,'給与明細'!$B$7:$B$78,$A${r})`,`=SUMIFS('給与明細'!$H$7:$H$78,'給与明細'!$B$7:$B$78,$A${r})`,`=SUM(F${r}:H${r})`];
});
sheets['集計'].getRange('A13').values=[['合計']];
sheets['集計'].getRange('C13:I13').formulas=[['C','D','E','F','G','H','I'].map(c=>`=SUM(${c}7:${c}12)` )];
sheets['集計'].getRange('C7:E13').setNumberFormat('#,##0.0');
sheets['集計'].getRange('F7:I13').setNumberFormat('#,##0');
sheets['集計'].getRange('A13:I13').format.fill='#E6F2F0';
sheets['集計'].getRange('A16:C16').values=[['集計対象','人数','実働時間h']];
sheets['集計'].getRange('A16:C16').format={fill:'#E6F2F0',font:{bold:true,name:jp,size:10}};
sheets['集計'].getRange('A17:A18').values=[['役員'],['従業員']];
sheets['集計'].getRange('B17:C18').formulas=[17,18].map(r=>[`=COUNTIFS('名簿'!$C$7:$C$12,A${r})`,`=SUMIFS($E$7:$E$12,$B$7:$B$12,A${r})`]);
sheets['集計'].getRange('C17:C18').setNumberFormat('#,##0.0');
const notes=[
 '総時間は両区分の単純合計。制度上の集計対象・対象期は別途適用する。',
 '有休・休憩は実働に含めない。役員の時間は業務従事の記録。',
 '休日：土日祝日、8/13～15、12/29～1/2。有休・休務は日次明細に記録。',
 '給与は控除前の支給額。本人負担の社会保険・税などの控除は別管理。',
 '対応資料：2025年度決算書・人事経理資料。決算書は千円、本Excelは円。'
];
notes.forEach((s,i)=>sheets['集計'].getRange(`A${21+i}`).values=[[s]]);
sheets['集計'].getRange('A21:I25').format.font={name:jp,size:10,color:'#516273'};
sheets['集計'].tabColor='#123246';

wb.recalculate();
const vals=sheets['集計'].getRange('C13:I13').values[0];
const expected=['regularHours','overtimeHours','actualHours','salary','bonus','officer','total'].map(k=>data.totals[k]);
assert.deepEqual(vals,expected);
assert.deepEqual(sheets['集計'].getRange('B17:C18').values,[[1,data.totals.officerHours],[5,data.totals.employeeHours]]);
for(const i of [0,35,71]) {
 const row=sheets['月次勤怠'].getRange(`D${i+7}:H${i+7}`).values[0], src=data.monthly[i];
 assert.deepEqual(row,[src.days,src.paidLeaveDays,src.regularHours,src.overtimeHours,src.actualHours]);
}
const old=sheets['日次勤怠'].getRange('J7').values[0][0];
sheets['日次勤怠'].getRange('J7').values=[[old+1]];wb.recalculate();
assert.equal(sheets['集計'].getRange('E13').values[0][0],data.totals.actualHours+1);
sheets['日次勤怠'].getRange('J7').values=[[old]];wb.recalculate();
assert.equal(sheets['集計'].getRange('E13').values[0][0],data.totals.actualHours);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:20},maxChars:1800});
await fs.writeFile(path.join(import.meta.dirname,'formula-scan.json'),errors.ndjson);
console.log(errors.ndjson);
const inspect=await wb.inspect({kind:'table',range:'集計!A6:I18',include:'values,formulas',tableMaxRows:13,tableMaxCols:9,maxChars:3000});
await fs.writeFile(path.join(import.meta.dirname,'workbook-inspection.json'),inspect.ndjson);
const output=await SpreadsheetFile.exportXlsx(wb);
const dest=path.join(out,'04_勤怠・給与明細_2025年度.xlsx');await output.save(dest);
await fs.copyFile(dest,path.join(root,'outputs','01a1b457-test-data','cocreate-test-ledgers.xlsx'));
for(const [i,n] of names.entries()){
 const end=n==='日次勤怠'?'L18':n==='名簿'?'H16':n==='集計'?'I25':n==='月次勤怠'?'H18':'I18';
 const blob=await wb.render({sheetName:n,range:`A1:${end}`,scale:1.2,format:'png'});
 await fs.writeFile(path.join(import.meta.dirname,`sheet-${i+1}.png`),new Uint8Array(await blob.arrayBuffer()));
}
console.log(JSON.stringify({xlsx:dest,sheets:names,totals:vals,verification:'independent source totals, representative monthly rows, change/recalculate/restore'}));
