import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectNativeSession,nativeSessionAvailable} from '../host/native-session.js';
test('current DSH uses actual registered Agent Session header/events without inspect or fabricated metadata',async()=>{
 const header={id:'actual-session-fixture',cwd:'explicit-software-fixture',agentPreset:'actual-fixed-preset-fixture'},events=[{seq:0,type:'user/message',data:{}}],agent={id:header.id,session:{header,snapshotEvents:()=>events}},agents={get:id=>id===agent.id?agent:null};const ctx={get:name=>name==='agents'?agents:name==='sessionController'?{resolveAgent:async()=>({agent})}:undefined};assert.equal(nativeSessionAvailable(ctx),true);const value=await inspectNativeSession(ctx,agent.id);assert.deepEqual(value.meta,header);assert.strictEqual(value.events,events);assert.equal(value.events.some(row=>row.type==='agent-preset/selected'),false);assert.equal(value.meta.agentPreset,'actual-fixed-preset-fixture');
});
test('current DSH cold recovery checks resolved Agent against registry and never accepts a foreign object',async()=>{
 let registered=null;const agent={id:'owned-cold-fixture',session:{header:{id:'owned-cold-fixture',cwd:'owned',agentPreset:'fixed'},snapshotEvents:()=>[]}},ctx={get:name=>name==='agents'?{get:()=>registered}:name==='sessionController'?{resolveAgent:async()=>{registered=agent;return {agent};}}:undefined};assert.equal((await inspectNativeSession(ctx,agent.id)).meta.id,agent.id);registered={...agent,session:{...agent.session,header:{id:'different'}}};await assert.rejects(inspectNativeSession(ctx,agent.id),/身份/);assert.equal(nativeSessionAvailable({}),false);
});
test('legacy inspect remains an actual service call; no synthetic fallback on an inspect error',async()=>{
 let calls=0;const ctx={get:name=>name==='sessionController'?{inspect:async id=>{calls++;assert.equal(id,'legacy-fixture');throw new Error('actual inspect failure fixture');}}:undefined};await assert.rejects(inspectNativeSession(ctx,'legacy-fixture'),/actual inspect failure/);assert.equal(calls,1);
});
