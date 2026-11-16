/** Metadata bridge only. Native DSH handles all messages, models and tool streaming. */
const pendingCreations=new Map();
function requireToolInspection(value){if(value?.protocolVersion!==5||!value?.toolSurface||typeof value.toolSurface.ready!=='boolean'||typeof value.toolSurface.pending!=='boolean')throw new Error('DSH尚未加载ARES工作台更新，请点“一键重载”。新建对话不会更新插件。');return value;}
export function nativeConversationLayout(session){return {phase:session?.openState==='open'?'active':'settling',hero:false,variant:'embedded'};}
export function createEditorSession({request,createSession,onState=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 let disposed=false,context=null,signature='',synced='',revision=0,connectPromise=null,syncPromise=null,pollTimer=null,syncTimer=null,visible=true,epoch=0;
 let nativeRunning=null,contextProvider=null;
 let state={sessionId:null,connecting:false,connectionRevision:0,error:null,nativeConnection:null,toolError:null,toolSurface:null,proposal:null,running:null,execution:null,hint:null,contextToken:null};
 const listeners=new Set();let hintId=0;
 const notify=()=>{if(!disposed){onState(state);listeners.forEach(fn=>fn(state));}};
 const patch=value=>{state={...state,...value};notify();};
 const accept=next=>{if(next.revision<revision)return;requireToolInspection(next);revision=next.revision;const tools=next.toolSurface,change=next.unchanged?{}:{sessionId:next.sessionId,proposal:next.proposal||null};if(!next.unchanged&&next.sessionId!==state.sessionId)change.nativeConnection=null;Object.assign(change,{toolSurface:tools,toolError:!tools.ready&&!tools.pending?tools.message||'ARES原生工具尚未完整挂载':null,execution:next.execution||null,running:nativeRunning===true?true:next.execution?.running??null,contextToken:next.contextToken??state.contextToken});patch(change);};
 async function refreshState(){const at=epoch;try{const next=await request('assistant/state?afterRevision='+revision);if(at===epoch&&!disposed)accept(next);}catch(error){if(at===epoch)patch({error:error.message});}}
 function schedulePoll(){clearTimer(pollTimer);if(!disposed&&visible&&state.sessionId)pollTimer=setTimer(async()=>{await refreshState();schedulePoll();},1500);}
 async function synchronize(){if(disposed||!context||!state.sessionId||synced===signature)return;if(syncPromise)return syncPromise;syncPromise=(async()=>{let attempts=0;while(!disposed&&synced!==signature&&attempts++<3){const body=JSON.parse(JSON.stringify(context)),at=signature;try{const next=await request('assistant/context',{...body,expectedRevision:revision});accept(next);synced=at;patch({error:null});}catch(error){if(error.status!==409)throw error;accept(await request('assistant/state'));}}})().catch(error=>patch({error:error.message})).finally(()=>{syncPromise=null;});return syncPromise;}
 async function connect({fresh=false}={}){
  if(disposed||!context)return;if(connectPromise)return connectPromise;
  const atEpoch=++epoch;patch({connecting:true,error:null});
  connectPromise=(async()=>{const body=JSON.parse(JSON.stringify(context)),at=signature;let next=requireToolInspection(await request(fresh?'assistant/new':'assistant/session',body));revision=next.revision;
   if(next.needsSession){let creation=pendingCreations.get(next.bindingToken);if(!creation){creation=Promise.resolve(createSession({cwd:next.cwd,agentPreset:next.presetId})).then(result=>{const id=typeof result==='string'?result:result?.sessionId??result?.id;if(typeof id!=='string'||!id)throw new Error('DSH未返回有效原生会话ID');return id;});pendingCreations.set(next.bindingToken,creation);}let id;try{id=await creation;}catch(error){pendingCreations.delete(next.bindingToken);throw error;}next=await request('assistant/bind',{bindingToken:next.bindingToken,sessionId:id});pendingCreations.delete(next.bindingToken);}
   if(disposed||atEpoch!==epoch)return;accept(next);synced=at;patch({connecting:false,error:null,connectionRevision:state.connectionRevision+1});await synchronize();schedulePoll();
  })().catch(error=>patch({connecting:false,error:error.message})).finally(()=>{connectPromise=null;});
  return connectPromise;
 }
 function updateContext(value){const next=JSON.stringify(value);if(next===signature)return;context=JSON.parse(next);signature=next;clearTimer(syncTimer);if(!state.sessionId){connect();return;}syncTimer=setTimer(()=>synchronize(),250);}
 function prepareMessageContext(){
  if(contextProvider){const latest=contextProvider();if(!latest)throw new Error('正在切换或读取比赛流程，请待当前编排对象就绪后发送');updateContext(latest);}
  if(disposed||!context||!state.sessionId||state.connecting)throw new Error('流程助手尚未连接，未发送到旧编排对象');
  const captured={sessionId:state.sessionId,signature,epoch};
  const matchesProvider=()=>!contextProvider||JSON.stringify(contextProvider())===captured.signature;
  return {sessionId:captured.sessionId,async beforeSend(){
   if(disposed||!matchesProvider()||state.sessionId!==captured.sessionId||signature!==captured.signature||epoch!==captured.epoch)throw new Error('发送期间编排对象已切换，请核对当前流程后重发');
   await synchronize();
   if(disposed||!matchesProvider()||state.sessionId!==captured.sessionId||signature!==captured.signature||synced!==captured.signature||epoch!==captured.epoch)throw new Error(state.error||'编排上下文尚未同步，草稿保留，请重试');
  }};
 }
 return {
  kind:'editor',prepareMessageContext,setContextProvider(fn){contextProvider=typeof fn==='function'?fn:null;},
  updateContext,getState:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  setNativeConnection(sessionId,phase,error=null){
   if(disposed||sessionId!==state.sessionId||!['connecting','connected','error'].includes(phase))return;
   const detail=phase==='error'?String(error||'原生会话连接失败'):null;
   if(state.nativeConnection?.phase===phase&&state.nativeConnection?.error===detail)return;
   patch({nativeConnection:{phase,error:detail}});
  },
  reconnect:()=>connect(),
  async newConversation(){if(state.running!==false||state.connecting)throw new Error('请等待DSH当前回复结束再新建对话');await syncPromise;clearTimer(pollTimer);epoch++;patch({sessionId:null,nativeConnection:null,proposal:null,hint:null,toolSurface:null,toolError:null});synced='';return connect({fresh:true});},
  setVisible(value){if(visible===value)return;visible=value;if(visible){if(state.sessionId)refreshState();schedulePoll();}else clearTimer(pollTimer);},
  setRunning(value){if(typeof value==='boolean'&&nativeRunning!==value){nativeRunning=value;patch({running:value?true:state.execution?.running??null});if(!value&&state.sessionId)refreshState();}},
  hint(text){patch({hint:{id:++hintId,text}});},consumeHint(id){if(state.hint?.id===id)patch({hint:null});},
  async review(configuration){if(state.running!==false||!state.proposal)throw new Error('请等待DSH回复结束并读取提案');const session=state.sessionId,proposal=state.proposal.id,result=await request('assistant/review',{configuration,proposalId:proposal,expectedRevision:revision,contextToken:state.contextToken});if(state.running!==false||state.sessionId!==session||state.proposal?.id!==proposal)throw new Error('原生会话或提案已变化，请重新查看差异');return result;},
  async saveProposal(configuration){if(state.running!==false||!state.proposal)throw new Error('请等待ARES助手及队友结束并读取提案');const next=await request('assistant/save',{configuration,proposalId:state.proposal.id,configurationHash:state.proposal.configurationHash,expectedRevision:revision,expectedConfigurationRevision:configuration.revision,contextToken:state.contextToken});accept(next);return next;},
  async dismiss(){if(!state.proposal)return;accept(await request('assistant/dismiss',{proposalId:state.proposal.id,expectedRevision:revision}));},
  dispose(){disposed=true;contextProvider=null;clearTimer(syncTimer);clearTimer(pollTimer);listeners.clear();},
 };
}
