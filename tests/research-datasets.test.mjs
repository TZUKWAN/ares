import assert from 'node:assert/strict';
import {test} from 'node:test';
import {datasetFixture,digest,version,small,large,largeHash} from './helpers/research-provider.mjs';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createDatasetTools,profileDataset} from '../host/research-datasets.js';
import {allowedDatasetUrl} from '../host/research-network.js';
import {researchEntry,researchIndex} from '../host/project-research.js';
import {getResearchJob,createResearchJobs,previousResearchJob} from '../host/research-jobs.js';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';

const rootBase=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-research-dataset-'));
process.env.ARES_HOME=join(rootBase,'home');
function project(name){
  const root=join(rootBase,name);mkdirSync(root);linkRoot(root);
  return initializeProject({root,name,competitionId:5,track:competitionCatalog().find(c=>c.id===5).tracks[0].track,workflowId:'modeling'}).root;
}
async function settled(root,id){
  for(let attempt=0;attempt<180;attempt++){
    const value=getResearchJob(root,id);
    if(value.status!=='running')return value;
    await sleep(50);
  }
  throw Error('Job did not finish');
}

test('dataset access is explicit and streamed file receipts preserve pinned provenance, checksum and cancellation',async t=>{
  const root=project('data-research-test'),other=project('data-research-other'),jobs=createResearchJobs();
  t.after(()=>jobs.dispose());
  const {transport,requests}=await datasetFixture(t);
  const tools=createDatasetTools(jobs,{transport});
  const at=()=>({root,expectedRevision:readProject(root).revision});
  await assert.rejects(tools.search({...at(),provider:'hf',query:'software'}),{status:403});
  assert.equal(requests.length,0);
  assert.equal((await tools.search({...at(),provider:'hf',query:'software',approveExternal:true})).matches[0].license,'cc0-1.0');
  const details=await tools.details({...at(),provider:'hf',datasetId:'research/qa',approveExternal:true});
  assert.equal(details.version,version);assert.equal(details.files.length,4);
  const download=(file,extra={})=>tools.download({...at(),snapshotId:details.snapshotId,approveExternal:true,confirmLicense:true,file,...extra}).job;
  assert.throws(()=>download('large.bin',{confirmLicense:false}),{status:403});
  assert.throws(()=>download('missing.csv'),{status:404});
  assert.throws(()=>tools.download({root:other,expectedRevision:0,snapshotId:details.snapshotId,file:'large.bin',approveExternal:true,confirmLicense:true}),{status:404});
  const stored=await settled(root,download('large.bin').id);
  assert.equal(stored.status,'completed',JSON.stringify(stored));
  const saved=researchEntry(root,stored.result.itemId);
  assert.equal(saved.data.file.bytes,large.length);
  assert.equal(saved.data.file.sha256,largeHash);
  assert.equal(digest(readFileSync(join(root,saved.data.file.path))),largeHash);
  assert.equal(saved.data.version,version);
  assert.equal(saved.data.verification.providerDigest,'sha256');
  assert.equal(saved.data.license,'cc0-1.0');
  assert.throws(()=>download('large.bin'),{status:409});
  const bad=await settled(root,download('bad.bin').id);
  assert.equal(bad.status,'failed');assert.match(bad.message,/SHA-256/);
  const slow=download('slow.bin');
  for(let i=0;i<40&&!getResearchJob(root,slow.id).progress.done;i++)await sleep(50);
  assert.ok(getResearchJob(root,slow.id).progress.done>0);
  jobs.cancel(root,slow.id);
  assert.equal((await settled(root,slow.id)).status,'cancelled');
  assert.equal(readdirSync(join(root,'.ares','research','pending')).length,0);
  assert.equal(researchIndex(root).items.filter(row=>row.kind==='dataset').length,1);
  const csv=await settled(root,download('dataset.csv').id);
  assert.equal(csv.status,'completed',JSON.stringify(csv));
  assert.equal(researchEntry(root,csv.result.itemId).data.verification.providerDigest,'git-blob-sha1');
  const profile=await profileDataset({...at(),id:csv.result.itemId});
  assert.deepEqual(researchEntry(root,profile.item.id).data.profile.find(row=>row.name==='value'),{name:'value',present:1,missing:1,numeric:1});
  assert.equal(researchEntry(root,profile.item.id).version.payload.source.versionId,csv.result.versionId);
  assert.equal(readProject(root).progress.done,0);
});

