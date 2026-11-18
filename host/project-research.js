import {randomUUID} from 'node:crypto';
import {linkSync,mkdirSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {AresError,now,safePath} from './storage.js';
import {readProject,changeProject,inspectOutput,inputHash,sourceFiles} from './projects.js?v=2.3.0-directory1';
import {captureCheckedArtifact,ensureProjectWorkbench,projectEvent,sensitiveFile} from './project-artifacts.js';
import {putProjectObject,putProjectRecord,readProjectObject,readProjectRecord} from './project-objects.js';
import {researchText} from '../client/research-survey-model.js';
import {researchTools} from './research-registry.js';

export const researchOwner=Object.freeze({kind:'user',id:'owner'});
export const researchKinds=Object.freeze({
  survey:'问卷', guide:'访谈提纲', interview:'访谈记录', codebook:'编码本',
  responses:'实际答卷', pretest:'模拟预测试', dataset:'数据集', report:'研究报告'
});
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const VERSION_LIMIT=300;
const ITEM_LIMIT=300;
export function researchInput(action) {
  try { return action(); }
  catch(error) { if (error instanceof AresError) throw error; throw new AresError(error.message); }
}
export function researchProject(root) {
  const project=readProject(root);
  if (project.kind!=='v2') throw new AresError('请先打开 ARES 项目',409);
  return project;
}
export function researchState(project,{create=false}={}) {
  const workbench=ensureProjectWorkbench(project);
  const state=workbench.research??{schemaVersion:1,items:{},jobs:{}};
  if (state.schemaVersion!==1||!state.items||!state.jobs) throw new AresError('研究工具记录损坏',409);
  if (create&&!workbench.research) workbench.research=state;
  return state;
}
export function researchItem(project,id) {
  const item=typeof id==='string'&&uuid.test(id)&&researchState(project).items[id];
  if (!item) throw new AresError('研究记录不属于当前项目',404);
  return item;
}
export function researchVersion(project,id,versionId) {
  const item=researchItem(project,id),version=versionId||item.head;
  if (!item.versions.includes(version)) throw new AresError('版本不属于此研究记录',404);
  const entry=readProjectRecord(project.root,'research-versions',version);
  if (entry.payload.projectId!==project.id||entry.payload.itemId!==item.id||entry.payload.kind!==item.kind)
    throw new AresError('研究版本身份不一致',409);
  return {item,version:entry,data:JSON.parse(readProjectObject(project.root,entry.payload.object.sha256).toString('utf8'))};
}
export function requireKind(version,kind) {
  if (version.item.kind!==kind) throw new AresError('请选择'+researchKinds[kind]);
  return version;
}
export function researchEntry(root,id,versionId) {
  const project=researchProject(root);
  return {...researchVersion(project,id,versionId),revision:project.revision};
}
export function researchIndex(root) {
  const p=researchProject(root),state=researchState(p);
  const items=Object.values(state.items).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const history=(p.workbench.eventIds??[]).slice(-60).reverse().map(id=>readProjectRecord(p.root,'events',id).payload).filter(row=>row.type.startsWith('research.'));
  return {projectId:p.id,revision:p.revision,items,tools:researchTools,history,steps:p.workflow.steps.map(({id,title,outputs})=>({id,title,outputs:outputs.filter(o=>o.kind==='file').map(({id,title,format})=>({id,title,format}))}))};
}
export function requireResearchHead(project,body,kind) {
  const value=requireKind(researchVersion(project,body.id),kind);
  if (value.item.head!==body.baseVersion) throw new AresError('研究稿已更新，请先加载最新版本',409);
  return value;
}
export function writeResearchVersion(project, body, options) {
  const {kind,status,data,provenance,source=null,actor=researchOwner,catalogFile=null}=options;
  if (!Object.hasOwn(researchKinds,kind)) throw new AresError('未知研究工具');
  const title=researchInput(()=>researchText(options.title,'研究稿标题',160));
  const state=researchState(project,{create:true});
  let item;
  if (body.id) {
    item=researchItem(project,body.id);
    if (actor.kind!=='user'||item.kind!==kind||item.head!==body.baseVersion)
      throw new AresError('研究稿类型、权限或版本已变化',409);
    if (item.versions.length>=VERSION_LIMIT) throw new AresError('此记录已达版本上限，请另存新稿',409);
  } else {
    if (Object.keys(state.items).length>=ITEM_LIMIT) throw new AresError('此项目已达研究记录上限',409);
    const id=randomUUID();
    item={id,kind,createdAt:now(),versions:[],bindings:[]};
  }
  if (source) researchVersion(project,source.itemId,source.versionId);
  const bytes=Buffer.from(JSON.stringify(data));
  if (bytes.length>6*1024*1024) throw new AresError('结构化研究稿超过6MiB，请分批整理',413);
  const object=putProjectObject(project.root,bytes);
  const version=putProjectRecord(project.root,'research-versions',{
    projectId:project.id,itemId:item.id,kind,title,status,object,provenance,source,
    parentVersion:item.head??null,actor,savedAt:now()
  });
  if (!item.versions.includes(version.id)) item.versions.push(version.id);
  Object.assign(item,{head:version.id,title,status,provenance,updatedAt:version.payload.savedAt});
  if(catalogFile)item.catalogFile=catalogFile;
  state.items[item.id]=item;
  projectEvent(project.root,project,'research.version-saved',{itemId:item.id,versionId:version.id,kind,status,source},actor);
  return {item,version};
}
export function saveResearchVersion(body,options) {
  let result;
  const project=changeProject(body,p=>{ result=writeResearchVersion(p,body,options); });
  return {...result,revision:project.revision};
}
export function bindResearch(body) {
  const project=changeProject(body,(p,definition)=>{
    const version=researchVersion(p,body.id,body.versionId);
    const step=definition.workflow.steps.find(row=>row.id===body.stepId);
    if (!step) throw new AresError('请选择当前流程中的步骤');
    if (version.version.payload.status==='proposal') throw new AresError('请先采用研究建议');
    const binding={stepId:step.id,versionId:version.version.id};
    version.item.bindings=version.item.bindings.filter(row=>row.stepId!==step.id);
    if (body.remove!==true) version.item.bindings.push(binding);
    projectEvent(p.root,p,body.remove===true?'research.unbound':'research.bound',{itemId:version.item.id,...binding});
  });
  return {revision:project.revision};
}
/** Publish a new file only; all output checks and the usual manual review still apply. */
export function stageResearchOutput(body,{bytes,extension}) {
  let result;
  const project=changeProject(body,(p,definition)=>{
    const version=researchVersion(p,body.id,body.versionId);
    if (['synthetic','proposal'].includes(version.version.payload.provenance)||version.version.payload.status==='proposal')
      throw new AresError('模拟资料或未采用的建议不能写入竞赛工作稿',403);
    const step=definition.workflow.steps.find(row=>row.id===body.stepId);
    const output=step?.outputs.find(row=>row.id===body.artifactId&&row.kind==='file');
    if (!output||output.format!==extension) throw new AresError('请选择和导出格式一致的流程文件');
    const path=join(p.outputDir,output.path).replaceAll('\\','/');
    if (sensitiveFile(path)) throw new AresError('工作稿路径无效');
    const target=safePath(p.root,path),temporary=target+'.research-'+randomUUID();
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});
    try {
      try { linkSync(temporary,target); }
      catch(error) { if (error.code==='EEXIST') throw new AresError('该流程文件已有工作稿，请先核对现有文件',409); throw error; }
      try {
        const check=inspectOutput(p.root,p,output,definition.workflow.steps.flatMap(s=>s.outputs));
        if (!check.valid) throw new AresError(check.error||'工作稿结构检查失败');
        const draft=captureCheckedArtifact(p.root,p,step,output,check,{
          sourceFiles,inputHash:inputHash(p,step),inputVersions:step.dependsOn.flatMap(id=>p.tasks[id]?.acceptedVersionIds||[]),
          provenance:{kind:'research',itemId:version.item.id,versionId:version.version.id,reviewRequired:true}
        });
        projectEvent(p.root,p,'research.artifact-draft',{stepId:step.id,versionId:version.version.id,artifactVersionId:draft.id});
        result={path,artifactVersionId:draft.id};
      } catch(error) { unlinkSync(target); throw error; }
    } finally { unlinkSync(temporary); }
  });
  return {...result,revision:project.revision,tasksAutoCompleted:false};
}
