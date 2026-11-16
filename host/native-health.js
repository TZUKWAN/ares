import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {AresError,home,atomicJson,safePath,now} from './storage.js';
import {nativeToolOutcome} from './skill-execution.js';
import {runConversationHealth} from './native-conversation-health.js';

const terminal=job=>['completed','failed','killed'].includes(job.status);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
/** Observe only this owned probe. A real waiter prevents the standard job
 * notifier from waking a model for results the UI caller is already collecting.
 * Never changes global notification settings or touches another job. */
function observeOwnedJobs(registry,owner,nonce){
 if(!registry?.events?.subscribe||!registry.wait||!registry.get)throw new AresError('原生任务观察服务未就绪，未执行终端体检',503);
 const jobs=new Map(),failures=[];
 const unsubscribe=registry.events.subscribe({owner},event=>{
  const job=event.job;if(event.type!=='registered'||job?.owner!==owner||typeof job.label!=='string'||!job.label.includes(nonce)||jobs.has(job.id))return;
  const record={id:job.id,status:job.status};jobs.set(job.id,record);
  record.wait=(async()=>{try{let state=job;while(!terminal(state)){state=await registry.wait(job.id,30000,owner);if(!state||state.id!==job.id)throw new Error('Invalid owned job state');}record.status=state.status;}catch{record.status='unknown';failures.push(job.id);}})();
 });
 return {jobs,failures,close(){if(typeof unsubscribe==='function')unsubscribe();else unsubscribe?.dispose?.();}};
}
export async function runNativeHealth(ctx,agent,surface,{signal,expectedServiceId}={}){
 if(typeof expectedServiceId!=='string'||!expectedServiceId)throw new AresError('缺少当前原生配置服务标识，未把未知服务当作当前版本',409);
 const id=randomUUID(),nonce='ARES_HEALTH_'+id,challenge='ARES_READ_'+randomUUID(),psMarker='ARES_SUM_'+randomUUID()+'|',root=agent.session?.header?.cwd;
 if(!root||ctx.get?.('agents')?.get?.(agent.id)!==agent)throw new AresError('需要当前真实ARES编辑Agent，未创建替代会话',409);
 const tools=ctx.get?.('tools')||ctx.tools,registry=agent.ctx?.get?.('jobs')||ctx.get?.('jobs')||ctx.jobs;
 if(!tools?.schemas||!tools.execute)throw new AresError('原生工具执行服务未就绪',503);
 const permissionPresets=agent.ctx?.get?.('permissionPresets')||ctx.get?.('permissionPresets'),permission=permissionPresets?.current?.(agent.session)??surface?.permissions?.current;
 if(permission==='auto'&&typeof ctx.get?.('sessionController')?.prompt==='function')return runConversationHealth(ctx,agent,surface,{signal,expectedServiceId});
 const activeSignal=signal||new AbortController().signal,rawSchemas=tools.schemas(agent),wire=typeof tools.wireSchemas==='function'?tools.wireSchemas(agent):[],wireSchemas=Array.isArray(wire)?wire:wire?.schemas;
 if(!Array.isArray(rawSchemas)||!Array.isArray(wireSchemas))throw new AresError('原生工具目录或展示目录结构不符，未猜测工具可用性',503);
 const schemas=[...rawSchemas,...wireSchemas],map=new Map(schemas.map(s=>[s.name,s]));
 const file=safePath(root,'.ares-healthcheck/'+id+'/marker.txt'),content=challenge+'\n',values=[7,11,17],sum=values.reduce((a,b)=>a+b,0),command='# '+nonce+'\n$value=('+values.join('+')+'); Write-Output ('+quote(psMarker)+' + $value)';
 const report={schema_version:1,implementation:'ares-native-health-v1',implementationRevision:2,pluginVersion:'2.3.0',id,sessionId:agent.id,reportPath:join(home(),'ares-health-reports',id+'.json'),checkedAt:now(),complete:false,status:'running',presentation:surface?.presentation,toolNames:[...map.keys()].sort(),modelRequestsInitiated:0,newSessionsCreated:0,newDshHostsStarted:0,userWindowsControlled:0,checks:[],calls:[],blockers:[]};
 const observer=observeOwnedJobs(registry,agent.id,nonce);
 async function invoke(name,args){
  activeSignal.throwIfAborted();const schema=map.get(name);if(!schema)throw new AresError('当前Agent没有体检所需工具：'+name,403);
  // Probe bookkeeping belongs to the independent report below. append() is
  // for native event vocabulary: custom required events make cold restore
  // refuse the whole conversation. DSH owns its real tool/message records.
  const callId='ares-health:'+id+':'+report.calls.length;
  try{const result=await tools.execute({name,arguments:args,schema,agent,callId,rootCallId:callId,signal:activeSignal});const status=nativeToolOutcome(result);report.calls.push({callId,name,status});return result;}
  catch{report.calls.push({callId,name,status:'unknown'});throw new AresError('原生体检调用未返回完整结果，未将未知结果当作通过',502);}
 }
 function passed(name,condition){report.checks.push({name,status:condition?'passed':'failed'});return condition;}
 function text(value){try{return JSON.stringify(value);}catch{return '';}}
 try{
  if(!passed('actual-tool-surface',surface?.ready===true))throw new AresError('当前工具目录尚未通过与DSH标准的实际比对',409);
  // Auto reviews a genuine, model-owned pending call against its request route,
  // open step and durable tool/call event. A background diagnostic has none of
  // those facts. Do not forge them, invoke an approval model, or change policy.
  if(permission==='auto'){
   report.status='blocked';report.blockers.push({code:'auto-review-background-context',message:'当前会话使用DSH自动审批。后台体检没有模型产生的待执行调用及审批上下文，未执行工具，也未调用审批模型。',nextAction:'可在正常ARES对话中使用工具并由DSH审批；本次后台体检不能代替该链路的验收。'});passed('background-tool-approval',false);
   throw new AresError(report.blockers[0].message,409);
  }
  if(surface.presentation==='ptc'){const language=(agent.ctx?.get?.('ptcRuntime')||ctx.get?.('ptcRuntime'))?.language;if(language&&!['javascript','typescript'].includes(language))throw new AresError('此PTC语言的体检脚本尚未适配，未强制切换展示模式',503);}
  let config,read,pwsh;
  if(surface.presentation==='ptc'){const result=await invoke('run_code',{description:nonce,code:'return await tools.ares_config_read({kind:"context"});'});if(nativeToolOutcome(result)!=='succeeded')throw new AresError('原生PTC配置读取没有成功返回',502);config=result.value?.result;}
  else{const result=await invoke('ares_config_read',{kind:'context'});if(nativeToolOutcome(result)!=='succeeded')throw new AresError('原生配置读取没有成功返回',502);config=result.value;}
  let context;try{context=typeof config==='string'?JSON.parse(config):config;}catch{}
  if(!passed('actual-config-context',context?.target==='ARES配置编辑'&&context?.workspaceSelectionRequired===false))throw new AresError('工具未返回真实ARES编辑上下文，未执行后续检查',409);
  if(!passed('current-editor-service',context?.serviceInstanceId===expectedServiceId))throw new AresError('当前工具仍绑定旧的配置服务，请在空闲时重载并重新连接ARES',409);
  if(surface.presentation==='ptc'){
   const code='const c=await tools.ares_config_read({kind:"context"}); await tools.write({file_path:'+JSON.stringify(file)+',content:'+JSON.stringify(content)+'}); const r=await tools.read({file_path:'+JSON.stringify(file)+'}); let p=await tools.pwsh({command:'+JSON.stringify(command)+',description:'+JSON.stringify(nonce)+',run_in_background:false}); let psText=""; for(let n=0;n<3&&["background","promoted"].includes(p?.kind);n++){const j=p.jobId||p.job?.id;if(!j)throw Error("No actual job id");p=await tools.job_output({job_id:j,wait:true,timeout_ms:30000});psText+=p.text||"";if(["running","stopping"].includes(p.job?.status))p={...p,kind:"background",jobId:j};} return {config:c,read:r,pwsh:p,psText};';
   const result=await invoke('run_code',{description:nonce,code});if(nativeToolOutcome(result)!=='succeeded')throw new AresError('原生PTC调用没有成功返回',502);const returned=result.value?.result;if(!returned)throw new AresError('PTC结果没有实际返回值，未猜测通过',502);config=returned.config;read=returned.read;pwsh={value:returned.pwsh,content:[{type:'text',text:returned.psText||''}]};
  }else{
   const written=await invoke('write',{file_path:file,content});if(nativeToolOutcome(written)!=='succeeded')throw new AresError('原生写入未成功',502);
   const readResult=await invoke('read',{file_path:file});if(nativeToolOutcome(readResult)!=='succeeded')throw new AresError('原生读取未成功',502);read=readResult.value??readResult.content;
   pwsh=await invoke('pwsh',{command,description:nonce,run_in_background:false});let output='';
   for(let n=0;n<3&&nativeToolOutcome(pwsh)==='pending';n++){const jobId=pwsh.value?.jobId||pwsh.value?.job?.id;if(!jobId)break;pwsh=await invoke('job_output',{job_id:jobId,wait:true,timeout_ms:30000});output+=pwsh.value?.text||'';}
   if(output)pwsh={...pwsh,healthCollectedText:output};
  }
  passed('actual-native-read',text(read).includes(challenge));
  passed('actual-filesystem-write',readFileSync(file,'utf8')===content);
  passed('actual-pwsh-calculation',nativeToolOutcome(pwsh)==='succeeded'&&text(pwsh.value?.stdout||pwsh.value?.text||pwsh.healthCollectedText||pwsh.content).includes(psMarker+sum));
  passed('owned-job-observation',observer.failures.length===0&&observer.jobs.size>0&&[...observer.jobs.values()].every(job=>terminal(job)));
  report.complete=report.checks.every(check=>check.status==='passed');
 }catch(error){report.error=error instanceof AresError?error.message:activeSignal.aborted?'工具体检已取消':'工具体检未完成，原始数据未被改写';}
 finally{observer.close();if(report.status!=='blocked')report.status=report.complete?'passed':'failed';report.jobs=[...observer.jobs.values()].map(({id,status})=>({id,status}));report.finishedAt=now();atomicJson(report.reportPath,report);}
 return report;
}
