import {readFileSync} from 'node:fs';
import {AresError,hash,safePath} from './storage.js';
import {readProjectObject,readProjectRecord} from './project-objects.js';

export const factText=data=>String(data.value)+(data.unit||'');
export function factVersion(project,id,versionId) {
  const item=project.workbench?.research?.items?.[id],wanted=versionId||item?.head;
  if(item?.kind!=='fact'||!Array.isArray(item.versions)||!item.versions.includes(wanted))throw new AresError('事实版本不属于项目',404);
  const version=readProjectRecord(project.root,'research-versions',wanted);
  if(version.payload.projectId!==project.id||version.payload.itemId!==id||version.payload.kind!=='fact')throw new AresError('事实版本身份不符',409);
  return {item,version,data:JSON.parse(readProjectObject(project.root,version.payload.object.sha256))};
}
export function sourceChanged(project,source) {
  try{
    if(source.kind==='file')return hash(readFileSync(safePath(project.root,source.snapshot.sourcePath,{existing:true})))!==source.snapshot.object.sha256;
    const item=project.workbench.research.items[source.itemId];
    if(!item||item.head!==source.versionId)return true;
    const record=readProjectRecord(project.root,'research-versions',source.versionId);
    return record.payload.projectId!==project.id||record.payload.itemId!==source.itemId||record.payload.object.sha256!==source.object.sha256;
  }catch{return true;}
}
export function evidenceImpact(project) {
  const references=project.workbench?.research?.references??[];
  if(!Array.isArray(references))return [{id:null,state:'unavailable',sourceStale:true}];
  return references.map(use=>{
    try{
      const fact=factVersion(project,use.factId),step=project.workflow.steps.find(s=>s.id===use.stepId),output=step?.outputs.find(o=>o.id===use.artifactId);
      if(!output)throw new Error('作品已从流程中移除');
      const actual=readFileSync(safePath(project.root,use.path,{existing:true}));
      const sourceStale=fact.data.sources.some(source=>sourceChanged(project,source));
      const state=sourceStale?'source-updated':use.factVersion!==fact.version.id?'fact-updated':hash(actual)!==use.targetSha256?'target-edited':'current';
      return {...use,factTitle:fact.item.title,latestVersion:fact.version.id,latestValue:factText(fact.data),stepTitle:step.title,artifactTitle:output.title,state,sourceStale};
    }catch{return {...use,state:'unavailable',sourceStale:true};}
  });
}
export function studyEvidenceIssues(project) {
  return evidenceImpact(project).filter(row=>row.state!=='current').map(row=>({code:'evidence-reference-stale',stepId:row.stepId,artifactId:row.artifactId,
    referenceId:row.id,reason:'作品引用的事实、原始证据或对应段落发生变化，请重新核对引用'}));
}
