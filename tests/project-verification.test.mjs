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
import {freezeProjectRelease,readRelease} from '../host/project-workbench.js';
import {hash} from '../host/storage.js';
import {randomUUID} from 'node:crypto';

function setup({owner=true,checklist=true,reviewActor,requirement='required',writeArtifact=true,management=false,facts}={}){
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-delivery-gate-')),root=join(base,'project'),home=join(base,'home');process.env.ARES_HOME=home;mkdirSync(root);linkRoot(root);
 const config=defaults(),flow=structuredClone(config.workflows.find(row=>row.id==='modeling')),step=flow.steps[0];
 flow.id='delivery-software-fixture';
 step.outputs=[{id:'actual-file',title:'真实软件验证文件',kind:'file',format:'md',path:'actual.md',requirement,...(requirement==='conditional'?{condition:{field:'facts.deliverReport',equals:true}}:{})}];
 flow.steps=[step];
 if(management){
  flow.steps.unshift({...structuredClone(step),id:'coordination',title:'团队排期确认',execution:'human',outputs:[{id:'meeting-notes',title:'可选会议记录',kind:'file',format:'md',path:'meeting.md',requirement:'optional'}]});
  step.dependsOn=['coordination'];
 }
 config.workflows.push(flow);saveConfiguration(config,0);
 let p=initializeProject({root,name:'内部交付门禁软件验证（非竞赛成果）',competitionId:5,track:competitionCatalog(config).find(row=>row.id===5).tracks[0].track,workflowId:flow.id,edition:'SOFTWARE-QA',facts});
 const quote='Explicit software QA scope; this is not an actual competition rule.';writeFileSync(join(root,'scope.txt'),quote);
 p=recordRules({root,expectedRevision:p.revision,edition:'SOFTWARE-QA',sourceUrl:'https://example.invalid/owned-software-rule-fixture',snapshotPath:'scope.txt',quote},owner?'user':'agent');
 mkdirSync(join(root,p.outputDir),{recursive:true});const artifact=join(root,p.outputDir,'actual.md');
 if(writeArtifact)writeFileSync(artifact,'# Software verification document\nActual bytes for the state-machine contract, not a contest submission.');
 if(management)p=taskAction({root,expectedRevision:p.revision,stepId:'coordination',action:'complete',confirmHuman:true,review:{summary:'排期已由软件验收夹具负责人确认。',findings:[]}},'user');
 const body={root,expectedRevision:p.revision,stepId:step.id,action:'complete'};
 if(owner)body.review={summary:'Only this real software QA document was inspected, no actual contest content is certified.',findings:[]};
 else{const path='agent-review.json';writeFileSync(join(root,path),JSON.stringify({passed:true,summary:'Explicit agent-authored QA review.',findings:[],artifactHashes:taskChecks(root,step.id).artifactHashes}));body.reviewPath=path;}
 p=taskAction(body,owner?'user':'agent',reviewActor);
 if(checklist){p=configureRuleChecklist({root,expectedRevision:p.revision,items:[{id:'scope-check',label:'Software QA scope explicitly checked against the actual scope file',kind:'mandatory'}]});p=confirmRuleItem({root,expectedRevision:p.revision,ruleId:'scope-check',confirmChecked:true,evidencePath:'scope.txt',summary:'Explicit owner API contract confirmation of the software QA scope.'});}
 return {base,root,home,p,artifact};
}

function freezeSubmission(f){
 return freezeProjectRelease({root:f.root,expectedRevision:f.p.revision,kind:'submission'});
}

function assertCurrentSubmission(f,verification){
 assert.equal(verification.checksPassed,true,JSON.stringify(verification.blocking));
 assert.equal(verification.submissionReadiness,'project-checks-passed');
 const {project,release}=freezeSubmission(f);
 assert.equal(project.revision,verification.projectRevision+1);
 assert.equal(release.payload.baseRevision,verification.projectRevision);
 assert.deepEqual(release.payload.stepIds,f.p.workflow.steps.map(step=>step.id));
 assert.deepEqual(release.payload.artifactVersionIds,verification.steps.flatMap(step=>step.acceptedVersionIds));
 assert.deepEqual(readRelease(f.root,release.id).payload.files.map(row=>[row.workingPath,row.sha256]),
  verification.files.filter(row=>row.accepted).map(row=>[row.path,row.sha256]));
 assert.equal(release.payload.files.length,1);
 assert.equal(release.payload.files[0].sha256,hash(readFileSync(f.artifact)));
}

test('accepted management and optional steps with no works cannot pass the project submission gate',()=>{
 const f=setup({requirement:'optional',writeArtifact:false});
 const saved=join(f.root,'.ares/project.json'),before=readFileSync(saved);
 const report=verifyProject(f.root);
 assert.equal(report.steps[0].status,'done');
 assert.equal(report.contentReview.ownerReviewed,1);
 assert.equal(report.rules.confirmed,1);
 assert.equal(report.files.length,0);
 assert.equal(report.completeness.requiredArtifacts,0);
 assert.throws(()=>freezeSubmission(f),/没有可固定的(?:已验收)?实际作品/);
 assert.equal(report.checksPassed,false);
 assert.equal(report.submissionReadiness,'blocked');
 assert.deepEqual(report.blocking.map(row=>row.code),['submission-artifacts-missing']);
 assert.deepEqual(readFileSync(saved),before);
});

