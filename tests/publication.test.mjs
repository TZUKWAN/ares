/** Explicit registry fault fixtures exercise real storage and publication ordering. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNativeCatalog} from '../host/native.js';
import {defaults,readConfiguration,competitionCatalog} from '../host/catalog.js';
import {loadNativeDefinition} from '../host/native-versions.js';
import {linkRoot,initializeProject,readProject} from '../host/projects.js';

function setup(){
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-publication-'));process.env.ARES_HOME=join(base,'home');
 const records=new Map(),registry={definitions:new Map(),async register(row){records.set(row.id,row);return()=>records.delete(row.id);},async resolve(id){return {id,...(records.get(id)?.name?.includes('TEST FAIL')?{broken:'TEST FIXTURE registration failed'}:{})};},async remoteExportList(){return {presets:[...records.values()]};}};
 registry.definitions.set('standard',{config:{plugins:[{id:'persona',name:'@deepseek-ai/dsh-persona',config:{prefix:'TEST FIXTURE standard'}}]},context:{agentPresets:registry}});
 let notificationFailure=false;
 const native=createNativeCatalog({inject(_deps,fn){fn({agentPresets:registry,effect(){}});},emit(){if(notificationFailure)throw new Error('TEST FIXTURE notification unavailable');}});
 return {base,native,registry,setNotificationFailure(){notificationFailure=true;}};
}
test('failed prepublication and a final runtime recheck preserve the old file and visible modes',async()=>{
 const f=setup();try{await f.native.publish();const before=readConfiguration(),roster=(await f.registry.remoteExportList()).presets.map(item=>item.id),bad=structuredClone(before);bad.workflows[0].title='TEST FAIL bad definition';
  await assert.rejects(()=>f.native.commitConfiguration(bad,0),/registration failed/);assert.equal(readConfiguration().revision,0);assert.deepEqual((await f.registry.remoteExportList()).presets.map(item=>item.id),roster);assert.equal(f.native.capability().available,true);
  await assert.rejects(()=>f.native.commitConfiguration(before,0,{beforeCommit(){throw new Error('TEST FIXTURE Agent began running');}}),/began running/);assert.equal(readConfiguration().revision,0);
  f.setNotificationFailure();const committed=await f.native.commitConfiguration(before,0);assert.equal(committed.configuration.revision,1);assert.match(committed.warning,/通知失败/);assert.equal(readConfiguration().revision,1);
 }finally{await f.native.dispose();}
});
test('a project pins its complete declaration and compiled instructions across configuration updates',async()=>{
 const f=setup();try{await f.native.publish();const root=join(f.base,'project');mkdirSync(root);linkRoot(root);const competition=competitionCatalog().find(item=>item.id===5),project=initializeProject({root,name:'TEST FIXTURE full declaration',competitionId:5,track:competition.tracks[0].track,edition:'TEST',workflowId:'modeling'});
  const id=await f.native.forProject(project),record=loadNativeDefinition(id),runtime=record.plugins.find(item=>item.id==='ares-runtime');assert.equal(runtime.name,'ares/runtime-directory');assert.ok(runtime.config.frozenSteps.problem);assert.equal(runtime.config.definitionId,project.definitionId);
  const next=readConfiguration();next.workflows.find(item=>item.id==='modeling').steps.find(item=>item.id==='problem').objective='TEST FIXTURE changed current workflow';await f.native.commitConfiguration(next,0);
  assert.equal(await f.native.forProject(readProject(root)),id);assert.equal(loadNativeDefinition(id).plugins.find(item=>item.id==='ares-runtime').config.frozenSteps.problem,runtime.config.frozenSteps.problem);
  assert.notEqual(await f.native.forWorkflow('modeling'),id);
  const path=join(process.env.ARES_HOME,'ares-native-versions',id+'.json'),original=readFileSync(path,'utf8'),damaged=JSON.parse(original);damaged.name+=' tampered';writeFileSync(path,JSON.stringify(damaged));await assert.rejects(()=>f.native.forProject(readProject(root)),/声明损坏/);writeFileSync(path,original);
 }finally{await f.native.dispose();}
});
