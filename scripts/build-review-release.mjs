import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { zipSync, unzipSync } from 'fflate';

const root=resolve(import.meta.dirname,'..');
const source=resolve(root,'releases/subsidy-ai-1.1.0');
const output=resolve(root,'output/release-1.1.0');
const files=['.codex-plugin/plugin.json','.mcp.json','skills/subsidy-consultation/SKILL.md','assets/subsidy-search-logo.png','LICENSE'];
const entries={};
for(const file of files)entries[file]=new Uint8Array(await readFile(resolve(source,file)));
const decode=file=>JSON.parse(new TextDecoder().decode(entries[file]));
const manifest=decode(files[0]),mcp=decode('.mcp.json');
assert.equal(manifest.name,'app-6a9b5a9e8f808191831c8655ee2191ae');assert.equal(manifest.version,'1.1.0');
assert.equal(manifest.mcpServers,'./.mcp.json');assert.ok(!manifest.apps&&!manifest.hooks);
assert.equal(manifest.interface.category,'Business & Operations');
assert.ok([...manifest.interface.shortDescription].length<=30);
assert.ok([...manifest.interface.longDescription].length<=4000);
const japanese=manifest.extensions['com.openai'].publication.translations['ja-JP'];
assert.ok(japanese.subtitle.trim()&&[...japanese.subtitle].length<=30);
assert.ok(japanese.description.trim()&&[...japanese.description].length<=4000);
for(const prompt of manifest.interface.defaultPrompt)assert.ok(prompt.trim()&&[...prompt].length<=128&&!/[\r\n\t]/.test(prompt));
assert.deepEqual(Object.keys(mcp.mcpServers),['subsidy-ai']);
assert.equal(mcp.mcpServers['subsidy-ai'].url,'https://subsidy-ai-plugin.mkisama.workers.dev/mcp');
const review=manifest.extensions['com.openai'].review;
assert.equal(review.test_cases.positive.length,5);assert.equal(review.test_cases.negative.length,3);
const submission=JSON.parse(await readFile(resolve(root,'chatgpt-app-submission.json'),'utf8'));
const excluded=['get_subsidy_documents','render_subsidy_comparison','discover_subsidies','get_discovered_subsidy_detail'];
const tools=Object.fromEntries(Object.entries(submission.tools).filter(([name])=>!excluded.includes(name)));
assert.equal(Object.keys(tools).length,15);
for(const c of review.test_cases.positive){assert.ok(c.prompt&&c.expected_behavior);for(const name of c.tools_triggered.split(',').map(s=>s.trim()))assert.ok(tools[name],name);}
for(const field of ['composerIcon','logo'])assert.ok(entries[manifest.interface[field].replace(/^\.\//,'')]);
const skill=new TextDecoder().decode(entries['skills/subsidy-consultation/SKILL.md']);
assert.match(skill,/^---\r?\nname: subsidy-consultation\r?\ndescription:/);
for(const name of excluded)assert.ok(!skill.includes(name));
// Explicit allowlist: no app references, nested ZIPs, environment files, or source/deployment code.
const zip=zipSync(Object.fromEntries(Object.entries(entries).map(([name,data])=>[name,[data,{mtime:new Date('2026-10-09T00:00:00Z')}]])),{level:9});
const unpacked=unzipSync(zip);assert.deepEqual(Object.keys(unpacked).sort(),files.toSorted());
for(const file of files)assert.deepEqual(unpacked[file],entries[file]);
await mkdir(output,{recursive:true});
await writeFile(resolve(output,'subsidy-ai-1.1.0.zip'),zip);
await writeFile(resolve(output,'tool-annotations-15.json'),JSON.stringify({endpoint:mcp.mcpServers['subsidy-ai'].url,tools},null,2)+'\n');
const result={packageVersion:'1.1.0',mcpVersion:'0.13.0',endpoint:mcp.mcpServers['subsidy-ai'].url,
  files,bytes:zip.length,sha256:createHash('sha256').update(zip).digest('hex'),positiveCases:5,negativeCases:3,
  declaredDemoRecording:review.demo_recording_url??null,localPackageChecks:'passed',openaiUploadValidation:'not_run'};
await writeFile(resolve(output,'package-check.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
