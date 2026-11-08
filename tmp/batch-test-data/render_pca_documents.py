from pathlib import Path
import subprocess
from PIL import Image, ImageOps, ImageDraw

root=Path(__file__).resolve().parents[2]
work=Path(__file__).resolve().parent/'pca-render'
work.mkdir(exist_ok=True)
poppler=Path('C:/Users/yamamotoma/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe')
pages=[]
for ix,pdf in enumerate(sorted((root/'output/pdf/cocreate-application').glob('*.pdf')),1):
    subprocess.run([str(poppler),'-r','125','-png',str(pdf),str(work/f'doc{ix}')],check=True,capture_output=True)
    pages.extend(sorted(work.glob(f'doc{ix}-*.png')))
for i in range(0,len(pages),2):
    images=[]
    for p in pages[i:i+2]:
        img=Image.open(p).convert('RGB')
        img.thumbnail((1000,1450))
        images.append(img)
    sheet=Image.new('RGB',(sum(im.width for im in images)+24,max(im.height for im in images)+12),'#ced6df')
    x=8
    for im in images:sheet.paste(im,(x,6));x+=im.width+8
    sheet.save(work/f'pair-{i//2+1}.png')
print(f'Rendered {len(pages)} pages / {(len(pages)+1)//2} review pairs')
