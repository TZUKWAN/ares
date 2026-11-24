import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AresError,hash,safePath,now} from './storage.js';
import {sourceFiles} from './projects.js?v=2.3.0-directory1';
import {putProjectObject,readProjectObject,readProjectRecord} from './project-objects.js';
import {researchProject,researchVersion,researchEntry,requireKind,saveResearchVersion} from './project-research.js';
import {sensitiveFile,syntheticEvidence} from './project-artifacts.js';
import {parseResearchCsv} from './research-surveys.js';
import {previousResearchJob} from './research-jobs.js';
import {buildExtension,runExtension,extensionResult} from './project-extensions.js';

const worker=fileURLToPath(new URL('../scripts/research_analysis.py',import.meta.url));
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const MAX=4*1024*1024;
function tabularRows(bytes,format) {
  const text=bytes.toString('utf8').replace(/^\uFEFF/,'');
  if(format==='.json'){
    try{return JSON.parse(text);}catch{throw new AresError('分析JSON数据格式无效');}
  }
  if(format!=='.csv')throw new AresError('模型实验支持CSV或JSON对象数组');
  const lines=parseResearchCsv(text.replace(/^ARES_SYNTHETIC_DATA\r?\n/,''),20001),columns=lines.shift();
  if(!columns?.length||columns.length>200||new Set(columns).size!==columns.length)throw new AresError('数据列名为空、重复或超过200列');
  if(lines.some(row=>row.length!==columns.length))throw new AresError('CSV数据行列数不一致');
  return lines.map(row=>Object.fromEntries(columns.map((name,i)=>[name,row[i]])));
}
export function experimentInput(body) {
  const p=researchProject(body.root);let rows,raw,source,synthetic=false;
  if(body.repeatExperimentId){
    const entry=requireKind(researchVersion(p,body.repeatExperimentId),'experiment');
    const previous=entry.data.input;
    raw=readProjectObject(p.root,previous.object.sha256);rows=JSON.parse(readProjectObject(p.root,previous.normalized.sha256));
    source={kind:'experiment',itemId:entry.item.id,versionId:entry.version.id};synthetic=entry.version.payload.provenance==='synthetic';
  }else if(body.dataItemId){
    const entry=researchVersion(p,body.dataItemId,body.dataVersionId);
    if(entry.item.status==='proposal')throw new AresError('未采用建议不能作为分析数据');
    synthetic=entry.version.payload.provenance==='synthetic';
    if(entry.item.kind==='dataset'){
      const path=safePath(p.root,entry.data.file.path,{existing:true});
      if(statSync(path).size>MAX)throw new AresError('每次分析最多4MiB，请先选择分析样本');
      raw=readFileSync(path);if(hash(raw)!==entry.data.file.sha256)throw new AresError('登记的数据集文件已变化',409);
      rows=tabularRows(raw,extname(entry.data.fileName).toLowerCase());
      synthetic=synthetic||syntheticEvidence(p.root,p,{valid:true,path:entry.data.file.path,sha256:hash(raw)},{kind:'file'},{sourceFiles});
    }else{
      if(!Array.isArray(entry.data.rows))throw new AresError('请选择实际答卷或含对象数组的研究版本');
      rows=entry.data.rows;raw=Buffer.from(JSON.stringify(rows));
    }
    source={kind:'research',itemId:entry.item.id,versionId:entry.version.id};
  }else{
    if(typeof body.dataPath!=='string'||sensitiveFile(body.dataPath))throw new AresError('请选择项目内CSV或JSON数据');
    const path=safePath(p.root,body.dataPath,{existing:true});
    if(!statSync(path).isFile()||statSync(path).size>MAX)throw new AresError('每次分析数据最多4MiB');
    raw=readFileSync(path);
    synthetic=syntheticEvidence(p.root,p,{valid:true,path:body.dataPath,sha256:hash(raw)},{kind:'file'},{sourceFiles});
    rows=tabularRows(raw,extname(path).toLowerCase());
    source={kind:'file',path:body.dataPath};
  }
  if(raw.length>MAX||!Array.isArray(rows)||!rows.length||rows.length>20000||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new AresError('请选择1至20000条对象形式的数据');
  return {rows,object:putProjectObject(p.root,raw),normalized:putProjectObject(p.root,Buffer.from(JSON.stringify(rows))),source,synthetic};
}
export function previewExperimentData(body) {
  const data=experimentInput(body),names=[...new Set(data.rows.flatMap(row=>Object.keys(row)))];
  return {rows:data.rows.length,dataSha256:data.object.sha256,synthetic:data.synthetic,
    columns:names.map(name=>({name,numeric:data.rows.filter(row=>row[name]!==null&&row[name]!==''&&typeof row[name]!=='boolean'&&Number.isFinite(Number(row[name]))).length}))};
}
function settings(body) {
  const spec=body.spec;
  if(!spec||!['regression','clustering'].includes(spec.engine)||!Array.isArray(spec.features)||!spec.features.length||spec.features.length>20||new Set(spec.features).size!==spec.features.length||spec.features.some(x=>typeof x!=='string'||!x||x.length>100))throw new AresError('请选择模型和1至20个不同的数值变量');
  const seed=spec.seed??42;if(!Number.isSafeInteger(seed)||seed<0||seed>2147483647)throw new AresError('种子须为0至2147483647的整数');
  if(spec.engine==='clustering'){
    const clusters=spec.clusters??3;if(!Number.isInteger(clusters)||clusters<2||clusters>12)throw new AresError('聚类数量须为2至12');
    return {engine:spec.engine,features:spec.features,seed,clusters};
  }
  const ridge=spec.ridge??0,testFraction=spec.testFraction??.2;
  if(typeof spec.target!=='string'||!spec.target||spec.features.includes(spec.target)||!Number.isFinite(ridge)||ridge<0||ridge>1e8||!Number.isFinite(testFraction)||testFraction<.1||testFraction>.5)throw new AresError('请填写独立目标变量、非负岭参数和10%至50%的测试比例');
  return {engine:spec.engine,features:spec.features,target:spec.target,seed,ridge,testFraction};
}
function markdown(title,result){return '# '+title+'\n\n'+Object.entries(result.metrics).map(([name,value])=>'- '+name+' = '+String(value)).join('\n')+'\n\n实际运行环境 '+result.python+' · '+(result.engine||'custom');}
function finiteMetrics(result) {
  if(!result?.metrics||!Object.keys(result.metrics).length||Object.keys(result.metrics).length>100||Object.values(result.metrics).some(value=>value!==null&&(!Number.isFinite(value)||typeof value!=='number')))throw new AresError('实际分析结果没有有效的有限数值指标',422);
  return result;
}
export function startAnalysis(jobs,body) {
  if(body.approveCompute!==true)throw new AresError('请确认在本机使用所选数据运行分析',403);
  const input=experimentInput(body),spec=settings(body),title=String(body.title||'模型实验').slice(0,160),workerSha256=hash(readFileSync(worker));
  const previous=body.retryId?previousResearchJob(body.root,body.retryId,'analysis'):null;
  if(previous&&hash(previous.settings)!==hash({spec,dataSha256:input.object.sha256,workerSha256}))throw new AresError('重试的数据、模型或计算代码已变化，请新建实验',409);
  return jobs.start(body,{kind:'analysis',title,settings:{spec,dataSha256:input.object.sha256,workerSha256},source:input.source,previous},async({signal,update,job})=>{
    update({phase:'computing',done:0,total:1});
    const raw=await new Promise((resolve,reject)=>{
      const child=execFile('python',[worker],{windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:6*1024*1024,signal,
        env:{...process.env,PYTHONIOENCODING:'utf-8'}},(error,stdout)=>{
        let result;try{result=JSON.parse(stdout);}catch{}
        if(error)return reject(new AresError(result?.error||'固定分析进程未完成，请检查数据或本机Python环境',422));
        resolve(result);
      });
      child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({rows:input.rows,spec}));
    });
    signal.throwIfAborted();const result=finiteMetrics(raw),current=researchProject(body.root);
    const saved=saveResearchVersion({root:body.root,expectedRevision:current.revision},{kind:'experiment',status:'completed',title,
      provenance:input.synthetic?'synthetic':'analysis',data:{engine:spec.engine,spec,input:{...input,rows:undefined},result,
        startedAt:job.startedAt,finishedAt:now(),workerSha256,markdown:markdown(title,result)}});
    return {itemId:saved.item.id,versionId:saved.version.id,metrics:result.metrics,sourceDataKind:input.synthetic?'synthetic':'source-data'};
  });
}
export function compareExperiments(body) {
  const p=researchProject(body.root);
  if(!Array.isArray(body.ids)||body.ids.length<2||body.ids.length>12||new Set(body.ids).size!==body.ids.length)throw new AresError('请选择2至12个不同的已完成实验');
  const rows=body.ids.map(id=>{
    const entry=requireKind(researchVersion(p,id),'experiment');if(entry.item.status!=='completed')throw new AresError('请选择已完成实验');
    return {id,title:entry.item.title,versionId:entry.version.id,engine:entry.data.engine,dataSha256:entry.data.input.object.sha256,
      parameters:entry.data.spec,metrics:entry.data.result.metrics,provenance:entry.version.payload.provenance};
  });
  return {rows,sameData:new Set(rows.map(row=>row.dataSha256)).size===1,sameTarget:new Set(rows.map(row=>row.parameters.target||row.engine)).size===1,
    note:'比较实际指标与参数，指标含义、样本或目标不同的方案需分别判断。'};
}

