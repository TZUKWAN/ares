import {mkdirSync,writeFileSync,readFileSync,statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {AresError,hash,safePath,now,clone} from './storage.js';
import {readProject,changeProject} from './projects.js?v=2.3.0-loadfix1';
import {ensureProjectWorkbench,projectEvent} from './project-artifacts.js';
import {putProjectObject,readProjectObject,putProjectRecord,readProjectRecord,repairProjectObject,repairProjectFile,objectPath} from './project-objects.js';
import {runSurveyPretest} from './survey-execution.js';
import {extensionUrl,requestExtensionJson} from './extension-network.js';
import {dispatchSkillTool,skillCallResult} from './skill-execution.js';
import {validateInput,validateSchema} from './extension-schema.js';
export {validateInput} from './extension-schema.js';
import {prepareExtensionApproval,activateExtensionApproval,revokeExtensionApproval,extensionAccess} from './extension-authority.js';
const executingRuns=new Set();

export const surveyExtension={schema_version:1,id:'ares-survey-pretest',title:'问卷与数学模型预测试',version:'1.0.0',kind:'survey-generator',description:'按显式假设生成带来源标记的模拟问卷，计算缺失、相关、量表与可选线性模型诊断。',dataKind:'synthetic',inputSchema:{type:'object',required:['count','seed','questions'],properties:{count:{type:'integer',minimum:10,maximum:20000},seed:{type:['string','number']},questions:{type:'array',minItems:2,maxItems:80},scenario:{type:'string',enum:['baseline','high-missingness','low-reliability']},missingRate:{type:'number',minimum:0,maximum:0.8},model:{type:'object'}},additionalProperties:false},config:{}};
export function validateExtension(manifest){
 if(!manifest||manifest.schema_version!==1||!/^[a-z][a-z0-9-]{2,63}$/.test(manifest.id)||!/^\d+\.\d+\.\d+$/.test(manifest.version)||typeof manifest.title!=='string'||!manifest.title.trim()||manifest.title.length>120||Buffer.byteLength(JSON.stringify(manifest))>128*1024)throw new AresError('子插件需要有效标识、名称、语义版本及有界清单');
 if(Object.keys(manifest).some(k=>!['schema_version','id','title','version','kind','description','dataKind','inputSchema','outputSchema','config'].includes(k)))throw new AresError('子插件包含未支持的清单字段');
 if(!['survey-generator','http-json','native-tool'].includes(manifest.kind)||!['synthetic','unverified'].includes(manifest.dataKind))throw new AresError('子插件类型或数据来源无效；接口不能自行认证为真实调查证据');
 validateSchema(manifest.inputSchema);const c=manifest.config;if(!c||typeof c!=='object'||Array.isArray(c))throw new AresError('子插件配置无效');
 const configFields={'survey-generator':[],'http-json':['url','method','headerEnv','responsePath'],'native-tool':['tool','arguments']}[manifest.kind];if(Object.keys(c).some(k=>!configFields.includes(k)))throw new AresError('子插件配置包含未支持字段；密钥只能使用headerEnv环境变量引用');
 if(manifest.kind==='survey-generator'&&manifest.dataKind!=='synthetic')throw new AresError('问卷预测试必须声明模拟来源');
 if(manifest.kind==='http-json'){extensionUrl(c.url);if(c.method!==undefined&&!['POST','GET'].includes(c.method))throw new AresError('接口仅支持GET/POST');if(c.headerEnv!==undefined&&(!c.headerEnv||typeof c.headerEnv!=='object'||Array.isArray(c.headerEnv)))throw new AresError('请求头引用须为JSON对象');if(Object.keys(c.headerEnv||{}).some(k=>['host','content-length','connection','transfer-encoding','proxy-authorization'].includes(k.toLowerCase())))throw new AresError('不允许覆盖接口连接控制请求头');if(c.method&&!['POST','GET'].includes(c.method))throw new AresError('接口仅支持GET/POST');if(c.responsePath&&!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(c.responsePath))throw new AresError('响应路径无效');if(c.headerEnv&&Object.entries(c.headerEnv).some(([k,v])=>!/^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(k)||typeof v!=='string'||!/^[A-Z][A-Z0-9_]{0,100}$/.test(v)))throw new AresError('请求头只能引用环境变量名称');}
 if(manifest.kind==='native-tool'&&(typeof c.tool!=='string'||!c.tool||c.tool.startsWith('ares_')))throw new AresError('请选择DSH实际工具，不能递归调用ARES自身');
 if(manifest.kind==='native-tool'&&c.arguments!==undefined&&(!c.arguments||typeof c.arguments!=='object'||Array.isArray(c.arguments)))throw new AresError('原生固定参数必须为JSON对象');if(manifest.kind==='native-tool'&&c.arguments)validateInput({type:'object'},c.arguments,'arguments');if(manifest.outputSchema!==undefined)validateSchema(manifest.outputSchema);return clone(manifest);
}
const manifestPackagePath=e=>'.ares/extensions/packages/'+e.id+'-'+e.manifestHash.slice(0,16)+'/ares-extension.json';
function boundedManifestFile(root,path){const full=safePath(root,path,{existing:true});if(!statSync(full).isFile()||statSync(full).size>2*1024*1024)throw new AresError('扩展包清单不是2MiB以内文件',409);return readFileSync(full);}
function loadManifest(root,sha){const file=objectPath(root,sha);if(statSync(file).size>2*1024*1024)throw new AresError('扩展清单超过读取限制',409);return validateExtension(JSON.parse(readProjectObject(root,sha)));}
function extensions(p){const state=ensureProjectWorkbench(p);state.extensions??={};state.extensionRunIds??=[];return state.extensions;}
export function listExtensions(root){
 const p=readProject(root),installed=extensions(p);
 const rows=Object.values(installed).map(extension=>{const access=extensionAccess(p.root,p,extension);try{const manifest=loadManifest(p.root,extension.manifestHash);let packageRepairNeeded=false;try{packageRepairNeeded=hash(boundedManifestFile(p.root,manifestPackagePath(extension)))!==extension.manifestHash;}catch{packageRepairNeeded=true;}if(manifest.id!==extension.id)throw new AresError('扩展清单与项目标识不一致',409);return {...extension,id:manifest.id,title:manifest.title,version:manifest.version,kind:manifest.kind,dataKind:manifest.dataKind,enabled:access.allowed,permissionStatus:access.status,available:true,packageRepairNeeded,manifest};}catch(error){return {...extension,enabled:false,permissionStatus:access.status,available:false,manifest:null,error:error.message};}});
 const runs=p.workbench.extensionRunIds.slice(-30).reverse().map(id=>{try{const record=readProjectRecord(p.root,'extension-runs',id);if(record.payload.projectId!==p.id)throw new AresError('记录属于其他项目',409);return record;}catch(error){return {id,integrity:'damaged',payload:{status:'damaged',extensionId:'历史运行',files:[],diagnostic:{error:error.message}}};}});
 return {templates:[surveyExtension],activeRuns:Object.values(p.workbench.activeExtensionRuns||{}),extensions:rows,runs};
}
export function repairExtensionManifest(body,actor={kind:'user',id:'owner'}){
 if(actor.kind!=='user')throw new AresError('扩展包修复须由项目负责人操作',403);let repair;
 const project=changeProject(body,p=>{
  const extension=extensions(p)[body.id];if(!extension||extension.manifestHash!==body.manifestHash)throw new AresError('扩展版本发生变化，请刷新',409);
  const path=manifestPackagePath(extension),candidates=[];
  try{if(statSync(objectPath(p.root,extension.manifestHash)).size<=2*1024*1024)candidates.push(readProjectObject(p.root,extension.manifestHash));}catch{}
  try{candidates.push(boundedManifestFile(p.root,path));}catch{}
  if(extension.id===surveyExtension.id)candidates.push(Buffer.from(JSON.stringify(surveyExtension,null,2)+'\n'));
  const bytes=candidates.find(value=>hash(value)===extension.manifestHash);if(!bytes)throw new AresError('没有与原指纹完全一致的清单来源，不能猜测或替换历史版本',409);
  const manifest=validateExtension(JSON.parse(bytes));if(manifest.id!==extension.id)throw new AresError('修复来源标识不一致',409);
  const packageFile=repairProjectFile(p.root,path,extension.manifestHash,bytes),object=repairProjectObject(p.root,extension.manifestHash,bytes);repair={repaired:packageFile.repaired||object.repaired,packageFile,object};projectEvent(p.root,p,'extension.manifest-repaired',{id:extension.id,manifestHash:extension.manifestHash,...repair},actor);
 });return {project,repair};
}
export function extensionResult(root,id){const p=readProject(root);extensions(p);if(!p.workbench.extensionRunIds.includes(id))throw new AresError('运行记录不属于此项目',403);const record=readProjectRecord(p.root,'extension-runs',id);return {run:record,files:record.payload.files.map(file=>{const bytes=readProjectObject(p.root,file.sha256),text=bytes.toString('utf8');return {...file,text:text.slice(0,120000),truncated:text.length>120000};})};}
function finishApproval(project,extensionId,receiptId){
 if(!receiptId)return;try{activateExtensionApproval(project.root,project,project.workbench.extensions[extensionId],receiptId);}catch{throw new AresError('项目配置已保存，但执行授权尚未激活；请刷新后重新启用固定版本',409);}
}
export function buildExtension(body,actor={kind:'user',id:'owner'}){
 if(actor.kind!=='user')throw new AresError('子插件构建和权限启用须由项目负责人操作',403);
 const manifest=validateExtension(body.manifest),bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');let path,receiptId;
 const project=changeProject(body,p=>{
  const sha=putProjectObject(p.root,bytes).sha256;path='.ares/extensions/packages/'+manifest.id+'-'+sha.slice(0,16);mkdirSync(safePath(p.root,path),{recursive:true});const file=safePath(p.root,path+'/ares-extension.json');try{writeFileSync(file,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;if(hash(readFileSync(file))!==sha)throw new AresError('同名扩展包损坏，未替换历史',409);}
  const old=extensions(p)[manifest.id];if(old)revokeExtensionApproval(p.root,p,old);
  const extension={id:manifest.id,title:manifest.title,version:manifest.version,kind:manifest.kind,dataKind:manifest.dataKind,manifestHash:sha,enabled:body.enabled===true,grant:{tool:manifest.kind==='native-tool'?manifest.config.tool:null,endpoint:manifest.kind==='http-json'?extensionUrl(manifest.config.url).origin:null,grantedBy:actor.id,at:now()},history:[...new Set([...(old?.history||[]),sha])],builtAt:now(),packagePath:path};
  if(extension.enabled){receiptId=prepareExtensionApproval(p.root,p,extension,actor);extension.grantReceiptId=receiptId;}extensions(p)[manifest.id]=extension;projectEvent(p.root,p,'extension.built',{id:manifest.id,manifestHash:sha,enabled:extension.enabled,kind:manifest.kind},actor);
 });finishApproval(project,manifest.id,receiptId);return {project,path};
}
export function toggleExtension(body,actor={kind:'user',id:'owner'}){
 if(actor.kind!=='user')throw new AresError('扩展权限须由负责人调整',403);let receiptId;
 const project=changeProject(body,p=>{const extension=extensions(p)[body.id];if(!extension||extension.manifestHash!==body.manifestHash)throw new AresError('子插件版本已变化，请刷新',409);
  // Even if the project write later fails, a revoked capability stays revoked.
  revokeExtensionApproval(p.root,p,extension);extension.enabled=body.enabled===true;delete extension.grantReceiptId;
  if(extension.enabled){receiptId=prepareExtensionApproval(p.root,p,extension,actor);extension.grantReceiptId=receiptId;}projectEvent(p.root,p,'extension.permission-changed',{id:extension.id,manifestHash:extension.manifestHash,enabled:extension.enabled},actor);
 });finishApproval(project,body.id,receiptId);return project;
}
export function bindExtensionStep(body,actor={kind:'user',id:'owner'}){if(actor.kind!=='user')throw new AresError('节点能力绑定须由负责人确认',403);return changeProject(body,(p,v)=>{const e=extensions(p)[body.id];if(!e||e.manifestHash!==body.manifestHash||!v.workflow.steps.some(s=>s.id===body.stepId))throw new AresError('节点或子插件版本不匹配，请刷新',409);const state=ensureProjectWorkbench(p);state.extensionBindings??={};const rows=(state.extensionBindings[body.stepId]||[]).filter(r=>r.id!==e.id);if(body.remove!==true)rows.push({id:e.id,manifestHash:e.manifestHash});state.extensionBindings[body.stepId]=rows;projectEvent(p.root,p,'extension.step-bound',{stepId:body.stepId,id:e.id,manifestHash:e.manifestHash,removed:body.remove===true},actor);});}
export async function runExtension(body,actor={kind:'user',id:'owner'},{signal,ctx,exec,observeDispatch}={}){
 const p=readProject(body.root),e=extensions(p)[body.id];
 if(!e||!extensionAccess(p.root,p,e).allowed)throw new AresError('此固定子插件未通过负责人有效授权，请在工作台确认启用',403);
 if(p.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);
 if(body.stepId&&!(p.workbench.extensionBindings?.[body.stepId]||[]).some(r=>r.id===e.id&&r.manifestHash===e.manifestHash))throw new AresError('此节点尚未绑定当前子插件版本，请先绑定',409);
 if(Object.values(p.workbench.activeExtensionRuns||{}).some(r=>r.extensionId===e.id))throw new AresError('此子插件已有运行中或待核对的任务，请先跟踪原记录，不重复启动',409);
 const manifest=loadManifest(p.root,e.manifestHash),input=body.input===undefined?{}:body.input;
 if(Buffer.byteLength(JSON.stringify(input))>2*1024*1024)throw new AresError('扩展输入超过限制');validateInput(manifest.inputSchema,input);
 if(manifest.kind==='native-tool'){if(!ctx||!exec?.agent?.id)throw new AresError('此扩展须在DSH原生项目助手中运行，工作台不会在宿主直接执行脚本',409);actor={kind:'agent',id:exec.agent.id};}
 const runId=randomUUID(),path=(manifest.dataKind==='synthetic'?'预测试/':'扩展运行/')+runId,inputObject=putProjectObject(p.root,Buffer.from(JSON.stringify(input))).sha256;
 const nativeArguments=manifest.kind==='native-tool'?{...(manifest.config.arguments||{}),...input}:null;
 if(manifest.kind==='native-tool'&&manifest.config.tool==='pwsh'&&typeof nativeArguments.command==='string')nativeArguments.command='# ARES extension attempt '+runId+'\n'+nativeArguments.command;
 changeProject(body,project=>{const state=ensureProjectWorkbench(project);state.activeExtensionRuns??={};state.activeExtensionRuns[runId]={id:runId,extensionId:e.id,manifestHash:e.manifestHash,grantReceiptId:e.grantReceiptId,status:'running',actor,inputHash:inputObject,path,dataKind:manifest.dataKind,stepId:body.stepId||null,toolName:manifest.kind==='native-tool'?manifest.config.tool:null,commandHash:typeof nativeArguments?.command==='string'?hash(nativeArguments.command):null,at:now()};projectEvent(project.root,project,'extension.run-started',{runId,extensionId:e.id,manifestHash:e.manifestHash,grantReceiptId:e.grantReceiptId,inputHash:inputObject},actor);});
 executingRuns.add(runId);
 let status='failed',files=[],diagnostic=null,nativeJobId=null,nativeCallId=null,requestDispatched=false;
 try{
  signal?.throwIfAborted();let data,report;
  if(manifest.kind==='survey-generator'){
   const result=await runSurveyPretest(input,{signal});validateInput({},result.report,'report');if(manifest.outputSchema)validateInput(manifest.outputSchema,result.report,'output');data=Buffer.from(result.csv);report=result.report;
  }else if(manifest.kind==='http-json'){
   const result=await requestExtensionJson(manifest.config,input,{signal,onDispatch:()=>{requestDispatched=true;observeDispatch?.();}});if(manifest.outputSchema)validateInput(manifest.outputSchema,result,'output');data=Buffer.from(JSON.stringify(result,null,2));report={dataKind:manifest.dataKind,purpose:manifest.dataKind==='synthetic'?'model-pretest':'unverified-interface-result',realSampleCount:0,endpoint:new URL(manifest.config.url).origin,verification:'actual-http-json-result-not-research-verification'};
  }else{
   const call=await dispatchSkillTool(ctx,exec,manifest.config.tool,nativeArguments);nativeJobId=call.result.value?.jobId||call.result.value?.job?.id||null;nativeCallId=call.callId;status=call.status;diagnostic=skillCallResult(call);
   if(call.status!=='succeeded')throw new AresError(call.status==='pending'?'原生工具仍在后台运行，请跟踪真实job，不重复运行':'原生工具未成功，未生成成功产物');
   if(manifest.outputSchema)validateInput(manifest.outputSchema,diagnostic,'output');data=Buffer.from(JSON.stringify(diagnostic,null,2));report={dataKind:manifest.dataKind,purpose:'native-tool-result',realSampleCount:0,verification:'native-execution-receipt',callId:call.callId};
  }
  if(data.length>16*1024*1024)throw new AresError('扩展结果超过16MiB限制');report={...report,extensionId:e.id,manifestHash:e.manifestHash,inputHash:inputObject,runId,at:now()};mkdirSync(safePath(p.root,path),{recursive:true});
  for(const [name,bytes]of [[manifest.kind==='survey-generator'?'模拟问卷.csv':'接口结果.json',data],['来源与诊断.json',Buffer.from(JSON.stringify(report,null,2))]]){const object=putProjectObject(p.root,bytes);writeFileSync(safePath(p.root,path+'/'+name),bytes,{flag:'wx'});files.push({path:path+'/'+name,...object});}status='succeeded';
 }catch(error){
  if(error.executionOutcome==='unknown'||manifest.kind==='http-json'&&(manifest.config.method||'POST')==='POST'&&requestDispatched){status='needs-reconciliation';nativeCallId=error.nativeCallId||nativeCallId;}
  else if(status!=='pending')status=signal?.aborted?'cancelled':'failed';
  diagnostic={...(diagnostic?{nativeCall:diagnostic}:{}),...(nativeCallId?{nativeCallId}:{}),requestDispatched,error:error instanceof AresError?error.message:'扩展运行失败，未记录可能含密钥的原始错误'};
 }finally{executingRuns.delete(runId);}
 const current=readProject(p.root);if(current.id!==p.id)throw new AresError('项目身份在运行期间变化，未把结果写入另一个项目',409);
 let record;const project=changeProject({root:p.root,expectedRevision:current.revision},project=>{
  const state=ensureProjectWorkbench(project);if(!state.activeExtensionRuns?.[runId])throw new AresError('运行跟踪记录变化，请先核对实际结果',409);
  record=putProjectRecord(project.root,'extension-runs',{projectId:project.id,runId,extensionId:e.id,manifestHash:e.manifestHash,grantReceiptId:e.grantReceiptId,inputHash:inputObject,stepId:body.stepId||null,dataKind:manifest.dataKind,realSampleCount:0,status,path,files,diagnostic,actor,at:now()});state.extensionRunIds.push(record.id);
  if(['pending','needs-reconciliation'].includes(status))Object.assign(state.activeExtensionRuns[runId],{status,jobId:nativeJobId,nativeCallId,recordId:record.id});else delete state.activeExtensionRuns[runId];
  if(manifest.dataKind==='synthetic')for(const file of files)state.syntheticHashes[file.sha256]={kind:'synthetic',purpose:'model-pretest',runId,manifestHash:e.manifestHash,realSampleCount:0};
  projectEvent(project.root,project,['pending','needs-reconciliation'].includes(status)?'extension.run-awaiting-result':'extension.run-finished',{runId,recordId:record.id,status,dataKind:manifest.dataKind,files},actor);
 });return {project,run:record,tasksAutoCompleted:false};
}
export function settleInterruptedExtension(body,actor={kind:'user',id:'owner'}){if(actor.kind!=='user'||body.confirmStopped!==true)throw new AresError('请实际核对原任务已停止，再登记中断，不能把未知任务记成成功',403);if(executingRuns.has(body.runId))throw new AresError('当前进程仍在执行此请求，请先取消或等待真实结果',409);return changeProject(body,p=>{const state=ensureProjectWorkbench(p),run=state.activeExtensionRuns?.[body.runId];if(!run)throw new AresError('没有此待核对任务',404);const record=putProjectRecord(p.root,'extension-runs',{projectId:p.id,runId:body.runId,extensionId:run.extensionId,manifestHash:run.manifestHash,inputHash:run.inputHash,dataKind:run.dataKind,realSampleCount:0,status:'interrupted-unverified',path:run.path,files:[],diagnostic:{reason:'负责人确认原任务已停止；没有成功回执，不能作为完成证据'},actor,at:now()});state.extensionRunIds.push(record.id);delete state.activeExtensionRuns[body.runId];projectEvent(p.root,p,'extension.interruption-recorded',{runId:body.runId,recordId:record.id,status:'interrupted-unverified'},actor);});}
export async function pollExtensionRun(body,{ctx,exec}={}){
 let p=readProject(body.root);const active=ensureProjectWorkbench(p).activeExtensionRuns?.[body.runId];if(!active)throw new AresError('此项目没有该待跟踪运行',404);if(p.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);
 if(!ctx||!exec||active.actor.kind!=='agent'||exec.agent?.id!==active.actor.id)throw new AresError('后台任务须由原DSH项目助手跟踪',403);
 if(!active.jobId){
  if(active.toolName!=='pwsh'||!active.commandHash)throw new AresError('原生结果没有可核对jobId，请先在原DSH助手中核对调用记录，未重复启动');
  const listed=await dispatchSkillTool(ctx,exec,'job_list',{}),jobs=listed.result.value;
  if(listed.status!=='succeeded'||!Array.isArray(jobs))return {status:'needs-reconciliation',nativeCall:skillCallResult(listed),workCompleted:false};
  const matches=jobs.filter(job=>job.kind==='pwsh'&&typeof job.id==='string'&&typeof job.label==='string'&&hash(job.label)===active.commandHash&&Number.isFinite(job.startedAt)&&job.startedAt>=Date.parse(active.at)-1000);
  if(matches.length!==1)return {status:'needs-reconciliation',reason:'未找到唯一匹配原命令和时间的实际任务，未重复启动',workCompleted:false};
  active.jobId=matches[0].id;p=changeProject({root:p.root,expectedRevision:p.revision},project=>{const tracking=project.workbench.activeExtensionRuns?.[body.runId];if(!tracking||tracking.manifestHash!==active.manifestHash)throw new AresError('运行跟踪记录变化',409);tracking.jobId=active.jobId;projectEvent(project.root,project,'extension.job-recovered',{runId:body.runId,jobId:active.jobId},active.actor);});
 }
 const call=await dispatchSkillTool(ctx,exec,'job_output',{job_id:active.jobId,wait:false}),job=call.result.value?.job,receipt=skillCallResult(call);
 if(!job||job.id!==active.jobId||call.result.isError||!['running','stopping','completed','failed','killed'].includes(job.status))return {status:'needs-reconciliation',jobId:active.jobId,nativeCall:receipt,workCompleted:false};
 if(['running','stopping'].includes(job.status))return {status:'pending',jobId:active.jobId,nativeCall:receipt,workCompleted:false};
 let status=call.status,diagnostic=receipt;const manifest=loadManifest(p.root,active.manifestHash);
 if(status==='succeeded'&&manifest.outputSchema){try{validateInput(manifest.outputSchema,receipt,'output');}catch(error){status='failed';diagnostic={nativeCall:receipt,error:error.message};}}
 const bytes=Buffer.from(JSON.stringify({dataKind:active.dataKind,realSampleCount:0,purpose:'native-tool-result',jobId:active.jobId,nativeCall:receipt},null,2)),object=putProjectObject(p.root,bytes),path=active.path+'/后台任务实际回执-'+object.sha256.slice(0,12)+'.json';mkdirSync(safePath(p.root,active.path),{recursive:true});
 try{writeFileSync(safePath(p.root,path),bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;if(hash(readFileSync(safePath(p.root,path)))!==object.sha256)throw new AresError('后台回执已存在且不同，未覆盖',409);}
 const current=readProject(p.root);let record;const project=changeProject({root:p.root,expectedRevision:current.revision},project=>{const state=ensureProjectWorkbench(project);if(!state.activeExtensionRuns?.[body.runId])throw new AresError('运行已被另一请求处理',409);record=putProjectRecord(project.root,'extension-runs',{projectId:project.id,runId:body.runId,extensionId:active.extensionId,manifestHash:active.manifestHash,grantReceiptId:active.grantReceiptId,inputHash:active.inputHash,stepId:active.stepId||null,dataKind:active.dataKind,realSampleCount:0,status,path:active.path,files:[{path,...object}],diagnostic,actor:active.actor,at:now(),previousRecordId:active.recordId});state.extensionRunIds.push(record.id);delete state.activeExtensionRuns[body.runId];if(active.dataKind==='synthetic')state.syntheticHashes[object.sha256]={kind:'synthetic',purpose:'model-pretest',runId:body.runId,realSampleCount:0};projectEvent(project.root,project,'extension.run-finished',{runId:body.runId,jobId:active.jobId,status,recordId:record.id},active.actor);});return {project,run:record,tasksAutoCompleted:false};
}
