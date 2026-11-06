import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const artifact=new URL('dist/index.js',import.meta.url);
const source=await readFile(artifact,'utf8');
const encoded=source.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/)?.[1];
assert.ok(encoded,'Build the fixed rule package first');
const map=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
for(let i=0;i<map.sources.length;i++) {
  const actual=await readFile(new URL(map.sources[i],artifact),'utf8');
  assert.equal(actual.replace(/\r\n/g,'\n'),map.sourcesContent[i].replace(/\r\n/g,'\n'),'The shared evaluator changed. Bump/rebuild the rule package and update the reviewed consumer archive.');
}
console.log('PASS: the fixed shared evaluator matches the owning source.');
