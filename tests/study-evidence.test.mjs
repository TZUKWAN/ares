import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {initializeProject,linkRoot,readProject,verifyProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {readProjectObject} from '../host/project-objects.js';
import {researchEntry} from '../host/project-research.js';
import {artifactHistory} from '../host/project-workbench.js';
import {saveFact,registerFactReference,projectEvidence,previewFactUpdate,applyFactUpdate} from '../host/study-evidence.js';
import {hash} from '../host/storage.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-study-evidence-'));process.env.ARES_HOME=join(base,'home');
function setup(name){const root=join(base,name);mkdirSync(root);linkRoot(root);const comp=competitionCatalog().find(row=>row.id===5);const project=initializeProject({root,name,competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'});return {root,project};}

test('fact citations link immutable actual evidence to a work and update one reviewed occurrence with a real artifact version',async()=>{
  const {root,project}=setup('citations');
  const source=join(root,'software-observations.txt');writeFileSync(source,'Software test only.\nCount = 100\n');
  const request={root,key:'sample_count',title:'测试样本数',value:100,unit:'份',confirmEvidence:true,sources:[{kind:'file',path:'software-observations.txt',quote:'Count = 100',locator:'第2行'}]};
  const fact=await saveFact({...request,expectedRevision:0});
  const evidence=researchEntry(root,fact.item.id).data.sources[0];
  const step=project.workflow.steps[0],output=step.outputs.find(row=>row.kind==='file'&&row.format==='md'),path=join(root,project.outputDir,output.path);
  mkdirSync(dirname(path),{recursive:true});const old='# 软件验收报告\n有效样本数为100份。';writeFileSync(path,old);
  const linked=registerFactReference({root,expectedRevision:1,factId:fact.item.id,factVersion:fact.version.id,artifactId:output.id,quote:'有效样本数为100份',location:'第一节'});
  assert.equal(projectEvidence(root).uses[0].state,'current');
  writeFileSync(source,'Software test only.\nCount = 120\n');
  assert.equal(projectEvidence(root).uses[0].state,'source-updated');
  assert.ok(verifyProject(root).blocking.some(row=>row.code==='evidence-reference-stale'&&row.artifactId===output.id));
  const updated=await saveFact({...request,id:fact.item.id,baseVersion:fact.version.id,expectedRevision:2,value:120,sources:[{...request.sources[0],quote:'Count = 120'}]});
  assert.equal(projectEvidence(root).uses[0].state,'fact-updated');
  const preview=previewFactUpdate({root,expectedRevision:3,referenceId:linked.reference.id});
  assert.equal(preview.canApply,true);assert.equal(preview.before,'有效样本数为100份');assert.equal(preview.after,'有效样本数为120份');
  assert.throws(()=>applyFactUpdate({root,expectedRevision:3,referenceId:linked.reference.id,token:preview.token}),/审阅/);
  const applied=applyFactUpdate({root,expectedRevision:3,referenceId:linked.reference.id,token:preview.token,confirmUpdate:true});
  assert.equal(readFileSync(path,'utf8'),'# 软件验收报告\n有效样本数为120份。');
  assert.equal(applied.accepted,false);assert.equal(projectEvidence(root).uses[0].state,'current');
  assert.equal(artifactHistory(root,output.id).versions[0].id,applied.artifactVersionId);
  assert.deepEqual(readProjectObject(root,hash(Buffer.from(old))),Buffer.from(old));
  assert.equal(readProjectObject(root,evidence.snapshot.object.sha256).toString(),'Software test only.\nCount = 100\n');
  assert.equal(readProject(root).progress.done,0);assert.equal(updated.item.id,fact.item.id);
});

test('synthetic provenance, invented quotes, duplicate fact keys and stale update previews are refused',async()=>{
  const {root,project}=setup('guards');writeFileSync(join(root,'source.txt'),'Actual test evidence count 50');
  const request={root,key:'count',title:'软件计数',value:50,confirmEvidence:true,sources:[{kind:'file',path:'source.txt',quote:'count 50'}]};
  await assert.rejects(saveFact({...request,expectedRevision:0,confirmEvidence:false}),/来源后保存|核对/);
  const saved=await saveFact({...request,expectedRevision:0,confirmEvidence:true});
  await assert.rejects(saveFact({...request,expectedRevision:1,confirmEvidence:true}),/相同事实/);
  await assert.rejects(saveFact({...request,key:'different',expectedRevision:1,confirmEvidence:true,sources:[{...request.sources[0],quote:'invented'}]}),/找不到/);
  writeFileSync(join(root,'synthetic.txt'),'ARES_SYNTHETIC_DATA\ncount 50');
  await assert.rejects(saveFact({...request,key:'other',expectedRevision:1,confirmEvidence:true,sources:[{kind:'file',path:'synthetic.txt',quote:'count 50'}]}),/模拟材料/);
  const step=project.workflow.steps[0],output=step.outputs.find(row=>row.kind==='file'&&row.format==='md'),path=join(root,project.outputDir,output.path);
  assert.throws(()=>registerFactReference({root,expectedRevision:1,factId:'00000000-0000-0000-0000-000000000000',artifactId:output.id,quote:'50'}),{status:404});
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'# 软件测试\n150');
  assert.throws(()=>registerFactReference({root,expectedRevision:1,factId:saved.item.id,artifactId:output.id,quote:'150'}),/完整当前事实值/);
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'# 软件测试\n50');
  const linked=registerFactReference({root,expectedRevision:1,factId:saved.item.id,factVersion:saved.version.id,artifactId:output.id,quote:'50'});
  writeFileSync(join(root,'source.txt'),'Actual test evidence count 51');
  const latest=await saveFact({...request,id:saved.item.id,baseVersion:saved.version.id,expectedRevision:2,value:51,confirmEvidence:true,sources:[{...request.sources[0],quote:'count 51'}]});
  const preview=previewFactUpdate({root,expectedRevision:3,referenceId:linked.reference.id});
  writeFileSync(path,'# 软件测试\n已被人工改为50');
  assert.throws(()=>applyFactUpdate({root,expectedRevision:3,referenceId:linked.reference.id,token:preview.token,confirmUpdate:true}),/预览已变化/);
  assert.equal(readFileSync(path,'utf8'),'# 软件测试\n已被人工改为50');
  assert.equal(latest.item.status,'owner-attested');
});
