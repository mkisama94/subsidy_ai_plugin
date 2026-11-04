1: import { readFile, writeFile, mkdir } from 'node:fs/promises';
2: import { resolve } from 'node:path';
3: import { createHash } from 'node:crypto';
4: import assert from 'node:assert/strict';
5: import { zipSync, unzipSync } from 'fflate';
6: 
7: const root=resolve(import.meta.dirname,'..');
8: const source=resolve(root,'releases/subsidy-ai-1.1.0');
9: const output=resolve(root,'output/release-1.1.0');
10: const files=['.codex-plugin/plugin.json','.mcp.json','skills/subsidy-consultation/SKILL.md','assets/subsidy-search-logo.png','LICENSE'];
11: const entries={};
12: for(const file of files)entries[file]=new Uint8Array(await readFile(resolve(source,file)));
13: const decode=file=>JSON.parse(new TextDecoder().decode(entries[file]));
14: const manifest=decode(files[0]),mcp=decode('.mcp.json');
15: assert.equal(manifest.name,'app-6a9b5a9e8f808191831c8655ee2191ae');assert.equal(manifest.version,'1.1.0');
16: assert.equal(manifest.mcpServers,'./.mcp.json');assert.ok(!manifest.apps&&!manifest.hooks);
17: assert.equal(manifest.interface.category,'Business & Operations');
18: assert.ok([...manifest.interface.shortDescription].length<=30);
19: assert.ok([...manifest.interface.longDescription].length<=4000);
20: const japanese=manifest.extensions['com.openai'].publication.translations['ja-JP'];
21: assert.ok(japanese.subtitle.trim()&&[...japanese.subtitle].length<=30);
22: assert.ok(japanese.description.trim()&&[...japanese.description].length<=4000);
23: for(const prompt of manifest.interface.defaultPrompt)assert.ok(prompt.trim()&&[...prompt].length<=128&&!/[\r\n\t]/.test(prompt));
24: assert.deepEqual(Object.keys(mcp.mcpServers),['subsidy-ai']);
25: assert.equal(mcp.mcpServers['subsidy-ai'].url,'https://subsidy-ai-plugin.mkisama.workers.dev/mcp');
26: const review=manifest.extensions['com.openai'].review;
27: assert.equal(review.test_cases.positive.length,5);assert.equal(review.test_cases.negative.length,3);
28: const submission=JSON.parse(await readFile(resolve(root,'chatgpt-app-submission.json'),'utf8'));
29: const excluded=['get_subsidy_documents','render_subsidy_comparison','discover_subsidies','get_discovered_subsidy_detail'];
30: const tools=Object.fromEntries(Object.entries(submission.tools).filter(([name])=>!excluded.includes(name)));
31: assert.equal(Object.keys(tools).length,15);
32: for(const c of review.test_cases.positive){assert.ok(c.prompt&&c.expected_behavior);for(const name of c.tools_triggered.split(',').map(s=>s.trim()))assert.ok(tools[name],name);}
33: for(const field of ['composerIcon','logo'])assert.ok(entries[manifest.interface[field].replace(/^\.\//,'')]);
34: const skill=new TextDecoder().decode(entries['skills/subsidy-consultation/SKILL.md']);
35: assert.match(skill,/^---\r?\nname: subsidy-consultation\r?\ndescription:/);
36: for(const name of excluded)assert.ok(!skill.includes(name));
37: // Explicit allowlist: no app references, nested ZIPs, environment files, or source/deployment code.
38: const zip=zipSync(Object.fromEntries(Object.entries(entries).map(([name,data])=>[name,[data,{mtime:new Date('2026-10-09T00:00:00Z')}]])),{level:9});
39: const unpacked=unzipSync(zip);assert.deepEqual(Object.keys(unpacked).sort(),files.toSorted());
40: for(const file of files)assert.deepEqual(unpacked[file],entries[file]);
41: await mkdir(output,{recursive:true});
42: await writeFile(resolve(output,'subsidy-ai-1.1.0.zip'),zip);
43: await writeFile(resolve(output,'tool-annotations-15.json'),JSON.stringify({endpoint:mcp.mcpServers['subsidy-ai'].url,tools},null,2)+'\n');
44: const result={packageVersion:'1.1.0',mcpVersion:'0.13.0',endpoint:mcp.mcpServers['subsidy-ai'].url,
45:   files,bytes:zip.length,sha256:createHash('sha256').update(zip).digest('hex'),positiveCases:5,negativeCases:3,
46:   declaredDemoRecording:review.demo_recording_url??null,localPackageChecks:'passed',openaiUploadValidation:'not_run'};
47: await writeFile(resolve(output,'package-check.json'),JSON.stringify(result,null,2)+'\n');
48: console.log(JSON.stringify(result,null,2));