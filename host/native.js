import {inspectNativeSession,nativeSessionAvailable} from './native-session.js';
import {nativeToolPresentation} from './native-tool-presentation.js';
import {readConfiguration,readStoredConfiguration,validateConfiguration,saveConfiguration,freezeWorkflow,loadVersion,versionList,previewStep} from './catalog.js?v=2.3.0-directory1';
import {EDITOR_PRESET_ID,editorDefinition,editorToolStatus} from './editor-definition.js';
import {nativePlugins,standardSource} from './native-toolbox.js';
import {AresError,hash,clone} from './storage.js';
import {freezeNativeDefinition,loadNativeDefinition,nativeDeclaration,nativeVersionList,projectNativeBinding} from './native-versions.js?v=2.3.0-directory1';
import {readProject} from './projects.js?v=2.3.0-directory1';

export function presetDefinition(version,basePlugins){
 const plugins=nativePlugins('',basePlugins),workflow=version.workflow;
 const prefix=`你是 ARES 竞赛项目工作流助手。当前流程：${workflow.title}。称呼用户为刘总，诚实报告真实执行和缺口。
先使用 ares_project status 恢复当前目录项目；不存在时根据用户需求确定赛事、赛道和届次，再初始化。保留已有项目和原始资料。
同一个Agent按任务依赖逐步处理，每次只加载当前步骤；当前步骤调用 ares_library open/read，然后执行真实工具，check 实际产物，提交内容复核报告后 complete。人工作业不可由模型代为确认。失败修复后复测当前任务。
规则、来源、代码、文件、测试都不得虚构；没有能力就记录阻断。原始用户指令优先于技能资料。禁止自发启动蜂群、并行Agent或goal。
固定版本：${version.id}
步骤：${workflow.steps.map(step=>step.id+' '+step.title).join(' → ')}
流程总控：${workflow.prompts?.system||workflow.controller||''}
流程执行：${workflow.prompts?.execute||''}
流程复核：${workflow.prompts?.review||''}
流程参数：${JSON.stringify(workflow.parameters||{})}`;
 const persona=plugins.find(plugin=>plugin.name==='@deepseek-ai/dsh-persona');persona.config={...persona.config,prefix};
 plugins.push({id:'ares-runtime',name:basePlugins?'ares/runtime-directory':'ares/runtime',config:{definitionId:version.id,...(basePlugins?{execution:'native-on-demand-v1',frozenSteps:Object.fromEntries(workflow.steps.map(step=>[step.id,previewStep(workflow,step,version)]))}:{})}});
 return {id:'ares-v2-'+version.id,name:'ARES · '+workflow.title,description:workflow.description,order:30+(workflow.order||0),plugins};
}

