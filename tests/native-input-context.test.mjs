/** Actual adapter + actual project-message persistence, with explicit native
 * transport boundary fixtures. No model output or business completion is faked. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {attachNativeInputContext} from '../client/native-input-context.js';
import {bindProjectMessageContext,readProjectMessageContext} from '../host/project-chat-context.js';
import {initializeProject,linkRoot,changeProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';

function nativeBoundary({legacy=false,sessionId='session-boundary'}={}){
 const calls={original:[],sends:[],submissions:[],prompts:[],abandoned:0,scopeCleanup:null};
 const nativeOutcome=Object.freeze({transportBoundaryToken:Symbol('native-result')});
 const originalSink=function(...args){calls.original.push({self:this,args});return Promise.resolve(nativeOutcome);};
 const core=legacy?{mintAttempt(...args){return {attempt:{signal:args[0]||new AbortController().signal},legacy:true};}}:
  {beginAttempt(...args){return {signal:args[0]||new AbortController().signal,rawArgs:args};}};
 const shell={core,deps:{defaultSink:originalSink}},requestId=randomUUID();
 const binding={sessionId,ctx:{effect(fn){calls.scopeCleanup=fn();}},session:{
  beginSubmission(input){calls.submissions.push(input);return {requestId,abandon(){calls.abandoned++;}};},
  prompt(...args){calls.prompts.push(args);return Promise.resolve(nativeOutcome);}
 }};
 const conversation={input:{for(ctx){assert.equal(ctx,binding.ctx);return shell;}},
  async sendSession(session,text,attachmentIds,mode,signal,accept){
   calls.sends.push({session,text,attachmentIds,mode,signal,accept});
   const submission=session.beginSubmission({mode,text,attachments:attachmentIds});
   // Only the native transport fixture serializes these boundary receipt values.
   const content=[...attachmentIds.map(id=>({type:'file',receiptId:'boundary-receipt:'+id})),{type:'text',text}];
   calls.serialized=content;
   return session.prompt(content,mode,signal,submission.requestId);
  }};
 const method=legacy?'mintAttempt':'beginAttempt';
 return {calls,nativeOutcome,conversation,binding,shell,requestId,method,original:core[method],originalSink,
  gesture(signal){const value=core[method](signal);return value.attempt||value;}};
}
function actualProject(){
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-input-context-'));
 process.env.ARES_HOME=join(base,'home');const root=join(base,'project');mkdirSync(root);linkRoot(root);
 let p=initializeProject({root,name:'输入上下文协议验证 · 非在线模型',competitionId:5,
  track:competitionCatalog().find(row=>row.id===5).tracks[0].track,workflowId:'modeling'});
 const native=nativeBoundary(),presetId='native-boundary-preset';
 p=changeProject({root,expectedRevision:p.revision},value=>value.workbench.nodeSession={sessionId:native.binding.sessionId,presetId,definitionId:p.definitionId});
 const agent={id:native.binding.sessionId,session:{header:{id:native.binding.sessionId,cwd:root,agentPreset:presetId},snapshotEvents:()=>[]}};
 const ctx={get:name=>name==='agents'?{get:id=>id===agent.id?agent:null}:name==='sessionController'?{inspect:()=>({meta:{...agent.session.header},events:[]})}:null};
 let view={stepId:'context',artifactId:'inventory'};
 const manager={kind:'project',getMessageContext:()=>({root,projectId:p.id,definitionId:p.definitionId,sessionId:agent.id,view})};
 return {p,root,native,ctx,agent,manager,setView(value){view=value;}};
}
const projectManager=sessionId=>({kind:'project',getMessageContext:()=>({root:'boundary-root',projectId:'boundary-project',definitionId:'boundary-definition',sessionId,view:{stepId:'boundary-step'}})});
const responseFor=value=>({context:{...value},applied:false});
const deferred=()=>{let resolve;const promise=new Promise(fn=>resolve=fn);return {promise,resolve};};

test('real host persistence binds the gesture selection before delayed native expansion, preserving all native transport arguments',async()=>{
 const f=actualProject(),n=f.native,posts=[],before=readFileSync(join(f.root,'.ares/project.json'));
 const detach=attachNativeInputContext(n.conversation,n.binding,f.manager,{request:async(path,value,options)=>{
  assert.equal(path,'project/assistant/message-context');posts.push({value,options});return bindProjectMessageContext(value,f.ctx);
 }});
 try{
  const signal=new AbortController().signal,attempt=n.gesture(signal),accept=()=>{},ids=['native-attachment-1','native-attachment-2'];
  f.setView({stepId:'rules',artifactId:'requirements'});
  const outcome=await n.shell.deps.defaultSink('原生引用展开后的原文',ids,'followup',attempt.signal,accept);
  assert.equal(outcome,n.nativeOutcome);assert.equal(posts.length,1);assert.equal(posts[0].value.view.stepId,'context');
  assert.equal(posts[0].options.signal,signal);assert.equal(n.calls.sends[0].attachmentIds,ids);assert.equal(n.calls.sends[0].accept,accept);
  assert.equal(n.calls.sends[0].mode,'followup');assert.equal(n.calls.sends[0].signal,signal);
  assert.equal(n.calls.prompts[0][0],n.calls.serialized);assert.equal(n.calls.prompts[0][1],'followup');assert.equal(n.calls.prompts[0][2],signal);assert.equal(n.calls.prompts[0][3],n.requestId);
  const stored=readProjectMessageContext(f.p,f.agent,{source:{kind:'user',rpcId:n.requestId}},f.p.definitionId);
  assert.equal(stored.view.stepId,'context');assert.equal(stored.view.artifactId,'inventory');
  assert.equal(n.calls.abandoned,0);assert.deepEqual(readFileSync(join(f.root,'.ares/project.json')),before);
 }finally{detach();}
 assert.equal(n.shell.core[n.method],n.original);assert.equal(n.shell.deps.defaultSink,n.originalSink);
});

test('failed or mismatched binding abandons the native submission without sending or consuming the original input',async()=>{
 for(const request of [async()=>{throw new Error('context service rejected identity');},async()=>({context:{sessionId:'another'}})]){
  const n=nativeBoundary(),manager=projectManager(n.binding.sessionId),detach=attachNativeInputContext(n.conversation,n.binding,manager,{request});
  try{
   const attempt=n.gesture(),ids=['kept-attachment'];
   await assert.rejects(n.shell.deps.defaultSink('保留的原始草稿',ids,'followup',attempt.signal,()=>assert.fail('not accepted')),/identity|未获项目服务确认/);
   assert.equal(n.calls.abandoned,1);assert.equal(n.calls.prompts.length,0);assert.equal(n.calls.submissions[0].text,'保留的原始草稿');assert.equal(n.calls.sends[0].attachmentIds,ids);
  }finally{detach();}
 }
});

test('editor capture uses the exact synchronous snapshot and waits before native prompt, including legacy mintAttempt',async()=>{
 const n=nativeBoundary({legacy:true}),gate=deferred(),order=[];let target='first';
 const manager={kind:'editor',prepareMessageContext(){const captured=target;return {sessionId:n.binding.sessionId,async beforeSend(){order.push('flush:'+captured);await gate.promise;if(target!==captured)throw new Error('editor selection changed');}};}};
 const detach=attachNativeInputContext(n.conversation,n.binding,manager,{request:()=>assert.fail('editor must not use project endpoint')});
 try{
  const attempt=n.gesture(),pending=n.shell.deps.defaultSink('编辑原草稿',[],'followup',attempt.signal,()=>{});
  await Promise.resolve();assert.deepEqual(order,['flush:first']);assert.equal(n.calls.prompts.length,0);
  gate.resolve();assert.equal(await pending,n.nativeOutcome);assert.equal(n.calls.prompts.length,1);assert.equal(n.calls.abandoned,0);
 }finally{detach();}
 assert.equal(n.shell.core.mintAttempt,n.original);
});

test('editor object switches during preparation are rejected rather than silently sent against the later object',async()=>{
 const n=nativeBoundary(),gate=deferred();let object='first';
 const manager={kind:'editor',prepareMessageContext(){const captured=object;return {sessionId:n.binding.sessionId,async beforeSend(){await gate.promise;if(captured!==object)throw new Error('editor object switched');}};}};
 const detach=attachNativeInputContext(n.conversation,n.binding,manager,{});
 try{
  const attempt=n.gesture(),pending=n.shell.deps.defaultSink('改这里',[],'followup',attempt.signal,()=>{});
  object='second';gate.resolve();await assert.rejects(pending,/object switched/);assert.equal(n.calls.prompts.length,0);assert.equal(n.calls.abandoned,1);
 }finally{detach();}
});

test('unmount after gesture keeps the frozen target until expansion settles; cleanup never restores over another owner',async()=>{
 const n=nativeBoundary(),manager=projectManager(n.binding.sessionId),posts=[];
 const detach=attachNativeInputContext(n.conversation,n.binding,manager,{request:async(_path,value)=>{posts.push(value);return responseFor(value);}});
 const attempt=n.gesture();detach();assert.notEqual(n.shell.deps.defaultSink,n.originalSink);
 await n.shell.deps.defaultSink('异步展开完成',[],'followup',attempt.signal,()=>{});
 assert.equal(posts[0].view.stepId,'boundary-step');assert.equal(n.shell.core[n.method],n.original);assert.equal(n.shell.deps.defaultSink,n.originalSink);
 const second=attachNativeInputContext(n.conversation,n.binding,manager,{request:async(_path,value)=>responseFor(value)});
 const thirdMint=()=>{},thirdSink=()=>{};n.shell.core[n.method]=thirdMint;n.shell.deps.defaultSink=thirdSink;second();
 assert.equal(n.shell.core[n.method],thirdMint);assert.equal(n.shell.deps.defaultSink,thirdSink);
});

test('outside ARES gestures retain the original sink; attachment-only sends capture locally while unbound normal sends fail closed',async()=>{
 const n=nativeBoundary(),manager=projectManager(n.binding.sessionId);let active=false,posts=0;
 const detach=attachNativeInputContext(n.conversation,n.binding,manager,{isActive:()=>active,request:async(_path,value)=>{posts++;return responseFor(value);}});
 try{
  const attempt=n.gesture();active=true;
  await n.shell.deps.defaultSink('其他原生界面的输入',[],'followup',attempt.signal,()=>{});
  assert.equal(n.calls.original.length,1);assert.equal(n.calls.sends.length,0);assert.equal(posts,0);
  await assert.rejects(n.shell.deps.defaultSink('未经过发送手势',[],'followup',new AbortController().signal,()=>{}),/未记录发送时/);
  await n.shell.deps.defaultSink('',['attachment-only'], 'followup',new AbortController().signal,()=>{});
  assert.equal(posts,1);assert.equal(n.calls.prompts.length,1);
 }finally{detach();}
});

test('cross-session snapshots and unsupported ABI never forward a project message; cancellation preserves native ownership',async()=>{
 const n=nativeBoundary(),wrong=projectManager('other-session');
 const detach=attachNativeInputContext(n.conversation,n.binding,wrong,{request:()=>assert.fail('wrong-session request')});
 try{const attempt=n.gesture();await assert.rejects(n.shell.deps.defaultSink('原输入',[],'followup',attempt.signal,()=>{}),/会话不同/);assert.equal(n.calls.sends.length,0);}finally{detach();}
 assert.throws(()=>attachNativeInputContext({input:{for:()=>({core:{},deps:{}})},sendSession(){}},n.binding,projectManager(n.binding.sessionId),{request(){}}),/不支持/);
 const active=nativeBoundary(),gate=deferred(),controller=new AbortController();
 const release=attachNativeInputContext(active.conversation,active.binding,projectManager(active.binding.sessionId),{request:async(_path,value)=>{await gate.promise;return responseFor(value);}});
 try{const attempt=active.gesture(controller.signal),pending=active.shell.deps.defaultSink('取消的输入',[],'followup',attempt.signal,()=>{});controller.abort();gate.resolve();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(active.calls.prompts.length,0);assert.equal(active.calls.abandoned,1);}finally{release();}
});
