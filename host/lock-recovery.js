import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {dirname,basename,join} from 'node:path';

/** Serializes stale-lock recovery across processes. The OS releases this mutex
 * on process death, so recovering a lock cannot itself leave a permanent lock.
 * Windows uses libuv's first named-pipe instance; other hosts use a local port.
 * No listener processes messages or exposes project data. */
export function withLockRecoveryGuard(path,fn){
 const canonical=join(realpathSync(dirname(path)),basename(path)),key=createHash('sha256').update(process.platform==='win32'?canonical.toLowerCase():canonical).digest('hex');
 const endpoint=process.platform==='win32'?'\\\\.\\pipe\\ares-lock-recovery-'+key:{host:'127.0.0.1',port:49152+parseInt(key.slice(0,6),16)%16384,exclusive:true};
 const buffer=new SharedArrayBuffer(8),state=new Int32Array(buffer),worker=new Worker(new URL('./lock-recovery-worker.js',import.meta.url),{workerData:{state:buffer,endpoint},resourceLimits:{maxOldGenerationSizeMb:32}});
 worker.on('error',()=>{});worker.unref();
 try{
  Atomics.wait(state,0,0,5000);
  if(Atomics.load(state,0)!==1){const error=new Error(Atomics.load(state,1)===1?'另一处正在恢复保存，请稍后重试':'保存锁恢复服务未就绪，未修改项目文件');error.status=Atomics.load(state,1)===1?409:503;throw error;}
  return fn();
 }finally{
  const previous=Atomics.exchange(state,0,3);Atomics.notify(state,0);
  if(previous===1)Atomics.wait(state,0,3,5000);
  worker.terminate().catch(()=>{});
 }
}
