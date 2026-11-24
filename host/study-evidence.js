import {readFileSync,writeFileSync,renameSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AresError,hash,safePath,readJson} from './storage.js';
import {readProject,changeProject,inspectOutput,inputHash,sourceFiles} from './projects.js?v=2.3.0-directory1';
import {projectEvent,captureCheckedArtifact,syntheticEvidence} from './project-artifacts.js';
import {putProjectObject,readProjectObject} from './project-objects.js';
import {researchProject,researchVersion,saveResearchVersion,researchEntry} from './project-research.js';
import {captureStudySource} from './study-sources.js';
import {factText,factVersion,evidenceImpact,sourceChanged} from './study-evidence-model.js';
import {readableBytes,textDifference} from './artifact-diff.js?v=2.3.0-directory1';

function scalar(value){if(typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean')return value;if(typeof value==='string'&&value.trim()&&value.length<=4000)return value.trim();throw new AresError('事实值需要有效文字或有限数值');}
async function evidenceSource(root,source,options) {
  if(source.kind==='file'){
    const snapshot=await captureStudySource({root,sourcePath:source.path},options);
    if(syntheticEvidence(root,researchProject(root),{valid:true,path:source.path,sha256:snapshot.object.sha256},{kind:'file'},{sourceFiles}))throw new AresError('模拟材料不能登记为实际事实证据',403);
    if(typeof source.quote!=='string'||!source.quote.trim()||source.quote.length>8000||!snapshot.text.includes(source.quote))throw new AresError('来源文件中找不到证据片段');
    const {text,...saved}=snapshot;
    return {kind:'file',snapshot:saved,quote:source.quote,start:text.indexOf(source.quote),end:text.indexOf(source.quote)+source.quote.length,locator:String(source.locator||'').slice(0,200)};
  }
  if(source.kind!=='research')throw new AresError('请选择项目文件或已有研究版本作为证据');
  const value=researchEntry(root,source.itemId,source.versionId);
  if(['synthetic','proposal'].includes(value.version.payload.provenance)||value.item.kind==='pretest')throw new AresError('模拟材料和未采用的建议不能作为实际事实证据',403);
  const serialized=JSON.stringify(value.data);
  if(typeof source.quote!=='string'||!source.quote.trim()||source.quote.length>8000||!serialized.includes(source.quote))throw new AresError('研究版本中找不到证据片段');
  return {kind:'research',itemId:value.item.id,versionId:value.version.id,object:value.version.payload.object,quote:source.quote,
    locator:String(source.locator||'').slice(0,200),provenance:value.version.payload.provenance};
}
function invalidate(p,stepIds,reason) {
  const affected=new Set(stepIds);
  for(const step of p.workflow.steps){
    if(step.dependsOn.some(id=>affected.has(id)))affected.add(step.id);
    if(affected.has(step.id)&&p.tasks[step.id].status==='done'){p.tasks[step.id].status='stale';p.tasks[step.id].reason=reason;}
  }
}
export async function saveFact(body,options={}) {
  if(body.confirmEvidence!==true)throw new AresError('请核对事实值和来源后保存',403);
  const p=researchProject(body.root),key=String(body.key||'');
  if(!/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(key))throw new AresError('事实标识使用英文字母、数字或下划线');
  if(Object.values(p.workbench.research?.items||{}).some(item=>item.kind==='fact'&&item.id!==body.id&&factVersion(p,item.id).data.key===key))throw new AresError('此项目已有相同事实标识');
  if(!Array.isArray(body.sources)||!body.sources.length||body.sources.length>10)throw new AresError('请为事实提供1至10项实际证据');
  const sources=[];for(const source of body.sources)sources.push(await evidenceSource(body.root,source,options));
  const value=scalar(body.value),unit=String(body.unit||'').slice(0,40),title=String(body.title||key).trim();
  const data={key,value,unit,sources,description:String(body.description||'').slice(0,3000),markdown:'# '+title+'\n\n'+String(value)+unit+'\n\n'+sources.map(source=>'> '+source.quote).join('\n\n')};
  const saved=saveResearchVersion(body,{kind:'fact',status:'owner-attested',title,provenance:'owner-attested',data});
  // The citation gate derives invalidation from fixed references and live source fingerprints.
  return saved;
}
function outputFor(project,artifactId) {
  const step=project.workflow.steps.find(row=>row.outputs.some(o=>o.id===artifactId)),output=step?.outputs.find(row=>row.id===artifactId&&row.kind==='file');
  if(!output)throw new AresError('请选择此项目中的独立作品文件');
  const path=join(project.outputDir,output.path).replaceAll('\\','/'),target=safePath(project.root,path,{existing:true}),bytes=readFileSync(target);
  if(bytes.length>4*1024*1024)throw new AresError('引用定位文件超过4MiB');
  return {step,output,path,target,bytes};
}
function oneValue(quote,data){
  const value=factText(data),start=quote.indexOf(value);
  if(start<0||quote.indexOf(value,start+value.length)>=0)return false;
  if(typeof data.value==='number'){
    const before=quote[start-1]||'',after=quote[start+String(data.value).length]||'';
    const end=start+String(data.value).length;
    if(/[\d+-]/.test(before)||before==='.'&&/\d/.test(quote[start-2]||'')||/\d/.test(after)||after==='.'&&/\d/.test(quote[end+1]||''))return false;
  }
  return true;
}
export function registerFactReference(body) {
  let result;
  const project=changeProject(body,p=>{
    const fact=factVersion(p,body.factId,body.factVersion),output=outputFor(p,body.artifactId);
    if(fact.item.head!==fact.version.id||fact.data.sources.some(source=>sourceChanged(p,source)))throw new AresError('事实或证据已更新，请先核对最新版本',409);
    const text=readableBytes(p.root,output.path,output.bytes).text;
    if(typeof body.quote!=='string'||!body.quote.trim()||body.quote.length>8000||!text?.includes(body.quote))throw new AresError('作品中找不到要关联的文字');
    if(!oneValue(body.quote,fact.data))throw new AresError('请选取只包含一次完整当前事实值的作品片段');
    const state=p.workbench.research;state.references??=[];
    const same=state.references.find(row=>row.factId===body.factId&&row.artifactId===body.artifactId&&row.quote===body.quote);
    result={id:same?.id||randomUUID(),factId:body.factId,factVersion:fact.version.id,artifactId:body.artifactId,stepId:output.step.id,path:output.path,
      quote:body.quote,citedValue:factText(fact.data),location:String(body.location||'').slice(0,200),targetSha256:hash(output.bytes)};
    state.references=state.references.filter(row=>row.id!==result.id);state.references.push(result);
    projectEvent(p.root,p,'research.reference-linked',{referenceId:result.id,factId:body.factId,artifactId:body.artifactId});
  });
  return {reference:result,revision:project.revision};
}
export function projectEvidence(root) {
  const p=researchProject(root);
  const facts=Object.values(p.workbench.research?.items||{}).filter(row=>row.kind==='fact').map(item=>{
    const value=factVersion(p,item.id);return {id:item.id,title:item.title,versionId:value.version.id,...value.data,sourceStale:value.data.sources.some(source=>sourceChanged(p,source))};
  });
  return {facts,uses:evidenceImpact(p)};
}
function prepared(p,body) {
  const use=p.workbench.research?.references?.find(row=>row.id===body.referenceId);
  if(!use)throw new AresError('引用不属于此项目',404);
  const fact=factVersion(p,use.factId),current=outputFor(p,use.artifactId);
  if(fact.data.sources.some(source=>sourceChanged(p,source)))throw new AresError('事实来源已更新，请先重新核对事实',409);
  const view=readableBytes(p.root,current.path,current.bytes);
  if(view.text===null||!view.text.includes(use.quote))throw new AresError('引用位置已经改动，请重新关联作品文字',409);
  const afterQuote=use.quote.replace(use.citedValue,factText(fact.data));
  const applicable=afterQuote!==use.quote&&['md','txt'].includes(current.output.format)&&view.text.split(use.quote).length===2;
  const after=applicable?Buffer.from(view.text.replace(use.quote,afterQuote)):null;
  const token=hash({projectId:p.id,revision:p.revision,referenceId:use.id,version:fact.version.id,before:hash(current.bytes),afterQuote});
  return {...current,use,fact,after,afterQuote,token,text:view.text};
}
export function previewFactUpdate(body) {
  const p=researchProject(body.root);if(p.revision!==body.expectedRevision)throw new AresError('项目已更新，请重新比较',409);
  const plan=prepared(p,body);
  return {token:plan.token,referenceId:plan.use.id,path:plan.path,canApply:!!plan.after,beforeSha256:hash(plan.bytes),
    difference:textDifference(plan.use.quote,plan.afterQuote),before:plan.use.quote,after:plan.afterQuote,
    note:plan.after?'确认后只更新该段事实值，并保存作品版本。':'请在原文档或金山中按差异修改，再重新关联引用。'};
}
export function applyFactUpdate(body) {
  if(body.confirmUpdate!==true)throw new AresError('请审阅引用差异后确认更新',403);
  const p=researchProject(body.root),plan=prepared(p,body);
  if(!plan.after||body.token!==plan.token)throw new AresError('更新预览已变化，请重新比较',409);
  const temporary=plan.target+'.evidence-'+randomUUID();let written=false,result;
  try{
    const project=changeProject(body,current=>{
      const actual=prepared(current,body);if(actual.token!==plan.token)throw new AresError('作品已变化，请重新比较',409);
      putProjectObject(current.root,actual.bytes);
      writeFileSync(temporary,actual.after,{flag:'wx'});renameSync(temporary,actual.target);written=true;
      const check=inspectOutput(current.root,current,actual.output,current.workflow.steps.flatMap(s=>s.outputs));
      if(!check.valid||check.sha256!==hash(actual.after))throw new AresError('更新后的作品未通过实际文件检查',409);
      const draft=captureCheckedArtifact(current.root,current,actual.step,actual.output,check,{sourceFiles,inputHash:inputHash(current,actual.step),
        inputVersions:actual.step.dependsOn.flatMap(id=>current.tasks[id].acceptedVersionIds||[]),provenance:{kind:'research',factId:actual.fact.item.id,versionId:actual.fact.version.id}});
      Object.assign(actual.use,{factVersion:actual.fact.version.id,quote:actual.afterQuote,citedValue:factText(actual.fact.data),targetSha256:check.sha256});
      // Other citations in this same file must also be checked against its new bytes.
      for(const use of current.workbench.research.references.filter(row=>row.path===actual.path)){
        if(actual.after.toString('utf8').includes(use.quote))use.targetSha256=check.sha256;
      }
      invalidate(current,[actual.step.id],'事实引用已更新，请重新复核作品');
      projectEvent(current.root,current,'research.reference-updated',{referenceId:actual.use.id,artifactVersionId:draft.id,sha256:check.sha256});
      result={artifactVersionId:draft.id,path:actual.path};
    });
    return {...result,revision:project.revision,accepted:false};
  }catch(error){
    const committed=readJson(safePath(p.root,'.ares/project.json')).workbench?.research?.references?.some(row=>row.id===plan.use.id&&row.factVersion===plan.fact.version.id&&row.targetSha256===hash(plan.after));
    if(!committed&&written&&existsSync(plan.target)&&hash(readFileSync(plan.target))===hash(plan.after)){writeFileSync(temporary,plan.bytes,{flag:'wx'});renameSync(temporary,plan.target);}
    throw error;
  }finally{if(existsSync(temporary))unlinkSync(temporary);}
}