/** Custom Python/R remains behind the existing owner-approved native-tool mechanism. */
export function previewScriptAnalysis(body) {
  const p=researchProject(body.root),path=String(body.scriptPath||'');
  if(sensitiveFile(path)||!['.py','.r'].includes(extname(path).toLowerCase()))throw new AresError('请选择项目内Python或R脚本');
  const file=safePath(p.root,path,{existing:true});if(!statSync(file).isFile()||statSync(file).size>256*1024)throw new AresError('分析脚本最多256KiB');
  const bytes=readFileSync(file);return {path,sha256:hash(bytes),text:bytes.toString('utf8')};
}
export function prepareScriptAnalysis(body) {
  if(body.approveScript!==true)throw new AresError('请先审阅脚本，并明确批准通过宿主原生工具运行',403);
  const p=researchProject(body.root),input=experimentInput(body),scriptPath=String(body.scriptPath||'');
  if(sensitiveFile(scriptPath)||!['.py','.r'].includes(extname(scriptPath).toLowerCase()))throw new AresError('请选择项目内Python或R脚本');
  const file=safePath(p.root,scriptPath,{existing:true});if(statSync(file).size>256*1024)throw new AresError('分析脚本最多256KiB');
  const script=putProjectObject(p.root,readFileSync(file)),parameters=putProjectObject(p.root,Buffer.from(JSON.stringify(body.parameters||{})));
  if(body.scriptSha256!==script.sha256)throw new AresError('脚本与审阅预览不一致，请重新查看脚本',409);
  const id=randomUUID(),directory=safePath(p.root,'.ares/research/native/'+id);mkdirSync(directory,{recursive:true});
  const snapshot=join(directory,'script'+extname(scriptPath)),inputFile=join(directory,'input.json'),paramsFile=join(directory,'parameters.json');
  for(const [path,object] of [[snapshot,script],[inputFile,input.normalized],[paramsFile,parameters]])writeFileSync(path,readProjectObject(p.root,object.sha256),{flag:'wx'});
  const spec={planId:id,interpreter:extname(scriptPath).toLowerCase()==='.py'?'python':'Rscript',
    script:{path:snapshot,sha256:script.sha256},input:{path:inputFile,sha256:input.normalized.sha256},parameters:{path:paramsFile,sha256:parameters.sha256},
    output:join(directory,'result.json'),receipt:join(directory,'receipt.json')};
  const planBytes=Buffer.from(JSON.stringify(spec)),planFile=join(directory,'plan.json');writeFileSync(planFile,planBytes,{flag:'wx'});
  const command="$ErrorActionPreference='Stop'\nif((Get-FileHash -Algorithm SHA256 -LiteralPath "+quote(worker)+").Hash.ToLowerInvariant() -ne "+quote(hash(readFileSync(worker)))+"){throw 'ARES analysis runner changed'}\n& python "+quote(worker)+' --native-spec '+quote(planFile)+' --expected-sha '+quote(hash(planBytes))+"\nif($LASTEXITCODE -ne 0){throw 'Analysis process failed'}";
  const manifest={schema_version:1,id:'study-native-'+id.slice(0,8),title:String(body.title||'自定义模型实验').slice(0,100),version:'1.0.0',kind:'native-tool',dataKind:input.synthetic?'synthetic':'unverified',
    inputSchema:{type:'object',additionalProperties:false},config:{tool:'pwsh',arguments:{description:'运行已审阅的固定分析脚本、数据和参数',command}}};
  const built=buildExtension({root:p.root,expectedRevision:body.expectedRevision,manifest,enabled:true});
  return saveResearchVersion({root:p.root,expectedRevision:built.project.revision},{kind:'experiment',title:manifest.title,status:'prepared',provenance:input.synthetic?'synthetic':'analysis',
    data:{engine:'native-script',spec:{scriptPath,scriptSha256:script.sha256,parameters:body.parameters||{}},native:{plan:spec,planFile,planSha256:hash(planBytes),extensionId:manifest.id,manifestHash:built.project.workbench.extensions[manifest.id].manifestHash},
      input:{...input,rows:undefined},markdown:'# '+manifest.title+'\n\n已固定脚本、数据和参数，等待宿主原生工具执行。'}});
}
export function collectScriptAnalysis(body) {
  const p=researchProject(body.root),entry=requireKind(researchVersion(p,body.id),'experiment'),native=entry.data.native;
  if(!native)throw new AresError('请选择自定义脚本实验');
  if(entry.data.nativeRunId===body.runId)return {item:entry.item,version:entry.version,revision:p.revision,idempotent:true};
  const run=extensionResult(p.root,body.runId).run;
  if(run.payload.extensionId!==native.extensionId||run.payload.manifestHash!==native.manifestHash||run.payload.status!=='succeeded'||run.payload.diagnostic?.status!=='succeeded')throw new AresError('脚本尚无匹配的宿主成功执行回执',409);
  const receiptFile=safePath(p.root,'.ares/research/native/'+native.plan.planId+'/receipt.json',{existing:true});
  if(statSync(receiptFile).size>5*1024*1024)throw new AresError('实际脚本回执过大');
  const receipt=JSON.parse(readFileSync(receiptFile,'utf8')),started=Date.parse(receipt.startedAt),finished=Date.parse(receipt.finishedAt);
  const dispatch=(p.workbench.eventIds||[]).map(id=>readProjectRecord(p.root,'events',id).payload).find(row=>row.type==='extension.run-started'&&row.detail.runId===run.payload.runId);
  if(!dispatch||receipt.planId!==native.plan.planId||receipt.exitCode!==0||!Number.isFinite(started)||!Number.isFinite(finished)||started>finished||started<Date.parse(dispatch.at)-1000||finished>Date.parse(run.payload.at)+1000)throw new AresError('脚本回执与原生执行不匹配',409);
  const output=safePath(p.root,'.ares/research/native/'+native.plan.planId+'/result.json',{existing:true});
  if(hash(readFileSync(output))!==receipt.outputSha256||hash(JSON.parse(readFileSync(output,'utf8')))!==hash(receipt.result))throw new AresError('脚本输出在执行后发生变化',409);
  const result=finiteMetrics({...receipt.result,python:receipt.python,engine:'native-script'});
  return saveResearchVersion({root:p.root,expectedRevision:body.expectedRevision,id:entry.item.id,baseVersion:entry.version.id},{kind:'experiment',title:entry.item.title,status:'completed',provenance:entry.version.payload.provenance,
    data:{...entry.data,nativeRunId:run.id,result,receiptObject:putProjectObject(p.root,readFileSync(receiptFile)),
      finishedAt:receipt.finishedAt,markdown:markdown(entry.item.title,result)}});
}
export async function runScriptAnalysis(body,{ctx,exec}) {
  if(body.runId)return collectScriptAnalysis(body);
  const p=researchProject(body.root),entry=requireKind(researchVersion(p,body.id),'experiment');
  if(!entry.data.native||entry.item.status!=='prepared')throw new AresError('此脚本实验尚未准备或已有执行结果');
  const result=await runExtension({root:p.root,expectedRevision:body.expectedRevision,id:entry.data.native.extensionId,input:{}},undefined,{ctx,exec,signal:exec.signal});
  if(result.run.payload.status!=='succeeded')return {run:result.run,accepted:false};
  return collectScriptAnalysis({root:p.root,id:entry.item.id,runId:result.run.id,expectedRevision:result.project.revision});
}
