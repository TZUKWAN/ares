import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestExtensionJson} from '../host/extension-network.js';
// Failure injection only: no fabricated DNS/network success response.
const config={url:'https://explicit-resolver-fixture.invalid/results',method:'GET'};
test('an unresolved DNS operation cannot outlive the complete request deadline',async()=>{
 let lookups=0,dispatched=false;const started=performance.now();
 await assert.rejects(requestExtensionJson(config,{}, {deadlineMs:40,resolveHost:()=>{lookups++;return new Promise(()=>{});},onDispatch:()=>dispatched=true}),error=>error.status===504);
 assert.equal(lookups,1);assert.equal(dispatched,false);assert.ok(performance.now()-started<1500);
});
test('closing before or during DNS prevents dispatch and promptly returns cancellation',async()=>{
 for(const alreadyClosed of [true,false]){const controller=new AbortController();let lookups=0,dispatched=false;const started=performance.now();if(alreadyClosed)controller.abort();else setTimeout(()=>controller.abort(),10);
  await assert.rejects(requestExtensionJson(config,{}, {signal:controller.signal,resolveHost:()=>{lookups++;return new Promise(()=>{});},onDispatch:()=>dispatched=true}),error=>/已取消/.test(error.message));
  assert.equal(lookups,alreadyClosed?0:1);assert.equal(dispatched,false);assert.ok(performance.now()-started<1500);
 }
});
