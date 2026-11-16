/** Reusable competition/track workflows live in the existing configuration.
 * Reading an unsaved starting plan never creates a project, file or version. */
import {AresError,clone,hash} from './storage.js';
import {readConfiguration,saveConfiguration,validateConfiguration,validateCompetitionTemplate,
 competitionCatalog,freezeWorkflow} from './catalog.js?v=2.3.0-directory1';
import {competitionFlow} from './competition-flow.js?v=2.3.0-directory1';

function scopeFor(body,configuration){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new AresError('需要比赛和赛道资料');
 return validateCompetitionTemplate({competitionId:Number(body.competitionId),track:body.track,
  edition:body.edition??'',group:body.group??''},configuration);
}
const same=(a,b)=>hash(a)===hash(b);
const defaultId=scope=>'event-'+hash(scope).slice(0,24);
function skillHashes(workflow,configuration){
 const values=Object.fromEntries(configuration.skills.map(skill=>[skill.id,hash(skill)]));
 for(const id of workflow.steps.flatMap(step=>step.skills))if(!Object.hasOwn(values,id))values[id]=null;
 return values;
}
function competition(scope,configuration){
 const value=competitionCatalog(configuration).find(row=>row.id===scope.competitionId);
 return {id:value.id,name:value.name,...clone(scope)};
}
export function competitionWorkflowSummaries(configuration=readConfiguration()){
 const catalogue=new Map(competitionCatalog(configuration).map(row=>[row.id,row]));
 return configuration.workflows.filter(row=>row.competitionTemplate&&catalogue.get(row.competitionTemplate.competitionId)?.tracks.some(t=>t.track===row.competitionTemplate.track)).map(row=>({id:row.id,title:row.title,
  ...clone(validateCompetitionTemplate(row.competitionTemplate,configuration,row.pipeline)),
  competitionName:catalogue.get(row.competitionTemplate.competitionId)?.name||'',
  stepCount:row.steps.length,workflowHash:hash(row)}));
}
export function readCompetitionWorkflow(body,configuration=readConfiguration()){
 const scope=scopeFor(body,configuration),matching=configuration.workflows.filter(row=>row.competitionTemplate&&same(row.competitionTemplate,scope));
 let workflow;
 if(body.workflowId){
  workflow=configuration.workflows.find(row=>row.id===body.workflowId);
  if(!workflow||!workflow.competitionTemplate||!same(workflow.competitionTemplate,scope))throw new AresError('所选流程不属于当前比赛、赛道或届次',403);
 }else workflow=matching.find(row=>row.id===defaultId(scope))||matching[0];
 const saved=!!workflow;
 if(!workflow){const plan=competitionFlow({...body,...scope},configuration);workflow={...plan.workflow,competitionTemplate:clone(scope),competitionScope:clone(scope)};}
 return {workflow:clone(workflow),competition:competition(scope,configuration),basis:clone(workflow.competitionBasis||null),
  saved,expectedRevision:configuration.revision,workflowId:workflow.id,workflowHash:hash(workflow),skillHashes:skillHashes(workflow,configuration),
  configuration:clone(configuration),alternatives:competitionWorkflowSummaries(configuration).filter(row=>same({competitionId:row.competitionId,track:row.track,edition:row.edition,group:row.group},scope))};
}
export function saveCompetitionWorkflow(body,{commitConfiguration,beforeCommit}={}){
 const configuration=readConfiguration(),scope=scopeFor(body,configuration);
 if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision!==configuration.revision)throw new AresError('比赛流程库已更新，请保留草稿并重新读取',409);
 if(!body.workflow||typeof body.workflow!=='object'||Array.isArray(body.workflow))throw new AresError('需要完整的比赛流程草稿');
 const workflow=clone(body.workflow),previous=configuration.workflows.find(row=>row.id===workflow.id);
 if(!workflow.competitionTemplate||!same(validateCompetitionTemplate(workflow.competitionTemplate,configuration,workflow.pipeline),scope))throw new AresError('草稿与当前比赛、赛道或届次不一致',403);
 if(workflow.competitionScope&&!same(workflow.competitionScope,scope))throw new AresError('不能把其他项目或比赛的流程覆盖到当前赛道',403);
 if(previous&&(!previous.competitionTemplate||!same(previous.competitionTemplate,scope)))throw new AresError('流程名称标识属于其他比赛或基础流程，未覆盖',403);
 if(body.expectedWorkflowHash&&hash(previous||readCompetitionWorkflow(body,configuration).workflow)!==body.expectedWorkflowHash)throw new AresError('所选比赛流程已变化，请保留草稿并重新读取',409);
 if(body.expectedSkillHashes!==undefined){
  const expected=body.expectedSkillHashes;if(!expected||typeof expected!=='object'||Array.isArray(expected)||Object.values(expected).some(value=>value!==null&&(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))))throw new AresError('能力版本基线无效');
  const stored=new Map(configuration.skills.map(skill=>[skill.id,hash(skill)]));
  for(const id of (Array.isArray(workflow.steps)?workflow.steps:[]).flatMap(step=>Array.isArray(step?.skills)?step.skills:[]))if((stored.get(id)||null)!==(Object.hasOwn(expected,id)?expected[id]:null))throw new AresError('当前流程引用的能力已被更新，请保留草稿并协调最新能力：'+id,409);
 }
 workflow.competitionTemplate=clone(scope);workflow.competitionScope=clone(scope);
 const skills=new Map(configuration.skills.map(skill=>[skill.id,skill]));
 if(body.configuration!==undefined){
  if(!body.configuration||body.configuration.schema_version!==2||!Array.isArray(body.configuration.skills))throw new AresError('比赛流程的能力草稿结构无效');
  if(body.configuration.revision!==body.expectedRevision)throw new AresError('能力草稿基线已变化，请保留修改并读取最新状态',409);
  const referenced=new Set((Array.isArray(workflow.steps)?workflow.steps:[]).flatMap(step=>Array.isArray(step?.skills)?step.skills:[])),seen=new Set();
  for(const skill of body.configuration.skills){if(!skill||typeof skill.id!=='string'||seen.has(skill.id))throw new AresError('能力草稿包含无效或重复技能');seen.add(skill.id);if(referenced.has(skill.id))skills.set(skill.id,clone(skill));}
 }
 // A scoped save takes only the selected flow and its referenced skill edits;
 // unrelated editor workflows/skills never replace concurrently stored content.
 const candidate={...configuration,skills:[...skills.values()],workflows:previous?configuration.workflows.map(row=>row.id===workflow.id?workflow:row):[...configuration.workflows,workflow]};
 const validated=validateConfiguration(candidate),checked=validated.workflows.find(row=>row.id===workflow.id);
 // Freeze the actual skills/resources before publishing a saved reusable flow.
 // A failed freeze leaves the global configuration and current projects intact.
 const definition=freezeWorkflow(checked,validated),finish=result=>{
  const saved=result?.configuration;if(!saved||saved.revision!==body.expectedRevision+1)throw new AresError('比赛流程保存未返回实际配置修订，未报告成功',502);
  return {...readCompetitionWorkflow({...scope,workflowId:checked.id},saved),definitionId:definition.id,
   ...(result.warning?{warning:result.warning}:{}),...(result.capabilities?{capabilities:result.capabilities}:{})};
 };
 // The real route supplies the original native publisher. It performs asynchronous
 // registry work, then repeats the synchronous owner/agent idle check before commit.
 if(commitConfiguration)return Promise.resolve(commitConfiguration(validated,body.expectedRevision,{beforeCommit})).then(finish);
 if(beforeCommit){const checked=beforeCommit();if(checked?.then)throw new AresError('保存前状态检查必须同步完成');}
 return finish({configuration:saveConfiguration(validated,body.expectedRevision)});
}
