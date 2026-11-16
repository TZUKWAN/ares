/** Auto approval must see a genuine DSH-owned conversation and pending action.
 * This module submits one bounded owner request through SessionController. It
 * never writes request headers, assistant messages, steps or tool-call events.
 */
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {AresError,home,atomicJson,safePath,now} from './storage.js';

const terminal=job=>['completed','failed','killed'].includes(job?.status);
export const healthJobSucceeded=job=>job?.status==='completed'&&/^exit code: 0(?:;|$)/.test(job.detail||'');
export function healthJobSnapshot(value,id){if(!value||value.id!==id||!['running','stopping','completed','failed','killed'].includes(value.status))throw new AresError('原生任务观察未返回对应的实际任务，未猜测完成状态',502);return value;}
const texts=value=>(value?.content||[]).filter(row=>row.type==='text').map(row=>row.text).join('\n');
const args=value=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}};
const samePath=(left,right)=>typeof left==='string'&&resolve(left).toLowerCase()===resolve(right).toLowerCase();

export function healthConversationPlan(root,id=randomUUID()){
 const nonce='ARES_HEALTH_'+id,challenge='ARES_READ_'+randomUUID(),marker='ARES_SUM_'+randomUUID()+'|',values=[7,11,17],sum=values.reduce((a,b)=>a+b,0),file=safePath(root,'.ares-healthcheck/'+id+'/marker.txt'),content=challenge+'\n';
 const command='# '+nonce+'\n$value=('+values.join('+')+'); Write-Output (\''+marker+'\' + $value)';
 const instruction='刘总要求对当前ARES助手进行一次真实工具链体检。使用当前DSH会话、原生工具和原有自动审批，不创建会话、子Agent或DSH，不改权限、配置、竞赛文件、验收状态或MCP。\n'+
  '依次实际调用：1. ares_config_read，参数 {"kind":"context"}；2. write，将下列完整content写入file_path；3. read读取同一文件；4. pwsh执行下列固定command，run_in_background=false。仅可用这四种工具及为收齐本次终端结果必需的job_output；如工具通过PTC展示，使用run_code及真实tools绑定。保留原DSH审批，工具被拒绝或失败时如实停止，不能改用其他路径或伪造结果。最后简短说明实际结果，不继续改项目。\n'+JSON.stringify({file_path:file,content,command,description:nonce});
 return {id,requestId:'ares-health-'+id,nonce,challenge,marker,values,sum,file,content,command,instruction};
}

/** Read-only verifier. A model's prose never proves a tool was executed. */
export function verifyHealthConversation(events,plan,expectedServiceId){
 const user=events.find(event=>event.type==='user/message'&&event.data?.source?.kind==='user'&&event.data.source.rpcId===plan.requestId);
 const turnStart=user&&events.filter(event=>event.type==='turn/start'&&event.seq<user.seq).at(-1),turn=turnStart?.data.turn;
 const roots=events.filter(event=>event.type==='tool/call'&&turn!==undefined&&event.data.turn===turn&&event.seq>user.seq),calls=[];
 for(const event of roots){
  const row=event.data,visible=events.some(item=>item.type==='assistant/message'&&item.data?.turn===turn&&item.data.step===row.step&&item.seq<event.seq&&item.data.message?.content?.some(block=>block.type==='tool-call'&&block.id===row.callId&&block.name===row.name&&block.arguments===row.arguments));
  const step=events.some(item=>item.type==='step/start'&&item.data.turn===turn&&item.data.step===row.step&&item.seq<event.seq),result=events.find(item=>item.type==='tool/result'&&item.data.turn===turn&&item.data.step===row.step&&item.data.message?.toolCallId===row.callId&&item.seq>event.seq);
  calls.push({name:row.name,arguments:args(row.arguments),callId:row.callId,turn,step:row.step,callSeq:event.seq,resultSeq:result?.seq,valid:visible&&step&&!!result&&result.data.message.isError===false,text:result?texts(result.data.message):'',transport:'native'});
  if(row.name==='run_code'&&visible&&step){
   for(const inner of events.filter(item=>item.type==='tool/ptc-dispatch-start'&&item.data.rootCallId===row.callId&&item.seq>event.seq)){
    const value=inner.data,returned=events.find(item=>item.type==='tool/ptc-dispatch'&&item.data.subCallId===value.subCallId&&item.data.rootCallId===row.callId&&item.seq>inner.seq);
    calls.push({name:value.name,arguments:args(value.arguments),callId:value.subCallId,turn,step:row.step,callSeq:inner.seq,resultSeq:returned?.seq,valid:!!returned&&returned.data.isError===false,text:returned?texts(returned.data):'',transport:'ptc'});
   }
  }
 }
 const found=(name,predicate)=>calls.find(row=>row.valid&&row.name===name&&predicate(row.arguments,row)),configuration=found('ares_config_read',value=>value?.kind==='context');let context;
 try{context=JSON.parse(configuration?.text);}catch{}
 const written=found('write',value=>samePath(value?.file_path,plan.file)&&value.content===plan.content),read=found('read',(value,row)=>samePath(value?.file_path,plan.file)&&row.text.includes(plan.challenge));
 const pwsh=found('pwsh',value=>value?.command===plan.command&&value.run_in_background!==true),output=found('job_output',(_value,row)=>row.text.includes(plan.marker+plan.sum));
 const header=configuration&&events.filter(event=>event.type==='request/header'&&event.seq<configuration.callSeq).at(-1)?.data.header;
 const checks=[['genuine-owner-prompt',!!user&&turn!==undefined],['actual-request-route',!!header?.config?.provider&&!!header?.config?.model],['actual-config-context',context?.target==='ARES配置编辑'&&context.workspaceSelectionRequired===false],['current-editor-service',context?.serviceInstanceId===expectedServiceId],['actual-native-write-call',!!written],['actual-native-read',!!read],['actual-pwsh-calculation',!!pwsh&&(pwsh.text.includes(plan.marker+plan.sum)||!!output)]];
 return {turn,route:header?{provider:header.config.provider,model:header.config.model}:null,checks:checks.map(([name,value])=>({name,status:value?'passed':'failed'})),calls:calls.map(({text,arguments:_arguments,valid,...row})=>({...row,status:valid?'succeeded':'failed'}))};
}

