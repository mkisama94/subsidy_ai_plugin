1: import { execFileSync } from 'node:child_process';
2: import { writeFile, unlink } from 'node:fs/promises';
3: import { resolve } from 'node:path';
4: import { pathToFileURL } from 'node:url';
5: import { createHash } from 'node:crypto';
6: import assert from 'node:assert/strict';
7: import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
8: import { createServer } from '../src/index';
9: 
10: const root=resolve(import.meta.dirname,'..'),path=resolve(root,`src/.mhlw-baseline-${crypto.randomUUID()}.ts`);
11: const baselineRef='f1027e2';
12: await writeFile(path,execFileSync('git',['show',`${baselineRef}:src/index.ts`],{cwd:root}));
13: async function list(factory:typeof createServer,env:Parameters<typeof createServer>[0]) {
14:   const server=factory(env),client=new Client({name:'contract-check',version:'1'}),[ct,st]=InMemoryTransport.createLinkedPair();
15:   await server.connect(st);await client.connect(ct);
16:   try{return (await client.listTools()).tools;}finally{await client.close();await server.close();}
17: }
18: try {
19:   const previous=await import(pathToFileURL(path).href);
20:   for(const env of [{},{OFFICIAL_DOCUMENTS_ENABLED:'true',SUBSIDY_COMPARISON_ENABLED:'true'}]){
21:     const old=await list(previous.createServer,env),current=await list(createServer,env);assert.deepEqual(current,old);
22:     console.log(JSON.stringify({baselineRef,count:old.length,sha256:createHash('sha256').update(JSON.stringify(old)).digest('hex'),exactDefinitionMatch:true}));
23:   }
24: }finally{await unlink(path);}