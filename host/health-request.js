/** Owner-requested, fixed safe diagnostics. No command/tool/path is accepted
 * from this request; HTTP authentication and native tool permissions stay intact. */
import {readFileSync,writeFileSync,lstatSync,existsSync,watch,mkdirSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {ROOT} from './catalog.js?v=2.3.0-directory1';
import {atomicJson,now} from './storage.js';
export const healthRequestPaths=()=>({request:join(ROOT,'.claude','native-health-request.json'),result:join(ROOT,'.claude','native-health-result.json')});
export function readHealthRequest(path,at=Date.now()){
 try{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)return null;const value=JSON.parse(readFileSync(path,'utf8')),keys=['schema_version','kind','id','issuedAt','expiresAt','targetPid'];if(Object.keys(value).some(key=>!keys.includes(key))||value.schema_version!==1||value.kind!=='native-safe-check-v1'||value.targetPid!==process.pid||typeof value.id!=='string'||!/^[a-f0-9-]{36}$/.test(value.id)||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.issuedAt>at+30000||value.expiresAt<=at||value.expiresAt-value.issuedAt>1800000)return null;return value;}catch{return null;}
}
export function startHealthRequest(editor,{paths=healthRequestPaths(),pollMs=2000,onError=()=>{}}={}){
 let stopped=false,busy=false,timer=null,watcher=null,controller=null;
 const readResult=()=>{try{return JSON.parse(readFileSync(paths.result,'utf8'));}catch{return null;}};
 function publish(request,result){if(readHealthRequest(paths.request)?.id!==request.id)return;atomicJson(paths.result,{schema_version:1,requestId:request.id,updatedAt:now(),...result});}
 function later(){if(!stopped){clearTimeout(timer);timer=setTimeout(()=>run(),pollMs);timer.unref?.();}}
 async function check(){
  if(stopped||busy)return;const request=readHealthRequest(paths.request);if(!request)return;
  const previous=readResult();if(previous?.requestId===request.id&&['passed','failed','blocked','unknown'].includes(previous.status))return;
  if(previous?.requestId===request.id&&previous.status==='running'){publish(request,{status:'unknown',error:'上次体检执行结果未收齐，未重复启动'});return;}
  if(typeof editor.healthReadiness!=='function'||typeof editor.healthCheck!=='function'){publish(request,{status:'failed',error:'当前进程仍在使用旧ARES服务，请载入2.1.1后重新请求体检'});return;}
  const readiness=editor.healthReadiness();if(!readiness.ready){const reason=readiness.reason||'等待现有ARES编辑会话空闲';if(previous?.requestId!==request.id||previous.reason!==reason)publish(request,{status:'pending',reason});later();return;}
  mkdirSync(dirname(paths.result),{recursive:true});const claim=paths.result+'.claim-'+request.id;
  try{writeFileSync(claim,JSON.stringify({requestId:request.id,pid:process.pid,at:now()}),{flag:'wx',mode:0o600});}
  catch(error){if(error.code==='EEXIST'){publish(request,{status:'unknown',error:'此请求已有执行凭据，未重复运行'});return;}throw error;}
  busy=true;controller=new AbortController();publish(request,{status:'running',pid:process.pid});
  try{const value=await editor.healthCheck({}, {signal:controller.signal}),report=value.report;publish(request,{status:report?.complete&&[2,3].includes(report.implementationRevision)?'passed':report?.status==='blocked'?'blocked':'failed',report});}
  catch(error){const safe=Number.isInteger(error.status)&&typeof error.message==='string'&&!/token|secret|cookie|authorization|password|credential|api.?key|bearer/i.test(error.message);publish(request,{status:'failed',error:safe?error.message.slice(0,500):'原生体检未完成；未启动替代会话或模型',errorStatus:Number.isInteger(error.status)?error.status:null});}
  finally{busy=false;controller=null;}
 }
 const run=()=>check().catch(error=>{onError(error);});
 if(existsSync(dirname(paths.request))){watcher=watch(dirname(paths.request),{persistent:false},(_event,name)=>{if(String(name)===basename(paths.request))run();});watcher.on('error',onError);}
 queueMicrotask(run);
 return {check:run,dispose(){stopped=true;clearTimeout(timer);watcher?.close();controller?.abort();}};
}
