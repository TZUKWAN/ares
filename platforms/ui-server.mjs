/** MCP Apps surface; every call uses the same agent/roots boundary as text tools. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from './shared/sdk.mjs';
import {portableToolResult,portableToolError} from './shared/server.mjs';

export const ARES_UI_URI='ui://ares/workbench.html';
export function registerPortableUi(server,core,options={}){
 const assets=[],files=[];
 for(const file of ['orb.mp4','orb.jpg','jellyfish.mp4','jellyfish.jpg']){
  const bytes=readFileSync(new URL('../assets/neural-reference/'+file,import.meta.url)),mimeType=file.endsWith('.mp4')?'video/mp4':'image/jpeg',chunks=[];
  for(let start=0,part=0;start<bytes.length;start+=512*1024,part++){
   const uri='ares://media/'+file+'/part/'+part,blob=bytes.subarray(start,start+512*1024).toString('base64');chunks.push(uri);
   assets.push(server.registerResource('ares-media-'+file+'-'+part,uri,{mimeType},async()=>({contents:[{uri,mimeType,blob}]})));
  }
  files.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mimeType,chunks});
 }
 assets.push(server.registerResource('ares-media-index','ares://media/index',{mimeType:'application/json'},async()=>({contents:[{uri:'ares://media/index',mimeType:'application/json',text:JSON.stringify({files})}]})));
 const meta={ui:{resourceUri:ARES_UI_URI,surface:'workbench',visibility:['model','app']}};
 const resourceMeta={ui:{prefersBorder:false,csp:{connectDomains:[],resourceDomains:[]}}};
 const resource=server.registerResource('ares-workbench',ARES_UI_URI,{title:'ARES 竞赛工作台',mimeType:'text/html;profile=mcp-app',_meta:resourceMeta},async()=>({contents:[{uri:ARES_UI_URI,mimeType:'text/html;profile=mcp-app',text:readFileSync(new URL('./ui/workbench.html',import.meta.url),'utf8'),_meta:resourceMeta}]}));
 const tool=server.registerTool('ares_workbench',{
  title:'ARES 工作台',description:'Open the real competition workflow and project workbench in MCP Apps-compatible hosts. Hosts without UI can use the same ARES tools. No model, owner approval or arbitrary file access is added.',
  inputSchema:z.object({root:z.string().max(2000).optional(),workspace:z.enum(['projects','composer']).optional()}).strict(),
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},_meta:meta,
 },async(args,ctx)=>{
  try{
   const required=await options.prepareToolCall?.('ares_workbench',args,ctx);if(required)return required;
   const capabilities=await core.dispatch('ares_capabilities',{}, {principal:'agent',signal:ctx.mcpReq.signal});
   if(args.root)await core.dispatch('ares_project',{action:'status',root:args.root},{principal:'agent',signal:ctx.mcpReq.signal});
   return portableToolResult({workspace:args.workspace||'projects',root:args.root||capabilities.roots[0]||null,host:capabilities.host,roots:capabilities.roots,uiResource:ARES_UI_URI,nativeAssistant:'Use the current host conversation and tools; the plugin does not start a model loop.',ownerApproval:'Eligible local actions require one-exact-operation confirmation from the trusted host; model arguments and the UI cannot self-approve.'});
  }catch(error){return portableToolError(error);}
 });
 return {uri:ARES_UI_URI,dispose(){resource.remove();tool.remove();for(const item of assets)item.remove();}};
}
