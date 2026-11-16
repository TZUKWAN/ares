import {AresError} from './storage.js';

export function agentFamily(ctx,sessionId){
 const agents=ctx.get?.('agents'),root=sessionId?agents?.get?.(sessionId):null;
 if(!root||!agents?.list||!agents?.isOwnedBy)return {known:false,running:null,status:'not-active',activeAgents:[],agents:[]};
 const family=[root],seen=new Set(family),all=agents.list();
 for(let at=0;at<family.length;at++)for(const candidate of all)if(!seen.has(candidate)&&agents.isOwnedBy(candidate.id,family[at])){seen.add(candidate);family.push(candidate);}
 const known=family.every(agent=>agent.status==='idle'||agent.status==='running'),activeAgents=family.filter(agent=>agent.status==='running').map(agent=>agent.id);
 return {known,running:activeAgents.length?true:known?false:null,status:activeAgents.length?'running':known?'idle':'unknown',activeAgents,agents:family};
}
export function executionState(ctx,sessionId){
 const {agents,...state}=agentFamily(ctx,sessionId),activeJobs=[];let jobsKnown=true;
 for(const agent of agents){
  try{const registry=agent.ctx?.get?.('jobs')||ctx.get?.('jobs')||ctx.jobs;if(typeof registry?.list!=='function'){jobsKnown=false;continue;}const rows=registry.list(agent.id);if(!Array.isArray(rows)){jobsKnown=false;continue;}
   for(const job of rows){if(!job||typeof job!=='object'||job.owner!==undefined&&typeof job.owner!=='string'){jobsKnown=false;continue;}if(job.owner!==agent.id)continue;if(typeof job.id!=='string'||!['running','stopping','completed','failed','killed'].includes(job.status)){jobsKnown=false;continue;}if(['running','stopping'].includes(job.status)&&!activeJobs.some(row=>row.id===job.id&&row.owner===job.owner))activeJobs.push({id:job.id,owner:job.owner});}
  }catch{jobsKnown=false;}
 }
 const known=state.known&&jobsKnown,running=state.activeAgents.length||activeJobs.length?true:known?false:null;
 return {...state,known,running,status:running?'running':known?'idle':'unknown',agentCount:agents.length,jobsKnown,activeJobs};
}
export function assertIdle(ctx,sessionId){
 if(!sessionId)return;
 const state=executionState(ctx,sessionId);
 if(state.running!==false)throw new AresError(state.running?(state.activeJobs.length?'ARES助手或受管队友有后台任务仍在运行，请结束后保存或新建对话':'ARES助手或受管队友仍在运行，请结束后保存或新建对话'):'尚未确认ARES真实执行状态及后台任务，请重新连接',409);
}
export function configurationOwner(ctx,sessionId,agent){
 const agents=ctx.get?.('agents');
 if(!agent?.id||agents?.get?.(agent.id)!==agent||!agents.list||!agents.isOwnedBy)throw new AresError('配置工具需要当前真实DSH Agent',409);
 const seen=new Set();let current=agent;
 while(current){
  if(seen.has(current))throw new AresError('DSH Agent所有权链异常',409);seen.add(current);
  if(current.id===sessionId)return current;
  const child=current;current=agents.list().find(parent=>agents.isOwnedBy(child.id,parent));
 }
 throw new AresError('此Agent不属于当前ARES配置编辑会话',409);
}
export function humanAuthorization(agent){
 return (agent?.session?.snapshotEvents?.()||[]).filter(event=>event.type==='user/message'&&event.data?.source?.kind==='user').flatMap(event=>(event.data.content||[]).filter(block=>block.type==='text').map(block=>block.text)).join('\n');
}
