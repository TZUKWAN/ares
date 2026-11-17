/** Actual files and production business functions; explicit software QA only. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {defaults,saveConfiguration,readConfiguration,competitionCatalog} from '../host/catalog.js';
import {linkRoot,initializeProject,recordRules,taskAction,taskChecks,verifyProject,changeProject,previewUpgrade,upgradeProject} from '../host/projects.js';
import {configureRuleChecklist,confirmRuleItem} from '../host/rule-checklist.js';
import {hash} from '../host/storage.js';
import {randomUUID} from 'node:crypto';

function setup({owner=true,checklist=true}={}){
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-delivery-gate-')),root=join(base,'project'),home=join(base,'home');process.env.ARES_HOME=home;mkdirSync(root);linkRoot(root);
 const config=defaults(),flow=structuredClone(config.workflows.find(row=>row.id==='modeling'));flow.id='delivery-software-fixture';flow.steps=[{...flow.steps[0],outputs:[{id:'actual-file',title:'真实软件验证文件',kind:'file',format:'md',path:'actual.md',requirement:'required'}]}];config.workflows.push(flow);saveConfiguration(config,0);
 let p=initializeProject({root,name:'内部交付门禁软件验证（非竞赛成果）',competitionId:5,track:competitionCatalog(config).find(row=>row.id===5).tracks[0].track,workflowId:flow.id,edition:'SOFTWARE-QA'});
 const quote='Explicit software QA scope; this is not an actual competition rule.';writeFileSync(join(root,'scope.txt'),quote);
 p=recordRules({root,expectedRevision:p.revision,edition:'SOFTWARE-QA',sourceUrl:'https://example.invalid/owned-software-rule-fixture',snapshotPath:'scope.txt',quote},owner?'user':'agent');
 mkdirSync(join(root,p.outputDir),{recursive:true});const artifact=join(root,p.outputDir,'actual.md');writeFileSync(artifact,'# Software verification document\nActual bytes for the state-machine contract, not a contest submission.');
 const body={root,expectedRevision:p.revision,stepId:flow.steps[0].id,action:'complete'};
 if(owner)body.review={summary:'Only this real software QA document was inspected, no actual contest content is certified.',findings:[]};
 else{const path='agent-review.json';writeFileSync(join(root,path),JSON.stringify({passed:true,summary:'Explicit agent-authored QA review.',findings:[],artifactHashes:taskChecks(root,flow.steps[0].id).artifactHashes}));body.reviewPath=path;}
 p=taskAction(body,owner?'user':'agent');
 if(checklist){p=configureRuleChecklist({root,expectedRevision:p.revision,items:[{id:'scope-check',label:'Software QA scope explicitly checked against the actual scope file',kind:'mandatory'}]});p=confirmRuleItem({root,expectedRevision:p.revision,ruleId:'scope-check',confirmChecked:true,evidencePath:'scope.txt',summary:'Explicit owner API contract confirmation of the software QA scope.'});}
 return {base,root,home,p,artifact};
}
test('agent-authored rule/review records and an empty checklist cannot become owner acceptance',()=>{
 const f=setup({owner:false,checklist:false}),result=verifyProject(f.root);assert.equal(result.checksPassed,false);assert.ok(result.blocking.some(row=>/负责人/.test(row.reason)));
});
test('even owner-reviewed files need explicit current mandatory rule items',()=>{
 const f=setup({checklist:false}),result=verifyProject(f.root);assert.equal(result.checksPassed,false);assert.ok(result.blocking.some(row=>/逐项|规则.*条目/.test(row.reason)));
});
test('one structured report binds fixed workflow, real SHA, dependencies, owner review and rule evidence without writing the project',()=>{
 const f=setup(),before=readFileSync(join(f.root,'.ares/project.json')),result=verifyProject(f.root);
 assert.equal(result.checksPassed,true);assert.equal(result.schema_version,'3.0');assert.equal(result.workflow.definitionId,f.p.definitionId);assert.equal(result.workflow.state,'verified');
 assert.equal(result.contentReview.ownerReviewed,1);assert.equal(result.rules.mandatory,1);assert.equal(result.rules.confirmed,1);assert.equal(result.cloud.status,'not-configured');
 assert.equal(result.files.find(row=>row.path.endsWith('/actual.md')).sha256,hash(readFileSync(f.artifact)));assert.equal(result.steps[0].dependencies.length,0);assert.ok(result.steps[0].acceptedVersionIds.length);
 assert.equal(result.ruleEvidence.scoreEligible,false,'QA owner evidence never upgrades the archive into official numeric scoring');assert.deepEqual(readFileSync(join(f.root,'.ares/project.json')),before);
});
test('changed work, damaged frozen resources and unknown cloud writes remain explicit blockers',()=>{
 const changed=setup();writeFileSync(changed.artifact,'# A changed actual QA work file');assert.equal(verifyProject(changed.root).checksPassed,false);
 const resource=setup(),fixed=JSON.parse(readFileSync(join(resource.root,'.ares/definition.json'),'utf8')),skill=fixed.skills[0];writeFileSync(join(resource.home,'ares-versions',fixed.id,'resources',skill.id,'SKILL.md'),'Changed fixed resource');
 const damaged=verifyProject(resource.root);assert.equal(damaged.checksPassed,false);assert.equal(damaged.workflow.state,'invalid');
 const cloud=setup();changeProject({root:cloud.root,expectedRevision:cloud.p.revision},p=>{p.workbench.collaboration={provider:'kdocs',status:'connected',documents:[],linkOperations:[{operationId:'explicit-unknown-write-fixture',status:'needs-reconciliation',fileId:'explicit-fixture'}]};});
 const pending=verifyProject(cloud.root);assert.equal(pending.checksPassed,false);assert.ok(pending.blocking.some(row=>row.code==='cloud-operation-unresolved'));assert.equal(pending.cloud.operations[0].status,'needs-reconciliation');
});
test('a workflow metadata upgrade preserves valid acceptance while retaining its actual original artifact definition',()=>{
 const f=setup(),config=readConfiguration(),flow=config.workflows.find(row=>row.id==='delivery-software-fixture');flow.description+=' Only workflow metadata changed.';saveConfiguration(config,config.revision);
 const preview=previewUpgrade({root:f.root,workflowId:flow.id}),p=upgradeProject(preview);assert.notEqual(p.definitionId,f.p.definitionId);assert.equal(p.tasks.context.status,'done');assert.deepEqual(p.tasks.context.acceptedVersionIds,f.p.tasks.context.acceptedVersionIds);
 const report=verifyProject(f.root);assert.equal(report.checksPassed,true,JSON.stringify(report.blocking));assert.equal(report.workflow.definitionId,p.definitionId);
});
test('unknown or foreign stored execution cannot be declared successful by a manually accepted file',()=>{
 const f=setup(),id=randomUUID();changeProject({root:f.root,expectedRevision:f.p.revision},p=>{p.workbench.nodeRunIds=[id];});mkdirSync(join(f.root,'.ares/node-runs'),{recursive:true});const path=join(f.root,'.ares/node-runs',id+'.json');
 writeFileSync(path,JSON.stringify({id,projectId:f.p.id,definitionId:f.p.definitionId,stepId:'context',status:'unknown',calls:[],jobs:[]}));const report=verifyProject(f.root);assert.equal(report.checksPassed,false);assert.ok(report.blocking.some(row=>row.code==='node-execution-unresolved'));assert.equal(report.execution.runs[0].status,'unknown');
 writeFileSync(path,JSON.stringify({id,projectId:'different-explicit-fixture',status:'awaiting-review',calls:[],jobs:[]}));const foreign=verifyProject(f.root);assert.equal(foreign.checksPassed,false);assert.ok(foreign.blocking.some(row=>row.code==='node-execution-damaged'));assert.equal(foreign.execution.runs.length,0);
});
const gate=fileURLToPath(new URL('../scripts/final_gate.py',import.meta.url));
function cli(f,report){return spawnSync('python',[gate,'--profile',join(f.root,'.ares/project.json'),'--output-dir',join(f.base,'reports'),'--report',report],{encoding:'utf8',windowsHide:true,timeout:120000,env:{...process.env,PYTHONIOENCODING:'utf-8'}});}
test('the final-gate CLI really writes the same v2 project report and returns its actual readiness',()=>{
 const f=setup(),path=join(f.base,'reports','actual-report.json'),before=readFileSync(join(f.root,'.ares/project.json')),result=cli(f,path);
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(existsSync(path),true);const report=JSON.parse(readFileSync(path,'utf8'));
 assert.equal(report.projectId,f.p.id);assert.equal(report.checksPassed,true);assert.equal(report.workflow.definitionId,f.p.definitionId);assert.equal(report.files.find(row=>row.path.endsWith('/actual.md')).sha256,hash(readFileSync(f.artifact)));assert.deepEqual(readFileSync(join(f.root,'.ares/project.json')),before);
});
test('a report target cannot overwrite project state or a checked work file',()=>{
 const f=setup();for(const path of [join(f.root,'.ares/project.json'),f.artifact]){const before=readFileSync(path),result=cli(f,path);assert.notEqual(result.status,0);assert.deepEqual(readFileSync(path),before);}
});
