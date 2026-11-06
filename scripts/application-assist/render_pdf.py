"""Offline PDF derivatives. Source remains unchanged; physical pages are 1-based."""
import argparse
from pathlib import Path
import pypdfium2 as pdfium

parser = argparse.ArgumentParser()
parser.add_argument('source')
parser.add_argument('output')
parser.add_argument('first', type=int)
parser.add_argument('last', type=int)
args = parser.parse_args()
with pdfium.PdfDocument(args.source) as doc:
    if not 1 <= args.first <= args.last <= len(doc):
        raise ValueError('Invalid physical page range')
    for number in range(args.first, args.last + 1):
        page = doc[number - 1]
        bitmap = page.render(scale=2.5)
        bitmap.to_pil().save(Path(args.output) / f'page-{number:04d}.png')
        bitmap.close()
        page.close()