export async function runConversationHealth(ctx,agent,surface,{signal,expectedServiceId,timeoutMs=180000}={}){
 const plan=healthConversationPlan(agent.session.header.cwd),report={schema_version:1,implementation:'ares-native-health-v1',implementationRevision:3,pluginVersion:'2.3.0',id:plan.id,sessionId:agent.id,requestId:plan.requestId,checkedAt:now(),reportPath:join(home(),'ares-health-reports',plan.id+'.json'),executionMode:'dsh-native-conversation',complete:false,status:'running',modelConversationRequested:false,newSessionsCreated:0,newDshHostsStarted:0,userWindowsControlled:0,presentation:surface?.presentation,toolNames:surface?.visibleTools||[],checks:[],calls:[],blockers:[],jobs:[]};
 const controller=ctx.get?.('sessionController'),registry=agent.ctx?.get?.('jobs')||ctx.get?.('jobs');let stop=null,stopGuard=null,admitted=false,done=false,timeout;const jobs=new Map(),waits=[];
 const check=(name,value)=>report.checks.push({name,status:value?'passed':'failed'});
 const save=()=>atomicJson(report.reportPath,{...report,updatedAt:now()});
 const ownsActiveTurn=()=>{const events=agent.session.snapshotEvents(),start=events.filter(row=>row.type==='turn/start').at(-1),own=events.find(row=>row.type==='user/message'&&row.seq>start?.seq&&row.data?.source?.rpcId===plan.requestId);return !!own&&!events.some(row=>row.type==='turn/end'&&row.seq>start.seq)&&!events.some(row=>row.type==='user/message'&&row.seq>own.seq&&row.data?.source?.kind==='user'&&row.data.source.rpcId!==plan.requestId);};
 try{
  check('actual-tool-surface',surface?.ready===true);if(!surface?.ready)throw new AresError('实际工具目录尚未对齐DSH',409);
  if(typeof controller?.prompt!=='function'||typeof agent.whenIdle!=='function'||typeof agent.session.snapshotEvents!=='function'){
   report.status='blocked';report.blockers.push({code:'native-conversation-unavailable',message:'自动审批需要DSH正常对话入口，当前宿主尚未提供可用的原生消息或完成通知接口。'});throw new AresError(report.blockers[0].message,503);
  }
  if(ctx.get?.('agents')?.get?.(agent.id)!==agent||agent.status!=='idle'||agent.inbox?.nextTurn?.length||agent.inbox?.nextStep?.length)throw new AresError('ARES现有会话未空闲或已有待发消息，未插入体检',409);
  if(typeof registry?.events?.subscribe!=='function'||typeof registry.wait!=='function')throw new AresError('原生任务观察服务未就绪',503);
  if(typeof ctx.on!=='function')throw new AresError('原生体检约束服务未就绪',503);
  // Narrow only this explicitly requested diagnostic turn. Every ordinary
  // conversation retains the full DSH tool surface and original policy chain.
  stopGuard=ctx.on('tools/pre-execute',async(exec,next)=>{
   const decision=await next();if(decision.kind!=='allow'||exec.agent!==agent)return decision;
   const events=agent.session.snapshotEvents(),root=events.filter(row=>row.type==='tool/call'&&row.data.callId===(exec.rootCallId||exec.callId)).at(-1),start=root&&events.find(row=>row.type==='turn/start'&&row.data.turn===root.data.turn),own=start&&events.some(row=>row.type==='user/message'&&row.seq>start.seq&&row.seq<root.seq&&row.data?.source?.rpcId===plan.requestId);
   if(!own)return decision;const ownMessage=events.find(row=>row.type==='user/message'&&row.seq>start.seq&&row.seq<root.seq&&row.data?.source?.rpcId===plan.requestId);if(events.some(row=>row.type==='user/message'&&row.seq>ownMessage.seq&&row.seq<root.seq&&row.data?.source?.kind==='user'&&row.data.source.rpcId!==plan.requestId))return decision;
   const value=exec.arguments,allowed=exec.name==='run_code'&&surface.presentation==='ptc'||exec.name==='ares_config_read'&&value?.kind==='context'||exec.name==='write'&&samePath(value?.file_path,plan.file)&&value.content===plan.content||exec.name==='read'&&samePath(value?.file_path,plan.file)||exec.name==='pwsh'&&value?.command===plan.command&&value.run_in_background!==true||exec.name==='job_output'&&jobs.has(value?.job_id);
   return allowed?decision:{kind:'deny',reason:'本次ARES固定体检仅允许指定的配置读取、标记文件读写和固定算术命令；未执行额外操作。'};
  });
  stop=registry.events.subscribe({owner:agent.id},event=>{const job=event.job;if(event.type!=='registered'||job?.owner!==agent.id||!job.label?.includes(plan.nonce)||jobs.has(job.id))return;const row={id:job.id,status:job.status};jobs.set(job.id,row);waits.push((async()=>{try{let current=healthJobSnapshot(job,job.id);const deadline=Date.now()+timeoutMs;while(!terminal(current)){if(signal?.aborted||Date.now()>=deadline)throw new Error('Owned job observation interrupted');current=healthJobSnapshot(await registry.wait(job.id,Math.min(30000,Math.max(1,deadline-Date.now())),agent.id),job.id);}row.status=current.status;row.detail=current.detail;}catch{row.status='unknown';}})());});
  signal?.throwIfAborted();save();
  const accepted=await controller.prompt({sessionId:agent.id,requestId:plan.requestId,mode:'followup',content:[{type:'text',text:plan.instruction}],clientTimeZone:'Asia/Shanghai'},signal||new AbortController().signal);
  admitted=true;report.modelConversationRequested=true;if(accepted?.accepted!==true)throw new AresError('DSH没有确认接收体检消息，未重复发送',502);save();
  const idle=agent.whenIdle().then(()=>{done=true;});
  const limit=AbortSignal.timeout(timeoutMs),active=signal?AbortSignal.any([signal,limit]):limit;
  const interrupted=new Promise((_,reject)=>{const abort=()=>reject(new DOMException('体检已取消或超时','AbortError'));if(active.aborted)abort();else{active.addEventListener('abort',abort,{once:true});timeout=()=>active.removeEventListener('abort',abort);}});
  await Promise.race([idle,interrupted]);await Promise.race([Promise.all(waits),interrupted]);
  const proof=verifyHealthConversation(agent.session.snapshotEvents(),plan,expectedServiceId);Object.assign(report,proof);report.checks.unshift({name:'actual-tool-surface',status:'passed'});
  check('actual-filesystem-write',readFileSync(plan.file,'utf8')===plan.content);check('owned-job-observation',jobs.size>0&&[...jobs.values()].every(healthJobSucceeded));
  const end=agent.session.snapshotEvents().find(row=>row.type==='turn/end'&&row.data.turn===proof.turn);check('actual-conversation-finished',end?.data.reason?.kind==='completed');
  report.complete=report.checks.every(row=>row.status==='passed');if(!report.complete)report.error='原生对话已结束，但实际调用、审批回执或文件检查未全部通过；未采信模型自述。';
 }catch(error){
  if(admitted&&!done&&ownsActiveTurn()){try{controller.cancel({sessionId:agent.id});await Promise.race([agent.whenIdle().then(()=>{done=true;}),new Promise(resolve=>{const timer=setTimeout(resolve,10000);timer.unref?.();})]);}catch{}}
  if(report.status!=='blocked')report.status=admitted&&!done?'unknown':'failed';
  report.error=error instanceof AresError?error.message:signal?.aborted?'原生对话体检已取消，未影响其他会话':'原生对话体检未完成，请核对DSH实际模型连接与调用记录。';
 }finally{timeout?.();if(typeof stop==='function')stop();else stop?.dispose?.();if(stopGuard){if(admitted&&!done)agent.whenIdle().finally(()=>stopGuard()).catch(()=>{});else stopGuard();}report.jobs=[...jobs.values()];if(report.status==='running')report.status=report.complete?'passed':'failed';report.finishedAt=now();save();}
 return report;
}
