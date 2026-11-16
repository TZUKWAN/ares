/** Native-service fixtures test metadata wiring; they do not emulate model replies. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAssistant} from '../host/assistant.js';
import {readConfiguration,saveConfiguration} from '../host/catalog.js';
import {EDITOR_PRESET_ID} from '../host/editor-runtime.js';
import {createEditorSession,nativeConversationLayout} from '../client/editor-session.js';

const nextTick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){for(let i=0;i<30&&!fn();i++)await nextTick();assert.ok(fn(),'metadata did not settle');}
function setup(){
 process.env.ARES_HOME=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-editor-client-'));
 const nativeSessions=new Map(),nativeAgents=new Map(),calls=[],timers=new Map();let timerId=0,creates=0,stateGate=null;
 const server=createAssistant({get:key=>key==='jobs'?{list:()=>[]}:key==='sessionController'?{async inspect(id){assert.ok(nativeSessions.has(id));return nativeSessions.get(id);},async resolveAgent(id){return {agent:nativeAgents.get(id)};}}:key==='agents'?{get:id=>nativeAgents.get(id),list:()=>[...nativeAgents.values()],isOwnedBy:(id,parent)=>nativeAgents.get(id)?.parent===parent.id}:undefined},{forEditor:async()=>EDITOR_PRESET_ID,commitConfiguration:async(raw,revision,{beforeCommit}={})=>{beforeCommit?.();return {configuration:saveConfiguration(raw,revision),warning:null};}});
 const request=async(path,body)=>{calls.push({path,body});try{if(path==='assistant/session')return server.open(body);if(path==='assistant/new')return server.newConversation(body);if(path==='assistant/bind')return server.bind(body);if(path==='assistant/context')return server.sync(body);if(path==='assistant/review')return server.review(body);if(path==='assistant/save')return server.saveProposal(body);if(path==='assistant/dismiss')return server.dismiss(body);if(path.startsWith('assistant/state')){if(stateGate){const gate=stateGate;stateGate=null;return gate;}const q=new URL(path,'http://test.invalid').searchParams;return server.state(q.has('afterRevision')?Number(q.get('afterRevision')):undefined);}throw new Error('Unexpected editor endpoint: '+path);}catch(e){throw e;}};
 const client=createEditorSession({request,async createSession(options){assert.equal('workspaceId' in options,false);const id='test-native-'+(++creates),meta={id,cwd:options.cwd,agentPreset:options.agentPreset};nativeSessions.set(id,{meta,events:[]});nativeAgents.set(id,{id,status:'idle',session:{header:meta}});return {sessionId:id};},setTimer:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)});
 const configuration=readConfiguration(),context={configuration,workflowId:'venture',activeStepId:'context'};
 return {client,server,calls,context,nativeSessions,agent:id=>nativeAgents.get(id),get creates(){return creates;},deferNextState(){const previous=server.state();let release;stateGate=new Promise(resolve=>release=()=>resolve(previous));return release;},async flushContext(){const pending=[...timers].find(([,value])=>value.ms===250);if(pending){timers.delete(pending[0]);await pending[1].fn();}await nextTick();},dispose(){client.dispose();server.dispose();}};
}
test('blank bound DSH editor uses active embedded conversation instead of hero/workspace selection',()=>{assert.deepEqual(nativeConversationLayout({openState:'open',blank:true}),{phase:'active',hero:false,variant:'embedded'});assert.equal(nativeConversationLayout(undefined).hero,false);});
test('automatic connection uses fixed cwd/preset and backend token, no browser workspace identifier',async()=>{const f=setup();f.client.updateContext(f.context);await f.client.reconnect();assert.equal(f.creates,1);assert.equal(f.client.getState().sessionId,'test-native-1');assert.ok(f.calls.some(c=>c.path==='assistant/bind'));assert.equal(f.calls.some(c=>'workspaceId' in (c.body||{})),false);f.dispose();});
test('changing selected ARES flow keeps the same native conversation and synchronizes context',async()=>{const f=setup();f.client.updateContext(f.context);await f.client.reconnect();f.client.updateContext({...f.context,workflowId:'modeling',activeStepId:'problem'});await f.flushContext();assert.equal(f.creates,1);assert.equal(f.client.getState().sessionId,'test-native-1');const record=await f.server.read(f.agent('test-native-1'),{kind:'context'});assert.equal(record.workflowId,'modeling');f.dispose();});
test('shortcuts only fill native draft hints and do not send provider or chat requests',async()=>{const f=setup();f.client.updateContext(f.context);await f.client.reconnect();const count=f.calls.length;f.client.hint('请编辑ARES当前步骤');assert.equal(f.client.getState().hint.text,'请编辑ARES当前步骤');assert.equal(f.calls.length,count);assert.equal(f.calls.some(c=>/models|chat|llm/.test(c.path)),false);f.dispose();});
test('native configuration tool proposals reach editor review without automatic save or message loop',async()=>{const f=setup();f.client.updateContext(f.context);await f.client.reconnect();const read=await f.server.read(f.agent('test-native-1'),{kind:'context'});await f.server.propose(f.agent('test-native-1'),{expectedRevision:read.revision,edits:[{type:'update_step',stepId:'context',changes:{title:'TEST FIXTURE proposed step'}}]});f.client.setVisible(false);f.client.setVisible(true);await until(()=>!!f.client.getState().proposal);const reviewed=await f.client.review(f.context.configuration);assert.equal(reviewed.configuration.workflows[0].steps[0].title,'TEST FIXTURE proposed step');assert.equal(readConfiguration().workflows[0].steps[0].title,f.context.configuration.workflows[0].steps[0].title);f.dispose();});
test('explicit new conversation creates a new native session; reconnect never duplicates one',async()=>{const f=setup();f.client.updateContext(f.context);await f.client.reconnect();const firstConnection=f.client.getState().connectionRevision;await f.client.reconnect();assert.equal(f.client.getState().connectionRevision,firstConnection+1);assert.equal(f.creates,1);await f.client.newConversation();assert.equal(f.creates,2);assert.equal(f.client.getState().sessionId,'test-native-2');f.dispose();});

test('editor connection status follows only the current native lease and resets for a new conversation',async()=>{
 const f=setup();try{f.client.updateContext(f.context);await f.client.reconnect();const id=f.client.getState().sessionId;assert.equal(f.client.getState().nativeConnection,null);
  f.client.setNativeConnection(id,'error','Explicit lease failure');f.client.setNativeConnection('foreign-session','connected');assert.equal(f.client.getState().nativeConnection.phase,'error');
  f.client.setNativeConnection(id,'connected');const state=f.client.getState().nativeConnection;f.client.setNativeConnection(id,'connected');assert.equal(f.client.getState().nativeConnection,state);await f.client.reconnect();assert.equal(f.client.getState().nativeConnection,state);assert.equal(f.creates,1);
  await f.client.newConversation();assert.equal(f.client.getState().nativeConnection,null);f.client.setNativeConnection(id,'error','Late old lease');assert.equal(f.client.getState().nativeConnection,null);
 }finally{f.dispose();}
});
test('late status response from an old conversation cannot replace the new native session',async()=>{const f=setup();f.client.updateContext(f.context);await f.client.reconnect();const release=f.deferNextState();f.client.setVisible(false);f.client.setVisible(true);await f.client.newConversation();release();await nextTick();await nextTick();assert.equal(f.client.getState().sessionId,'test-native-2');f.dispose();});

test('an older backend without actual tool inspection cannot create a misleading ready conversation',async()=>{let creates=0;const client=createEditorSession({request:async()=>({revision:1,needsSession:true,cwd:'LEGACY-FIXTURE',presetId:EDITOR_PRESET_ID}),createSession:async()=>{creates++;return 'should-not-be-created';}});client.updateContext({configuration:{}});await client.reconnect();assert.equal(creates,0);assert.match(client.getState().error,/一键重载/);assert.equal(client.getState().sessionId,null);client.dispose();});

test('tool failures and recovery propagate even when the configuration revision has not changed',async()=>{
 let status={ready:false,pending:true,visibleCount:null,missing:[]};
 const timers=new Map();let seq=0;
 const client=createEditorSession({request:async path=>path==='assistant/session'?{protocolVersion:5,revision:1,sessionId:'native-tool-status-fixture',needsSession:false,toolSurface:status}:{protocolVersion:5,revision:1,sessionId:'native-tool-status-fixture',unchanged:true,toolSurface:status},createSession:async()=>{assert.fail('Must retain the existing session');},setTimer:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)});
 client.updateContext({configuration:{}});await client.reconnect();assert.equal(client.getState().toolError,null);
 status={ready:false,pending:false,visibleCount:0,missing:['read'],message:'TEST FIXTURE missing native read'};
 client.setVisible(false);client.setVisible(true);await until(()=>!!client.getState().toolError);assert.equal(client.getState().toolError,status.message);assert.equal(client.getState().sessionId,'native-tool-status-fixture');
 status={ready:true,pending:false,visibleCount:25,missing:[],message:null};
 client.setVisible(false);client.setVisible(true);await until(()=>client.getState().toolSurface.ready);assert.equal(client.getState().toolError,null);client.dispose();
});

test('one explicit client save persists the actual reviewed proposal without a preliminary apply request',async()=>{
 const f=setup();try{f.client.updateContext(f.context);await f.client.reconnect();const actor=f.agent('test-native-1'),read=await f.server.read(actor,{kind:'context'});await f.server.propose(actor,{expectedRevision:read.revision,edits:[{type:'update_workflow',workflowId:'venture',title:'TEST FIXTURE explicit one-step save'}]});f.client.setVisible(false);f.client.setVisible(true);await until(()=>!!f.client.getState().proposal);const saved=await f.client.saveProposal(f.context.configuration);assert.equal(saved.savedConfiguration.revision,1);assert.equal(readConfiguration().workflows[0].title,'TEST FIXTURE explicit one-step save');assert.equal(f.client.getState().proposal,null);assert.equal(f.calls.filter(item=>item.path==='assistant/save').length,1);assert.equal(f.calls.some(item=>item.path==='assistant/review'),false);}finally{f.dispose();}
});


test('native Send synchronizes the exact unsaved editor object before native forwarding',async()=>{
 const f=setup();try{f.client.updateContext(f.context);await f.client.reconnect();const configuration=structuredClone(f.context.configuration),flow=configuration.workflows.find(row=>row.id==='venture');flow.steps[0].objective='真实未保存的流程发送上下文';f.client.updateContext({...f.context,configuration});const captured=f.client.prepareMessageContext();await captured.beforeSend();const context=await f.server.read(f.agent('test-native-1'),{kind:'context'}),actual=await f.server.read(f.agent('test-native-1'),{kind:'step'});assert.equal(context.workflowId,'venture');assert.equal(actual.step.objective,'真实未保存的流程发送上下文');assert.equal(readConfiguration().workflows.find(row=>row.id==='venture').steps[0].objective===actual.step.objective,false);}finally{f.dispose();}
});
test('a captured editor send rejects a later workflow switch instead of borrowing its context',async()=>{
 const f=setup();try{f.client.updateContext(f.context);await f.client.reconnect();const captured=f.client.prepareMessageContext();f.client.updateContext({...f.context,workflowId:'modeling',activeStepId:'problem'});await assert.rejects(captured.beforeSend,/已切换/);await f.flushContext();const current=f.client.prepareMessageContext();await current.beforeSend();assert.equal((await f.server.read(f.agent('test-native-1'),{kind:'context'})).workflowId,'modeling');}finally{f.dispose();}
});

test('live composing provider prevents sends during scope loading and catches changes before a render',async()=>{
 const f=setup();try{f.client.updateContext(f.context);await f.client.reconnect();let current=null;f.client.setContextProvider(()=>current);assert.throws(()=>f.client.prepareMessageContext(),/正在切换|读取/);current={...f.context,workflowId:'modeling',activeStepId:'problem'};const captured=f.client.prepareMessageContext();current=null;await assert.rejects(captured.beforeSend,/已切换/);current={...f.context,workflowId:'modeling',activeStepId:'problem'};await f.client.prepareMessageContext().beforeSend();assert.equal((await f.server.read(f.agent('test-native-1'),{kind:'context'})).workflowId,'modeling');}finally{f.dispose();}
});
