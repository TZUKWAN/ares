import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {linkRoot,initializeProject,readProject,taskAction} from '../host/projects.js';
import {competitionCatalog,readConfiguration,saveConfiguration} from '../host/catalog.js';
import {captureDraft,projectWorkbench,freezeProjectRelease,readRelease,restoreRelease,updateTeam,artifactHistory} from '../host/project-workbench.js';
import {readProjectObject,objectPath,recordPath} from '../host/project-objects.js';
import {createZip} from '../host/zip-archive.js';
import {spawnSync} from 'node:child_process';
import {competitionReferences,referenceWorkflow} from '../host/competition-references.js';
const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-project-board-'));process.env.ARES_HOME=join(base,'home');
const root=join(base,'project');mkdirSync(root);linkRoot(root);const comp=competitionCatalog().find(c=>c.id===5);
let p=initializeProject({root,name:'统一工作台软件测试夹具',competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'});
const target=()=>join(root,p.outputDir,'inventory.md');mkdirSync(join(root,p.outputDir),{recursive:true});writeFileSync(target(),'# 软件测试夹具第一稿\nOnly software test data.');
test('one project binds real immutable bytes, tasks, accepted versions and event history',()=>{
 p=captureDraft({root,expectedRevision:p.revision,stepId:'context'});const board=projectWorkbench(root),version=artifactHistory(root,'inventory').versions[0];assert.equal(board.artifacts.length,1);assert.equal(p.tasks.context.status,'pending');assert.equal(readProjectObject(root,version.payload.files[0].sha256).toString(),readFileSync(target(),'utf8'));
 p=taskAction({root,expectedRevision:p.revision,stepId:'context',action:'complete',review:{summary:'实际读取测试夹具后的结构复核。',findings:[]}},'user');assert.equal(p.tasks.context.status,'done');assert.ok(p.tasks.context.acceptedVersionIds.length);assert.ok(p.tasks.context.reviewObject);assert.equal(projectWorkbench(root).timeline[0].payload.type,'task.accepted');
});
let release;
test('stage requires accepted dependency closure and exact current output',()=>{
 assert.throws(()=>freezeProjectRelease({root,expectedRevision:p.revision,kind:'stage',stepIds:['rules']}),/已验收/);
 ({project:p,release}=freezeProjectRelease({root,expectedRevision:p.revision,kind:'stage',stepIds:['context'],title:'测试阶段一'}));assert.equal(readRelease(root,release.id).payload.files.length,1);
 writeFileSync(target(),'# 软件测试夹具第二稿');assert.equal(readProject(root).tasks.context.status,'stale');assert.throws(()=>freezeProjectRelease({root,expectedRevision:p.revision,kind:'stage',stepIds:['context']}),/已验收/);assert.throws(()=>freezeProjectRelease({root,expectedRevision:p.revision,kind:'submission'}),/未验收|规则缺口/);
});
test('restore creates a separate working draft with stale checks and preserves submitted bytes',()=>{
 const oldPath=target(),oldWorking=readFileSync(oldPath,'utf8'),oldRelease=JSON.stringify(readRelease(root,release.id));const result=restoreRelease({root,expectedRevision:p.revision,releaseId:release.id});p=result.project;
 assert.match(p.outputDir,/恢复工作稿/);assert.equal(readFileSync(oldPath,'utf8'),oldWorking);assert.match(readFileSync(target(),'utf8'),/第一稿/);assert.equal(p.tasks.context.status,'stale');assert.equal(JSON.stringify(readRelease(root,release.id)),oldRelease);
});
test('team assignment and optimistic revision share the project aggregate',()=>{
 p=updateTeam({root,expectedRevision:p.revision,action:'member',id:'analyst',name:'分析队员'});const oldRevision=p.revision;p=updateTeam({root,expectedRevision:p.revision,action:'assign',stepId:'context',memberId:'analyst'});assert.equal(p.tasks.context.assigneeId,'analyst');assert.throws(()=>updateTeam({root,expectedRevision:oldRevision,action:'member',name:'冲突写入'}),/变化|更新|被/);assert.throws(()=>updateTeam({root,expectedRevision:p.revision,action:'remove',id:'analyst'}),/先调整/);
});
test('corrupt immutable bytes fail without substituting current files',()=>{
 const file=release.payload.files[0],path=objectPath(root,file.sha256);writeFileSync(path,'BROKEN SOFTWARE FIXTURE');assert.throws(()=>readRelease(root,release.id),/损坏/);
 writeFileSync(recordPath(root,'releases',release.id),'BROKEN HISTORY FIXTURE');const listed=projectWorkbench(root).releases.find(r=>r.id===release.id);assert.equal(listed.kind,'damaged');assert.ok(listed.error);assert.throws(()=>readRelease(root,release.id),/JSON/);
});
test('source versions retain empty package files and invalidate acceptance when they change',()=>{
 const c=readConfiguration(),w=structuredClone(c.workflows.find(w=>w.id==='modeling'));w.id='version-source-test';w.steps=[{...w.steps[0],outputs:[{id:'actual-code',title:'软件测试源文件',kind:'directory',format:'directory',requirement:'required',path:'source'}]}];c.workflows.push(w);saveConfiguration(c,c.revision);const path=join(base,'source-project');mkdirSync(path);linkRoot(path);let q=initializeProject({root:path,name:'空源码文件软件测试',competitionId:5,track:comp.tracks[0].track,workflowId:w.id});mkdirSync(join(path,q.outputDir,'source'),{recursive:true});writeFileSync(join(path,q.outputDir,'source/__init__.py'),'');writeFileSync(join(path,q.outputDir,'source/model.py'),'print("explicit software test fixture")');q=taskAction({root:path,expectedRevision:q.revision,stepId:'context',action:'complete',review:{summary:'实际检查软件测试文件树，包括空包文件。',findings:[]}},'user');const versions=artifactHistory(path,'actual-code').versions;assert.equal(versions[0].payload.files.length,2);assert.equal(versions[0].payload.files.find(f=>f.path==='__init__.py').bytes,0);writeFileSync(join(path,q.outputDir,'source/empty.py'),'');assert.equal(readProject(path).tasks.context.status,'stale');
});
test('project archive CRC and UTF-8 paths are verified by an independent ZIP implementation',()=>{const bytes=createZip([{name:'实际文件/测试.py',bytes:Buffer.from('print(2+2)\n')},{name:'空文件.txt',bytes:Buffer.alloc(0)}]),path=join(base,'actual-archive.zip');writeFileSync(path,bytes);const result=spawnSync('python',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert len(z.namelist())==2; assert z.read(z.namelist()[0])==b"print(2+2)\\n"; print("ZIP_CRC_OK")',path],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ZIP_CRC_OK/);assert.throws(()=>createZip([{name:'../escape',bytes:Buffer.alloc(0)}]),/路径/);});
test('official reference profiles are explicit, scoped, and never mark rules reviewed',()=>{const c=readConfiguration(),w=c.workflows.find(w=>w.id==='modeling'),profile=competitionReferences(5)[0];assert.ok(profile.sources.every(s=>s.url.startsWith('https://www.mcm.edu.cn/')));const scoped=referenceWorkflow(w,profile.id,{id:5,track:comp.tracks[0].track});assert.equal(scoped.ruleStatus,'needs-current-edition-verification');assert.match(scoped.steps.find(s=>s.id==='paper').prompts.execute,/赛事参考/);assert.throws(()=>referenceWorkflow(w,profile.id,{id:1,track:'高教主赛道'}),/不同/);const inaccessible=competitionReferences(33)[0];assert.equal(inaccessible.requirements.length,0);assert.equal(inaccessible.sources[0].status,'unreachable');});
