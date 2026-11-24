import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {extname} from 'node:path';
import {AresError,hash,now,safePath} from './storage.js';
import {changeProject} from './projects.js?v=2.3.0-directory1';
import {artifactVersion,projectEvent} from './project-artifacts.js';
import {readProjectObject,putProjectObject} from './project-objects.js';
import {researchOwner,researchProject,researchState,researchVersion,requireKind,saveResearchVersion,writeResearchVersion} from './project-research.js';
import {studyObjectText} from './study-sources.js';
import {projectPlan} from './project-plan.js';

const text=(value,label,max=4000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new AresError(label+'不能为空或过长');return value.trim();};
function entryFor(p,id,versionId){return requireKind(researchVersion(p,id,versionId),'defense');}
export function defenseContext(root){
  const p=researchProject(root);
  return {works:Object.values(p.workbench.artifacts).flatMap(a=>a.versionIds.slice().reverse().map(id=>{
    const v=artifactVersion(root,id);return {id,title:v.payload.title,stepId:v.payload.stepId,format:v.payload.format,synthetic:v.payload.provenance.kind==='synthetic'};
  })),followups:projectPlan(root).followups};
}
export async function prepareDefense(body,{signal}={}){
  const p=researchProject(body.root),known=new Set(Object.values(p.workbench.artifacts).flatMap(a=>a.versionIds));
  if(!Array.isArray(body.artifactVersionIds)||!body.artifactVersionIds.length||body.artifactVersionIds.length>8||new Set(body.artifactVersionIds).size!==body.artifactVersionIds.length||body.artifactVersionIds.some(id=>!known.has(id)))throw new AresError('请选择1至8份当前项目已固定的实际作品版本');
  const sources=[];
  for(const id of body.artifactVersionIds){
    const version=artifactVersion(p.root,id);
    if(version.payload.projectId!==p.id||version.payload.provenance.kind==='synthetic')throw new AresError('模拟作品或其他项目作品不能用作本项目答辩依据');
    if(version.payload.files.length>20)throw new AresError('请选取文档作品；大型目录请先整理为报告');
    for(const file of version.payload.files){
      const extracted=await studyObjectText(p.root,file,extname(file.workingPath).slice(1).toLowerCase(),{signal});
      sources.push({id:'s'+(sources.length+1),kind:'artifact',artifactVersionId:id,artifactId:version.payload.artifactId,stepId:version.payload.stepId,title:version.payload.title,location:file.workingPath,object:{sha256:file.sha256,bytes:file.bytes},...extracted});
    }
  }
  if(p.competition.ruleBaseline){
    const baseline=p.competition.ruleBaseline,bytes=readFileSync(safePath(p.root,baseline.snapshotPath,{existing:true}));
    if(hash(bytes)!==baseline.sha256)throw new AresError('比赛规则原文已变化，请重新核对后演练',409);
    const object=putProjectObject(p.root,bytes),extracted=await studyObjectText(p.root,object,extname(baseline.snapshotPath).slice(1).toLowerCase(),{signal});
    sources.push({id:'s'+(sources.length+1),kind:'rules',title:'当前项目规则原文',location:baseline.snapshotPath,object,...extracted,ruleStatus:p.competition.ruleStatus});
  }
  for(const item of Object.values(researchState(p).items).filter(item=>item.kind==='fact').slice(0,30)){
    const version=researchVersion(p,item.id),raw=JSON.stringify(version.data);
    sources.push({id:'s'+(sources.length+1),kind:'fact',title:item.title,researchId:item.id,versionId:version.version.id,location:'项目事实版本',textObject:putProjectObject(p.root,Buffer.from(raw)),textSha256:hash(raw)});
  }
  return saveResearchVersion(body,{kind:'defense',title:text(body.title||p.name+' · 答辩演练','演练名称',160),status:'ready',provenance:'practice',
    data:{sources,questions:[],answers:{},feedback:[],practiceOnly:true,competition:p.competition,preparedAt:now(),artifactVersionIds:[...body.artifactVersionIds]}});
}
function evidence(p,sources,rows){
  if(!Array.isArray(rows)||!rows.length||rows.length>8)throw new AresError('每个问题或反馈需要1至8条原文依据');
  return rows.map(row=>{
    const source=sources.find(s=>s.id===row?.sourceId),quote=text(row?.quote,'逐字依据',2000);
    if(!source||!readProjectObject(p.root,source.textObject.sha256).toString('utf8').includes(quote))throw new AresError('答辩依据不属于指定固定版本或没有逐字原文');
    return {sourceId:source.id,quote,location:text(row.location||source.location,'依据位置',400)};
  });
}
export function proposeDefense(body,actor){
  if(actor?.kind!=='agent')throw new AresError('缺少项目助手身份',403);
  const p=researchProject(body.root),design=body.design??{},source=entryFor(p,design.sourceId,design.sourceVersion),data=source.data;
  if(source.item.head!==source.version.id)throw new AresError('回答或演练稿已更新，请读取最新版本后提出建议',409);
  if(Boolean(design.questions)===Boolean(design.feedback))throw new AresError('问题设计与回答反馈请选择一项');
  const knownSteps=new Set(p.workflow.steps.map(s=>s.id));let questions=data.questions,feedback=data.feedback;
  if(design.questions){
    if(!Array.isArray(design.questions)||!design.questions.length||design.questions.length>30)throw new AresError('请提供1至30个有依据的演练问题');
    const ids=new Set();questions=design.questions.map(q=>{
      if(typeof q.id!=='string'||!/^[a-zA-Z][\w-]{0,63}$/.test(q.id)||ids.has(q.id)||!knownSteps.has(q.stepId))throw new AresError('演练问题标识重复或步骤不属于项目');
      ids.add(q.id);return {id:q.id,question:text(q.question,'演练问题'),stepId:q.stepId,evidence:evidence(p,data.sources,q.evidence)};
    });feedback=[];
  }else if(design.feedback){
    if(!Array.isArray(design.feedback)||!design.feedback.length||design.feedback.length>30)throw new AresError('请提供已保存回答的演练反馈');
    const ids=new Set();feedback=design.feedback.map(f=>{
      const q=questions.find(q=>q.id===f.questionId);
      if(!q||!data.answers[q.id]?.trim()||ids.has(q.id))throw new AresError('反馈需要对应已保存的实际回答且不能重复');
      ids.add(q.id);return {id:'f_'+q.id,questionId:q.id,stepId:q.stepId,observation:text(f.observation,'演练反馈'),suggestion:text(f.suggestion,'建议改进'),evidence:evidence(p,data.sources,f.evidence)};
    });
  }else throw new AresError('请选择提出问题或基于回答提供反馈');
  return saveResearchVersion({root:p.root,expectedRevision:body.expectedRevision},{kind:'defense',title:source.item.title,status:'proposal',provenance:'proposal',actor,
    source:{itemId:source.item.id,versionId:source.version.id},data:{...data,questions,answers:design.questions?{}:data.answers,feedback,practiceOnly:true}});
}
export function adoptDefense(body){
  if(body.confirm!==true)throw new AresError('请核对问题、回答及依据后采用演练建议',403);
  const p=researchProject(body.root),entry=entryFor(p,body.id,body.versionId);
  if(entry.item.head!==entry.version.id||entry.item.status!=='proposal')throw new AresError('请选择最新的待采用演练建议',409);
  const source=entry.version.payload.source;
  if(source&&researchVersion(p,source.itemId).version.id!==source.versionId)throw new AresError('建议依据的回答或演练稿已更新，请重新生成反馈',409);
  return saveResearchVersion({root:p.root,expectedRevision:body.expectedRevision},{kind:'defense',title:entry.item.title,status:'draft',provenance:'practice',source:{itemId:entry.item.id,versionId:entry.version.id},data:entry.data});
}
export function saveDefenseAnswers(body){
  const p=researchProject(body.root),entry=entryFor(p,body.id,body.versionId);
  if(entry.item.head!==entry.version.id||entry.item.status==='proposal'||!body.answers||typeof body.answers!=='object'||Array.isArray(body.answers))throw new AresError('请在已采用的最新演练稿填写回答',409);
  const answers={...entry.data.answers};
  for(const [id,value] of Object.entries(body.answers)){
    if(!entry.data.questions.some(q=>q.id===id)||typeof value!=='string'||value.length>8000)throw new AresError('回答与当前演练问题不符或超过8000字');
    answers[id]=value.trim();
  }
  return saveResearchVersion({...body,baseVersion:entry.version.id},{kind:'defense',title:entry.item.title,status:'draft',provenance:'practice',source:entry.version.payload.source,data:{...entry.data,answers,feedback:[]}});
}
export function defenseFollowup(body){
  if(body.confirm!==true)throw new AresError('请确认将此演练意见加入项目待办',403);
  let result;const project=changeProject(body,p=>{
    const entry=entryFor(p,body.id,body.versionId);
    if(entry.item.status==='proposal'||entry.item.head!==entry.version.id)throw new AresError('请先采用最新演练反馈',409);
    const finding=entry.data.feedback.find(f=>f.id===body.findingId);if(!finding)throw new AresError('演练反馈不存在');
    p.workbench.plan??={deadline:null,steps:{}};const followups=p.workbench.plan.followups??=[];
    const existing=followups.find(row=>row.sourceId===entry.item.id&&row.findingId===finding.id);
    if(existing){result=existing;return;}
    if(followups.length>=200)throw new AresError('项目待办达到200条，请先整理已有事项');
    result={id:randomUUID(),title:finding.suggestion,stepId:finding.stepId,status:'open',sourceId:entry.item.id,sourceVersion:entry.version.id,findingId:finding.id,createdAt:now()};
    followups.push(result);projectEvent(p.root,p,'defense.followup-created',result,researchOwner);
  });return {followup:result,revision:project.revision};
}
export function resolveDefenseFollowup(body){
  if(body.confirm!==true)throw new AresError('请确认此项目待办已完成',403);
  const p=changeProject(body,p=>{
    const row=p.workbench.plan?.followups?.find(row=>row.id===body.followupId);if(!row)throw new AresError('待办不属于此项目',404);
    row.status=body.reopen===true?'open':'done';row.updatedAt=now();projectEvent(p.root,p,'defense.followup-updated',{id:row.id,status:row.status});
  });return {revision:p.revision};
}
