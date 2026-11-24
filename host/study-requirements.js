import {AresError,hash} from './storage.js';
import {changeProject} from './projects.js?v=2.3.0-directory1';
import {projectEvent} from './project-artifacts.js';
import {readProjectObject} from './project-objects.js';
import {researchProject,researchVersion,requireKind,saveResearchVersion,writeResearchVersion} from './project-research.js';
import {captureStudySource} from './study-sources.js';
import {ruleItems} from './rule-checklist-model.js';

const scope=p=>({competitionId:p.competition.id,edition:p.competition.edition||'',track:p.competition.track,group:p.competition.group||''});
function text(value,label,max=1000){if(typeof value!=='string'||!value.trim()||value.length>max)throw new AresError(label+'需要有效文字');return value.trim();}
function checkedRows(project,rows,sourceText){
  if(!Array.isArray(rows)||!rows.length||rows.length>100)throw new AresError('请填写1至100项原文要求');
  const seen=new Set();
  return rows.map((row,index)=>{
    const label=text(row.label,'要求'),quote=text(row.quote,'原文摘录',4000),start=sourceText.indexOf(quote),id=row.id||'requirement-'+hash([index,quote]).slice(0,12);
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||seen.has(id))throw new AresError('要求标识重复或无效');seen.add(id);
    if(start<0)throw new AresError('原文中找不到摘录，不能保存为有来源的要求');
    if(!['mandatory','advisory'].includes(row.kind))throw new AresError('请选择必须满足或建议');
    const step=row.stepId?project.workflow.steps.find(s=>s.id===row.stepId):null;
    if(row.stepId&&!step||row.artifactId&&(!step||!step.outputs.some(o=>o.id===row.artifactId)))throw new AresError('要求映射不属于当前步骤或作品');
    return {id,label,quote,start,end:start+quote.length,kind:row.kind,stepId:row.stepId||null,artifactId:row.artifactId||null};
  });
}
function markdown(title,rows){return '# '+title+'\n\n'+rows.map(row=>'## '+row.label+'\n\n> '+row.quote+'\n\n'+(row.stepId?'对应步骤 '+row.stepId:'尚未安排步骤')).join('\n\n');}
export async function importRequirements(body,options) {
  const p=researchProject(body.root),source=await captureStudySource(body,options);
  const paragraphs=source.text.split('\n').map(row=>row.trim()).filter(row=>row.length>3&&row.length<=1000);
  const candidate=paragraphs.filter(row=>/必须|应当|不得|须|提交|截止|限于|不少于|不超过|required|must|deadline/i.test(row)).slice(0,100);
  const rows=candidate.length?checkedRows(p,candidate.map((quote,index)=>({label:quote,quote,kind:'mandatory',id:'requirement-'+index})),source.text):[];
  const {text:_,...snapshot}=source,title=text(body.title||'本届比赛要求','标题',160);
  return saveResearchVersion(body,{kind:'requirements',status:'draft',title,provenance:'source-material',
    data:{scope:scope(p),source:snapshot,rows,method:'paragraph-candidates',markdown:markdown(title,rows)}});
}
export function saveRequirements(body,{actor={kind:'user',id:'owner'},proposal=false}={}) {
  const p=researchProject(body.root),previous=requireKind(researchVersion(p,body.sourceId||body.id,body.sourceVersion||body.baseVersion),'requirements');
  if(hash(scope(p))!==hash(previous.data.scope))throw new AresError('条款来源与本项目比赛范围不符',409);
  const sourceText=readProjectObject(p.root,previous.data.source.textObject.sha256).toString('utf8');
  const rows=checkedRows(p,body.rows,sourceText),title=text(body.title||previous.item.title,'标题',160);
  return saveResearchVersion(proposal?{root:body.root,expectedRevision:body.expectedRevision}:body,{
    kind:'requirements',status:proposal?'proposal':'draft',title,actor,provenance:proposal?'proposal':'source-material',
    source:{itemId:previous.item.id,versionId:previous.version.id},data:{scope:previous.data.scope,source:previous.data.source,rows,markdown:markdown(title,rows)}});
}
export function adoptRequirements(body) {
  if(body.confirmOriginal!==true)throw new AresError('请由负责人核对原文、适用范围和映射后采用',403);
  let result;
  const project=changeProject(body,p=>{
    const value=requireKind(researchVersion(p,body.id,body.versionId),'requirements');
    if(value.item.head!==value.version.id||hash(scope(p))!==hash(value.data.scope))throw new AresError('要求版本或比赛范围已变化，请重新核对',409);
    const sourceText=readProjectObject(p.root,value.data.source.textObject.sha256).toString('utf8');
    const rows=checkedRows(p,value.data.rows,sourceText);
    const adopted=rows.map(row=>({id:'study-'+hash([value.item.id,row.id]).slice(0,20),label:row.label,kind:row.kind,sourceId:value.item.id}));
    const others=ruleItems(p).filter(row=>row.sourceId!==value.item.id);
    if(others.length+adopted.length>100)throw new AresError('合并后超过100项，请先整理现有条目');
    p.competition.ruleChecklist={items:[...others,...adopted],checks:p.competition.ruleChecklist?.checks||{}};
    p.competition.ruleStatus='unreviewed';
    result=writeResearchVersion(p,{id:value.item.id,baseVersion:value.version.id},{kind:'requirements',status:'adopted',title:value.item.title,
      data:{...value.data,adoptedRuleIds:adopted.map(row=>row.id)},provenance:'owner-attested'});
    projectEvent(p.root,p,'research.requirements-adopted',{itemId:value.item.id,versionId:result.version.id,ruleIds:adopted.map(row=>row.id)});
  });
  return {...result,revision:project.revision};
}
export function requirementsCoverage(root) {
  const p=researchProject(root);
  return Object.values(p.workbench.research?.items||{}).filter(item=>item.kind==='requirements').map(item=>{
    const value=researchVersion(p,item.id),rows=value.data.rows;
    return {id:item.id,title:item.title,versionId:value.version.id,status:item.status,scope:value.data.scope,
      rows:rows.map(row=>({...row,mapped:!!row.stepId,stepTitle:p.workflow.steps.find(s=>s.id===row.stepId)?.title||'',
        state:row.stepId?p.tasks[row.stepId]?.status||'pending':'unmapped'}))};
  });
}
