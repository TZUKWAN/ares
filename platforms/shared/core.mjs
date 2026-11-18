/** Portable ARES business dispatch. It never provisions models, shell tools or DSH sessions. */
import {realpathSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from './sdk.mjs';
import {readConfiguration, competitionCatalog, skillCatalog, loadVersion, previewStep} from '../../host/catalog.js?v=2.3.0-loadfix1';
import {competitionWorkflowSummaries, readCompetitionWorkflow, saveCompetitionWorkflow} from '../../host/competition-workflows.js?v=2.3.0-loadfix1';
import {linkRoot, readProject, initializeProject, taskChecks, taskAction, updateFacts, addMaterial, recordRules, verifyProject} from '../../host/projects.js?v=2.3.0-loadfix1';
import {projectWorkbench, artifactHistory, captureDraft, freezeProjectRelease, readRelease, restoreRelease, updateTeam} from '../../host/project-workbench.js';
import {createArtifactViewer} from '../../host/artifact-viewer.js';
import {compareProjectVersions} from '../../host/artifact-diff.js';
import {projectPlan, saveProjectPlan} from '../../host/project-plan.js';
import {projectProgress} from '../../host/project-progress.js';
import {modelResearchIndex,modelResearchProposal} from '../../host/research-model.js';
import {readProjectFlow, saveProjectFlowDraft, previewProjectFlow, applyProjectFlow} from '../../host/project-flow.js';
import {verifyFrozenResources} from '../../host/native-versions.js';
import {nodeRuns} from '../../host/node-execution.js';
import {collaborationStatus, listCollaborationFiles, cloudDocumentHistory, cloudCollaborators, connectCollaboration, bindCloudDocument} from '../../host/project-collaboration.js';
import {localOwnerAction,ownerActionSnapshot,pinConfirmedReview} from './approval.mjs';

const text = (max=200) => z.string().min(1).max(max);
const revision = z.number().int().min(0);
const object = z.record(z.string(), z.unknown());
const root = {root:text(2000)};
const readOnly = {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false};
const localWrite = {readOnlyHint:false, destructiveHint:false, openWorldHint:false};

export const portableToolDefinitions = [
  {name:'ares_capabilities', description:'Read portable ARES capabilities, trusted project roots, and honest host limitations. Missing roots must be configured by the MCP client or startup flags, never tool arguments.', schema:z.object({}).strict(), annotations:readOnly},
  {name:'ares_catalog', description:'Read actual competitions/tracks, saved workflow summaries, or skill bodies. Skills are reference material, not execution receipts.', schema:z.object({action:z.enum(['summary','competitions','skills']), competitionId:z.number().int().positive().optional(), ids:z.array(text(100)).max(40).optional(), content:z.boolean().optional()}).strict(), annotations:readOnly},
  {name:'ares_workflow', description:'Read/save a competition-track workflow library using existing revision, scope and skill-hash conflict checks. Project flow changes remain independent from library templates. Project apply requires one-operation confirmation from a trusted host user.', schema:z.object({action:z.enum(['read','save','project-read','project-draft','project-preview','project-apply']), competitionId:z.number().int().positive().optional(), track:text(400).optional(), edition:z.string().max(100).optional(), group:z.string().max(200).optional(), workflowId:text(100).optional(), root:text(2000).optional(), workflow:object.optional(), configuration:object.optional(), expectedRevision:revision.optional(), expectedWorkflowHash:z.string().nullable().optional(), expectedSkillHashes:z.record(z.string(),z.string().nullable()).optional(), projectId:text(100).optional(), expectedDefinitionId:text(64).optional(), draftRevision:revision.optional(), fromId:text(64).optional(), toId:text(64).optional()}).strict(), annotations:localWrite},
  {name:'ares_project', description:'Create or read a project; get the next step with its real fixed instructions, record start/block, check actual outputs, or request acceptance. This does not launch a DSH agent. Use the host agent and its native tools to produce the declared files. Completion/rule approval is owner-only. Research reads study design specifications; research-proposal stores a versioned suggestion for review.', schema:z.object({action:z.enum(['list','init','status','step','start','block','check','verify','facts','material','complete','rules','execute-native','research','research-proposal']), proposalKind:z.enum(['survey','guide','codes']).optional(), design:z.record(z.string(),z.unknown()).optional(), root:text(2000).optional(), expectedRevision:revision.optional(), competitionId:z.number().int().positive().optional(), track:text(400).optional(), edition:z.string().max(100).optional(), group:z.string().max(200).optional(), name:text(120).optional(), goal:z.string().max(3000).optional(), ownerName:text(120).optional(), flowMode:z.enum(['competition','library']).optional(), workflowId:text(100).optional(), expectedWorkflowHash:text(64).optional(), expectedConfigurationRevision:revision.optional(), stepId:text(100).optional(), reason:text(3000).optional(), facts:object.optional(), path:text(400).optional(), title:text(200).optional(), confirmHuman:z.boolean().optional(), review:z.object({summary:text(5000),findings:z.array(object).max(200)}).strict().optional(), reviewPath:text(400).optional(), sourceUrl:text(2000).optional(), snapshotPath:text(400).optional(), quote:text(8000).optional(), scope:z.string().max(400).optional()}).strict(), annotations:localWrite},
  {name:'ares_artifact', description:'Read or edit an existing registered project artifact, or inspect its immutable history. Save requires the actual file hash (version) and project revision, retains the previous bytes and invalidates stale acceptance. No arbitrary file write or path registration.', schema:z.object({action:z.enum(['read','save','history']), ...root, id:text(100), file:z.string().max(800).optional(), versionId:text(64).optional(), version:text(64).optional(), expectedRevision:revision.optional(), text:z.string().max(1024*1024).optional(), offset:z.number().int().min(0).optional(), limit:z.number().int().min(1).max(120000).optional()}).strict(), annotations:localWrite},
  {name:'ares_version', description:'Read real workbench/version records, capture actual working files, freeze a checkpoint or compare versions. Formal releases/restores require one-operation confirmation from a trusted host user and retain the original review gates.', schema:z.object({action:z.enum(['list','capture','freeze','read','compare','restore']), ...root, expectedRevision:revision.optional(), stepId:text(100).optional(), artifactId:text(100).optional(), stepIds:z.array(text(100)).min(1).max(40).optional(), title:text(200).optional(), kind:z.enum(['checkpoint','stage','submission']).optional(), releaseId:text(64).optional(), left:object.optional(), right:object.optional(), path:text(800).optional(), offset:z.number().int().min(0).optional(), limit:z.number().int().min(1).max(50).optional()}).strict(), annotations:localWrite},
  {name:'ares_plan', description:'Read the actual project plan and progress. Schedule changes require an owner; the model may propose changes in conversation without impersonating a team member.', schema:z.object({action:z.enum(['read','progress','save']), ...root, expectedRevision:revision.optional(), memberId:text(64).optional(), deadline:z.string().nullable().optional(), steps:z.array(z.object({stepId:text(100),assigneeId:text(64).optional(),dueAt:z.string().nullable().optional(),estimateHours:z.number().min(0).max(1000).nullable().optional()}).strict()).max(40).optional()}).strict(), annotations:localWrite},
  {name:'ares_team', description:'Read project members and assignments. Team membership and assignment changes require one-operation confirmation from a trusted host user; JSON cannot select an owner identity.', schema:z.object({action:z.enum(['read','member','remove','assign']), ...root, expectedRevision:revision.optional(), id:text(64).optional(), name:text(80).optional(), role:z.enum(['leader','member','reviewer']).optional(), stepId:text(100).optional(), memberId:text(64).optional(), collaboratorIds:z.array(text(64)).max(32).optional()}).strict(), annotations:localWrite},
  {name:'ares_collaboration', description:'Read the existing project-bound Kdocs collaboration state, files, history and recent visitors through the original CLI. Connect/bind needs an owner. Public sharing, publication and permissions are not granted to MCP; keep the original DSH owner-confirmation path.', schema:z.object({action:z.enum(['status','files','history','visitors','connect','bind','publish','permissions']), ...root, expectedRevision:revision.optional(), driveId:text(160).optional(), folderId:text(160).optional(), fileId:text(160).optional(), artifactId:text(100).optional(), pageToken:z.string().max(4000).optional()}).strict(), annotations:{...localWrite,openWorldHint:true}},
];

const definitions = new Map(portableToolDefinitions.map(row=>[row.name,row]));
const envQueueKey = Symbol.for('ares.portable.home.queue');
globalThis[envQueueKey] ??= Promise.resolve();
function withHome(home, action) {
  const result = globalThis[envQueueKey].then(async()=>{
    const previous = process.env.ARES_HOME;
    process.env.ARES_HOME = home;
    try { return await action(); }
    finally { if(previous===undefined)delete process.env.ARES_HOME;else process.env.ARES_HOME=previous; }
  });
  globalThis[envQueueKey] = result.catch(()=>{});
  return result;
}
export class PortableAresError extends Error {
  constructor(code, message, status=400) {super(message);this.code=code;this.status=status;}
}
const fail = (code,message,status=400) => {throw new PortableAresError(code,message,status);};
function requireFields(value, fields) {
  for(const key of fields)if(value[key]===undefined||value[key]===null)fail('invalid-arguments','缺少字段：'+key);
}
function canonicalRoot(value) {
  if(typeof value!=='string')fail('scope-denied','项目目录必须由宿主显式授权',403);
  let path=value;
  if(/^file:/i.test(path)) {
    const uri=new URL(path);
    if(uri.search||uri.hash||uri.hostname&&uri.hostname!=='localhost')fail('scope-denied','只接受本机 file:// 项目根目录',403);
    path=fileURLToPath(uri);
  }
  if(!isAbsolute(path))fail('scope-denied','项目根目录须为绝对路径',403);
  try {const actual=realpathSync(path);if(!statSync(actual).isDirectory())throw new Error('不是目录');return actual;}
  catch(error) {if(error instanceof PortableAresError)throw error;fail('scope-denied','授权项目目录不可用：'+error.message,403);}
}
const key = path=>process.platform==='win32'?path.toLowerCase():path;

export function defaultPortableHome(host='portable') {
  if(!['portable','codex','zcode'].includes(host))fail('invalid-host','宿主须为 portable、codex 或 zcode');
  return join(homedir(),'.ares',host);
}

/** All options and dispatch context are trusted server code, never tool JSON. */
export function createPortableAres({home, host='portable', roots=[]}={}) {
  const directory=home||defaultPortableHome(host);
  if(!isAbsolute(directory))fail('invalid-home','ARES_HOME 须为绝对路径');
  const ownHome=resolve(directory), viewer=createArtifactViewer();
  let allowed=new Map(), disposed=false;
  let pendingRoots=Promise.resolve();
  function updateAllowedRoots(values) {
    if(!Array.isArray(values)||values.length>128)fail('scope-denied','授权目录列表无效',403);
    const checked=new Map(values.map(value=>{const actual=canonicalRoot(typeof value==='string'?value:value?.uri);return [key(actual),actual];}));
    // Revoke immediately. A previous in-flight call may finish; every queued call rechecks.
    allowed=checked;
    const version=allowed;
    pendingRoots=withHome(ownHome,()=>{if(version!==allowed)return;for(const path of checked.values())linkRoot(path);});
    return pendingRoots.then(()=>[...allowed.values()]);
  }
  const ready=updateAllowedRoots(roots);
  function authorize(value) {
    const actual=canonicalRoot(value);
    if(!allowed.has(key(actual)))fail('scope-denied','此项目目录未获宿主 roots/list 或 --root 授权；工具参数不能扩大目录权限',403);
    return actual;
  }
  function owner(context) {
    if(context.principal!=='owner')fail('needs-owner','此动作需要负责人在宿主受信界面明确确认，MCP 模型不能自行审批',403);
    return {kind:'user',id:'owner'};
  }
  function idleProject(path) {
    const p=readProject(path);
    if(p.workbench?.nodeSession?.sessionId)fail('unsupported','此项目绑定了 DSH 原生执行会话；便携服务无法核验其空闲状态，请在 DSH 中完成本次写入',409);
    if(p.kind==='v2'&&nodeRuns(path).some(row=>['preparing','running','stopping','unknown','damaged'].includes(row.status)))fail('unsupported','此项目仍有未核对的 DSH 节点运行记录，请在 DSH 中核对后再写入',409);
    return p;
  }
  function revisionForWrite(body) {requireFields(body,['expectedRevision']);idleProject(body.root);}
  async function run(name, body, context) {
    const actor={kind:'agent',id:host+'-agent'};
    switch(name) {
      case 'ares_capabilities': return {host,home:ownHome,roots:[...allowed.values()],rootPolicy:'exact-canonical-roots-only',execution:'Host agent and host native tools; ARES supplies instructions, checked files and version records.',dshNativeExecution:false,modelApi:false,arbitraryToolProxy:false,ownerApproval:'Requires a trusted host confirmation for one exact operation; JSON cannot select owner. Protocol availability is reported by the MCP adapter.',unsupported:['DSH native sessions/execution','public cloud sharing and permissions from MCP','automatic external MCP installation'],configurationSharing:'Only explicit --home / ARES_HOME; default home is independent.'};
      case 'ares_catalog': {
        const c=readConfiguration();
        if(body.action==='skills')return {skills:skillCatalog(c,{content:body.content===true,ids:body.ids?new Set(body.ids):null}).map(({root,...skill})=>skill)};
        const competitions=competitionCatalog(c).filter(row=>!body.competitionId||row.id===body.competitionId);
        return {configurationRevision:c.revision,competitions,competitionWorkflows:competitionWorkflowSummaries(c),...(body.action==='summary'?{skills:skillCatalog(c,{content:false}).map(({root,...skill})=>skill)}:{})};
      }
      case 'ares_workflow': {
        if(body.action==='read'||body.action==='save') {
          requireFields(body,['competitionId','track']);
          if(body.action==='read')return readCompetitionWorkflow(body);
          requireFields(body,['expectedRevision','workflow']);
          return saveCompetitionWorkflow(body);
        }
        requireFields(body,['root']);
        if(body.action==='project-read')return readProjectFlow(body);
        revisionForWrite(body);requireFields(body,['projectId','expectedDefinitionId']);
        if(body.action==='project-draft')return saveProjectFlowDraft(body,actor);
        if(body.action==='project-preview')return previewProjectFlow(body);
        owner(context);requireFields(body,['fromId','toId']);return applyProjectFlow(body);
      }
      case 'ares_project': {
        if(body.action==='list')return {projects:[...allowed.values()].map(path=>{try{return readProject(path);}catch(error){return {root:path,kind:'error',error:error.message};}})};
        requireFields(body,['root']);
        if(body.action==='execute-native')fail('unsupported','便携 ARES 不会伪装 DSH 原生执行；请读取 step，由当前宿主 Agent 使用其原生工具执行');
        if(body.action==='init') {requireFields(body,['competitionId','track','name']);return initializeProject({...body,flowMode:body.flowMode||'competition'});}
        if(body.action==='status')return readProject(body.root);
        if(body.action==='verify')return verifyProject(body.root);
        if(body.action==='research')return modelResearchIndex(body.root);
        if(body.action==='research-proposal'){
          revisionForWrite(body);requireFields(body,['proposalKind','design']);
          return modelResearchProposal(body,actor);
        }
        const p=readProject(body.root);
        if(body.action==='step') {
          const step=p.workflow?.steps.find(row=>row.id===(body.stepId||p.nextTask));
          if(!step)fail('no-step','当前没有可推进的步骤，请检查依赖和项目状态',409);
          const fixed=loadVersion(p.definitionId);
          verifyFrozenResources(fixed);
          return {projectId:p.id,expectedRevision:p.revision,definitionId:p.definitionId,step,task:p.tasks[step.id],instructions:'便携宿主接线：ares_project 的 status/check/start 均通过 action 字段调用；下列 skills 已提供本步骤实际固定的技能正文，原文中的 ares_library 是 DSH 工具名，此宿主不创建该工具。由当前宿主原生工具完成实际文件工作。\n\n'+previewStep(p.workflow,step,fixed),skills:fixed.skills.filter(row=>step.skills.includes(row.id)),outputDirectory:p.outputDir,executor:'current-host-agent',dshSessionCreated:false,acceptance:'File check plus owner review remains required. A host tool run is not acceptance.'};
        }
        if(body.action==='check') {requireFields(body,['stepId']);return taskChecks(body.root,body.stepId);}
        revisionForWrite(body);
        if(body.action==='facts') {requireFields(body,['facts']);return updateFacts(body);}
        if(body.action==='material') {requireFields(body,['path']);return addMaterial(body);}
        if(body.action==='rules') {owner(context);requireFields(body,['edition','sourceUrl','snapshotPath','quote']);return recordRules(body,'user');}
        requireFields(body,['stepId']);
        if(body.action==='complete') {owner(context);return taskAction(body,'user',{id:'owner'});}
        return taskAction(body,'agent',{id:actor.id});
      }
      case 'ares_artifact': {
        if(body.action==='history')return artifactHistory(body.root,body.id);
        if(body.action==='save') {revisionForWrite(body);requireFields(body,['version','text']);return viewer.save(body,actor);}
        const model=await viewer.open(body,{signal:context.signal});
        const offset=body.offset||0,limit=body.limit||120000;
        if(typeof model.text==='string')return {...model,text:model.text.slice(offset,offset+limit),textOffset:offset,totalCharacters:model.text.length,nextOffset:offset+limit<model.text.length?offset+limit:null};
        return model;
      }
      case 'ares_version': {
        if(body.action==='list')return projectWorkbench(body.root,{offset:body.offset,limit:body.limit});
        if(body.action==='read') {requireFields(body,['releaseId']);return readRelease(body.root,body.releaseId);}
        if(body.action==='compare') {requireFields(body,['left','right']);return compareProjectVersions(body);}
        revisionForWrite(body);
        if(body.action==='capture') {requireFields(body,['stepId']);return captureDraft(body,actor);}
        if(body.action==='restore') {const principal=owner(context);requireFields(body,['releaseId']);return restoreRelease(body,principal);}
        return freezeProjectRelease(body,body.kind==='stage'||body.kind==='submission'?owner(context):actor);
      }
      case 'ares_plan': {
        if(body.action==='read')return projectPlan(body.root,{memberId:body.memberId});
        if(body.action==='progress')return projectProgress(body.root);
        const principal=owner(context);revisionForWrite(body);requireFields(body,['steps']);return saveProjectPlan(body,principal);
      }
      case 'ares_team': {
        if(body.action==='read') {const p=readProject(body.root);return {projectId:p.id,expectedRevision:p.revision,team:p.workbench?.team||[],assignments:p.tasks};}
        const principal=owner(context);revisionForWrite(body);return updateTeam(body,principal);
      }
      case 'ares_collaboration': {
        if(body.action==='status')return collaborationStatus(body.root);
        if(body.action==='files')return listCollaborationFiles(body.root,{pageToken:body.pageToken,signal:context.signal});
        if(body.action==='history'||body.action==='visitors') {requireFields(body,['fileId']);return body.action==='history'?cloudDocumentHistory(body.root,body.fileId,{pageToken:body.pageToken,signal:context.signal}):cloudCollaborators(body.root,body.fileId,{signal:context.signal});}
        const principal=owner(context);
        if(body.action==='publish'||body.action==='permissions')fail('unsupported','发布、公开分享与队员权限须走原 DSH 负责人确认和回执核对机制；便携服务不代批云端写入',409);
        revisionForWrite(body);
        if(body.action==='connect') {requireFields(body,['driveId','folderId']);return connectCollaboration(body,principal,{signal:context.signal});}
        requireFields(body,['fileId']);return bindCloudDocument(body,principal,{signal:context.signal});
      }
    }
    fail('unknown-tool','未知 ARES 工具',404);
  }
  function parseArguments(name,args) {
    if(disposed)fail('disposed','ARES 便携服务已关闭',503);
    const tool=definitions.get(name);if(!tool)fail('unknown-tool','未知 ARES 工具',404);
    const parsed=tool.schema.safeParse(args);
    if(!parsed.success)fail('invalid-arguments',parsed.error.issues.map(row=>row.path.join('.')+': '+row.message).join('; '));
    if(Buffer.byteLength(JSON.stringify(args))>8*1024*1024)fail('invalid-arguments','工具参数超过 8MiB 限制',413);
    return parsed.data;
  }
  async function inProjectContext(name,args,context,operation) {
    const parsed=parseArguments(name,args);
    await pendingRoots;
    return withHome(ownHome,async()=>{
      context.signal?.throwIfAborted();
      const body={...parsed};
      if(body.root!==undefined)body.root=authorize(body.root);
      try {return await operation(body);}
      catch(error) {if(error instanceof PortableAresError)throw error;throw new PortableAresError(error.code||(error.status===409?'revision-or-state-conflict':error.status===403?'forbidden':'operation-failed'),error.message,error.status||400);}
    });
  }
  return {
    home:ownHome, host, ready,
    tools:()=>portableToolDefinitions,
    listTools:()=>portableToolDefinitions.map(({schema,...row})=>({...row,inputSchema:z.toJSONSchema(schema)})),
    updateAllowedRoots,
    allowedRoots:()=>[...allowed.values()],
    dispatch(name,args={},context={}) {return inProjectContext(name,args,context,body=>run(name,body,context));},
    ownerActionSupported:localOwnerAction,
    prepareOwnerApproval(name,args,context={}) {
      return inProjectContext(name,args,context,body=>{requireFields(body,['root','expectedRevision']);revisionForWrite(body);return ownerActionSnapshot(name,body);});
    },
    dispatchConfirmed(name,args,confirmation,context={}) {
      if(!confirmation||typeof confirmation.fingerprint!=='string'||typeof confirmation.id!=='string')fail('invalid-confirmation','缺少受信宿主的单次确认',403);
      return inProjectContext(name,args,context,body=>{
        requireFields(body,['root','expectedRevision']);revisionForWrite(body);
        const current=ownerActionSnapshot(name,body);
        if(current.fingerprint!==confirmation.fingerprint)fail('confirmation-stale','确认期间项目、输入、作品或复核记录已变化；本次确认已作废',409);
        // No await between the fingerprint recheck, approved hash binding and
        // the original mutation inside this same selected-home queue segment.
        const checked=name==='ares_project'?pinConfirmedReview(body,current,confirmation):body;
        return run(name,checked,{...context,principal:'owner'});
      });
    },
    dispose(){disposed=true;allowed.clear();viewer.dispose();},
  };
}
