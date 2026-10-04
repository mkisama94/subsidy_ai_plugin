import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function documentDatabase() {
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
  for(const name of ["0001_initial_schema.sql","0002_public_api_cache.sql","0003_subsidy_research_schema.sql","0004_official_document_registry.sql"])
    sqlite.exec(readFileSync(new URL(`../../migrations/${name}`,import.meta.url),"utf8"));
  const prepare=(sql:string)=>{
    const s=sqlite.prepare(sql);let values:any[]=[];
    const query={bind(...args:any[]){values=args;return query;},
      async first(){return s.get(...values)??null;},async all(){return {results:s.all(...values),success:true};},
      async run(){const r=s.run(...values);return {success:true,meta:{changes:Number(r.changes)}};}};
    return query;
  };
  const db={prepare,async batch(statements:any[]){sqlite.exec("BEGIN");try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec("COMMIT");return r;}catch(e){sqlite.exec("ROLLBACK");throw e;}}} as unknown as D1Database;
  return {sqlite,db};
}
