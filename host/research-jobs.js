import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {AresError,atomicJson,now,readJson,safePath} from './storage.js';
import {changeProject} from './projects.js?v=2.3.0-directory1';
import {projectEvent} from './project-artifacts.js';
import {researchProject,researchState} from './project-research.js';

const active=new Map();
const idPattern=/^[a-f0-9-]{36}$/;
const jobPath=(root,id)=>safePath(root,'.ares/research/jobs/'+id+'.json');
const isLive=job=>{
  if(job.host!==hostname())return true;
  try {process.kill(job.pid,0);return true;}catch(error){return error.code!=='ESRCH';}
};
function readJob(p,id) {
  const registered=typeof id==='string'&&idPattern.test(id)&&researchState(p).jobs[id];
  if(!registered)throw new AresError('任务不属于此项目',404);
  const job=readJson(jobPath(p.root,id));
  if(job.projectId!==p.id||job.id!==id||job.kind!==registered.kind)throw new AresError('任务回执与项目身份不一致',409);
  if(job.status==='running'&&!active.has(id)&&(job.pid===process.pid||!isLive(job)))
    return {...job,status:'interrupted',message:'任务曾中断，可以使用原始文件重试'};
  return job;
}
function summary(job) {
  const {pid,host,checkpoint,...rest}=job;
  return {...rest,checkpointCount:checkpoint?.count??0};
}
export function getResearchJob(root,id) {return summary(readJob(researchProject(root),id));}
export function listResearchJobs(root) {
  const p=researchProject(root);
  return Object.keys(researchState(p).jobs).slice(-80).reverse().map(id=>summary(readJob(p,id)));
}
export function previousResearchJob(root,id,kind) {
  const job=readJob(researchProject(root),id);
  if(job.kind!==kind||!['failed','cancelled','interrupted'].includes(job.status))throw new AresError('只有已中断、失败或取消的同类型任务可以重试',409);
  return job;
}
export function createResearchJobs() {
  const owned=new Set();
  function start(body,{kind,title,settings={},source=null,previous=null},run) {
    let receipt;
    const project=changeProject(body,p=>{
      const state=researchState(p,{create:true}),id=randomUUID();
      if(Object.keys(state.jobs).length>=1000)throw new AresError('研究任务记录达到上限',409);
      const running=Object.entries(state.jobs).filter(([id,job])=>job.kind===kind&&readJob(p,id).status==='running');
      if(running.length>=2||running.some(([id])=>source&&JSON.stringify(readJob(p,id).source)===JSON.stringify(source)))
        throw new AresError('同一材料或项目已在执行，请先查看当前任务',409);
      receipt={schemaVersion:1,id,kind,title,projectId:p.id,status:'running',startedAt:now(),pid:process.pid,host:hostname(),settings,source,
        priorJob:previous?.id??null,progress:{phase:'preparing',done:0,total:null}};
      atomicJson(jobPath(p.root,id),receipt);
      state.jobs[id]={kind};
      projectEvent(p.root,p,'research.job-started',{id,kind,source,priorJob:receipt.priorJob});
    });
    const {id}=receipt,controller=new AbortController();
    const persist=()=>atomicJson(jobPath(project.root,id),receipt);
    let lastSaved=0;
    const update=(progress,checkpoint)=>{
      receipt.progress={...receipt.progress,...progress};
      if(checkpoint)receipt.checkpoint=checkpoint;
      if(Date.now()-lastSaved>650||checkpoint||progress.phase==='publishing'){persist();lastSaved=Date.now();}
    };
    active.set(id,{controller,projectId:project.id});
    owned.add(id);
    void Promise.resolve().then(async()=>{
      try {
        controller.signal.throwIfAborted();
        const result=await run({job:receipt,signal:controller.signal,update});
        receipt.status='completed';receipt.result=result;
        receipt.progress={phase:'completed',done:1,total:1};
      }catch(error){
        receipt.status=controller.signal.aborted?'cancelled':'failed';
        receipt.message=controller.signal.aborted?'任务已取消':error instanceof AresError?error.message:'工作进程未能完成任务';
      }finally{
        receipt.finishedAt=now();
        try {persist();}
        catch(error){console.warn('[ares] 无法保存研究任务回执',error.code??'storage');}
        finally{active.delete(id);owned.delete(id);}
      }
    });
    return {job:summary(receipt),revision:project.revision};
  }
  function cancel(root,id) {
    const p=researchProject(root),job=readJob(p,id),operation=active.get(id);
    if(!operation||operation.projectId!==p.id||!owned.has(id)||job.status!=='running')throw new AresError('此任务当前不可取消',409);
    operation.controller.abort(new DOMException('研究任务已取消','AbortError'));
    return {job:{...summary(job),status:'cancelling'}};
  }
  return {start,cancel,dispose(){for(const id of owned)active.get(id)?.controller.abort();}};
}
