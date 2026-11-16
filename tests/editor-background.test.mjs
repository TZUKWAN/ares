import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executionState,assertIdle} from '../host/agent-state.js';
const root={id:'editor-fixture',status:'idle'},child={id:'child-fixture',status:'idle',parent:'editor-fixture'};
function context(jobs){return {get:key=>key==='agents'?{get:id=>[root,child].find(a=>a.id===id),list:()=>[root,child],isOwnedBy:(id,parent)=>id===child.id&&parent.id===root.id}:key==='jobs'?jobs:undefined};}
test('an idle model with a running owned background job is never considered idle for configuration changes',()=>{const ctx=context({list:owner=>owner===root.id?[{id:'owned-job',owner:root.id,status:'running'}]:[]});assert.equal(executionState(ctx,root.id).running,true);assert.throws(()=>assertIdle(ctx,root.id),/后台|运行/);});
test('owned child jobs also block while unrelated and unowned jobs do not freeze the editor',()=>{let rows=[{id:'child-job',owner:child.id,status:'stopping'}];const ctx=context({list:()=>rows});assert.equal(executionState(ctx,root.id).running,true);rows=[{id:'other-job',owner:'unrelated',status:'running'},{id:'unowned-job',status:'running'}];assert.equal(executionState(ctx,root.id).running,false);});
test('unavailable or malformed job metadata cannot prove a bound editor is safe to mutate',()=>{for(const registry of [undefined,{list:()=>{throw new Error('explicit service failure');}},{list:()=>({not:'an array'})}]){const ctx=context(registry);assert.equal(executionState(ctx,root.id).running,null);assert.throws(()=>assertIdle(ctx,root.id),/尚未确认|后台/);}});
