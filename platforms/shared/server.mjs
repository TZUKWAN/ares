import {existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {McpServer, inputRequired, acceptedContent, z} from './sdk.mjs';
import {createPortableAres,PortableAresError} from './core.mjs';
import {hash} from '../../host/storage.js';

const rootsResult=z.object({roots:z.array(z.object({uri:z.string().max(4000),name:z.string().max(400).optional()}).strict()).max(128)}).passthrough();
const confirmationSchema=z.object({confirm:z.boolean().default(false)}).strict();
// The protocol's flat form schema excludes additionalProperties. Keep the
// wire shape restricted, and independently reject extra response fields above.
const confirmationRequestSchema={type:'object',properties:{confirm:{type:'boolean',title:'确认本次操作',default:false}},required:['confirm']};
const digest=(name,args)=>hash({name,args});
export function portableToolResult(value) {
  return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};
}
export function portableToolError(error) {
  const value={ok:false,code:error.code||'operation-failed',message:error.message||String(error),status:error.status||400};
  return {...portableToolResult(value),isError:true};
}

/** Only trusted options select roots/home. Owner actions require a one-use host form response. */
export async function createPortableMcpServer(options={}) {
  const explicitRoots=options.roots||[];
  const core=options.core||createPortableAres(options);
  await core.ready;
  const server=new McpServer({name:'ares',version:'2.4.0'}, {
    capabilities:{tools:{},resources:{}},
    instructions:'ARES manages competition workflows and checked project files. Use the current host native agent/tools to work. Eligible local owner actions require a single-operation host elicitation confirmation and rechecked actual evidence; tool JSON cannot select owner. ARES never creates DSH sessions, arbitrary shell tools or cloud publication rights. Project roots come only from MCP roots/list or explicit startup configuration.',
  });
  let rootsReady=Promise.resolve(), rootsRequested=false, generation=0;
  // One state machine owns roots and confirmation rounds. Opaque nonces carry
  // no authority by themselves: all exact bindings live only in this server.
  const pendingRequests=new Map(),confirmedContexts=new WeakMap();
  const confirmationTtl=options.confirmationTimeoutMs??300000;
  if(!Number.isFinite(confirmationTtl)||confirmationTtl<=0||confirmationTtl>600000)throw new Error('Invalid confirmation timeout');
  const report=error=>(options.onerror||((value)=>console.error('ARES MCP: '+value.message)))(error);
  async function refreshRoots() {
    const current=++generation;
    rootsRequested=true;
    await core.updateAllowedRoots(explicitRoots);
    if(!server.server.getClientCapabilities()?.roots)return;
    try {
      const response=rootsResult.parse(await server.server.listRoots({}, {timeout:15000}));
      if(current===generation)await core.updateAllowedRoots([...explicitRoots,...response.roots]);
    } catch(error) {
      if(current===generation)await core.updateAllowedRoots(explicitRoots);
      report(new Error('客户端 roots/list 未通过，已撤销客户端目录授权：'+error.message));
    }
  }
  server.server.oninitialized=()=>{rootsReady=refreshRoots();rootsReady.catch(report);};
  server.server.setNotificationHandler('notifications/roots/list_changed',()=>{
    rootsReady=refreshRoots();return rootsReady;
  });
  function requestContext(ctx) {
    const envelope=ctx.mcpReq.envelope;
    const modern=(envelope?.['io.modelcontextprotocol/protocolVersion']||server.server.getNegotiatedProtocolVersion())==='2026-07-28';
    const capabilities=envelope?.['io.modelcontextprotocol/clientCapabilities']||server.server.getClientCapabilities();
    const elicitation=capabilities?.elicitation;
    const form=!!elicitation&&(!!elicitation.form||Object.keys(elicitation).length===0);
    return {modern,capabilities,form};
  }
  function inputRound(name,args,row,inputRequests) {
    for(const [nonce,pending] of pendingRequests)if(pending.expires<Date.now())pendingRequests.delete(nonce);
    if(pendingRequests.size>=128)throw new PortableAresError('too-many-confirmations','待处理的交互过多',429);
    const nonce=randomBytes(24).toString('base64url');
    pendingRequests.set(nonce,{...row,hash:digest(name,args)});
    return inputRequired({inputRequests,requestState:nonce});
  }
  async function trustedRoots(name,args,ctx) {
    const {modern,capabilities,form}=requestContext(ctx),state=ctx.mcpReq.requestState();
    let pending=null;
    if(state!==undefined) {
      pending=typeof state==='string'?pendingRequests.get(state):null;
      if(pending)pendingRequests.delete(state); // Consume even when validation fails.
      if(!pending)throw new PortableAresError('invalid-confirmation','交互记录不存在或已经使用；未重新请求确认',403);
      if(pending.expires<=Date.now())throw new PortableAresError('confirmation-expired','单次确认已过期；未执行操作',403);
      if(pending.hash!==digest(name,args))throw new PortableAresError('confirmation-mismatch','确认请求的操作或参数不一致；未执行操作',403);
      if(pending.phase==='confirmation') {
        if(!form)throw new PortableAresError('needs-owner','当前宿主没有声明可用的确认表单能力',403);
        const response=ctx.mcpReq.inputResponses?.aresOwner;
        let accepted;
        try {accepted=acceptedContent(ctx.mcpReq.inputResponses,'aresOwner',confirmationSchema);}
        catch {throw new PortableAresError('invalid-confirmation','宿主确认结果未通过严格校验',403);}
        if(response?.action==='accept'&&accepted===undefined)throw new PortableAresError('invalid-confirmation','宿主确认内容未通过严格校验',403);
        if(response?.action!=='accept'||accepted?.confirm!==true)throw new PortableAresError(response?.action==='cancel'?'confirmation-cancelled':'confirmation-declined','未收到明确的单次操作确认；未执行操作',403);
        const proof={id:hash(state),fingerprint:pending.fingerprint,confirmedAt:new Date().toISOString(),source:'trusted-mcp-host-form'};
        // Obtain current roots AFTER the human-paced form, not before it. The
        // proof remains only in server state through this additional round.
        if(modern&&capabilities?.roots)return inputRound(name,args,{phase:'roots',expires:pending.expires,confirmation:proof},{aresRoots:inputRequired.listRoots()});
        if(modern)await core.updateAllowedRoots(explicitRoots);else {rootsReady=refreshRoots();await rootsReady;}
        confirmedContexts.set(ctx,proof);return null;
      }
      if(pending.phase!=='roots'||ctx.mcpReq.inputResponses?.aresRoots===undefined)throw new PortableAresError('invalid-confirmation','目录交互响应缺失或类型不符',403);
      if(!capabilities?.roots) {await core.updateAllowedRoots(explicitRoots);throw new PortableAresError('scope-denied','宿主目录声明能力已撤销；未执行操作',403);}
      try {const checked=rootsResult.parse(ctx.mcpReq.inputResponses.aresRoots);await core.updateAllowedRoots([...explicitRoots,...checked.roots]);}
      catch(error) {await core.updateAllowedRoots(explicitRoots);throw error;}
      if(pending.confirmation) {
        if(!form)throw new PortableAresError('needs-owner','宿主确认能力已撤销；未执行操作',403);
        confirmedContexts.set(ctx,pending.confirmation);return null;
      }
    } else if(modern) {
      await core.updateAllowedRoots(explicitRoots);
      if(capabilities?.roots)return inputRound(name,args,{phase:'roots',expires:Date.now()+120000},{aresRoots:inputRequired.listRoots()});
    } else {
      if(!rootsRequested)rootsReady=refreshRoots();await rootsReady;
    }
    if(core.ownerActionSupported(name,args)&&form) {
      const snapshot=await core.prepareOwnerApproval(name,args,{signal:ctx.mcpReq.signal});
      return inputRound(name,args,{phase:'confirmation',expires:Date.now()+confirmationTtl,fingerprint:snapshot.fingerprint},{aresOwner:inputRequired.elicit({message:snapshot.summary,requestedSchema:confirmationRequestSchema})});
    }
    return null;
  }
  for(const tool of core.tools())server.registerTool(tool.name,{
    title:tool.title||tool.name,description:tool.description,inputSchema:tool.schema,annotations:tool.annotations,
  },async(args,ctx)=>{
    try {
      const required=await trustedRoots(tool.name,args,ctx);if(required)return required;
      const confirmation=confirmedContexts.get(ctx);confirmedContexts.delete(ctx);
      let result=confirmation
        ?await core.dispatchConfirmed(tool.name,args,confirmation,{signal:ctx.mcpReq.signal})
        :await core.dispatch(tool.name,args,{principal:'agent',signal:ctx.mcpReq.signal});
      if(tool.name==='ares_capabilities')result={...result,hostConfirmation:{protocolAvailable:requestContext(ctx).form,scope:'one-exact-local-operation',identityAuthentication:false,unsupportedCloudActions:true}};
      if(confirmation)result={...result,hostConfirmation:{id:confirmation.id,fingerprint:confirmation.fingerprint,confirmedAt:confirmation.confirmedAt,source:confirmation.source,identityAuthentication:false}};
      return portableToolResult(result);
    } catch(error) {return portableToolError(error);}
  });
  let uiRegistration=null;
  const uiOptions={...options,prepareToolCall:trustedRoots};
  if(options.uiRegistrar)uiRegistration=await options.uiRegistrar(server,core,uiOptions);
  else if(options.ui!==false) {
    const moduleUrl=new URL('../ui-server.mjs',import.meta.url);
    if(existsSync(fileURLToPath(moduleUrl))) {
      const {registerPortableUi}=await import(moduleUrl.href);
      if(typeof registerPortableUi!=='function')throw new Error('Portable UI module does not export registerPortableUi');
      uiRegistration=await registerPortableUi(server,core,uiOptions);
    } else if(options.requireUi)throw new Error('Portable UI module is missing: '+fileURLToPath(moduleUrl));
    else report(new Error('可选 UI 模块尚未打包；MCP 工具可用，嵌入界面未注册'));
  }
  const close=server.close.bind(server);
  server.close=async()=>{pendingRequests.clear();core.dispose();await close();};
  return {server,core,refreshRoots,uiRegistration};
}
