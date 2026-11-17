/** Read-only internal delivery report. No network calls or acceptance writes. */
import {readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {hash,safePath,now} from './storage.js';
import {artifactVersion,completeDirectory} from './project-artifacts.js';
import {readProjectObject,readProjectRecord} from './project-objects.js';
import {verifyFrozenResources} from './native-versions.js';
import {ruleItems,ruleItemState} from './rule-checklist-model.js';
import {readNodeRunRecord} from './node-run-records.js';

function executionReport(project,block,warnings){
 const runs=[];
 const ended=new Set(['awaiting-review','awaiting-review-with-warnings','failed','cancelled']);
 for(const id of project.workbench?.nodeRunIds||[]){try{
  const record=readNodeRunRecord(project,id),calls=(record.calls||[]).map(row=>({name:row.name,status:row.status,callSeq:row.callSeq??null,resultSeq:row.resultSeq??null})),jobs=(record.jobs||[]).map(row=>({status:row.status,terminalExitReported:typeof row.detail==='string'&&row.detail.startsWith('exit code:'),exitCode:/^exit code: (-?\d+)(?:;|$)/.exec(row.detail||'')?.[1]??null}));
  runs.push({id,stepId:record.stepId,definitionId:record.definitionId,sessionId:record.sessionId,status:record.status,calls,jobs,finishedAt:record.finishedAt||null});
  if(!ended.has(record.status)||record.status.startsWith('awaiting-review')&&!calls.some(row=>row.status==='succeeded')||calls.some(row=>!['succeeded','failed'].includes(row.status))||jobs.some(row=>!['completed','failed','killed'].includes(row.status)||row.terminalExitReported&&row.exitCode===null))block({code:'node-execution-unresolved',stepId:record.stepId,runId:id,reason:'节点执行或工具结果尚未核对完成'});
  else if(['failed','cancelled','awaiting-review-with-warnings'].includes(record.status)||calls.some(row=>row.status==='failed')||jobs.some(row=>row.status!=='completed'||row.exitCode!==null&&row.exitCode!=='0'))warnings.push({code:'execution-history-warning',stepId:record.stepId,runId:id,reason:'执行历史包含失败或取消记录；负责人验收不把这些调用改记为成功'});
 }catch{block({code:'node-execution-damaged',runId:id,reason:'节点执行记录缺失、损坏或不属于此项目'});}}
 return {runs,verification:'stored-node-run-records-only',note:'列出项目实际保存的执行和工具回执；本次检查没有启动模型，也未重新查询运行中的宿主任务。手工提供作品不虚构执行记录。'};
}

function cloudReport(project,block){
 const cloud=project.workbench?.collaboration||{},operations=[];
 const terminal=new Set(['uploaded-verified','published-metadata-verified','editable-link-verified','explicit-role-verified','comment-readback-verified','annotation-readback-verified','failed-before-write']);
 for(const field of ['workingUploads','publications','permissionOperations','linkOperations','commentOperations','annotationOperations']){
  if(cloud[field]!==undefined&&!Array.isArray(cloud[field])){block({code:'cloud-receipts-invalid',reason:'云端操作回执结构损坏：'+field});continue;}
  for(const row of cloud[field]||[]){
   const operation={kind:field,operationId:row?.operationId||row?.opId||null,fileId:row?.fileId||null,releaseId:row?.releaseId||null,status:row?.status||'unknown',verification:row?.verification||null,finishedAt:row?.finishedAt||null};
   operations.push(operation);
   if(!terminal.has(operation.status))block({code:'cloud-operation-unresolved',operationId:operation.operationId,reason:'云端操作尚未核对完成：'+field+' · '+operation.status});
  }
 }
 return {status:cloud.provider?'stored-receipts':'not-configured',provider:cloud.provider||null,operations,verification:'stored-independent-readback-only',note:'只检查已保存的云端操作与独立读回回执，本次报告没有重新联网；元数据核对不等于下载文件逐字节核对。'};
}

export function buildProjectVerification(project,{definition,checkStep,ruleEvidence,ruleIssues}){
 const blocking=[],warnings=[],steps=[],files=new Map(),block=row=>blocking.push(row);
 const acceptances=new Map();
 // Actor identity belongs to the immutable task.accepted event, not the
 // content-addressed artifact payload (the same bytes can have several reviews).
 for(const id of project.workbench?.eventIds||[]){try{const event=readProjectRecord(project.root,'events',id).payload;if(event.projectId!==project.id)throw new Error('Foreign event');if(event.type==='task.accepted'){if(typeof event.detail?.stepId!=='string'||!Array.isArray(event.detail.artifactVersionIds)||typeof event.detail.reviewHash!=='string')throw new Error('Invalid acceptance');acceptances.set(event.detail.stepId,event);}}catch{block({code:'acceptance-history-damaged',reason:'验收事件历史缺失、损坏或不属于此项目'});}}
 const workflow={definitionId:definition.id,workflowId:definition.workflow.id,state:'verified',steps:definition.workflow.steps.length,skills:definition.skills.map(skill=>({id:skill.id,sha256:hash(skill.content),resources:skill.resources.length}))};
 try{verifyFrozenResources(definition);}catch{workflow.state='invalid';block({code:'fixed-resources-invalid',reason:'固定流程的技能或资源缺失、损坏，请恢复对应固定版本后再检查'});}
 function addFile(row){const key=row.path.replaceAll('\\','/'),previous=files.get(key);files.set(key,{...previous,...row,path:key,stepIds:[...new Set([...(previous?.stepIds||[]),row.stepId])],accepted:previous?.accepted===true||row.accepted===true});}
 for(const step of project.workflow.steps){
  const task=project.tasks[step.id],dependencies=step.dependsOn.map(id=>({stepId:id,status:project.tasks[id]?.status||'missing'}));
  if(task.status!=='done')block({code:'task-not-accepted',stepId:step.id,title:step.title,status:task.status,reason:task.reason||'尚未验收'});
  if(task.status==='done'&&dependencies.some(row=>row.status!=='done'))block({code:'dependency-not-accepted',stepId:step.id,reason:'前置任务尚未验收'});
  let checked;try{checked=checkStep(step);}catch{checked={passed:false,checks:[],error:'实际作品读取失败'};}
  if(!checked.passed)block({code:'artifact-check-failed',stepId:step.id,reason:'实际作品尚未通过检查',artifacts:checked.checks.filter(row=>row.required&&!row.valid).map(row=>({id:row.id,reason:row.error||row.state}))});
  const review={state:'pending',reviewer:task.review?.reviewer||null,path:task.reviewPath||null,sha256:task.reviewHash||null,summary:task.review?.summary||null};
  if(task.status==='done'){
   try{
    const bytes=readFileSync(safePath(project.root,task.reviewPath,{existing:true})),value=JSON.parse(bytes.toString('utf8'));
    if(hash(bytes)!==task.reviewHash||!task.reviewObject||hash(readProjectObject(project.root,task.reviewObject))!==task.reviewHash||value.passed!==true||!Array.isArray(value.findings)||value.findings.some(row=>row.severity==='blocking'&&!row.resolved)||hash(value.artifactHashes)!==hash(task.artifactHashes))throw new Error('Invalid review');
    review.state=task.review?.reviewer==='user'&&value.reviewer==='user'?'owner-reviewed':'agent-reviewed';
    if(review.state!=='owner-reviewed')block({code:'owner-review-required',stepId:step.id,reason:'此步骤仍需负责人复核；助手的内容报告不能替代负责人验收'});
   }catch{review.state='invalid';block({code:'content-review-invalid',stepId:step.id,reason:'实际内容复核文件或固定复核对象缺失、损坏或不匹配'});}
   const accepted=acceptances.get(step.id);
   if(accepted?.actor?.kind!=='user'||accepted?.actor?.id!=='owner'||accepted.detail.reviewHash!==task.reviewHash||hash(accepted.detail.artifactVersionIds)!==hash(task.acceptedVersionIds||[])){review.state='non-owner-reviewed';block({code:'owner-review-required',stepId:step.id,reason:'当前固定作品及复核记录尚无匹配的负责人验收事件'});}
  }
  const acceptedVersionIds=task.acceptedVersionIds||[],acceptedArtifacts=new Set();
  for(const id of acceptedVersionIds){try{
   const record=artifactVersion(project.root,id),value=record.payload,check=checked.checks.find(row=>row.id===value.artifactId);
   if(value.projectId!==project.id||value.inputHash!==task.inputHash||value.stepId!==step.id||!check?.valid||value.artifactHash!==check.sha256||task.artifactHashes?.[value.artifactId]!==check.sha256||value.provenance?.kind==='synthetic')throw new Error('Invalid accepted version');
   acceptedArtifacts.add(value.artifactId);
   for(const file of value.files)addFile({path:file.workingPath,sha256:file.sha256,bytes:file.bytes,artifactId:value.artifactId,stepId:step.id,versionId:id,sourceDefinitionId:value.definitionId,accepted:task.status==='done'});
  }catch{block({code:'accepted-version-invalid',stepId:step.id,versionId:id,reason:'已验收作品版本的内容、来源或引用不匹配'});}}
  for(const check of checked.checks){
   if(task.status==='done'&&check.required&&!acceptedArtifacts.has(check.id))block({code:'accepted-version-missing',stepId:step.id,artifactId:check.id,reason:'必需作品没有绑定当前实际文件的验收版本'});
   if(!check.valid||acceptedArtifacts.has(check.id))continue;
   if(!check.required)warnings.push({code:'optional-draft-unreviewed',stepId:step.id,artifactId:check.id,reason:'此可选工作稿未包含在本次验收版本中'});
   if(check.kind==='directory'){for(const file of completeDirectory(safePath(project.root,check.path,{existing:true})))addFile({path:join(check.path,file.path),sha256:file.sha256,bytes:statSync(safePath(project.root,join(check.path,file.path),{existing:true})).size,artifactId:check.id,stepId:step.id,accepted:false});}
   else addFile({path:check.path,sha256:check.sha256,bytes:statSync(safePath(project.root,check.path,{existing:true})).size,artifactId:check.id,stepId:step.id,accepted:false});
  }
  steps.push({stepId:step.id,title:step.title,status:task.status,execution:step.execution,dependencies,acceptedVersionIds,checks:checked.checks,review});
 }
 const baseline=project.competition.ruleBaseline,items=ruleItems(project).map(item=>({...item,state:ruleItemState(project,item)})),mandatory=items.filter(item=>item.kind!=='advisory');
 if(project.competition.ruleStatus!=='reviewed')block({code:'rules-not-current',reason:'当届、组别及作品类型的规则基线尚未复核'});
 if(!baseline||baseline.reviewer!=='user')block({code:'rules-owner-review-required',reason:'本届规则原文仍需负责人核对，助手登记不能代替负责人确认'});
 const scope={competitionId:project.competition.id,edition:project.competition.edition,track:project.competition.track,group:project.competition.group||''};
 if(!baseline?.scopeBinding||hash(baseline.scopeBinding)!==hash(scope))block({code:'rules-scope-mismatch',reason:'规则基线未绑定当前比赛、届次、赛道及组别'});
 if(!mandatory.length)block({code:'rules-checklist-missing',reason:'尚未建立本届规则的必需条目，请先按原文逐项核对'});
 blocking.push(...ruleIssues);
 const rules={state:blocking.some(row=>row.code?.startsWith('rules-')||row.ruleId)?'pending':'verified',scope,baseline:baseline||null,mandatory:mandatory.length,confirmed:mandatory.filter(item=>item.state==='confirmed').length,items};
 const cloud=cloudReport(project,block),execution=executionReport(project,block,warnings),actualFiles=[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),checksPassed=blocking.length===0;
 return {schema_version:'3.0',verificationRevision:2,kind:'ares-project-verification',projectId:project.id,projectRevision:project.revision,checkedAt:now(),definitionId:project.definitionId,checksPassed,submissionReadiness:checksPassed?'project-checks-passed':'blocked',note:'这是固定流程、实际文件与负责人记录的内部提交检查，不表示主办方认可或官方评分结论。',blocking,warnings,progress:project.progress,workflow,steps,files:actualFiles,completeness:{requiredArtifacts:steps.reduce((n,row)=>n+row.checks.filter(c=>c.required).length,0),checkedRequiredArtifacts:steps.reduce((n,row)=>n+row.checks.filter(c=>c.required&&c.valid).length,0),files:actualFiles.length},contentReview:{required:steps.length,ownerReviewed:steps.filter(row=>row.review.state==='owner-reviewed').length},rules,ruleEvidence,execution,cloud};
}
