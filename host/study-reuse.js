import {existsSync,mkdirSync,readdirSync,realpathSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {AresError,hash,safePath,now} from './storage.js';
import {readConfiguration,competitionCatalog,freezeWorkflow} from './catalog.js?v=2.3.0-directory1';
import {readCompetitionWorkflow} from './competition-workflows.js';
import {initializeProject,linkRoot,changeProject,inspectOutput,inputHash,sourceFiles} from './projects.js?v=2.3.0-directory1';
import {artifactVersion,captureCheckedArtifact,sensitiveFile} from './project-artifacts.js';
import {readProjectObject} from './project-objects.js';
import {researchProject,researchVersion,requireKind,saveResearchVersion,writeResearchVersion} from './project-research.js';

export function reuseCatalog(root){researchProject(root);return {competitions:competitionCatalog().map(c=>({id:c.id,name:c.name,tracks:c.tracks.map(t=>({track:t.track,name:t.name||t.track}))}))};}
function targetFolder(sourceRoot,value,{resume=false}={}){
  if(typeof value!=='string'||!isAbsolute(value))throw new AresError('请选择新项目的绝对目录');
  const target=resolve(value),parent=dirname(target);
  if(!existsSync(parent)||!lstatSync(parent).isDirectory())throw new AresError('新项目的父目录不存在');
  const real=join(realpathSync(parent),relative(parent,target));
  const sameTree=(a,b)=>{const rel=relative(a,b);return rel===''||rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(rel);};
  if(sameTree(sourceRoot,real)||sameTree(real,sourceRoot))throw new AresError('新项目目录不能位于原项目内或包含原项目');
  if(existsSync(target)&&(lstatSync(target).isSymbolicLink()||!lstatSync(target).isDirectory()||!resume&&readdirSync(target).length))throw new AresError('新项目目录须为空且不能是链接，未覆盖已有文件');
  return real;
}
function sources(project,mapping){
  const known=new Set(Object.values(project.workbench.artifacts).flatMap(a=>a.versionIds));
  return mapping.map(row=>{
    if(!row||typeof row.sourceVersionId!=='string'||!known.has(row.sourceVersionId))throw new AresError('复用作品版本不属于原项目');
    const version=artifactVersion(project.root,row.sourceVersionId);
    if(version.payload.projectId!==project.id||version.payload.provenance.kind==='synthetic'||!['file','directory'].includes(version.payload.kind))throw new AresError('请选择原项目的实际文件或目录作品版本');
    return {row,version};
  });
}
function mappedFiles(project,workflow,mapping,outputDir){
  const all=workflow.steps.flatMap(step=>step.outputs.map(output=>({step,output}))),seen=new Set();let bytes=0;
  const selected=sources(project,mapping).map(({row,version})=>{
    const pair=all.find(({output})=>output.id===row.targetArtifactId),source=version.payload;
    if(!pair||seen.has(pair.output.id)||pair.output.kind!==source.kind||pair.output.kind==='file'&&pair.output.format!==source.format)throw new AresError('目标作品不存在、重复或格式与原作品不一致');
    seen.add(pair.output.id);
    const path=join(outputDir,pair.output.path).replaceAll('\\','/');
    const files=source.files.map(file=>{
      bytes+=file.bytes;if(bytes>128*1024*1024)throw new AresError('单次改编最多128MiB作品');
      const name=source.kind==='directory'?join(path,file.path).replaceAll('\\','/'):path;
      if(sensitiveFile(name))throw new AresError('不能复用凭据文件');
      return {path:name,sha256:file.sha256,bytes:file.bytes};
    });
    return {sourceVersionId:version.id,sourceArtifactId:source.artifactId,sourceTitle:source.title,targetArtifactId:pair.output.id,targetTitle:pair.output.title,stepId:pair.step.id,files};
  });
  const paths=new Set();for(const entry of selected)for(const file of entry.files){if(paths.has(file.path))throw new AresError('目标作品路径重叠，请拆分映射');paths.add(file.path);}
  return selected;
}
export function previewReuse(body){
  const p=researchProject(body.root),targetRoot=targetFolder(p.root,body.targetRoot),name=String(body.name||'').trim();
  if(!name||name.length>120||/[\\/:*?"<>|]/.test(name))throw new AresError('请填写不含路径字符的新项目名称');
  if(!Array.isArray(body.mapping)||!body.mapping.length||body.mapping.length>30)throw new AresError('请选择1至30个作品版本及目标交付物');
  const configuration=readConfiguration(),scope={competitionId:Number(body.competitionId),track:body.track,edition:String(body.edition||'').trim(),group:String(body.group||'').trim()},flow=readCompetitionWorkflow(scope,configuration);
  const outputDir='输出/'+name,selected=mappedFiles(p,flow.workflow,body.mapping,outputDir);
  const plan={sourceProjectId:p.id,sourceRoot:p.root,targetRoot,name,scope,definitionHash:flow.workflowHash,configurationRevision:configuration.revision,mapping:body.mapping,selected,outputDir};
  return {...plan,token:hash(plan),targets:flow.workflow.steps.flatMap(step=>step.outputs.filter(output=>['file','directory'].includes(output.kind)).map(o=>({...o,stepId:step.id,stepTitle:step.title}))),
    gaps:flow.workflow.steps.flatMap(s=>s.outputs.filter(o=>o.requirement!=='optional'&&!selected.some(row=>row.targetArtifactId===o.id)).map(o=>({stepId:s.id,title:o.title,requirement:o.requirement}))),ruleStatus:'needs-current-edition-verification',acceptanceInherited:false};
}
export function reuseTargets(body){
  const p=researchProject(body.root),configuration=readConfiguration(),flow=readCompetitionWorkflow(body,configuration);
  return {works:Object.values(p.workbench.artifacts).flatMap(a=>a.versionIds.slice().reverse().map(id=>{
    const record=artifactVersion(p.root,id),v=record.payload;return {id,title:v.title,kind:v.kind,format:v.format,synthetic:v.provenance.kind==='synthetic'};
  })).filter(v=>['file','directory'].includes(v.kind)&&!v.synthetic),targets:flow.workflow.steps.flatMap(s=>s.outputs.filter(o=>['file','directory'].includes(o.kind)).map(o=>({...o,stepTitle:s.title})))};
}
function finishReuse(targetRoot,id){
  const target=researchProject(targetRoot),entry=requireKind(researchVersion(target,id),'reuse');
  if(entry.data.status==='completed')return {project:target,item:entry.item,version:entry.version,resumed:true};
  const plan=entry.data.plan,source=researchProject(plan.sourceRoot);
  if(source.id!==plan.sourceProjectId||target.definitionId!==entry.data.targetDefinitionId)throw new AresError('原项目身份或新项目流程已变化，停止复用',409);
  const selected=mappedFiles(source,target.workflow,plan.mapping,target.outputDir);
  if(hash(selected)!==hash(plan.selected))throw new AresError('改编清单与原固定版本不一致',409);
  try{
    let saved;const project=changeProject({root:targetRoot,expectedRevision:target.revision},p=>{
      const captures=[];
      for(const row of selected){
        for(const file of row.files){
          const path=safePath(p.root,file.path),bytes=readProjectObject(source.root,file.sha256);
          if(existsSync(path)){if(hash(readFileSync(path))!==file.sha256)throw new AresError('新项目工作稿已经变化，未覆盖：'+file.path,409);}
          else{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes,{flag:'wx'});}
        }
        const step=p.workflow.steps.find(s=>s.id===row.stepId),output=step.outputs.find(o=>o.id===row.targetArtifactId),check=inspectOutput(p.root,p,output,p.workflow.steps.flatMap(s=>s.outputs));
        if(!check.valid)throw new AresError('复用后的作品检查失败：'+(check.error||output.title),422);
        const captured=captureCheckedArtifact(p.root,p,step,output,check,{sourceFiles,inputHash:inputHash(p,step),provenance:{kind:'reused-draft',sourceProjectId:source.id,sourceVersionId:row.sourceVersionId,reviewRequired:true},sourceVersionId:row.sourceVersionId});
        captures.push(captured.id);
      }
      saved=writeResearchVersion(p,{id:entry.item.id,baseVersion:entry.version.id},{kind:'reuse',title:entry.item.title,status:'completed',provenance:'source-project',data:{...entry.data,status:'completed',artifactVersionIds:captures,completedAt:now(),acceptanceInherited:false}});
    });return {project,...saved};
  }catch(error){
    const current=researchProject(targetRoot),latest=requireKind(researchVersion(current,id),'reuse');
    saveResearchVersion({root:targetRoot,expectedRevision:current.revision,id,baseVersion:latest.version.id},{kind:'reuse',title:latest.item.title,status:'needs-attention',provenance:'source-project',data:{...latest.data,status:'needs-attention',error:error instanceof AresError?error.message:'改编未完成，原文件与改编清单已保留，可重试。'}});
    const failure=new AresError('新项目改编尚未完成，已保存可重试清单。'+(error instanceof AresError?error.message:''),409);failure.targetRoot=targetRoot;failure.reuseId=id;throw failure;
  }
}
export function applyReuse(body){
  if(body.confirm!==true)throw new AresError('请确认创建独立的新比赛项目',403);
  const preview=previewReuse(body);
  if(preview.token!==body.token)throw new AresError('比赛流程、作品映射或目录已变化，请重新预览',409);
  const configuration=readConfiguration(),flow=readCompetitionWorkflow(preview.scope,configuration);
  if(configuration.revision!==preview.configurationRevision||flow.workflowHash!==preview.definitionHash)throw new AresError('目标比赛流程已更新，请重新预览',409);
  const definition=freezeWorkflow(flow.workflow,configuration);
  if(!existsSync(preview.targetRoot))mkdirSync(preview.targetRoot);
  linkRoot(preview.targetRoot);
  const target=initializeProject({root:preview.targetRoot,name:preview.name,...preview.scope,definitionId:definition.id,flowMode:'competition',expectedWorkflowHash:preview.definitionHash,expectedConfigurationRevision:preview.configurationRevision});
  const {token,targets,gaps,ruleStatus,acceptanceInherited,...plan}=preview;
  const entry=saveResearchVersion({root:target.root,expectedRevision:target.revision},{kind:'reuse',title:'从 '+researchProject(body.root).name+' 改编',status:'copying',provenance:'source-project',data:{plan,targetDefinitionId:target.definitionId,status:'copying',gaps,acceptanceInherited:false}});
  return finishReuse(target.root,entry.item.id);
}
export function resumeReuse(body){
  if(body.confirm!==true)throw new AresError('请确认按原清单继续改编，不覆盖已变更的工作稿',403);
  researchProject(body.root);return finishReuse(body.root,body.id);
}
