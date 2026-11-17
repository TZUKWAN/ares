/** Production workflow/project/files, explicitly software QA, no model/cloud/desktop. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {defaults,saveConfiguration,readConfiguration,competitionCatalog} from '../host/catalog.js';
import {linkRoot,initializeProject,readProject,recordRules,taskAction,taskChecks,verifyProject,previewUpgrade,upgradeProject} from '../host/projects.js';
import {configureRuleChecklist,confirmRuleItem} from '../host/rule-checklist.js';
import {freezeProjectRelease,restoreRelease,readRelease} from '../host/project-workbench.js';
import {applyEdits} from '../host/editor-operations.js';
import {hash} from '../host/storage.js';
import {directRoutes} from './helpers/direct-routes.mjs';

// Forty actual snapshots/restores include repeated format validation on Windows.
// The observed pre-restore half took 160s; budget covers both real halves.
for(const count of [1,8,40])test('actual '+count+'-step lifecycle keeps DAG, versions, owner gates, concurrent revision conflicts and restored bytes',{timeout:600000},async()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-scale-lifecycle-'+count+'-')),root=join(base,'project');process.env.ARES_HOME=join(base,'home');mkdirSync(root);linkRoot(root);
 const config=defaults(),flow=structuredClone(config.workflows.find(row=>row.id==='modeling')),seed=structuredClone(flow.steps[0]);flow.id='scale-software-'+count;flow.title='软件流程 '+count+' 步（非竞赛）';flow.steps=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:'step-'+i,title:'软件步骤 '+i,execution:count>1&&i===count-1?'human':'agent',dependsOn:i?['step-'+(i-1)]:[],outputs:[{id:'file-'+i,title:'实际软件文件 '+i,kind:'file',format:'md',path:'file-'+i+'.md',requirement:'required'}]}));config.workflows.push(flow);saveConfiguration(config,0);
 let p=initializeProject({root,name:'真实状态机 '+count+' 步软件验证',competitionId:5,track:competitionCatalog(config).find(row=>row.id===5).tracks[0].track,workflowId:flow.id,edition:'SOFTWARE-QA-ONLY'});
 const scope='This actual file defines a software state-machine test only, not a contest rule or human-work certification.';writeFileSync(join(root,'scope.txt'),scope);
 function rules(){p=recordRules({root,expectedRevision:p.revision,edition:'SOFTWARE-QA-ONLY',sourceUrl:'https://example.invalid/owned-software-scope',snapshotPath:'scope.txt',quote:scope},'user');p=configureRuleChecklist({root,expectedRevision:p.revision,items:[{id:'qa-scope',label:'Explicit software test scope checked against its actual file',kind:'mandatory'}]});p=confirmRuleItem({root,expectedRevision:p.revision,ruleId:'qa-scope',confirmChecked:true,evidencePath:'scope.txt',summary:'Owner API contract checked this software scope only.'});}
 function accept(step){p=taskAction({root,expectedRevision:p.revision,stepId:step.id,action:'complete',confirmHuman:step.execution==='human',review:{summary:'Actual software QA bytes inspected. No competition result or real human fieldwork is certified.',findings:[]}},'user');}
 rules();mkdirSync(join(root,p.outputDir),{recursive:true});
 if(count>1)assert.throws(()=>taskAction({root,expectedRevision:p.revision,stepId:'step-1',action:'start'},'agent'),/前置/);
 const contents=[];
 for(const step of p.workflow.steps){const bytes=Buffer.from('# Software state-machine document '+step.id+'\nActual test bytes, not a competition submission.');contents.push({name:step.outputs[0].path,sha256:hash(bytes)});writeFileSync(join(root,p.outputDir,step.outputs[0].path),bytes);assert.equal(taskChecks(root,step.id).passed,true);if(step.execution==='human')assert.throws(()=>taskAction({root,expectedRevision:p.revision,stepId:step.id,action:'complete',confirmHuman:true},'agent'),{status:403});accept(step);}
 assert.equal(p.progress.done,count);assert.equal(verifyProject(root).checksPassed,true);
 const original=readFileSync(join(root,'.ares/project.json')),firstDefinition=p.definitionId;
 let current=readConfiguration();current=applyEdits(current,null,[{type:'remove_workflow',workflowId:flow.id}]);saveConfiguration(current,current.revision);assert.deepEqual(readFileSync(join(root,'.ares/project.json')),original);assert.equal(readProject(root).definitionId,firstDefinition);
 current=readConfiguration();current=applyEdits(current,null,[{type:'restore_workflow',workflowId:flow.id}]);saveConfiguration(current,current.revision);assert.deepEqual(readFileSync(join(root,'.ares/project.json')),original);
 current=readConfiguration();current.workflows.find(row=>row.id===flow.id).steps.at(-1).objective+=' Changed last-step QA requirement.';saveConfiguration(current,current.revision);assert.deepEqual(readFileSync(join(root,'.ares/project.json')),original);
 const preview=previewUpgrade({root,workflowId:flow.id});assert.equal(preview.changes.retained.length,count-1);assert.equal(preview.changes.changed.length,1);p=upgradeProject(preview);assert.equal(p.tasks['step-'+(count-1)].status,'stale');assert.equal(p.progress.done,count-1);assert.equal(verifyProject(root).checksPassed,false);accept(p.workflow.steps.at(-1));assert.equal(verifyProject(root).checksPassed,true);
 const saved=freezeProjectRelease({root,expectedRevision:p.revision,kind:'submission',title:'Actual software QA snapshot '+count});p=saved.project;const firstOutput=p.outputDir;
 // facts.name is a declared input. Unrelated metadata intentionally does not
 // invalidate accepted work; the original QA field tested the wrong contract.
 const api=directRoutes();try{const revision=p.revision,responses=await Promise.all(['A','B'].map(writer=>api.request('project/facts',{root,expectedRevision:revision,facts:{...p.facts,name:'Software lifecycle writer '+writer}})));assert.deepEqual(responses.map(row=>row.status).sort(),[200,409]);}finally{api.dispose();}
 p=readProject(root);assert.ok(['A','B'].some(writer=>p.facts.name==='Software lifecycle writer '+writer));assert.equal(p.progress.done,0);assert.equal(verifyProject(root).checksPassed,false);
 const restored=restoreRelease({root,expectedRevision:p.revision,releaseId:saved.release.id});p=restored.project;assert.notEqual(p.outputDir,firstOutput);assert.equal(p.progress.done,0);
 for(const file of contents){assert.equal(hash(readFileSync(join(root,firstOutput,file.name))),file.sha256);assert.equal(hash(readFileSync(join(root,p.outputDir,file.name))),file.sha256);}
 rules();for(const step of p.workflow.steps){assert.equal(taskChecks(root,step.id).passed,true);accept(step);}const report=verifyProject(root);assert.equal(report.checksPassed,true);assert.equal(report.contentReview.ownerReviewed,count);
 const beforeUnlink=readFileSync(join(root,'.ares/project.json'));linkRoot(root,true);assert.throws(()=>readProject(root),{status:403});assert.deepEqual(readFileSync(join(root,'.ares/project.json')),beforeUnlink);linkRoot(root);assert.equal(readProject(root).id,p.id);assert.equal(readRelease(root,saved.release.id).id,saved.release.id);
 writeFileSync(join(base,'evidence.json'),JSON.stringify({purpose:'Real software state-machine/file/owner-API contract, not live model or competition certification',count,root,originalDefinitionId:firstDefinition,restoredDefinitionId:p.definitionId,releaseId:saved.release.id,contents,report},null,2));console.log('WORKFLOW_SCALE_LIFECYCLE_EVIDENCE',base);
});
