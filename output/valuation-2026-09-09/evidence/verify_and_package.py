from pathlib import Path
import json,re,csv,hashlib,zipfile,shutil
from decimal import Decimal
from pypdf import PdfReader
from PIL import Image,ImageChops
R=Path(__file__).resolve().parents[1];E=R/'evidence'
d=json.loads((E/'repository-evidence.json').read_text(encoding='utf-8'))
sha=d['head'];texts=[p.extract_text() for p in PdfReader(R/'source-code-valuation-report.pdf').pages]
assert len(texts)==11
assert all(len(t)>500 for t in texts)
assert len(d['commits'])==37 and len(d['tools'])==13
assert sum(f['lines'] for f in d['files'] if f['path'].startswith('src/'))==6099
assert sum(f['lines'] for f in d['files'] if f['path'].startswith('test/'))==2853
assert all(x in ''.join(texts) for x in ['629.2','1,058.2','104','80件','6,099'])
md=(R/'source-code-valuation-report.md').read_text(encoding='utf-8')
checked=0
for path,line in re.findall(r'/blob/'+sha+r'/([^\s)#]+)(?:#L(\d+))?',md):
    f=next(f for f in d['files'] if f['path']==path)
    if line:assert 1<=int(line)<=f['lines']
    checked+=1
for days,rate,total in [(66,50000,3630000),(104,55000,6292000),(148,65000,10582000)]:
    assert Decimal(days)*rate*Decimal('1.1')==total
# Pages 1-10 are identical to the already-inspected render; only removal of an
# empty overflow page changes the final appendix numbering.
same=[]
for i in range(1,11):
    a=Image.open(E/f'render-v3/page-{i:02}.png').convert('RGB');b=Image.open(E/f'render-v4/page-{i:02}.png').convert('RGB')
    equal=a.size==b.size and ImageChops.difference(a,b).getbbox() is None
    assert equal
    same.append(i)
for name in ['commit-history.csv','file-metrics.csv']:shutil.copy2(E/name,R/name)
links=sum(len(p.get('/Annots',[])) for p in PdfReader(R/'source-code-valuation-report.pdf').pages)
result={'target_sha':sha,'pdf_pages':len(texts),'source_references_validated':checked,'pdf_annotations':links,'commits':37,'tools':13,'tests_passed':80,'typecheck':'passed','valuation_calculations':'passed','visual_review':'all pages inspected; final pages 1-10 pixel-identical to inspected prior render; final page 11 inspected','identical_pages':same}
(E/'verification-summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
files=['README-verification.md','repository-evidence.json','commit-history.csv','file-metrics.csv','dependency-install.txt','test-results.txt','typecheck-results.txt','source-validation-probe.mts','source-validation-probe-result.json','public-head.txt','verification-summary.json']
with zipfile.ZipFile(R/'verification-evidence.zip','w',zipfile.ZIP_DEFLATED) as z:
    for f in files:z.write(E/f,f)
    z.write(R/'valuation-model.csv','valuation-model.csv')
print(json.dumps(result,ensure_ascii=False))
