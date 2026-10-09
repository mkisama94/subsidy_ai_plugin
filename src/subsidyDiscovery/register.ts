import type { McpServer } from '@modelcontextprotocol/server';
import { CatalogError, enabled, type CatalogEnv } from '../officialSubsidyCatalog/types';
import { discoverSubsidies, getDiscoveredSubsidyDetail, searchInputSchema, detailInputSchema, searchOutputSchema, detailOutputSchema } from './service';

const annotations={readOnlyHint:false,destructiveHint:false,openWorldHint:true,idempotentHint:false};
function wrap(fn:(input:unknown)=>Promise<unknown>) {
  return async(input:unknown)=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{const value=await Promise.race([fn(input),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new CatalogError('search_timeout')),20_000);})]);return {structuredContent:value as Record<string,unknown>,content:[{type:'text' as const,text:JSON.stringify(value,null,2)}]};}
    catch(error){return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:{code:error instanceof CatalogError?error.code:'invalid_or_unavailable',message:'条件または情報の状態を確認し、必要に応じて再検索してください。'}})}]};}
    finally{if(timer)clearTimeout(timer);}
  };
}
export function registerDiscovery(server:McpServer,env:CatalogEnv) {
  if(!enabled(env.SUBSIDY_DISCOVERY_TOOLS_ENABLED))return;
  server.registerTool('discover_subsidies',{
    description:'Jグランツと登録済みの厚生労働省公式情報から補助金・雇用関係助成金を検索します。採用・研修・正社員化でも使えます。厚労省は内部DBを読み、Jグランツは外部APIと一時キャッシュを使用・更新します。収集・PDF解析は起動しません。coverage、適用時期、未確認候補を説明し、candidateIdとversionIdはget_discovered_subsidy_detailに渡してください。受給資格は判定しません。',
    annotations,inputSchema:searchInputSchema.shape,outputSchema:searchOutputSchema.shape,
  },wrap(input=>discoverSubsidies(input,env)));
  server.registerTool('get_discovered_subsidy_detail',{
    description:'discover_subsidiesのcandidateIdとversionIdから出典付き詳細を取得します。厚労省は登録済みDB、Jグランツは外部APIと一時キャッシュを使用・更新します。取組時期で条件が変わるため、最新版を自動適用しません。未確認の金額・期限を補完せず、公式資料と確認事項を案内してください。収集・PDF解析・公開処理は行いません。',
    annotations,inputSchema:detailInputSchema.shape,outputSchema:detailOutputSchema.shape,
  },wrap(input=>getDiscoveredSubsidyDetail(input,env)));
}
