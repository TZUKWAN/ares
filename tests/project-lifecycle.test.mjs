import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {defaults,saveConfiguration,competitionCatalog} from '../host/catalog.js';
import {linkRoot,initializeProject,taskAction,readProject} from '../host/projects.js';
import {captureDraft,freezeProjectRelease,restoreRelease,projectWorkbench} from '../host/project-workbench.js';
import {readProjectObject} from '../host/project-objects.js';

// Real files used only to exercise the state machine; never competition evidence.
function setup(){
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-lifecycle-'));process.env.ARES_HOME=join(base,'home');const root=join(base,'project');mkdirSync(root);linkRoot(root);
 const c=defaults(),w=structuredClone(c.workflows.find(w=>w.id==='modeling'));w.id='lifecycle-fixture';w.steps=[{...w.steps[0],outputs:[{id:'main',title:'协议测试正文',kind:'file',format:'md',path:'main.md',requirement:'required'},{id:'extra',title:'协议测试可选附件',kind:'file',format:'md',path:'extra.md',requirement:'optional'}]}];c.workflows.push(w);saveConfiguration(c,0);
 const competition=competitionCatalog(c).find(c=>c.id===5),p=initializeProject({root,name:'生命周期软件测试夹具',competitionId:5,track:competition.tracks[0].track,workflowId:w.id});mkdirSync(join(root,p.outputDir),{recursive:true});writeFileSync(join(root,p.outputDir,'main.md'),'# Explicit software fixture version one\n');return {root,p};
}
test('a formal stage freezes reviewed versions and cannot silently accept a new optional draft',()=>{
 const f=setup();let p=taskAction({root:f.root,expectedRevision:f.p.revision,stepId:'context',action:'complete',review:{summary:'实际读取协议夹具正文；可选附件当时不存在。',findings:[]}},'user');const accepted=[...p.tasks.context.acceptedVersionIds];
 writeFileSync(join(f.root,p.outputDir,'extra.md'),'# Newly created unreviewed software fixture\n');p=readProject(f.root);assert.equal(p.tasks.context.status,'done');const result=freezeProjectRelease({root:f.root,expectedRevision:p.revision,kind:'stage',stepIds:['context']});assert.equal(result.release.payload.files.some(f=>f.workingPath.endsWith('/extra.md')),false,'An unreviewed optional draft must not become accepted in a stage snapshot');assert.deepEqual(result.project.tasks.context.acceptedVersionIds,accepted);
});
test('restoring an older release updates current artifact heads to match restored real bytes',()=>{
 const f=setup();let p=captureDraft({root:f.root,expectedRevision:f.p.revision,stepId:'context'});const saved=freezeProjectRelease({root:f.root,expectedRevision:p.revision,kind:'checkpoint'});p=saved.project;
 writeFileSync(join(f.root,p.outputDir,'main.md'),'# Explicit software fixture version two\n');p=captureDraft({root:f.root,expectedRevision:p.revision,stepId:'context'});const oldHead=projectWorkbench(f.root).artifacts.find(v=>v.id==='main').currentVersionId;
 p=restoreRelease({root:f.root,expectedRevision:p.revision,releaseId:saved.release.id}).project;const head=projectWorkbench(f.root).artifacts.find(v=>v.id==='main');assert.notEqual(head.currentVersionId,oldHead);assert.ok(head.current.payload.workingPath.startsWith(p.outputDir+'/'));assert.equal(readProjectObject(f.root,head.current.payload.files[0].sha256).toString(),readFileSync(join(f.root,p.outputDir,'main.md'),'utf8'));assert.equal(p.tasks.context.status,'stale');
});
test('repeated checkpoint and restore keeps a bounded draft path instead of nesting prior trees',()=>{
 const f=setup();let p=f.p;for(let i=0;i<5;i++){const saved=freezeProjectRelease({root:f.root,expectedRevision:p.revision,kind:'checkpoint'});p=restoreRelease({root:f.root,expectedRevision:saved.project.revision,releaseId:saved.release.id}).project;assert.ok(p.outputDir.split('/').length<=4,p.outputDir);assert.match(readFileSync(join(f.root,p.outputDir,'main.md'),'utf8'),/version one/);}
});
