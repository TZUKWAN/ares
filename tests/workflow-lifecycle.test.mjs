import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {defaults,competitionCatalog,ROOT} from '../host/catalog.js';
import {directRoutes} from './helpers/direct-routes.mjs';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-all-workflows-'));process.env.ARES_HOME=join(base,'home');const api=directRoutes(),configuration=defaults(),catalogue=competitionCatalog(configuration),results=[];
const builder=fileURLToPath(new URL('./helpers/build-workflow-fixtures.py',import.meta.url));
async function call(path,data){const response=await api.request(path,data);assert.equal(response.status,200,path+': '+JSON.stringify(response.body));return response.body;}
after(()=>{api.dispose();writeFileSync(join(base,'workflow-results.json'),JSON.stringify({purpose:'software protocol only, not actual contest/human validation',results},null,2));console.log('FULL_WORKFLOW_EVIDENCE',join(base,'workflow-results.json'));});
for(const workflow of configuration.workflows)test('full production route lifecycle: '+workflow.id,async()=>{
 console.log('WORKFLOW_BEGIN',workflow.id);const root=join(base,workflow.id);mkdirSync(root);await call('roots',{path:root});const competition=catalogue.find(c=>c.tracks.some(t=>t.suggestedWorkflow===workflow.id))||catalogue.find(c=>c.tracks.some(t=>t.pipeline===workflow.pipeline)),track=competition.tracks.find(t=>t.suggestedWorkflow===workflow.id)||competition.tracks.find(t=>t.pipeline===workflow.pipeline);
 let p=(await call('project/init',{root,name:'软件协议测试-'+workflow.id,competitionId:competition.id,track:track.track,workflowId:workflow.id,edition:'SOFTWARE-CONTRACT-TEST'})).project;
 const quote='EXPLICIT SOFTWARE CONTRACT FIXTURE. This is not an actual competition rule or evidence of human work.';writeFileSync(join(root,'fixture-scope.txt'),quote);
 p=(await call('project/material',{root,expectedRevision:p.revision,path:'fixture-scope.txt',title:'软件协议验证范围'})).project;
 p=(await call('project/rules',{root,expectedRevision:p.revision,edition:'SOFTWARE-CONTRACT-TEST',sourceUrl:'https://example.invalid/explicit-software-contract-fixture',snapshotPath:'fixture-scope.txt',quote})).project;
 const missing=await call('project/check',{root,stepId:workflow.steps[0].id});assert.equal(missing.result.passed,false);
 for(const step of workflow.steps){
  const build=spawnSync('python',[builder],{input:JSON.stringify({outputDir:join(root,p.outputDir),sourceDir:join(ROOT,'host'),workflow,stepId:step.id}),encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}});assert.equal(build.status,0,workflow.id+'/'+step.id+': '+build.stderr);const actualBuild=JSON.parse(build.stdout);assert.ok(actualBuild.created.length);
  const checked=await call('project/check',{root,stepId:step.id});assert.equal(checked.result.passed,true,JSON.stringify(checked.result));
  if(step.execution==='human'){const refused=await api.request('project/task',{root,expectedRevision:p.revision,stepId:step.id,action:'complete',confirmHuman:false,review:{summary:'A software fixture cannot waive the human gate.',findings:[]}});assert.equal(refused.status,403);}
  p=(await call('project/task',{root,expectedRevision:p.revision,stepId:step.id,action:'complete',confirmHuman:step.execution==='human',review:{summary:'Only software protocol and actual format/file contents were checked. No competition, survey, experiment, financial forecast or platform work is claimed.',findings:[]}})).project;
  assert.equal(p.tasks[step.id].status,'done',JSON.stringify(p.tasks[step.id]));
 }
 assert.equal(p.progress.done,workflow.steps.length);const ready=await call('project/verify',{root});assert.equal(ready.result.checksPassed,true);
 const frozen=await call('project/release',{root,expectedRevision:p.revision,kind:'submission',title:'Software contract snapshot '+workflow.id});p=frozen.project;assert.equal(frozen.release.payload.stepIds.length,workflow.steps.length);
 p=(await call('project/facts',{root,expectedRevision:p.revision,facts:{...p.facts,name:'Changed software fixture input'}})).project;assert.equal((await call('project/verify',{root})).result.checksPassed,false);
 p=(await call('project/restore',{root,expectedRevision:p.revision,releaseId:frozen.release.id})).project;assert.equal(p.progress.done,0);assert.equal((await call('project/verify',{root})).result.checksPassed,false);
 p=(await call('project/rules',{root,expectedRevision:p.revision,edition:'SOFTWARE-CONTRACT-TEST',sourceUrl:'https://example.invalid/explicit-software-contract-fixture',snapshotPath:'fixture-scope.txt',quote})).project;
 for(const step of workflow.steps){const checks=await call('project/check',{root,stepId:step.id});assert.equal(checks.result.passed,true,workflow.id+'/'+step.id);p=(await call('project/task',{root,expectedRevision:p.revision,stepId:step.id,action:'complete',confirmHuman:step.execution==='human',review:{summary:'Restored actual software-format fixture rechecked; no real contest or human work is claimed.',findings:[]}})).project;assert.equal(p.tasks[step.id].status,'done');}
 assert.equal((await call('project/verify',{root})).result.checksPassed,true);const history=await call('project/release/read',{root,id:frozen.release.id});assert.equal(history.release.id,frozen.release.id);assert.equal(history.release.payload.facts.name,'软件协议测试-'+workflow.id);
 results.push({workflow:workflow.id,steps:workflow.steps.length,restoredAndRechecked:true,formats:[...new Set(workflow.steps.flatMap(s=>s.outputs.map(o=>o.format)))],releaseId:frozen.release.id,sourceDataPurpose:'real source-file observations for software state-machine testing only'});console.log('WORKFLOW_OK',workflow.id);
});
