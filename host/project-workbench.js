import {projectProduct} from './project-product.js?v=2.3.0-competition1';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AresError,clone,hash,safePath,now,atomicJson} from './storage.js';
import {readProject,changeProject,inspectOutput,sourceFiles,inputHash,inspectProjectSubmission} from './projects.js?v=2.3.0-directory1';
import {ensureProjectWorkbench,captureCheckedArtifact,captureTaskArtifacts,artifactVersion,artifactHeads,projectEvent,relativeName,addReleaseFiles,syntheticEvidence} from './project-artifacts.js';
import {putProjectObject,putProjectRecord,readProjectRecord,readProjectObject} from './project-objects.js';

const actorDefault={kind:'user',id:'owner'};
const shortText=(value,label,max=200)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new AresError(label+'不能为空或过长');return value.trim();};
export function projectWorkbench(root,{offset=0,limit=20}={}){
 const p=readProject(root);if(p.kind!=='v2')return {project:p};
 if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50)throw new AresError('历史分页无效');
 const state=ensureProjectWorkbench(p),ids=[...state.eventIds].reverse();
 return {project:p,product:projectProduct(p),artifacts:artifactHeads(p.root,p),releases:[...state.releaseIds].reverse().map(id=>{try{const r=readProjectRecord(p.root,'releases',id);return {id:r.id,createdAt:r.createdAt,title:r.payload.title,kind:r.payload.kind,stepIds:r.payload.stepIds,artifactCount:r.payload.artifactVersionIds.length,fileCount:r.payload.files.length};}catch(error){return {id,title:'历史版本损坏，未采用工作稿替代',kind:'damaged',artifactCount:0,fileCount:0,error:error.message};}}),timeline:ids.slice(offset,offset+limit).map(id=>{try{return readProjectRecord(p.root,'events',id);}catch(error){return {id,payload:{type:'history.damaged',at:null,detail:{error:error.message}}};}}),totalEvents:ids.length,nextOffset:offset+limit<ids.length?offset+limit:null};
}
export function artifactHistory(root,artifactId){const p=readProject(root),entry=ensureProjectWorkbench(p).artifacts[artifactId];if(!entry)throw new AresError('该作品尚未固定版本',404);return {versions:[...entry.versionIds].reverse().map(id=>artifactVersion(p.root,id,{verify:false})),acceptedVersionIds:p.tasks[entry.stepId]?.acceptedVersionIds||[]};}
export function captureDraft(body,actor=actorDefault){return changeProject(body,(p,v)=>{
 const step=v.workflow.steps.find(s=>s.id===body.stepId);if(!step)throw new AresError('请选择流程节点');
 const all=v.workflow.steps.flatMap(s=>s.outputs),selected=step.outputs.filter(o=>!body.artifactId||o.id===body.artifactId);if(!selected.length)throw new AresError('节点没有此作品');
 const versions=[];for(const output of selected){const check=inspectOutput(p.root,p,output,all);if(check.valid)versions.push(captureCheckedArtifact(p.root,p,step,output,check,{actor,sourceFiles,inputHash:inputHash(p,step),inputVersions:step.dependsOn.flatMap(id=>p.tasks[id]?.acceptedVersionIds||[])}));else if(body.artifactId)throw new AresError(check.error||'作品检查失败');}
 if(!versions.length)throw new AresError('尚无通过实际文件检查的作品，未创建空版本');
 projectEvent(p.root,p,'artifact.draft',{stepId:step.id,artifactVersionIds:versions.map(r=>r.id)},actor);
});}
function reviewedArtifactVersions(root,project,version,step,checks,actor){
 const task=project.tasks[step.id],expected=task.artifactHashes||{};
 const reviewed=checks.filter(check=>Object.hasOwn(expected,check.id));
 if(Object.keys(expected).length!==reviewed.length||reviewed.some(check=>!check.valid||check.sha256!==expected[check.id])||task.inputHash!==inputHash(project,step))throw new AresError('已验收作品或输入发生变化，请重新复核：'+step.title,409);
 if(step.outputs.some(output=>checks.find(check=>check.id===output.id)?.required&&!Object.hasOwn(expected,output.id)))throw new AresError('必需作品尚未绑定内容复核：'+step.title,409);
 const reviewBytes=readFileSync(safePath(root,task.reviewPath,{existing:true}));if(hash(reviewBytes)!==task.reviewHash)throw new AresError('内容复核记录发生变化，请重新验收',409);
 if(reviewed.some(check=>syntheticEvidence(root,project,check,step.outputs.find(o=>o.id===check.id),{sourceFiles})))throw new AresError('模拟预测试产物不能作为正式阶段或提交版证据',409);
 let ids=task.acceptedVersionIds||[];
 if(!ids.length&&reviewed.length){ids=captureTaskArtifacts(root,project,version.workflow,step,reviewed,{actor,sourceFiles,inputHash:task.inputHash});task.acceptedVersionIds=ids;}
 const records=ids.map(id=>artifactVersion(root,id));
 if(hash(records.map(r=>r.payload.artifactId).sort())!==hash(Object.keys(expected).sort())||records.some(r=>r.payload.projectId!==project.id||r.payload.stepId!==step.id||r.payload.artifactHash!==expected[r.payload.artifactId]))throw new AresError('已验收作品版本引用不完整或不匹配，未替换为当前工作稿',409);
 task.reviewObject=putProjectObject(root,reviewBytes).sha256;
 return ids;
}
function collectWorkingRelease(root,p,v,kind,ids,actor){
 if(kind!=='checkpoint')for(const id of ids){const s=v.workflow.steps.find(s=>s.id===id);if(p.tasks[id].status!=='done'||s.dependsOn.some(dep=>!ids.includes(dep)))throw new AresError('阶段版本必须包含已验收节点及其全部前置节点',409);}
 const all=v.workflow.steps.flatMap(s=>s.outputs),versionIds=[];
 for(const step of v.workflow.steps.filter(s=>ids.includes(s.id))){const checks=step.outputs.map(o=>inspectOutput(root,p,o,all));
  if(kind!=='checkpoint'&&checks.some(c=>c.required&&!c.valid))throw new AresError('固定版本前作品检查失败：'+step.title,409);
  const captured=kind==='checkpoint'?captureTaskArtifacts(root,p,v.workflow,step,checks,{actor,sourceFiles,inputHash:inputHash(p,step)}):reviewedArtifactVersions(root,p,v,step,checks,actor);versionIds.push(...captured);
 }
 if(!versionIds.length)throw new AresError('没有可固定的实际作品');
 const fileMap=new Map();for(const id of versionIds){const version=artifactVersion(root,id);if(kind!=='checkpoint'&&version.payload.provenance.kind==='synthetic')throw new AresError('模拟预测试产物不能作为正式阶段或提交版证据',409);addReleaseFiles(fileMap,version.payload.files);}
 return {artifactVersionIds:[...new Set(versionIds)],files:[...fileMap.values()]};
}
function snapshot(root,p,v,body,actor){
 const kind=body.kind||'checkpoint';if(!['checkpoint','stage','submission'].includes(kind))throw new AresError('版本类型无效');
 const ids=body.stepIds??(kind==='stage'?v.workflow.steps.filter(s=>p.tasks[s.id].status==='done').map(s=>s.id):v.workflow.steps.map(s=>s.id));
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!v.workflow.steps.some(s=>s.id===id)))throw new AresError('请选择有效且不重复的节点');
 let contents;
 if(kind==='submission'){
  if(ids.length!==v.workflow.steps.length)throw new AresError('提交版必须包含整套流程');
  // Under the project write lock, use the exact immutable files verified by the same gate as the report.
  const {report,submission}=inspectProjectSubmission(p,v);
  if(!submission)throw new AresError('提交版仍有未验收节点或规则缺口：'+report.blocking[0].reason,409);
  contents=submission;
 }else contents=collectWorkingRelease(root,p,v,kind,ids,actor);
 const rules=p.competition.ruleBaseline?{...clone(p.competition.ruleBaseline),object:putProjectObject(root,readFileSync(safePath(root,p.competition.ruleBaseline.snapshotPath,{existing:true}))).sha256}:null;if(rules&&rules.sha256!==rules.object)throw new AresError('规则原文在固定版本时变化，请重新复核',409);
 const release=putProjectRecord(root,'releases',{projectId:p.id,title:shortText(body.title||p.name+' · '+({checkpoint:'工作快照',stage:'阶段版本',submission:'提交版本'}[kind]),'版本名称'),kind,stepIds:ids,...contents,definition:v,facts:clone(p.facts),competition:clone(p.competition),ruleBaseline:rules,tasks:clone(p.tasks),outputDir:p.outputDir,extensionBindings:clone(ensureProjectWorkbench(p).extensionBindings||{}),extensionVersions:Object.values(p.workbench.extensions||{}).map(e=>({id:e.id,manifestHash:e.manifestHash,version:e.version})),extensionRunIds:[...(p.workbench.extensionRunIds||[])],baseRevision:p.revision,actor,at:now()});
 ensureProjectWorkbench(p).releaseIds.push(release.id);return release;
}
export function freezeProjectRelease(body,actor=actorDefault){let release;const project=changeProject(body,(p,v)=>{release=snapshot(p.root,p,v,body,actor);projectEvent(p.root,p,'release.frozen',{releaseId:release.id,kind:release.payload.kind,title:release.payload.title},actor);});return {project,release};}
export function readRelease(root,id){const p=readProject(root);if(!ensureProjectWorkbench(p).releaseIds.includes(id))throw new AresError('版本不属于此项目',403);const r=readProjectRecord(p.root,'releases',id);if(r.payload.projectId!==p.id)throw new AresError('版本项目不一致',409);const {id:definitionId,createdAt,...definition}=r.payload.definition;if(hash(definition)!==definitionId)throw new AresError('历史流程快照损坏',409);for(const f of r.payload.files)readProjectObject(p.root,f.sha256);for(const task of Object.values(r.payload.tasks))if(task.reviewObject)readProjectObject(p.root,task.reviewObject);if(r.payload.ruleBaseline?.object)readProjectObject(p.root,r.payload.ruleBaseline.object);return r;}
export function restoreRelease(body,actor=actorDefault){let draftPath;const project=changeProject(body,(p)=>{
 const r=readRelease(p.root,body.releaseId),release=r.payload;
 // A separate draft tree avoids overwriting any current output, even when restoration fails.
 draftPath='恢复工作稿/'+r.id.slice(0,10)+'-'+randomUUID().slice(0,8);
 const outputDir=draftPath+'/作品',prefix=relativeName(release.outputDir).replace(/\/+$/,'')+'/';
 for(const file of release.files){const previousPath=relativeName(file.workingPath);if(!previousPath.startsWith(prefix))throw new AresError('历史作品路径不属于其输出目录，未恢复越界内容',409);const target=safePath(p.root,outputDir+'/'+previousPath.slice(prefix.length));mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readProjectObject(p.root,file.sha256),{flag:'wx'});}
 const definition=release.definition,{id,createdAt,...payload}=definition;if(hash(payload)!==id)throw new AresError('恢复流程快照损坏',409);
 atomicJson(safePath(p.root,'.ares/definitions/'+id+'.json'),definition);
 p.definitionId=id;p.outputDir=outputDir;p.facts=clone(release.facts);p.competition={...clone(release.competition),ruleStatus:'needs-restored-draft-verification'};
 p.tasks=Object.fromEntries(definition.workflow.steps.map(step=>[step.id,{status:'stale',attempts:p.tasks[step.id]?.attempts||0,reason:'已从历史版本恢复为新工作稿，请复核后验收',artifactHashes:{},checks:[],restoredAcceptedVersionIds:release.tasks[step.id]?.acceptedVersionIds||[]}]));
 const state=ensureProjectWorkbench(p);for(const entry of Object.values(state.artifacts))entry.currentVersionId=null;
 const all=definition.workflow.steps.flatMap(step=>step.outputs);
 for(const versionId of release.artifactVersionIds){const source=artifactVersion(p.root,versionId),step=definition.workflow.steps.find(step=>step.id===source.payload.stepId),output=step?.outputs.find(output=>output.id===source.payload.artifactId);if(!step||!output)throw new AresError('历史作品与固定流程节点不匹配',409);const check=inspectOutput(p.root,p,output,all);if(!check.valid||check.sha256!==source.payload.artifactHash)throw new AresError('恢复后的实际作品未通过与原版本相同的检查',409);captureCheckedArtifact(p.root,p,step,output,check,{actor,sourceFiles,inputHash:inputHash(p,step),inputVersions:source.payload.inputVersions,provenance:source.payload.provenance,sourceVersionId:source.id});}
 ensureProjectWorkbench(p).restoredExtensionReferences={bindings:release.extensionBindings||{},versions:release.extensionVersions||[],note:'历史能力只作版本参考，当前权限不自动恢复；启用或绑定需明确确认'};ensureProjectWorkbench(p).activeDraft={path:draftPath,fromRelease:r.id,restoredAt:now()};projectEvent(p.root,p,'release.restored-as-draft',{releaseId:r.id,draftPath},actor);
 });return {project,draftPath};}
