/** Owner confirmation evidence. No protocol, identity assertions or permission grants. */
import {existsSync,readFileSync,statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {AresError,hash,safePath,atomicJson,now} from '../../host/storage.js';
import {readProject,taskChecks,inputHash,verifyProject} from '../../host/projects.js?v=2.3.0-loadfix1';
import {loadVersion} from '../../host/catalog.js?v=2.3.0-loadfix1';
import {verifyFrozenResources} from '../../host/native-versions.js';
import {completeDirectory,sensitiveFile} from '../../host/project-artifacts.js';
import {readRelease} from '../../host/project-workbench.js';

export function localOwnerAction(name,args) {
  return name==='ares_project'&&['complete','rules'].includes(args.action)
    ||name==='ares_plan'&&args.action==='save'
    ||name==='ares_team'&&['member','remove','assign'].includes(args.action)
    ||name==='ares_workflow'&&args.action==='project-apply'
    ||name==='ares_version'&&(args.action==='restore'||args.action==='freeze'&&['stage','submission'].includes(args.kind));
}
function failure(message) {throw new AresError(message,409);}
function fileEvidence(root,path) {
  if(typeof path!=='string'||sensitiveFile(path))failure('确认资料路径不可用或属于凭据文件');
  const file=safePath(root,path);
  if(!existsSync(file))return {path,status:'missing'};
  const before=statSync(file);
  if(before.isDirectory())return {path,status:'directory',sha256:hash(completeDirectory(file))};
  if(!before.isFile()||before.size>64*1024*1024)failure('确认资料超过64MiB或不是普通文件');
  const bytes=readFileSync(safePath(root,path,{existing:true})),after=statSync(file);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino||bytes.length!==after.size)failure('确认资料正在保存，请稳定后重新发起');
  return {path,status:'file',sha256:hash(bytes),bytes:bytes.length};
}

