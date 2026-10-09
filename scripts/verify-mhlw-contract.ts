import { execFileSync } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../src/index';

const root=resolve(import.meta.dirname,'..'),path=resolve(root,`src/.mhlw-baseline-${crypto.randomUUID()}.ts`);
const baselineRef='f1027e2';
await writeFile(path,execFileSync('git',['show',`${baselineRef}:src/index.ts`],{cwd:root}));
async function list(factory:typeof createServer,env:Parameters<typeof createServer>[0]) {
  const server=factory(env),client=new Client({name:'contract-check',version:'1'}),[ct,st]=InMemoryTransport.createLinkedPair();
  await server.connect(st);await client.connect(ct);
  try{return (await client.listTools()).tools;}finally{await client.close();await server.close();}
}
try {
  const previous=await import(pathToFileURL(path).href);
  for(const env of [{},{OFFICIAL_DOCUMENTS_ENABLED:'true',SUBSIDY_COMPARISON_ENABLED:'true'}]){
    const old=await list(previous.createServer,env),current=await list(createServer,env);assert.deepEqual(current,old);
    console.log(JSON.stringify({baselineRef,count:old.length,sha256:createHash('sha256').update(JSON.stringify(old)).digest('hex'),exactDefinitionMatch:true}));
  }
}finally{await unlink(path);}