test('Kaggle adapter sends pinned request fields and checks provider MD5 when present',async t=>{
  const root=project('kaggle-protocol-test'),jobs=createResearchJobs();t.after(()=>jobs.dispose());
  const {transport,requests}=await datasetFixture(t),tools=createDatasetTools(jobs,{transport});
  const at=()=>({root,expectedRevision:readProject(root).revision,provider:'kaggle',approveExternal:true});
  assert.equal((await tools.search({...at(),query:'software'})).matches[0].id,'research/qa');
  const snapshot=await tools.details({...at(),datasetId:'research/qa'});
  const job=tools.download({...at(),snapshotId:snapshot.snapshotId,file:'dataset.csv',confirmLicense:true}).job;
  const done=await settled(root,job.id);
  assert.equal(done.status,'completed',JSON.stringify(done));
  assert.equal(researchEntry(root,done.result.itemId).data.verification.providerDigest,'md5');
  assert.deepEqual(requests.find(row=>row.pathname.endsWith('DownloadDatasetRaw')).body,
    {ownerSlug:'research',datasetSlug:'qa',datasetVersionNumber:3,fileName:'dataset.csv'});
});
test('only pinned hosts and specific transfer origins can receive upstream traffic',()=>{
  const check=(provider,url,options)=>allowedDatasetUrl(provider,new URL(url),options);
  assert.equal(check('hf','https://huggingface.co/api/datasets'),true);
  assert.equal(check('hf','https://cas-bridge.xethub.hf.co/transfer',{download:true,redirect:true}),true);
  assert.equal(check('hf','https://huggingface.co.evil.test/api'),false);
  assert.equal(check('hf','https://user:password@huggingface.co/api'),false);
  assert.equal(check('kaggle','https://storage.googleapis.com/unrelated/file',{download:true,redirect:true}),false);
  assert.equal(check('kaggle','https://storage.googleapis.com/kagglesdsdata/file',{download:true,redirect:true}),true);
  assert.equal(check('kaggle','https://127.0.0.1/private',{download:true,redirect:true}),false);
});
test('a killed worker is detected from a real persisted job and can be resumed only as a new attempt',async t=>{
  const root=project('research-restart-test');
  const module=new URL('../host/research-jobs.js',import.meta.url).href;
  const child=spawn(process.execPath,['--input-type=module','-e',
    'import {createResearchJobs} from '+JSON.stringify(module)+';const jobs=createResearchJobs();const result=jobs.start({root:process.env.ARES_QA_PROJECT,expectedRevision:0},{kind:"dataset-download",title:"restart QA"},async()=>new Promise(()=>{}));console.log(JSON.stringify(result.job));setInterval(()=>{},500);'],
    {env:{...process.env,ARES_QA_PROJECT:root},stdio:['ignore','pipe','pipe'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});
  const [stdout]=await once(child.stdout,'data'),job=JSON.parse(stdout.toString());
  assert.equal(getResearchJob(root,job.id).status,'running');
  const stopped=once(child,'exit');child.kill();await stopped;
  assert.equal(getResearchJob(root,job.id).status,'interrupted');
  const previous=previousResearchJob(root,job.id,'dataset-download'),jobs=createResearchJobs();
  t.after(()=>jobs.dispose());
  const next=jobs.start({root,expectedRevision:readProject(root).revision},{kind:'dataset-download',title:'restart QA retry',previous},async()=>({validated:true}));
  assert.notEqual(next.job.id,job.id);
  assert.equal(next.job.priorJob,job.id);
  assert.equal((await settled(root,next.job.id)).status,'completed');
});
