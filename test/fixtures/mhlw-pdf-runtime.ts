// Local workerd smoke harness only. Never referenced by production Wrangler configuration.
import { extractPdf } from '../../src/officialSources/mhlw/pdf';
export default {
  async fetch(request:Request) {
    if(request.method!=='POST')return new Response('Local PDF runtime test', {status:405});
    try{return Response.json(await extractPdf(new Uint8Array(await request.arrayBuffer()),{deadline:Date.now()+120000}));}
    catch(error){return Response.json({error:error instanceof Error?error.message:'failed'},{status:422});}
  },
};
