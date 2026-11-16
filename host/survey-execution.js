import {Worker} from 'node:worker_threads';
import {AresError} from './storage.js';

// Fixed trusted computation code, never an external plugin script or model.
const waiting=[];let running=0;const limit=2;
const cancelled=()=>new DOMException('问卷预测试已取消','AbortError');
function acquire(signal){
 if(signal?.aborted)return Promise.reject(cancelled());if(running<limit){running++;return Promise.resolve();}
 if(waiting.length>=32)return Promise.reject(new AresError('预测试计算队列已满，请等待当前任务结束后重试',503));
 return new Promise((resolve,reject)=>{const entry={resolve,reject,signal};entry.abort=()=>{const index=waiting.indexOf(entry);if(index>=0)waiting.splice(index,1);reject(cancelled());};signal?.addEventListener('abort',entry.abort,{once:true});waiting.push(entry);});
}
function release(){while(waiting.length){const entry=waiting.shift();entry.signal?.removeEventListener('abort',entry.abort);if(entry.signal?.aborted){entry.reject(cancelled());continue;}entry.resolve();return;}running--;}
export async function runSurveyPretest(input,{signal}={}){
 await acquire(signal);if(signal?.aborted){release();throw cancelled();}
 return new Promise((resolve,reject)=>{
  let worker;try{worker=new Worker(new URL('./survey-worker.js',import.meta.url),{workerData:input,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256,stackSizeMb:8}});}catch{release();reject(new AresError('无法启动预测试计算线程',503));return;}
  let result,error,aborted=false,timedOut=false;const abort=()=>{aborted=true;void worker.terminate();};signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;void worker.terminate();},30000);
  worker.once('message',value=>{result=value;});worker.once('error',value=>{error=value;});
  worker.once('exit',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);release();if(aborted||signal?.aborted){reject(cancelled());return;}if(timedOut){reject(new AresError('预测试计算超过30秒，请缩小批次后重试',504));return;}if(error||code!==0){reject(new AresError('预测试计算线程失败或超出资源限制，请分批处理',503));return;}if(!result?.ok){reject(new AresError(result?.error||'预测试没有返回有效计算结果'));return;}resolve({csv:result.csv,report:result.report});});
 });
}
