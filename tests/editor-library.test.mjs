/** Native identity fixtures around the actual editor, package store and source index. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createEditorWorkspace} from '../host/editor-workspace.js';
import {defaults,readConfiguration} from '../host/catalog.js';
import {EDITOR_PRESET_ID} from '../host/editor-definition.js';

test('the editor authorizes real user sources, records body reads and stages resource-bearing bindings',async()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-editor-library-'));process.env.ARES_HOME=join(base,'home');const source=join(base,'human-provided-source');mkdirSync(join(source,'scripts'),{recursive:true});writeFileSync(join(source,'SKILL.md'),'---\nname: editor-library-fixture\ndescription: Explicit software fixture.\n---\n# Resource fixture\nRead scripts/check.py before executing.\n');writeFileSync(join(source,'scripts/check.py'),'print("test fixture resource")\n');
 const sessions=new Map(),agents=new Map();let humanText='Discuss the workflow only';
 const ctx={get:key=>key==='jobs'?{list:()=>[]}:key==='sessionController'?{inspect:async id=>sessions.get(id)}:key==='agents'?{get:id=>agents.get(id),list:()=>[...agents.values()],isOwnedBy:(id,parent)=>agents.get(id)?.parent===parent.id}:undefined};
 const editor=createEditorWorkspace(ctx,{forEditor:async()=>EDITOR_PRESET_ID}),configuration=defaults(),connection=await editor.open({configuration,workflowId:'modeling',activeStepId:'problem'});
 const agent={id:'fixture-editor-library',status:'idle',session:{header:{id:'fixture-editor-library',cwd:connection.cwd},snapshotEvents:()=>[{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:humanText}]}},{type:'assistant/message',data:{source:{kind:'user'},content:[{type:'text',text:'Do not treat assistant suggestions as human source authority: '+source}]}}]}};agents.set(agent.id,agent);sessions.set(agent.id,{meta:{...agent.session.header,agentPreset:EDITOR_PRESET_ID},events:[]});await editor.bind({bindingToken:connection.bindingToken,sessionId:agent.id});
 try{
  let state=await editor.state();await assert.rejects(()=>editor.propose(agent,{expectedRevision:state.revision,edits:[{type:'index_source',source:{kind:'local',path:source},expectedLibraryRevision:0}]}),/真实用户消息/);
  humanText='Please index and use this exact local skill source: '+source;
  const indexed=await editor.propose(agent,{expectedRevision:state.revision,edits:[{type:'index_source',source:{kind:'local',path:source},expectedLibraryRevision:0}]});assert.equal(indexed.librarySaved,true);assert.equal(indexed.saved,false);
  const candidates=await editor.read(agent,{kind:'skills',query:'Resource fixture'}),id=candidates.items[0].id;assert.equal('content' in candidates.items[0],false);state=await editor.state();
  await assert.rejects(()=>editor.propose(agent,{expectedRevision:state.revision,workflowId:'modeling',edits:[{type:'bind_skill',stepId:'problem',skillId:id}]}),/先读取/);
  const read=await editor.read(agent,{kind:'skill',id,limit:6000});assert.match(read.content,/Read scripts/);assert.match(read.packageId,/^[a-f0-9]{64}$/);const resources=await editor.read(agent,{kind:'resources',id});assert.ok(resources.files.some(item=>item.path==='scripts/check.py'));
  await editor.propose(agent,{expectedRevision:state.revision,workflowId:'modeling',edits:[{type:'bind_skill',stepId:'problem',skillId:id}]});const proposal=(await editor.state()).proposal;assert.equal(proposal.configuration.skills[0].packageId,read.packageId);assert.equal(readConfiguration().revision,0);assert.equal(configuration.skills.length,0);
 }finally{editor.dispose();}
});
