/** Project-only workflow drafts and explicit immutable upgrades. No global save. */
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {AresError,clone,hash,home,safePath,readJson,atomicJson,locked,now} from './storage.js';
import {readConfiguration,validateConfiguration,loadVersion,freezeWorkflow} from './catalog.js?v=2.3.0-directory1';
import {readProject,previewUpgrade,upgradeProject} from './projects.js?v=2.3.0-directory1';
import {storePackage,packageReference} from './skill-packages.js';
import {nodeRuns} from './node-execution.js?v=2.3.0-directory1';
import {assertIdle} from './agent-state.js';
import {verifyFrozenResources} from './native-versions.js?v=2.3.0-directory1';

function current(body,write=false){const p=readProject(body.root);if(p.kind!=='v2')throw new AresError('请先建立参赛项目');if(body.projectId!==undefined&&body.projectId!==p.id)throw new AresError('流程不属于当前项目',403);if(write&&(body.projectId!==p.id||body.expectedDefinitionId!==p.definitionId||body.expectedRevision!==p.revision))throw new AresError('项目或流程版本已变化，请重新读取本赛流程',409);return p;}
function scope(p){return {competitionId:p.competition.id,track:p.competition.track,edition:p.competition.edition||'',group:p.competition.group||'',projectId:p.id};}
function configurationFor(p){
 const c=readConfiguration(),v=loadVersion(p.definitionId),skills=new Map(c.skills.map(row=>[row.id,row]));
 // Preserve the actual fixed skill bytes/resources, including skills since removed
 // from the global library. Packages are immutable and never installed/executed here.
 for(const skill of v.skills){const files=new Map([['SKILL.md',Buffer.from(skill.content)]]);for(const resource of skill.resources||[]){const bytes=readFileSync(safePath(join(home(),'ares-versions',v.id,'resources',skill.id),resource.path,{existing:true}));if(hash(bytes)!==resource.sha256)throw new AresError('固定技能资源变化，未重新冻结流程',409);files.set(resource.path,bytes);}const pack=storePackage(files,{kind:'fixed-project-skill',projectId:p.id,definitionId:v.id,skillId:skill.id});skills.set(skill.id,{...packageReference(pack,skill.id),title:skill.title,description:skill.description});}
 return {...c,workflows:[],skills:[...skills.values()]};
}
function checked(body,p){
 const input=body.workflow||body.draft;if(!input||typeof input!=='object'||Array.isArray(input))throw new AresError('需要完整的本赛流程草稿');
 const w=clone(input);if(w.id!==p.workflow.id||hash(w.competitionScope||null)!==hash(scope(p)))throw new AresError('本赛流程的比赛、赛道或项目归属不符',403);
 if(w.pipeline!==p.workflow.pipeline)throw new AresError('本次编辑不能改变项目所属赛道领域');
 const template=p.workflow.competitionTemplate;
 if(w.competitionTemplate&&(!template||hash(w.competitionTemplate)!==hash(template)))throw new AresError('本项目原流程库来源不一致，不能改写为其他比赛赛道',403);
 // A project instance has a project ID, whereas a reusable library flow does not.
 // Validate the same steps/skills/contracts without treating this instance as a
 // global template save, then restore the immutable source provenance verbatim.
 delete w.competitionTemplate;delete w.competitionTemplateSource;
 const configuration=configurationFor(p),workflow=validateConfiguration({...configuration,workflows:[w]}).workflows[0];
 if(template){workflow.competitionTemplate=clone(template);if(p.workflow.competitionTemplateSource)workflow.competitionTemplateSource=clone(p.workflow.competitionTemplateSource);}
 return {configuration,workflow};
}
function freezeProjectWorkflow(p,workflow,configuration){
 const before=loadVersion(p.definitionId),built=freezeWorkflow(workflow,configuration),evidence=skill=>hash({content:skill.content,title:skill.title,description:skill.description,resources:(skill.resources||[]).map(row=>[row.path,row.sha256]).sort(([a],[b])=>a.localeCompare(b))});
 // Repackaging the same fixed bytes must not change their original provenance
 // metadata and falsely invalidate unrelated stages under the original signature.
 const skills=built.skills.map(skill=>{const fixed=before.skills.find(row=>row.id===skill.id);return fixed&&evidence(fixed)===evidence(skill)?clone(fixed):skill;}),payload={schema_version:built.schema_version,workflow:built.workflow,skills},id=hash(payload),base=join(home(),'ares-versions',id),file=join(base,'definition.json');
 if(!existsSync(file)){mkdirSync(base,{recursive:true});for(const skill of skills){const directory=safePath(base,'resources/'+skill.id);mkdirSync(directory,{recursive:true});for(const resource of [{path:'SKILL.md',sha256:hash(skill.content)},...(skill.resources||[])]){const bytes=resource.path==='SKILL.md'?Buffer.from(skill.content):readFileSync(safePath(join(home(),'ares-versions',built.id,'resources',skill.id),resource.path,{existing:true}));if(hash(bytes)!==resource.sha256)throw new AresError('固定资源字节变化，未保存项目流程',409);const target=safePath(directory,resource.path);mkdirSync(join(target,'..'),{recursive:true});if(existsSync(target)){if(hash(readFileSync(target))!==resource.sha256)throw new AresError('目标固定资源冲突，未覆盖',409);}else writeFileSync(target,bytes,{flag:'wx'});}}atomicJson(file,{id,createdAt:now(),...payload});}
 const result=loadVersion(id);verifyFrozenResources(result);return result;
}
export function readProjectFlow(body){const p=current(body),workflow={...clone(p.workflow),competitionScope:scope(p)},file=safePath(p.root,'.ares/workflow-draft.json'),draft=readJson(file,null);return {projectId:p.id,root:p.root,competition:clone(p.competition),expectedRevision:p.revision,expectedDefinitionId:p.definitionId,workflow,configuration:configurationFor(p),draft:draft?.projectId===p.id?draft:null,basis:workflow.competitionBasis||{method:'existing-fixed-project',requirementsVerified:false,note:'本项目仍使用原有固定流程，可在此按本赛要求调整，旧版本保留。'}};}
export function projectFlowDraftStatus(body){const p=current(body),draft=readJson(safePath(p.root,'.ares/workflow-draft.json'),null);return {projectId:p.id,definitionId:p.definitionId,revision:p.revision,scope:scope(p),suggestion:draft?.projectId===p.id?{revision:draft.revision,actor:draft.actor,baseDefinitionId:draft.baseDefinitionId,updatedAt:draft.updatedAt}:null};}
export function saveProjectFlowDraft(body,actor={kind:'user',id:'owner'}){const p=current(body,true),{workflow}=checked(body,p),file=safePath(p.root,'.ares/workflow-draft.json');return locked(file,()=>{const old=readJson(file,null);if((old?.revision||0)!==(body.draftRevision||0))throw new AresError('流程草稿已被其他编辑更新，请重新读取',409);const draft={projectId:p.id,baseDefinitionId:p.definitionId,baseRevision:p.revision,revision:(old?.revision||0)+1,workflow,actor,updatedAt:now()};atomicJson(file,draft);return {draft,applied:false};});}
export function previewProjectFlow(body){const p=current(body,true),{configuration,workflow}=checked(body,p),next=freezeProjectWorkflow(p,workflow,configuration),preview=previewUpgrade({...body,targetDefinitionId:next.id});return {preview:{...preview,projectId:p.id,targetDefinitionId:next.id,expectedDefinitionId:p.definitionId},workflow,applied:false};}
export function applyProjectFlow(body,ctx={}){const p=current(body,true),target=loadVersion(body.toId);if(body.projectId!==p.id||hash(target.workflow.competitionScope)!==hash(scope(p)))throw new AresError('待应用流程不属于当前项目',403);if(nodeRuns(p.root).some(run=>['preparing','running','stopping','unknown','damaged'].includes(run.status)))throw new AresError('请先结束或核对当前节点运行，再应用流程',409);assertIdle(ctx,p.workbench?.nodeSession?.sessionId);const project=upgradeProject({...body,targetDefinitionId:target.id});return {project,applied:true};}
