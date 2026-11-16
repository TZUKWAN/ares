import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,validateConfiguration,saveConfiguration,readConfiguration,competitionCatalog,skillCatalog,freezeWorkflow,loadVersion} from '../host/catalog.js';
import {linkRoot,initializeProject,readProject,taskAction,taskChecks,inspectOutput,updateFacts,verifyProject} from '../host/projects.js';
import {hash,safePath} from '../host/storage.js';

// All temporary content is explicitly a software test fixture, never submission material.
const testHome=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-v2-tests-'));
process.env.ARES_HOME=join(testHome,'home');
console.log('TEST_FIXTURES_ONLY',testHome);
const configuration=defaults();
test('132 competition records / 168 selectable tracks and one historical track map to available configurations',()=>{
 const rows=competitionCatalog(configuration),tracks=rows.flatMap(c=>c.tracks);assert.equal(rows.length,132);assert.equal(tracks.length,169);assert.equal(tracks.filter(t=>!t.legacy).length,168);assert.equal(tracks.filter(t=>t.legacy).length,1);assert.equal(new Set(tracks.map(t=>JSON.stringify([t.competition_id,t.track]))).size,tracks.length);assert.equal(tracks.filter(t=>!t.configurationAvailable).length,0);
 assert.equal(rows.find(c=>c.id===3).tracks.filter(t=>!t.legacy).length,8);assert.ok(rows.find(c=>c.id===3).tracks.some(t=>t.legacy&&t.track==='默认赛道'),'The previous track identity remains for existing projects');
 assert.equal(rows.find(c=>c.id===5).tracks[0].suggestedWorkflow,'modeling');assert.equal(rows.find(c=>c.id===51).tracks[0].suggestedWorkflow,'coding');
 assert.ok(rows.every(c=>c.ruleStatus==='needs-current-edition-verification'));assert.ok(configuration.workflows.every(w=>w.verification==='configuration-only'));
});
test('every bound skill is a real readable local skill',()=>{validateConfiguration(configuration);const ids=new Set(skillCatalog(configuration).map(s=>s.id));assert.ok(configuration.workflows.every(w=>w.steps.every(s=>s.skills.every(id=>ids.has(id)))));});
test('configuration refuses dangling skills, forward dependencies and traversal',()=>{
 for(const mutate of [c=>c.workflows[0].steps[0].skills=['nonexistent'],c=>c.workflows[0].steps[0].dependsOn=['delivery'],c=>c.workflows[0].steps[0].outputs[0].path='../outside']){const c=structuredClone(configuration);mutate(c);assert.throws(()=>validateConfiguration(c));}
});
test('atomic save checks revision; stale writer leaves committed configuration intact',()=>{const first=saveConfiguration(configuration,0);assert.equal(first.revision,1);assert.throws(()=>saveConfiguration(configuration,0),/已被/);assert.equal(readConfiguration().revision,1);});
test('fixed workflow version does not change when template is edited',()=>{const c=readConfiguration(),v=freezeWorkflow(c.workflows.find(w=>w.id==='modeling'),c),old=v.workflow.steps[0].objective;c.workflows.find(w=>w.id==='modeling').steps[0].objective='TEST FIXTURE updated objective';saveConfiguration(c,1);assert.equal(loadVersion(v.id).workflow.steps[0].objective,old);});

