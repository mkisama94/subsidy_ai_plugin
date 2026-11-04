1: import { readFile, writeFile, mkdir } from 'node:fs/promises';
2: import { resolve } from 'node:path';
3: // Generate an opt-in deployment configuration; this command never deploys.
4: const root=resolve(import.meta.dirname,'..');
5: const config=JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));
6: config.main=resolve(root,config.main);
7: config.$schema=resolve(root,'node_modules/wrangler/config-schema.json');
8: config.vars.MHLW_INGESTION_ENABLED='true';
9: config.queues={producers:[{binding:'MHLW_PDF_QUEUE',queue:'subsidy-ai-mhlw-pdf'}]};
10: for(const db of config.d1_databases)db.migrations_dir=resolve(root,'migrations');
11: if(process.argv.includes('--tools')){
12:   config.vars.MHLW_CATALOG_SERVING_ENABLED='true';config.vars.SUBSIDY_DISCOVERY_TOOLS_ENABLED='true';
13: }
14: if(process.argv.includes('--guidance')){
15:   if(!process.argv.includes('--tools'))throw new Error('--guidance requires --tools');
16:   config.vars.MHLW_DISCOVERY_GUIDANCE_ENABLED='true';
17: }
18: await mkdir(resolve(root,'.wrangler'),{recursive:true});
19: const output=resolve(root,'.wrangler/mhlw-collection.json');
20: await writeFile(output,JSON.stringify(config,null,2)+'\n');console.log(output);