/** Actual installed vendor methods with explicit decision/transport carriers.
 * These protocol checks are not live Auto/model/human-approval acceptance. */
import {test} from 'node:test';import assert from 'node:assert/strict';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
assert.ok(process.env.ARES_DSH_NODE_MODULES,'Explicit installed DSH module root required');
const root=resolve(process.env.ARES_DSH_NODE_MODULES),load=relative=>import(pathToFileURL(join(root,relative)).href);
const {ApprovalService}=await load('@deepseek-ai/dsh-user-approval/lib/index.js');
const {ToolExecutionPipeline}=await load('@deepseek-ai/dsh-tools/lib/pipeline.js');
const decide=ApprovalService.prototype.decide,ask=ToolExecutionPipeline.prototype.serviceAsk;
const agent={id:'explicit-native-contract-fixture',session:{}};
test('restored native never and pre-abort reject without invoking answerers',async()=>{
 const ctx={effectivePolicy:()=> 'never',ctx:{waterfall(){assert.fail('Never must reject before interactive dispatch');}}};
 assert.equal(await decide.call(ctx,{agent},agent.session),'rejected');const abort=new AbortController();abort.abort();assert.equal(await decide.call(ctx,{agent,signal:abort.signal},agent.session),'cancelled');
});
test('restored native ask normalizes allow, rejection, missing/throwing and invalid answerers',async()=>{
 for(const [value,expected] of [['allowed-once','allowed-once'],['rejected','rejected'],['cancelled','cancelled'],['unavailable','unavailable'],['invalid-result','unavailable']]){
  let calls=0;const carrier={effectivePolicy:()=> 'ask',ctx:{waterfall(_scope,event,request){calls++;assert.equal(event,'approval/request');assert.equal(request.agent,agent);return Promise.resolve(value);}}};assert.equal(await decide.call(carrier,{agent},agent.session),expected);assert.equal(calls,1);
 }
 assert.equal(await decide.call({effectivePolicy:()=> 'ask',ctx:{waterfall(){throw Error('explicit transport fixture failure');}}},{agent},agent.session),'unavailable');
});
test('restored native ask cancellation wins over a delayed answer',async()=>{
 const abort=new AbortController();let finish;const carrier={effectivePolicy:()=> 'ask',ctx:{waterfall(){return new Promise(resolve=>{finish=resolve;});}}};const request=decide.call(carrier,{agent,signal:abort.signal},agent.session);await Promise.resolve();abort.abort();assert.equal(await request,'cancelled');finish('allowed-once');
});
test('restored tool ask seam fails closed without a service or Agent',async()=>{
 const request={name:'explicit-fixture',agent,callId:'fixture-call',signal:new AbortController().signal};
 assert.equal((await ask.call({ctx:{get:()=>undefined}},request,{kind:'ask',reason:'fixture need approval'})).decision.kind,'deny');
 assert.equal((await ask.call({ctx:{get:()=>({request(){assert.fail('Missing agent cannot ask');}})}},{...request,agent:undefined},{kind:'ask'})).decision.kind,'deny');
});
test('restored tool ask seam only allows allowed-once and propagates the exact cancellation state',async()=>{
 for(const outcome of ['allowed-once','rejected','cancelled','unavailable']){
  const controller=new AbortController(),exec={agent,name:'explicit-fixture',callId:'fixture-call',signal:controller.signal},approval={async request(request){assert.equal(request.agent,agent);assert.equal(request.callId,exec.callId);assert.equal(request.signal,controller.signal);return outcome;}};
  const result=await ask.call({ctx:{get:()=>approval}},exec,{kind:'ask',reason:'fixture review'});assert.equal(result.decision.kind,outcome==='allowed-once'?'allow':'deny');assert.equal(result.approvalCancelled,outcome==='cancelled');
 }
});