/** All reads occur under the core's selected-home queue and authorized root. */
export function ownerActionSnapshot(name,args) {
  if(!localOwnerAction(name,args))failure('此操作不支持便携宿主确认');
  const p=readProject(args.root);
  if(p.kind!=='v2'||args.expectedRevision!==p.revision)failure('项目或修订号已变化，请重新读取后发起确认');
  const fixed=loadVersion(p.definitionId);verifyFrozenResources(fixed);
  const binding={tool:name,argsHash:hash(args),root:p.root,projectId:p.id,revision:p.revision,definitionId:p.definitionId,projectHash:hash(p),inputs:[],outputs:[],reviews:[],extra:[]};
  let selected=p.workflow.steps,checks=null,review=null;
  const required=(...fields)=>{for(const field of fields)if(args[field]===undefined||args[field]===null)failure('缺少确认字段：'+field);};
  if(name==='ares_project'&&args.action==='complete') {
    required('stepId');const step=p.workflow.steps.find(row=>row.id===args.stepId);if(!step)failure('确认步骤不属于项目');
    selected=[step];checks=taskChecks(p.root,step.id);
    if(!checks.passed)failure('实际产物检查尚未通过，未请求验收确认');
    if(step.dependsOn.some(id=>p.tasks[id]?.status!=='done'))failure('前置节点尚未验收');
    if(step.execution==='human'&&args.confirmHuman!==true)failure('此人工作业须在确认请求中明确登记已由团队实际完成');
    if(args.review)review={summary:args.review.summary,findings:args.review.findings};
    else {
      required('reviewPath');const evidence=fileEvidence(p.root,args.reviewPath);binding.reviews.push(evidence);
      if(evidence.status!=='file')failure('实际复核报告不存在');
      review=JSON.parse(readFileSync(safePath(p.root,args.reviewPath,{existing:true}),'utf8'));
      if(review.passed!==true||hash(review.artifactHashes)!==hash(checks.artifactHashes))failure('复核报告没有绑定当前实际产物');
    }
    if(!review||typeof review.summary!=='string'||!review.summary.trim()||!Array.isArray(review.findings)||review.findings.some(row=>!row||typeof row!=='object'||!['blocking','advisory','info'].includes(row.severity)||typeof row.resolved!=='boolean'||row.severity==='blocking'&&!row.resolved))failure('内容复核说明或问题记录尚未通过原验收条件');
    binding.extra.push({reviewContentHash:hash(review),artifactHashes:checks.artifactHashes});
  } else if(name==='ares_project'&&args.action==='rules') {
    required('edition','sourceUrl','snapshotPath','quote');binding.extra.push({rulesSnapshot:fileEvidence(p.root,args.snapshotPath)});
  } else if(name==='ares_workflow') {
    required('projectId','expectedDefinitionId','fromId','toId');
    if(args.projectId!==p.id||args.expectedDefinitionId!==p.definitionId||args.fromId!==p.definitionId)failure('待应用流程与当前项目不一致');
    const target=loadVersion(args.toId);verifyFrozenResources(target);binding.extra.push({targetDefinition:hash(target)});
    selected=p.workflow.steps;
  } else if(name==='ares_version') {
    if(args.action==='restore') {required('releaseId');binding.extra.push({release:hash(readRelease(p.root,args.releaseId))});selected=p.workflow.steps;}
    else {
      const ids=args.stepIds??(args.kind==='stage'?p.workflow.steps.filter(row=>p.tasks[row.id].status==='done').map(row=>row.id):p.workflow.steps.map(row=>row.id));
      if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!p.workflow.steps.some(row=>row.id===id)))failure('正式版本未选择有效且不重复的步骤');
      selected=p.workflow.steps.filter(row=>ids.includes(row.id));
      if(selected.some(row=>p.tasks[row.id].status!=='done'||row.dependsOn.some(id=>!ids.includes(id))))failure('正式版本需要已验收步骤及其全部前置节点');
      if(args.kind==='submission'&&(!verifyProject(p.root).checksPassed||ids.length!==p.workflow.steps.length))failure('提交版仍有未验收步骤或规则缺口');
    }
  }
  for(const step of selected) {
    const checked=checks?.stepId===step.id?checks:taskChecks(p.root,step.id);
    binding.inputs.push({stepId:step.id,inputHash:inputHash(p,step)});
    binding.outputs.push({stepId:step.id,passed:checked.passed,artifactHashes:checked.artifactHashes,files:checked.checks.filter(row=>row.path).map(row=>fileEvidence(p.root,row.path))});
    if(p.tasks[step.id].reviewPath)binding.reviews.push(fileEvidence(p.root,p.tasks[step.id].reviewPath));
  }
  if(p.competition.ruleBaseline?.snapshotPath)binding.extra.push({currentRules:fileEvidence(p.root,p.competition.ruleBaseline.snapshotPath)});
  const titles={complete:'验收节点',rules:'确认本届规则',save:'修改计划',member:'修改队员',remove:'移除队员',assign:'分配步骤','project-apply':'应用项目流程',freeze:'固定正式版本',restore:'恢复历史工作稿'};
  const lines=['ARES 本机负责人单次确认',
    '操作：'+(titles[args.action]||args.action)+(args.stepId?' · '+(p.workflow.steps.find(row=>row.id===args.stepId)?.title||args.stepId):''),
    '项目：'+p.name,'目录：'+p.root,'项目修订：'+p.revision,'固定流程：'+p.definitionId,
    '申请变更：'+JSON.stringify({...args,root:undefined,review:undefined,workflow:undefined,configuration:undefined}),
    ...(args.action==='complete'&&selected[0].execution==='human'?['此节点包含人工作业；确认表示团队已经实际完成。']:[]),
    ...binding.outputs.flatMap(row=>row.files.map(file=>'实际作品：'+file.path+' · '+(file.sha256||file.status))),
    ...(review?['内容复核：'+review.summary,'复核问题：'+JSON.stringify(review.findings)]:[]),
    '请先查看对应作品和变更。勾选仅批准这一次操作，原验收检查仍会执行。'];
  return {fingerprint:hash(binding),binding,summary:lines.join('\n').slice(0,24000),artifactHashes:checks?.artifactHashes||null,review};
}

/** Pin the actually confirmed hashes; taskAction's existing report branch checks them again. */
export function pinConfirmedReview(args,snapshot,confirmation) {
  if(args.action!=='complete'||!args.review)return args;
  const path='.ares/reviews/portable-'+randomUUID()+'.json';
  atomicJson(safePath(args.root,path),{passed:true,summary:snapshot.review.summary,findings:snapshot.review.findings,artifactHashes:snapshot.artifactHashes,reviewer:'user',reviewedAt:now(),portableConfirmation:{id:confirmation.id,fingerprint:snapshot.fingerprint,source:'mcp-host-elicitation'}});
  const next={...args,reviewPath:path};delete next.review;return next;
}