const root=join(testHome,'project');mkdirSync(root);linkRoot(root);
const comp=competitionCatalog().find(c=>c.id===5);
const body={root,name:'软件测试夹具项目',competitionId:5,track:comp.tracks[0].track,edition:'TEST-EDITION',workflowId:'modeling'};
test('initialization creates actual snapshot and no fake completed outputs',()=>{const p=initializeProject(body);assert.equal(p.kind,'v2');assert.equal(p.progress.done,0);assert.equal(p.nextTask,'context');assert.ok(existsSync(join(root,'.ares','definition.json')));assert.equal(existsSync(join(root,p.outputDir)),false);assert.throws(()=>initializeProject(body),/已有/);});
test('domain mismatch cannot silently create a modeling project using venture workflow',()=>{const path=join(testHome,'wrong-domain');mkdirSync(path);linkRoot(path);assert.throws(()=>initializeProject({...body,root:path,workflowId:'venture'}),/流程领域/);assert.equal(existsSync(join(path,'.ares','project.json')),false);});
test('associated Junction project remains accessible through its actual canonical root',()=>{const actual=join(testHome,'junction-target'),alias=join(testHome,'junction-alias');mkdirSync(actual);symlinkSync(actual,alias,process.platform==='win32'?'junction':'dir');linkRoot(alias);const p=initializeProject({...body,root:alias,name:'Junction软件测试夹具'});assert.equal(readProject(p.root).id,p.id);});
test('dependency guard, empty files and made-up evidence cannot complete task',()=>{
 assert.throws(()=>taskAction({root,stepId:'solve',action:'start'}),/前置/);
 const p=readProject(root);mkdirSync(join(root,p.outputDir),{recursive:true});writeFileSync(join(root,p.outputDir,'inventory.md'),'');
 const checked=taskChecks(root,'context');assert.equal(checked.passed,false);
 const result=taskAction({root,stepId:'context',action:'complete',reviewPath:'虚构报告.json'});assert.equal(result.tasks.context.status,'failed');
});
test('actual artifact check + hash-bound review permits only current output',()=>{
 const p=readProject(root);writeFileSync(join(root,p.outputDir,'inventory.md'),'# 软件测试夹具\n此内容只用于校验状态机，不是参赛材料。');
 const checked=taskChecks(root,'context');assert.equal(checked.passed,true);
 mkdirSync(join(root,'.ares','reviews'),{recursive:true});writeFileSync(join(root,'.ares','reviews','wrong.json'),JSON.stringify({summary:'TEST FIXTURE review',passed:true,findings:[],artifactHashes:{inventory:'wrong'}}));
 assert.throws(()=>taskAction({root,stepId:'context',action:'complete',reviewPath:'.ares/reviews/wrong.json'}),/哈希/);
 const result=taskAction({root,stepId:'context',action:'complete',review:{summary:'已阅读软件测试夹具，此验证只覆盖状态机协议。',findings:[]}},'user');assert.equal(result.tasks.context.status,'done');assert.equal(result.progress.done,1);assert.equal(result.nextTask,'rules');
});
test('actual output change invalidates completed task',()=>{const p=readProject(root);writeFileSync(join(root,p.outputDir,'inventory.md'),'# TEST FIXTURE changed actual output');assert.equal(readProject(root).tasks.context.status,'stale');});
test('optional output missing does not block; section belongs to parent document',()=>{
 const p=readProject(root),s={id:'optional',title:'可选产物',path:'does-not-exist.txt',format:'txt',kind:'file',requirement:'optional'};const value=inspectOutput(root,p,s,[s]);assert.equal(value.required,false);assert.equal(value.state,'optional-missing');
 const parent={id:'document',title:'测试文档',path:'section-test.md',format:'md',kind:'file',requirement:'required'},section={id:'section',title:'文内章节',kind:'section',parentId:'document',heading:'结果检验',requirement:'required'};
 writeFileSync(join(root,p.outputDir,'section-test.md'),'# 软件测试夹具\n## 结果检验\n这里是测试章节。');const r=inspectOutput(root,p,section,[parent,section]);assert.equal(r.valid,true);assert.equal(r.path,join(p.outputDir,'section-test.md').replaceAll('\\','/'));
});
test('corrupt Office file cannot pass by extension or existence',()=>{const p=readProject(root);writeFileSync(join(root,p.outputDir,'broken.docx'),'TEST FIXTURE invalid file');const o={id:'broken',title:'损坏文档',path:'broken.docx',format:'docx',kind:'file',requirement:'required'};assert.equal(inspectOutput(root,p,o,[o]).valid,false);});
test('paths cannot escape project',()=>{assert.throws(()=>safePath(root,'../outside'));assert.throws(()=>safePath(root,'C:/outside'));});
test('unknown conditional inputs block completion instead of silently skipping a requirement',()=>{const p=readProject(root),o={id:'conditional',title:'条件产物',path:'missing.md',kind:'file',format:'md',requirement:'conditional',condition:{field:'facts.includePrototype',equals:true}};const r=inspectOutput(root,p,o,[o]);assert.equal(r.required,true);assert.equal(r.valid,false);assert.match(r.error,/条件输入/);});
test('modified review record invalidates completed task independently of output presence',()=>{taskAction({root,stepId:'context',action:'complete',review:{summary:'实际阅读当前软件测试夹具，重新绑定当前文件哈希。',findings:[]}},'user');const p=readProject(root);assert.equal(p.tasks.context.status,'done');writeFileSync(join(root,p.tasks.context.reviewPath),'TEST FIXTURE changed review');assert.equal(readProject(root).tasks.context.status,'stale');});
test('legacy migration preserves original and does not inherit unverified completion',()=>{const path=join(testHome,'legacy');mkdirSync(path);const source=JSON.stringify({project_name:'旧项目测试夹具',competition:{id:5},market:{tam:123}});writeFileSync(join(path,'project.json'),source);writeFileSync(join(path,'ares-run.json'),JSON.stringify({current_stage:'deliver'}));linkRoot(path);assert.equal(readProject(path).kind,'legacy');const p=initializeProject({...body,root:path,name:'旧项目测试夹具'});assert.equal(readFileSync(join(path,'project.json'),'utf8'),source);assert.equal(p.progress.done,0);assert.equal(p.legacy.profile.market.tam,123);});
test('human work cannot be certified by agent; absent rules prevent submission readiness',()=>{
 const path=join(testHome,'human');mkdirSync(path);linkRoot(path);const c=readConfiguration(),w=structuredClone(c.workflows.find(w=>w.id==='lab'));w.id='test-human';w.steps=[{...w.steps.find(s=>s.id==='operation'),dependsOn:[]}];c.workflows.push(w);saveConfiguration(c,c.revision);const lab=competitionCatalog(c).flatMap(c=>c.tracks).find(t=>t.pipeline==='E2');
 initializeProject({...body,root:path,name:'人工作业测试夹具',competitionId:lab.competition_id,track:lab.track,workflowId:'test-human'});assert.throws(()=>taskAction({root:path,stepId:'operation',action:'complete',confirmHuman:true,review:{summary:'cannot certify'}}),/团队/);
 assert.equal(verifyProject(path).checksPassed,false);
});
