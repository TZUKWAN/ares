import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProjectUI,createDialogRequests,parseProjectFacts} from '../client/project-workbench.js';

// Delayed protocol fixtures test UI state only, not a live provider or DSH host.
function fixture(type,api){
 const p={root:'explicit-dialog-fixture',revision:4},state={modal:type?{type,extension:{id:'fixture-extension'},input:'{}',count:10,seed:'fixture',questionsText:'test',scenario:'baseline',missingRate:0}:null,boot:{projects:[p]},board:{project:p,extensions:{extensions:[{id:'ares-survey-pretest',enabled:true}]}}};
 const ui=createProjectUI({state,api,project:()=>p,render:()=>{},act:fn=>fn(),toast:()=>{},reloadProjects:async()=>{},helpers:{}});
 return {state,ui};
}
for(const [action,type,result] of [
 ['board-artifact-history',null,{versions:[]}],
 ['board-cloud-history','board-collaboration',{items:[]}],
 ['board-survey-run','board-survey',{run:{payload:{status:'succeeded',path:'explicit-software-fixture'}}}],
 ['board-extension-execute','board-extension-run',{run:{payload:{status:'succeeded'}}}]
])test(action+' discards a result after its dialog is closed',async()=>{
 let release,options;const pending=new Promise(resolve=>release=resolve),f=fixture(type,async(_path,_data,opts)=>{options=opts;return pending;});
 const task=f.ui.action(action,{dataset:{id:'explicit-fixture'}});
 f.ui.cancelDialog?.();f.state.modal=null;
 release(result);await task;
 assert.equal(f.state.modal,null,'A late result must not reopen the dialog');
 assert.equal(options?.signal?.aborted,true,'Closing must cancel the owned request');
});
test('a cancelled auto-build never starts a new extension run',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve),calls=[],f=fixture('board-survey',async(path)=>{calls.push(path);if(path.endsWith('/build'))return pending;throw new Error('A cancelled dialog must not dispatch '+path);});
 f.state.board.extensions={extensions:[],templates:[{id:'ares-survey-pretest'}]};
 const task=f.ui.action('board-survey-run',{dataset:{}});f.ui.cancelDialog?.();f.state.modal=null;release({});await task;
 assert.deepEqual(calls,['project/extensions/build']);assert.equal(f.state.modal,null);
});
test('a failure remains visible after its own result was presented',async()=>{
 const state={modal:{type:'explicit-form'}},dialogs=createDialogRequests({state,render:()=>{}});
 await assert.rejects(dialogs.run(async request=>{request.show({type:'preview'});throw new Error('Actual failure fixture');}),/Actual failure/);
 assert.equal(state.modal.type,'preview');
});
test('advanced facts accept objects and reject null, arrays, primitives and malformed JSON',()=>{
 for(const value of ['null','[]','3','true','"text"','{'])assert.throws(()=>parseProjectFacts(value),/JSON对象/);
 assert.deepEqual(parseProjectFacts('{"notes":"actual draft"}'),{notes:'actual draft'});
});
test('cloud history pagination appends unique schema rows and advances the opaque cursor',async()=>{
 // UI paging fixture only; not a live Kdocs result.
 let sent;const f=fixture('board-cloud-history',async(_path,data)=>{sent=data;return {items:[{id:'fixture-v1',version:1},{id:'fixture-v2',version:2}],nextPageToken:'fixture-next'};});Object.assign(f.state.modal,{fileId:'fixture-doc',items:[{id:'fixture-v1',version:1}],nextPageToken:'fixture-current'});
 await f.ui.action('board-cloud-history-more',{dataset:{}});assert.equal(sent.pageToken,'fixture-current');assert.equal(sent.fileId,'fixture-doc');assert.equal(f.state.modal.items.length,2);assert.equal(f.state.modal.nextPageToken,'fixture-next');
});
test('closing during a history page request preserves its original rows and cursor',async()=>{
 let release,signal;const f=fixture('board-cloud-history',(_path,_data,options)=>{signal=options.signal;return new Promise(resolve=>release=resolve);}),m=f.state.modal;Object.assign(m,{fileId:'fixture-doc',items:[{id:'fixture-old',version:1}],nextPageToken:'fixture-current'});
 const task=f.ui.action('board-cloud-history-more',{dataset:{}});f.ui.cancelDialog();f.state.modal=null;release({items:[{id:'fixture-new',version:2}],nextPageToken:null});await task;assert.equal(signal.aborted,true);assert.equal(m.items.length,1);assert.equal(m.nextPageToken,'fixture-current');assert.equal(f.state.modal,null);
});
