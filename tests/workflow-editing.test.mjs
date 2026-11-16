import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,validateConfiguration,previewStep,ROOT} from '../host/catalog.js';
import {applyEdits} from '../host/editor-operations.js';
import {createEditorWorkspace} from '../host/editor-workspace.js';
import {EDITOR_PRESET_ID} from '../host/editor-definition.js';

test('flow-level instructions/parameters compile with step overrides and invalid types fail',()=>{
 const base=defaults(),next=applyEdits(base,'modeling',[{type:'update_workflow',prompts:{system:'TEST FIXTURE entire flow controller'},parameters:{language:'en',seed:17}}]);
 const flow=next.workflows.find(item=>item.id==='modeling'),step=flow.steps[0];step.parameters={language:'zh-CN'};const prompt=previewStep(flow,step,{id:'test-version'});
 assert.match(prompt,/entire flow controller/);assert.match(prompt,/"seed":17/);assert.match(prompt,/"language":"zh-CN"/);assert.ok(prompt.includes(ROOT));assert.equal(prompt.includes('${ROOT}'),false);assert.notEqual(base.workflows.find(item=>item.id==='modeling').prompts.system,flow.prompts.system);
 for(const mutate of [configuration=>configuration.workflows[0].parameters=[],configuration=>configuration.workflows[0].prompts='invalid']){const bad=defaults();mutate(bad);assert.throws(()=>validateConfiguration(bad),/JSON对象/);}
});
test('all flows can be archived, independently recreated from real templates and restored without changing originals',()=>{
 const initial=defaults();initial.workflows[0].title='TEST FIXTURE customized archived original';let empty=applyEdits(initial,null,initial.workflows.map(flow=>({type:'remove_workflow',workflowId:flow.id})));
 assert.equal(empty.workflows.length,0);assert.equal(Object.keys(empty.workflowArchives).length,12);validateConfiguration(empty);
 const basic=applyEdits(empty,null,[{type:'create_workflow',id:'basic-flow',title:'TEST FIXTURE basic flow',pipeline:'L3'}]);assert.equal(basic.workflows[0].steps.length,1);assert.equal(basic.workflows[0].verification,'configuration-only');
 const fromTemplate=applyEdits(empty,null,[{type:'create_workflow',id:'software-copy',title:'TEST FIXTURE software template',templateId:'software'}]);assert.equal(fromTemplate.workflows[0].steps.length,initial.workflows.find(item=>item.id==='software').steps.length);
 const restored=applyEdits(empty,null,[{type:'restore_workflow',workflowId:'venture'}]);assert.equal(restored.workflows[0].title,initial.workflows[0].title);assert.deepEqual(restored.workflows[0].steps,initial.workflows[0].steps);assert.equal(empty.workflows.length,0);
});
test('flow reordering is complete and only changes order, preserving all current unsaved fields',()=>{
 const base=defaults(),flow=base.workflows[0];flow.steps[0].objective='TEST FIXTURE unsaved edit';const ids=base.workflows.map(item=>item.id).reverse(),next=applyEdits(base,null,[{type:'reorder_workflows',workflowIds:ids}]);assert.deepEqual(next.workflows.map(item=>item.id),ids);assert.equal(next.workflows.at(-1).steps[0].objective,flow.steps[0].objective);assert.equal(next.workflows[0].order,0);assert.throws(()=>applyEdits(base,null,[{type:'reorder_workflows',workflowIds:ids.slice(1)}]),/全部当前流程/);
});
test('the dedicated native editor can read and create a flow when its configuration is empty',async()=>{
 process.env.ARES_HOME=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-empty-editor-'));const agents=new Map(),sessions=new Map();
 const ctx={get:key=>key==='jobs'?{list:()=>[]}:key==='sessionController'?{inspect:async id=>sessions.get(id)}:key==='agents'?{get:id=>agents.get(id),list:()=>[...agents.values()],isOwnedBy:()=>false}:undefined};
 const editor=createEditorWorkspace(ctx,{forEditor:async()=>EDITOR_PRESET_ID}),configuration={...defaults(),workflows:[]},connection=await editor.open({configuration,workflowId:null,activeStepId:null});const actor={id:'empty-editor-fixture',status:'idle',session:{header:{id:'empty-editor-fixture',cwd:connection.cwd},snapshotEvents:()=>[]}};agents.set(actor.id,actor);sessions.set(actor.id,{meta:{...actor.session.header,agentPreset:EDITOR_PRESET_ID},events:[]});
 try{await editor.bind({bindingToken:connection.bindingToken,sessionId:actor.id});const context=await editor.read(actor,{kind:'context'});assert.equal(context.workflowId,null);assert.equal(context.workflows.length,0);assert.equal(context.templates.length,12);await editor.propose(actor,{expectedRevision:context.revision,edits:[{type:'create_workflow',id:'first-flow',title:'TEST FIXTURE new from empty',templateId:'modeling'}]});assert.equal((await editor.state()).proposal.configuration.workflows[0].id,'first-flow');}
 finally{editor.dispose();}
});