test('an optional-only workflow submits an accepted work, never a later unreviewed draft',()=>{
 const f=setup({requirement:'optional',writeArtifact:false});
 writeFileSync(f.artifact,'# Actual optional work\nCreated after step review.');
 const draft=verifyProject(f.root);
 assert.equal(draft.files.length,1);
 assert.equal(draft.files[0].accepted,false);
 assert.equal(draft.checksPassed,false);
 assert.ok(draft.blocking.some(row=>row.code==='submission-artifacts-missing'));
 assert.throws(()=>freezeSubmission(f),{status:409});
 f.p=taskAction({root:f.root,expectedRevision:f.p.revision,stepId:'context',action:'complete',
  review:{summary:'负责人检查实际可选工作稿。',findings:[]}},'user');
 assertCurrentSubmission(f,verifyProject(f.root));
});

test('a pure management step needs owner review but no file when the project has accepted required work',()=>{
 const f=setup({management:true});
 const report=verifyProject(f.root);
 assert.equal(report.contentReview.ownerReviewed,2);
 assert.deepEqual(report.steps[0].acceptedVersionIds,[]);
 assert.equal(report.steps[0].checks[0].valid,false);
 assert.equal(report.completeness.requiredArtifacts,1);
 assertCurrentSubmission(f,report);
});

test('conditional work can qualify when required and accepted, while inactive conditions cannot make an empty submission ready',()=>{
 const inactive=setup({requirement:'conditional',facts:{deliverReport:false},writeArtifact:false});
 const inactiveReport=verifyProject(inactive.root);
 assert.equal(inactiveReport.steps[0].status,'done');
 assert.equal(inactiveReport.steps[0].checks[0].required,false);
 assert.equal(inactiveReport.checksPassed,false);
 assert.ok(inactiveReport.blocking.some(row=>row.code==='submission-artifacts-missing'));
 assert.throws(()=>freezeSubmission(inactive),{status:409});

 const missing=setup({requirement:'conditional',facts:{deliverReport:true},writeArtifact:false});
 const missingReport=verifyProject(missing.root);
 assert.equal(missingReport.steps[0].checks[0].required,true);
 assert.equal(missingReport.checksPassed,false);
 assert.ok(missingReport.blocking.some(row=>row.code==='artifact-check-failed'));
 assert.throws(()=>freezeSubmission(missing),{status:409});

 const present=setup({requirement:'conditional',facts:{deliverReport:true}});
 const report=verifyProject(present.root);
 assert.equal(report.steps[0].checks[0].required,true);
 assertCurrentSubmission(present,report);
});

test('a changed accepted optional work blocks a fresh submission and leaves the prior release intact',()=>{
 const f=setup({requirement:'optional'}),before=verifyProject(f.root);
 assertCurrentSubmission(f,before);
 const statePath=join(f.root,'.ares/project.json'),state=JSON.parse(readFileSync(statePath,'utf8'));
 const releaseId=state.workbench.releaseIds.at(-1),old=readRelease(f.root,releaseId);
 f.p.revision=state.revision;
 writeFileSync(f.artifact,'# Actual later working copy\nThe accepted content no longer matches.');
 const report=verifyProject(f.root);
 assert.equal(report.steps[0].status,'stale');
 assert.equal(report.checksPassed,false);
 assert.equal(report.files.some(row=>row.accepted),false);
 assert.throws(()=>freezeSubmission(f),{status:409});
 assert.deepEqual(readRelease(f.root,releaseId),old);
 assert.deepEqual(JSON.parse(readFileSync(statePath,'utf8')),state);
});
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

test('unrecognized run/call states and malformed terminal exit results remain unresolved',()=>{
 const f=setup(),id=randomUUID();changeProject({root:f.root,expectedRevision:f.p.revision},p=>{p.workbench.nodeRunIds=[id];});mkdirSync(join(f.root,'.ares/node-runs'),{recursive:true});
 const file=join(f.root,'.ares/node-runs',id+'.json'),base={id,projectId:f.p.id,definitionId:f.p.definitionId,stepId:'context',status:'awaiting-review',calls:[{name:'read',status:'succeeded',callSeq:1,resultSeq:2}],jobs:[]};
 writeFileSync(file,JSON.stringify(base));assert.equal(verifyProject(f.root).checksPassed,true,'An explicit valid stored-record contract is accepted; no real tool execution is claimed by this fixture.');
 for(const altered of [{status:'unrecognized-state'},{status:null},{calls:[]},{calls:[{name:'read',status:'unrecognized-result'}]},{jobs:[{status:'completed',detail:'exit code: unknown'}]}]){
  writeFileSync(file,JSON.stringify({...base,...altered}));const report=verifyProject(f.root);assert.equal(report.checksPassed,false,JSON.stringify(altered));assert.ok(report.blocking.some(row=>row.code==='node-execution-unresolved'));
 }
});

test('stored team confirmations do not become formal owner review',()=>{
 const team=setup({reviewActor:{id:'team-member'}}),report=verifyProject(team.root);assert.equal(report.checksPassed,false);assert.equal(report.contentReview.ownerReviewed,0);assert.ok(report.blocking.some(row=>row.code==='owner-review-required'));
 const rule=setup();changeProject({root:rule.root,expectedRevision:rule.p.revision},p=>{for(const row of Object.values(p.competition.ruleChecklist.checks))row.reviewer='team-member';});const rules=verifyProject(rule.root);assert.equal(rules.checksPassed,false);assert.equal(rules.rules.confirmed,0);
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
