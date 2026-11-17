import {samePath} from './path-identity.js';
import {inspectNativeSession,nativeSessionAvailable} from './native-session.js';
/** Persistent editing channel. This does not implement a model/message loop. */
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {AresError,clone,hash,home,readJson,atomicJson,safePath,now} from './storage.js';
import {readConfiguration,validateConfiguration,skillCatalog,ROOT,text,defaults} from './catalog.js?v=2.3.0-directory1';
import {applyEdits,editorOperations} from './editor-operations.js?v=2.3.0-directory1';
import {EDITOR_PRESET_ID} from './editor-definition.js';
import {executionState,assertIdle,configurationOwner,humanAuthorization} from './agent-state.js';
import {libraryInfo,libraryEntries,searchLibrary,materializeLibrarySkill} from './skill-library.js';
import {loadPackage,readPackageResource} from './skill-packages.js';
import {prepareSkillEdits} from './editor-skill-operations.js?v=2.3.0-directory1';
import {runNativeHealth} from './native-health.js?v=2.3.0-healthfix1';

export function createEditorWorkspace(ctx={},native={}){
 const serviceInstanceId=randomUUID();
 const directory=()=>join(home(),'ares-editor',hash({home:resolve(home()),root:ROOT}).slice(0,16));
 const file=()=>join(directory(),'current.json');
 const cwd=()=>join(directory(),'session');
 let alive=true,queue=Promise.resolve(),healthRunning=false;
 function assertWorkspaceIdle(sessionId){if(healthRunning)throw new AresError('ARES原生工具体检仍在执行，请结束后保存或新建对话',409);assertIdle(ctx,sessionId);}
 function serialized(fn){const work=queue.catch(()=>{}).then(()=>{if(!alive)throw new AresError('ARES编辑服务已卸载',503);return fn();});queue=work.catch(()=>{});return work;}
 function controller(){const value=ctx.get?.('sessionController');if(!nativeSessionAvailable(ctx))throw new AresError('DSH原生会话服务尚未就绪',503);return value;}
 function load(){const record=readJson(file(),null);if(record&&(record.schema_version!==1||!record.channelId||!Number.isInteger(record.revision)||!record.editor))throw new AresError('ARES编辑会话记录损坏，未替换为其他会话',409);return record;}
 function save(record){record.updatedAt=now();atomicJson(file(),record);return record;}
 function checkedContext(body){
  const configuration=clone(body.configuration||readConfiguration());
  if(configuration.schema_version!==2||!Number.isInteger(configuration.revision)||!Array.isArray(configuration.workflows)||configuration.workflows.length>100||!Array.isArray(configuration.skills)||configuration.workflows.some(workflow=>typeof workflow.id!=='string'||!Array.isArray(workflow.steps)||!workflow.steps.length||workflow.steps.length>40)||Buffer.byteLength(JSON.stringify(configuration))>8*1024*1024)throw new AresError('ARES编辑草稿结构无效');
  let validationError=null;try{validateConfiguration(configuration);}catch(error){validationError=error.message;}
  const workflowId=configuration.workflows.length?(body.workflowId||configuration.workflows[0].id):null,workflow=configuration.workflows.find(item=>item.id===workflowId);
  if(workflowId&&!workflow)throw new AresError('选中的ARES流程不存在');
  if(workflow&&body.activeStepId&&!workflow.steps.some(item=>item.id===body.activeStepId))throw new AresError('选中的步骤不属于当前流程');
  if(body.selectedSkillId&&!skillCatalog(configuration,{content:false,tolerant:true}).some(item=>item.id===body.selectedSkillId)&&!libraryEntries().some(item=>item.id===body.selectedSkillId))throw new AresError('选中的技能不存在');
  return {configuration,hash:hash(configuration),contextToken:body.contextToken||randomUUID(),workflowId,activeStepId:workflow?(body.activeStepId||workflow.steps[0].id):null,selectedSkillId:body.selectedSkillId||null,validationError};
 }
 async function toolSurface(record){
  const agent=record?.sessionId?ctx.get?.('agents')?.get(record.sessionId):null;
  if(!agent)return {ready:false,pending:true,visibleCount:null,missing:[],message:'原生会话激活后核验实际工具目录。'};
  try{if(typeof native.inspectEditorTools!=='function')throw new Error('DSH原生工具检查服务尚未就绪');return await native.inspectEditorTools(agent);}
  catch(error){return {ready:false,pending:false,visibleCount:null,missing:[],message:'无法核验ARES原生工具目录：'+error.message};}
 }
 async function publicState(record,afterRevision){
  const execution=executionState(ctx,record?.sessionId);if(healthRunning)Object.assign(execution,{running:true,status:'running',nativeHealthRunning:true});
  const frame={protocolVersion:5,serviceInstanceId,toolSurface:await toolSurface(record),execution,contextToken:record?.editor.contextToken||null};
  if(!record)return {...frame,sessionId:null,revision:0,needsSession:true};
  if(afterRevision===record.revision)return {...frame,sessionId:record.sessionId,revision:record.revision,unchanged:true};
  return {...frame,channelId:record.channelId,sessionId:record.sessionId,revision:record.revision,target:'ares-configuration',presetId:EDITOR_PRESET_ID,lastSaved:record.lastSaved||null,proposal:record.proposal?{...clone(record.proposal),stale:record.proposal.baseHash!==record.editor.hash}:null};
 }
 function capability(){return {version:5,transport:'dsh-native-session',target:'ares-configuration',requiresWorkspaceSelection:false,toolInspection:typeof native.inspectEditorTools==='function',available:nativeSessionAvailable(ctx)&&typeof native.forEditor==='function'&&typeof native.inspectEditorTools==='function'};}
 async function checkSession(sessionId){
  if(typeof sessionId!=='string'||!sessionId||sessionId.length>200)throw new AresError('原生会话标识无效');
  const value=await inspectNativeSession(ctx,sessionId),preset=value.events?.filter(e=>e.type==='agent-preset/selected').at(-1)?.data?.agentPreset||value.meta?.agentPreset;
  if(value.meta?.id!==sessionId||preset!==EDITOR_PRESET_ID||!samePath(value.meta?.cwd,cwd()))throw new AresError('会话未绑定ARES配置编辑目录或原生编辑模式',409);
  const agents=ctx.get?.('agents');let agent=agents?.get?.(sessionId);
  if(!agent){if(typeof controller().resolveAgent!=='function')throw new AresError('DSH冷会话恢复接口尚未就绪',503);const result=await controller().resolveAgent(sessionId);if(result.error)throw result.error;agent=result.agent;}
  if(!agent||agents?.get?.(sessionId)!==agent||agent.session?.header?.id!==sessionId)throw new AresError('ARES原生Agent恢复身份不符',409);
  if(agent.status==='idle')await native.refreshEditor?.(agent);return value;
 }
 function update(record,editor){if(record.proposal&&hash(record.proposal.configuration)===editor.hash)record.proposal=null;if(record.editor?.hash===editor.hash){editor.contextToken=record.editor.contextToken||editor.contextToken;if(record.proposal?.baseHash===editor.hash)record.proposal.baseToken=editor.contextToken;}record.editor=editor;record.revision++;return record;}
 async function open(body={}){return serialized(async()=>{controller();if(typeof native.forEditor!=='function')throw new AresError('DSH原生编辑模式尚未就绪',503);await native.forEditor();const editor=checkedContext(body);let record=load();if(record?.sessionId)await checkSession(record.sessionId);if(!record)record={schema_version:1,channelId:randomUUID(),bindingToken:randomUUID(),revision:0,sessionId:null,editor,proposal:null};update(record,editor);mkdirSync(cwd(),{recursive:true});save(record);return {...await publicState(record),cwd:cwd(),bindingToken:record.bindingToken,needsSession:!record.sessionId};});}
 async function bind(body){return serialized(async()=>{const record=load();if(!record||body.bindingToken!==record.bindingToken)throw new AresError('编辑会话连接已变化，请重新连接',409);if(record.sessionId&&record.sessionId!==body.sessionId)throw new AresError('编辑通道已绑定另一会话',409);await checkSession(body.sessionId);record.sessionId=body.sessionId;record.revision++;save(record);return publicState(record);});}
 async function sync(body){return serialized(()=>{const record=load();if(!record||body.expectedRevision!==record.revision)throw new AresError('编辑上下文已更新，请保留当前草稿并重新同步',409);update(record,checkedContext(body));save(record);return publicState(record);});}
 function owned(agent){const record=load();if(!record?.sessionId)throw new AresError('此会话不是当前ARES配置编辑会话，请从ARES工作台恢复',409);const owner=configurationOwner(ctx,record.sessionId,agent);if(!samePath(owner.session?.header?.cwd,cwd()))throw new AresError('ARES编辑根目录不符',409);return record;}
 function effective(record){return record.proposal?.baseHash===record.editor.hash?record.proposal.configuration:record.editor.configuration;}
 async function read(agent,args,signal){const record=owned(agent);signal?.throwIfAborted();const c=effective(record),w=c.workflows.find(w=>w.id===(args.workflowId||record.editor.workflowId));
  if(args.kind==='context')return {revision:record.revision,serviceInstanceId,target:'ARES配置编辑',workspaceSelectionRequired:false,templates:defaults().workflows.map(({id,title,pipeline})=>({id,title,pipeline})),toolkitRoot:ROOT,sessionCwd:cwd(),workflowId:record.editor.workflowId,activeStepId:record.editor.activeStepId,selectedSkillId:record.editor.selectedSkillId,validationError:record.editor.validationError,workflows:c.workflows.map(({id,title,pipeline,steps})=>({id,title,pipeline,steps:steps.map(({id,title,skills})=>({id,title,skills}))})),proposal:record.proposal?{id:record.proposal.id,stale:record.proposal.baseHash!==record.editor.hash}:null,policy:'工作台配置通过提案修改；源码、资料读取和验证使用DSH原生工具。无需选择比赛工作区。'};
  if(args.kind==='operations'){if(args.operation&&!editorOperations[args.operation])throw new AresError('未知操作');return {revision:record.revision,operations:args.operation?{[args.operation]:editorOperations[args.operation]}:editorOperations};}
  if(args.kind==='workflow'){if(!w)throw new AresError('流程不存在');return {revision:record.revision,workflow:clone(w)};}
  if(args.kind==='step'){const s=w?.steps.find(s=>s.id===(args.stepId||record.editor.activeStepId));if(!s)throw new AresError('步骤不存在');return {revision:record.revision,step:clone(s)};}
  const offset=args.offset??0,limit=args.limit??6000;if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>12000)throw new AresError('读取分页无效');
  if(args.kind==='library')return {revision:record.revision,library:libraryInfo()};
  if(args.kind==='skills')return {revision:record.revision,...searchLibrary(skillCatalog(c,{content:false,tolerant:true}),{query:args.query,source:args.source,offset,limit:Math.min(limit,12)})};
  if(args.kind==='skill'||args.kind==='resources'){
   const id=args.id||record.editor.selectedSkillId;let s=skillCatalog(c,{ids:new Set([id])}).find(item=>item.id===id);
   if(!s&&String(id).startsWith('library-')){const loaded=await materializeLibrarySkill(id,{signal});s={...loaded.skill,root:loaded.pack.root,content:loaded.pack.content,origin:loaded.pack.origin};}
   if(!s)throw new AresError('技能不存在');
   if(args.kind==='resources'){if(!s.packageId)return {revision:record.revision,id,files:[],message:'此技能尚未打包；按已知相对路径读取内置资源，或导入真实技能包。'};const pack=loadPackage(s.packageId),files=pack.files.slice(offset,offset+Math.min(limit,12));return {revision:record.revision,id,files,total:pack.files.length,nextOffset:offset+files.length<pack.files.length?offset+files.length:null};}
   let content=s.content,bodyHash=hash(content);
   if(args.path){if(!s.root)throw new AresError('此自定义技能没有附属资源');if(s.packageId){const resource=readPackageResource(s.packageId,args.path);if(resource.binary)return {revision:record.revision,id,path:args.path,binary:true,bytes:resource.bytes,bodyHash:resource.bodyHash,verification:'binary-preserved-not-interpreted'};content=resource.content;bodyHash=resource.bodyHash;}
    else{const full=safePath(s.root,args.path,{existing:true});if(!/\.(md|txt|json|py|js|mjs|yaml|yml|css|html|r|sql)$/i.test(full))throw new AresError('只支持文本资源读取');const bytes=readFileSync(full);if(bytes.length>4*1024*1024)throw new AresError('资源过大');content=bytes.toString('utf8');bodyHash=hash(bytes);}
   }
   if(s.packageId&&!args.path&&offset===0)await serialized(()=>{signal?.throwIfAborted();const latest=owned(agent);latest.readReceipts={...latest.readReceipts,[id]:s.packageId};save(latest);});
   return {revision:record.revision,id:s.id,source:s.source,origin:s.origin,packageId:s.packageId,content:content.slice(offset,offset+limit),bodyHash,total:content.length,nextOffset:offset+limit<content.length?offset+limit:null,verification:'read-only-not-executed'};
  }
  throw new AresError('不支持的配置读取类型');
 }
 async function propose(agent,args,signal){return serialized(async()=>{const record=owned(agent);if(args.expectedRevision!==record.revision)throw new AresError('ARES草稿已变化，请重新读取context后修改',409);if(record.proposal&&record.proposal.baseHash!==record.editor.hash&&!args.replaceProposal)throw new AresError('人工草稿已变化，请重新读取并明确replaceProposal',409);signal?.throwIfAborted();const base=args.replaceProposal?record.editor.configuration:effective(record),owner=configurationOwner(ctx,record.sessionId,agent),prepared=await prepareSkillEdits(base,args.workflowId||record.editor.workflowId,args.edits,{signal,authorization:humanAuthorization(owner),readReceipts:record.readReceipts||{}});signal?.throwIfAborted();
  if(!prepared.edits.length&&prepared.libraryChanges.length){record.revision++;save(record);return {revision:record.revision,status:'library-index-updated',libraryChanges:prepared.libraryChanges,librarySaved:true,applied:false,saved:false,message:'真实技能来源索引已更新；未修改或保存工作流配置，未执行来源脚本。'};}
  const next=applyEdits(base,args.workflowId||record.editor.workflowId,prepared.edits);record.proposal={id:randomUUID(),baseHash:record.editor.hash,baseToken:record.editor.contextToken,configuration:next,configurationHash:hash(next),workflowId:args.workflowId||record.editor.workflowId,edits:clone(args.edits),createdAt:now()};record.revision++;save(record);return {revision:record.revision,proposalId:record.proposal.id,status:'pending-editor-review',applied:false,saved:false,libraryChanges:prepared.libraryChanges,message:'已生成ARES待审提案；刘总点击保存并生效后才正式提交。技能包暂存不等于依赖安装或任务运行。'};});}
 function checkedProposal(body){const record=load();if(!record?.proposal||record.revision!==body.expectedRevision||record.proposal.id!==body.proposalId||record.proposal.baseHash!==hash(body.configuration)||record.proposal.baseHash!==record.editor.hash||record.proposal.baseToken!==record.editor.contextToken||body.contextToken!==undefined&&body.contextToken!==record.editor.contextToken)throw new AresError('提案或人工草稿已变化，请重新查看差异',409);assertWorkspaceIdle(record.sessionId);return record;}
 async function review(body){return serialized(()=>{const record=checkedProposal(body);return {configuration:clone(record.proposal.configuration),proposalId:record.proposal.id,revision:record.revision,saved:false};});}
 async function saveProposal(body){return serialized(async()=>{
  const record=checkedProposal(body);if(body.configurationHash!==record.proposal.configurationHash)throw new AresError('提案正文指纹已变化',409);
  if(typeof native.commitConfiguration!=='function')throw new AresError('ARES统一保存服务尚未就绪',503);
  const result=await native.commitConfiguration(record.proposal.configuration,body.expectedConfigurationRevision,{beforeCommit:()=>{checkedProposal(body);}});
  const configuration=result.configuration,proposalId=record.proposal.id,workflow=configuration.workflows.find(item=>item.id===record.editor.workflowId)||configuration.workflows[0];
  const activeStepId=workflow?.steps.some(item=>item.id===record.editor.activeStepId)?record.editor.activeStepId:workflow?.steps[0]?.id||null;
  const selectedSkillId=skillCatalog(configuration,{content:false}).some(item=>item.id===record.editor.selectedSkillId)?record.editor.selectedSkillId:null;
  record.editor=checkedContext({...record.editor,configuration,workflowId:workflow?.id||null,activeStepId,selectedSkillId,contextToken:randomUUID()});
  record.proposal=null;record.lastSaved={proposalId,configurationRevision:configuration.revision,at:now()};record.revision++;
  let warning=result.warning||null;try{save(record);}catch(error){warning=[warning,'配置已保存，但助手回执保存失败：'+error.message].filter(Boolean).join('；');}
  return {...await publicState(record),savedConfiguration:configuration,warning};
 });}
 async function dismiss(body){return serialized(()=>{const record=load();if(!record?.proposal||record.revision!==body.expectedRevision||record.proposal.id!==body.proposalId)throw new AresError('提案已更新',409);assertWorkspaceIdle(record.sessionId);record.proposal=null;record.revision++;save(record);return publicState(record);});}
 async function newConversation(body){return serialized(async()=>{controller();const old=load();assertWorkspaceIdle(old?.sessionId);if(typeof native.forEditor!=='function')throw new AresError('DSH原生编辑模式尚未就绪',503);await native.forEditor();if(old)atomicJson(join(directory(),'history',old.channelId+'.json'),old);const editor=checkedContext(body),record={schema_version:1,channelId:randomUUID(),bindingToken:randomUUID(),revision:1,sessionId:null,editor,proposal:null};mkdirSync(cwd(),{recursive:true});save(record);return {...await publicState(record),cwd:cwd(),bindingToken:record.bindingToken,needsSession:true};});}
 async function healthCheck(_body={},options={}){
  let selected;
  await serialized(async()=>{const record=load();if(!record?.sessionId)throw new AresError('请先在ARES流程配置中连接原生编辑助手，再运行工具体检',409);assertWorkspaceIdle(record.sessionId);const agent=ctx.get?.('agents')?.get?.(record.sessionId);if(!agent||agent.session?.header?.id!==record.sessionId||!samePath(agent.session.header.cwd,cwd()))throw new AresError('真实ARES编辑Agent尚未连接，未创建替代会话',409);await native.forEditor?.();await native.refreshEditor?.(agent);const surface=await toolSurface(record);assertWorkspaceIdle(record.sessionId);healthRunning=true;selected={agent,surface};});
  try{return {report:await runNativeHealth(ctx,selected.agent,selected.surface,{...options,expectedServiceId:serviceInstanceId})};}finally{healthRunning=false;}
 }
 function healthReadiness(){try{if(!alive||!capability().available)return {ready:false,reason:'等待原生配置服务就绪'};const record=load(),agent=record?.sessionId?ctx.get?.('agents')?.get?.(record.sessionId):null;if(!record?.sessionId||!agent||agent.session?.header?.id!==record.sessionId)return {ready:false,reason:'等待现有ARES编辑会话连接，不创建替代会话'};const state=executionState(ctx,record.sessionId);if(healthRunning||state.running!==false)return {ready:false,reason:state.running?'等待ARES助手或后台任务结束':'等待真实执行状态确认'};return {ready:true,sessionId:record.sessionId};}catch{return {ready:false,reason:'ARES编辑状态尚未确认'};}}
 return {healthCheck,healthReadiness,capability,open,bind,sync,read,propose,review,saveProposal,dismiss,newConversation,state:afterRevision=>publicState(load(),afterRevision),assertIdle:()=>assertWorkspaceIdle(load()?.sessionId),dispose(){alive=false;}};
}
