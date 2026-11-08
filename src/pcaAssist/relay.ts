import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { PCA_ASSIST_CONTRACT } from './contract';

export interface PcaRelayEnv { PCA_RELAY_ENABLED?:string; PCA_RELAY_MODE?:string; PCA_MCP_URL?:string; }
const schemas=new Map(PCA_ASSIST_CONTRACT.tools.map(t=>[t.name,z.fromJSONSchema(JSON.parse(JSON.stringify(t.inputSchema)))]));
export function relayEnabled(env:PcaRelayEnv):boolean {return env.PCA_RELAY_ENABLED==='true'&&env.PCA_RELAY_MODE==='public_debug'&&!!env.PCA_MCP_URL;}
function target(env:PcaRelayEnv):string {const url=new URL(env.PCA_MCP_URL||'');if(url.protocol!=='https:'||url.pathname!=='/mcp/application-assist'||url.username||url.password||url.search||url.hash)throw new Error('INVALID_RELAY_TARGET');return url.href;}
function stable(value:unknown):string {if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';return JSON.stringify(value);}
async function boundedJson(response:Response):Promise<Record<string,unknown>> {
 if(!response.ok)throw new Error('PCA_HTTP_'+response.status);if(!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('PCA_CONTENT_TYPE');
 const reader=response.body?.getReader();if(!reader)throw new Error('PCA_EMPTY');let size=0,text='';const decoder=new TextDecoder();while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>128*1024){await reader.cancel();throw new Error('PCA_RESPONSE_LIMIT');}text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode()) as Record<string,unknown>;
}
export async function relayTool(env:PcaRelayEnv,name:string,input:unknown,fetcher:typeof fetch=fetch) {
 const unavailable=()=>({isError:true as const,structuredContent:{code:'PAID_SERVICE_UNAVAILABLE',userMessage:'PCA申請準備サービスに接続できません。無料検索は引き続き利用できます。',retryable:true,nextAction:'PCA Webから再開するか、時間をおいて再試行してください。'},content:[{type:'text' as const,text:'PCA申請準備サービスに接続できません。無料検索は引き続き利用できます。'}]});
 if(!relayEnabled(env))return unavailable();
 const schema=schemas.get(name as typeof PCA_ASSIST_CONTRACT.tools[number]['name']);if(!schema)return {isError:true as const,content:[{type:'text' as const,text:'許可されていない中継ツールです。'}]};
 const parsed=schema.safeParse(input);if(!parsed.success)return {isError:true as const,content:[{type:'text' as const,text:'入力項目を確認してください。'}]};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const url=target(env);let requestId=0;
  const rpc=async(method:string,params:unknown)=>{const id=++requestId;const result=await boundedJson(await fetcher(url,{method:'POST',redirect:'manual',signal:controller.signal,headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':PCA_ASSIST_CONTRACT.protocolVersion},body:JSON.stringify({jsonrpc:'2.0',id,method,params})}));if(result.id!==id||result.jsonrpc!=='2.0'||result.error||!result.result||typeof result.result!=='object')throw new Error('PCA_CONTRACT_MISMATCH');return result.result as Record<string,unknown>;};
  const listed=await rpc('tools/list',{});const tools=listed.tools;if(!Array.isArray(tools))throw new Error('PCA_CONTRACT_MISMATCH');const expected=PCA_ASSIST_CONTRACT.tools.find(t=>t.name===name),actual=tools.find((t:Record<string,unknown>)=>t.name===name);if(!actual||stable(actual.inputSchema)!==stable(expected?.inputSchema))throw new Error('PCA_CONTRACT_MISMATCH');
  const result=await rpc('tools/call',{name,arguments:parsed.data});if(!Array.isArray(result.content)||typeof result.isError!=='boolean')throw new Error('PCA_CONTRACT_MISMATCH');
  return {isError:result.isError,structuredContent:result.structuredContent as Record<string,unknown>|undefined,content:result.content as {type:'text';text:string}[]};
 }catch(error){const result=unavailable(),message=error instanceof Error?error.message:'';return {...result,structuredContent:{...result.structuredContent,reasonCode:/^PCA_(?:HTTP_\d{3}|CONTENT_TYPE|CONTRACT_MISMATCH|RESPONSE_LIMIT|EMPTY)$/.test(message)?message:'PCA_TRANSPORT_ERROR'}};}finally{clearTimeout(timer);}
}
export function registerPcaRelay(server:McpServer,env:PcaRelayEnv) {
 if(!relayEnabled(env))return;
 for(const tool of PCA_ASSIST_CONTRACT.tools){const schema=schemas.get(tool.name) as z.ZodObject;
  server.registerTool(tool.name,{description:'PCA公開デバッグ版へ中継します。回答・結果は通過しますが、案件DBと原本はPCAで保持します。架空資料限定。 '+tool.description,inputSchema:schema.shape,annotations:{...tool.annotations,openWorldHint:true}},async input=>relayTool(env,tool.name,input));
 }
}