export function updateTeam(body,actor=actorDefault){return changeProject(body,(p,v)=>{
 const state=ensureProjectWorkbench(p);
 if(body.action==='member'){const id=body.id||'member-'+randomUUID().slice(0,12);if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id))throw new AresError('队员标识无效');const current=state.team.find(m=>m.id===id);if(id==='owner'&&body.role&&body.role!=='leader')throw new AresError('本机负责人须保留管理职责');const member={id,name:shortText(body.name,'队员姓名',80),role:body.role||current?.role||'member'};if(!['leader','member','reviewer'].includes(member.role))throw new AresError('队内职责无效');state.team=state.team.filter(m=>m.id!==id);state.team.push(member);projectEvent(p.root,p,'team.member-updated',member,actor);}
 else if(body.action==='remove'){if(body.id==='owner')throw new AresError('不能删除本机负责人');if(Object.values(p.tasks).some(t=>t.assigneeId===body.id||t.collaboratorIds?.includes(body.id)))throw new AresError('请先调整该队员负责的节点');state.team=state.team.filter(m=>m.id!==body.id);projectEvent(p.root,p,'team.member-removed',{memberId:body.id},actor);}
 else if(body.action==='assign'){if(!v.workflow.steps.some(s=>s.id===body.stepId)||!state.team.some(m=>m.id===body.memberId))throw new AresError('节点或队员不存在');const collaborators=body.collaboratorIds??p.tasks[body.stepId].collaboratorIds??[];if(!Array.isArray(collaborators)||collaborators.length>32||collaborators.some(id=>typeof id!=='string'||!state.team.some(row=>row.id===id)))throw new AresError('参与队员不属于当前项目');p.tasks[body.stepId].assigneeId=body.memberId;p.tasks[body.stepId].collaboratorIds=[...new Set(collaborators)].filter(id=>id!==body.memberId);projectEvent(p.root,p,'task.assigned',{stepId:body.stepId,memberId:body.memberId,collaboratorIds:p.tasks[body.stepId].collaboratorIds},actor);}
 else throw new AresError('未知队员操作');
 });}