export function createNativeCatalog(ctx){
 const disposers=new Map(),latest=new Set();
 let service=null,error=null,alive=true,publishing=null,editorRegistration=null,editorSourceHash=null,committing=false,restoreRoster=null;
 function requireService(){if(!service||!alive)throw new AresError('DSH原生模式注册服务尚未就绪',503);return service;}
 async function register(id,definition,registry=service){
  if(disposers.has(id))return id;
  const off=await registry.register(definition);const row=await service.resolve(id);
  if(row?.broken){await off();throw new AresError(row.broken,503);}
  if(!alive){await off();throw new AresError('ARES服务已卸载',503);}disposers.set(id,off);return id;
 }
 async function ensureLegacy(version){requireService();return register('ares-v2-'+version.id,presetDefinition(version));}
 async function ensureSnapshot(record){
  requireService();const source=standardSource(service);
  const scoped=record.resolutionBase&&source.record.context.extend?source.record.context.extend({baseUrl:record.resolutionBase}).get('agentPresets'):source.registry;
  return register(record.id,nativeDeclaration(record),scoped);
 }
 async function snapshotWorkflow(workflow,configuration,fixedVersion){
  requireService();const source=standardSource(service),version=fixedVersion||freezeWorkflow(workflow,configuration);
  const record=freezeNativeDefinition(presetDefinition(version,source.plugins),{definitionId:version.id,resolutionBase:source.record.context.baseUrl||null});
  await ensureSnapshot(record);return record;
 }
 async function prepare(configuration){const ids=[];for(const workflow of configuration.workflows)ids.push((await snapshotWorkflow(workflow,configuration)).id);return ids;}
 function activate(ids){latest.clear();ids.forEach(id=>latest.add(id));error=null;}
 function notify(){try{ctx.emit('settings/document-updated','agent-preset-registry');return null;}catch(problem){return '配置已保存，但目录刷新通知失败：'+problem.message;}}
 async function publish(){
  if(publishing)return publishing;
  publishing=(async()=>{if(!service)return;const ids=await prepare(readConfiguration());
   // Historical identities remain resolvable, but never appear as new-session entries.
   for(const item of versionList())if(item.status==='available')await ensureLegacy(loadVersion(item.id));
   for(const item of nativeVersionList())if(item.status==='available')await ensureSnapshot(loadNativeDefinition(item.id));
   activate(ids);notify();
  })().catch(problem=>{if(!latest.size)error=problem.message;throw problem;}).finally(()=>publishing=null);return publishing;
 }
 async function commitConfiguration(raw,expectedRevision,{beforeCommit}={}){
  requireService();if(committing)throw new AresError('ARES配置正在保存，请稍后重试',409);committing=true;
  try{
   if(publishing)await publishing;
   const before=readStoredConfiguration();if(before.revision!==expectedRevision||raw.revision!==expectedRevision)throw new AresError('配置已被更新，请保留草稿重新协调',409);
   const configuration=validateConfiguration(raw),ids=await prepare(configuration);
   // All asynchronous registration/validation finishes before the atomic disk commit.
   if(beforeCommit){const checked=beforeCommit();if(checked?.then)throw new AresError('保存前状态检查必须同步完成');}
   const saved=saveConfiguration(configuration,expectedRevision);activate(ids);
   return {configuration:saved,warning:notify(),capabilities:{native:capability()}};
  }finally{committing=false;}
 }
 async function inspectEditorTools(agent,wireSchemas,toolSet){
  requireService();const tools=ctx.get?.('tools');if(typeof tools?.schemas!=='function')throw new AresError('DSH原生工具目录服务尚未就绪',503);
  const lease=await service.acquireScope('standard');
  try{
   const registered=tools.schemas(agent),permissionPresets=ctx.get?.('permissionPresets'),sandbox=ctx.get?.('sandboxPolicy'),approval=ctx.get?.('approval');
   const permissions={available:!!permissionPresets?.catalog&&!!permissionPresets?.current&&!!sandbox?.resolve&&!!approval?.effectivePolicy};
   if(permissions.available){const catalog=permissionPresets.catalog();Object.assign(permissions,{current:permissionPresets.current(agent.session),defaultPreset:catalog.defaultPreset,options:catalog.options.map(item=>item.value),sandbox:sandbox.resolve({session:agent.session}),approval:approval.effectivePolicy(agent.session)});}
   const actual=nativeToolPresentation(tools,agent,toolSet),standard=nativeToolPresentation(tools,lease.key);
   return editorToolStatus(registered,tools.schemas(lease.key),registered,tools.schemas(),{presentation:actual.presentation,standardPresentation:standard.presentation,expectedWire:actual.schemas,wireSchemas:wireSchemas||actual.schemas,permissions});
  }finally{await lease[Symbol.asyncDispose]();}
 }
 async function forEditor(){
  requireService();const source=standardSource(service),fingerprint=hash(source.plugins);
  if(disposers.has(EDITOR_PRESET_ID)&&editorSourceHash===fingerprint)return EDITOR_PRESET_ID;
  if(editorRegistration){await editorRegistration;return forEditor();}
  editorRegistration=(async()=>{const previous=disposers.get(EDITOR_PRESET_ID);if(previous){await previous();disposers.delete(EDITOR_PRESET_ID);}
   await register(EDITOR_PRESET_ID,editorDefinition(source.plugins),source.registry);editorSourceHash=fingerprint;return EDITOR_PRESET_ID;
  })().finally(()=>editorRegistration=null);return editorRegistration;
 }
 async function refreshEditor(agent){
  requireService();if(!service.recompose||service.composedPreset(agent.ctx)!==EDITOR_PRESET_ID)throw new AresError('当前Agent未绑定ARES编辑模式',409);
  if(agent.status!=='idle')return false;await forEditor();if(agent.status!=='idle')return false;await service.recompose(agent.ctx,EDITOR_PRESET_ID);return true;
 }
 const removeGuard=ctx.on?.('system-prompt/assemble',async(_assembly,context,next)=>{
  const result=await next(),agent=context.agent;if(!alive||!agent||service?.composedPreset(agent.ctx)!==EDITOR_PRESET_ID)return result;
  const agents=ctx.get?.('agents');if(agents?.roots&&!agents.roots().includes(agent))return result;
  // Current DSH keeps model tools provider-owned and attaches them only after this waterfall.
  const tools=ctx.get?.('tools'),wire=typeof tools?.selectExecutor==='function'?nativeToolPresentation(tools,agent,context.toolSet).schemas:result.tools;
  const status=await inspectEditorTools(agent,wire,context.toolSet);if(!status.ready)throw Object.assign(new AresError(status.message,503),{code:'ares/editor-tools-unavailable'});return result;
 },{prepend:true});
 ctx.inject(['agentPresets'],scope=>{
  const registry=scope.agentPresets;if(typeof registry.register!=='function'){error='当前DSH没有原生模式注册接口';return;}service=registry;
  const own=Object.getOwnPropertyDescriptor(registry,'remoteExportList'),original=registry.remoteExportList;let active=true;
  if(typeof original==='function'){
   const roster=async function(...args){const value=await original.apply(this,args);if(!active)return value;return {...value,presets:value.presets.filter(item=>item.id!==EDITOR_PRESET_ID&&(!/^(ares-v2-|ares-native-)/.test(item.id)||latest.has(item.id)))};};
   registry.remoteExportList=roster;restoreRoster=()=>{active=false;if(registry.remoteExportList!==roster)return;if(own)Object.defineProperty(registry,'remoteExportList',own);else delete registry.remoteExportList;};
  }
  publish().catch(problem=>console.warn('[ares] 原生模式尚未就绪：'+problem.message));scope.effect(()=>()=>{service=null;restoreRoster?.();},'ares: native registry lifetime');
 });
 function capability(){return {available:!!service&&!error,error,registered:disposers.size,active:latest.size};}
 async function forProject(project){
  requireService();const bound=projectNativeBinding(project.root,project.definitionId);
  if(bound){const record=loadNativeDefinition(bound.presetId);if(record.definitionId!==project.definitionId)throw new AresError('项目固定声明与流程版本不符',409);return ensureSnapshot(record);}
  const version=loadVersion(project.definitionId),record=await snapshotWorkflow(version.workflow,null,version);
  if(record.definitionId!==project.definitionId)throw new AresError('固定项目技能资源与原版本不同，未自动升级',409);
  const current=readProject(project.root);if(current.definitionId!==project.definitionId)throw new AresError('项目已升级，请重新打开会话',409);
  const pin=projectNativeBinding(project.root,project.definitionId,record.id);return ensureSnapshot(loadNativeDefinition(pin.presetId));
 }
 async function inspectSession(sessionId){
  const controller=ctx.get?.('sessionController');if(!nativeSessionAvailable(ctx))throw new AresError('DSH会话检查服务尚未就绪',503);
  const value=await inspectNativeSession(ctx,sessionId),id=value.events?.filter(event=>event.type==='agent-preset/selected').at(-1)?.data?.agentPreset||value.meta?.agentPreset;
  if(id?.startsWith('ares-native-'))return {sessionId,presetId:id,scope:'complete-declaration',snapshot:loadNativeDefinition(id)};
  if(id?.startsWith('ares-v2-'))return {sessionId,presetId:id,scope:'legacy-workflow-and-skills',version:loadVersion(id.slice(8)),warning:'旧版本只记录流程和技能；没有伪造原始完整原生声明。'};
  return {sessionId,presetId:id||null,scope:id===EDITOR_PRESET_ID?'configuration-editor':'unmanaged'};
 }
 return {publish,commitConfiguration,forEditor,refreshEditor,inspectEditorTools,capability,forProject,inspectSession,versions:nativeVersionList,
  async forWorkflow(id){const configuration=readConfiguration(),workflow=configuration.workflows.find(item=>item.id===id);if(!workflow)throw new AresError('未知流程');return (await snapshotWorkflow(workflow,configuration)).id;},
  async dispose(){alive=false;removeGuard?.();restoreRoster?.();for(const off of [...disposers.values()].reverse())await off();disposers.clear();},
 };
}
