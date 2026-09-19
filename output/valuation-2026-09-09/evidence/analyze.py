from pathlib import Path
import subprocess,json,re,hashlib,csv,sys
sys.stdout.reconfigure(encoding='utf-8')
from datetime import datetime
from docx import Document
base=Path(__file__).parent
repo=base/'public-repo'
def git(*args):
    return subprocess.check_output(['git','-C',str(repo),*args],encoding='utf-8').strip()
head=git('rev-parse','HEAD')
files=git('ls-tree','-r','--name-only',head).splitlines()
records=[]
for name in files:
    data=subprocess.check_output(['git','-C',str(repo),'show',f'{head}:{name}'])
    lines=data.decode('utf-8').splitlines() if not name.endswith('.png') else []
    records.append(dict(path=name,bytes=len(data),lines=len(lines),nonblank_lines=sum(bool(x.strip()) for x in lines),sha256=hashlib.sha256(data).hexdigest()))
commits=[]
for line in git('log','--reverse','--format=%H%x09%aI%x09%cI%x09%an%x09%P%x09%s',head).splitlines():
    sha,ad,cd,author,parents,subject=line.split('\t',5)
    commits.append(dict(sha=sha,authored=ad,committed=cd,author=author,parents=parents.split(),subject=subject))
index=(repo/'src/index.ts').read_text(encoding='utf-8')
tools=[dict(name=m.group(1),line=index[:m.start()].count('\n')+1) for m in re.finditer(r'server\.registerTool\(\s*"([^"]+)"',index)]
result=dict(repository='https://github.com/mkisama94/subsidy_ai_plugin',head=head,branch='main',retrieved=datetime.now().astimezone().isoformat(),files=records,commits=commits,tools=tools)
(base/'repository-evidence.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
with (base/'file-metrics.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=records[0].keys());w.writeheader();w.writerows(records)
with (base/'commit-history.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=['sha','authored','committed','author','parents','subject']);w.writeheader();w.writerows(commits)
for prefix in ('src/','test/','migrations/'):
    part=[x for x in records if x['path'].startswith(prefix)]
    print(prefix,len(part),sum(x['lines'] for x in part),sum(x['nonblank_lines'] for x in part))
print('commits',len(commits),'nonmerges',sum(len(c['parents'])<2 for c in commits),'files',len(files),'tools',tools)
ref=Path('C:/Users/yamamotoma/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-investment-committee-memo/assets/reference.docx')
doc=Document(ref)
design={'sections':[dict(width=s.page_width.pt,height=s.page_height.pt,left=s.left_margin.pt,right=s.right_margin.pt,top=s.top_margin.pt,bottom=s.bottom_margin.pt) for s in doc.sections],'paragraphs':[dict(text=p.text,style=p.style.name) for p in doc.paragraphs], 'styles':{s.name:dict(font=s.font.name,size=s.font.size.pt if s.font.size else None,bold=s.font.bold) for s in doc.styles if s.type==1}}
(base/'template-evidence.json').write_text(json.dumps(design,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(design,ensure_ascii=False)[:7500])
