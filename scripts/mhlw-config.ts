import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
// Generate an opt-in deployment configuration; this command never deploys.
const root=resolve(import.meta.dirname,'..');
const config=JSON.parse(await readFile(resolve(root,'wrangler.jsonc'),'utf8'));
config.main=resolve(root,config.main);
config.$schema=resolve(root,'node_modules/wrangler/config-schema.json');
config.vars.MHLW_INGESTION_ENABLED='true';
config.queues={producers:[{binding:'MHLW_PDF_QUEUE',queue:'subsidy-ai-mhlw-pdf'}]};
for(const db of config.d1_databases)db.migrations_dir=resolve(root,'migrations');
if(process.argv.includes('--tools')){
  config.vars.MHLW_CATALOG_SERVING_ENABLED='true';config.vars.SUBSIDY_DISCOVERY_TOOLS_ENABLED='true';
}
if(process.argv.includes('--guidance')){
  if(!process.argv.includes('--tools'))throw new Error('--guidance requires --tools');
  config.vars.MHLW_DISCOVERY_GUIDANCE_ENABLED='true';
}
await mkdir(resolve(root,'.wrangler'),{recursive:true});
const output=resolve(root,'.wrangler/mhlw-collection.json');
await writeFile(output,JSON.stringify(config,null,2)+'\n');console.log(output);
