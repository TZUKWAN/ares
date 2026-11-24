import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {createResearchJobs,getResearchJob} from '../host/research-jobs.js';
import {researchEntry,saveResearchVersion} from '../host/project-research.js';
import {startAnalysis,compareExperiments,previewScriptAnalysis,prepareScriptAnalysis,runScriptAnalysis} from '../host/study-experiments.js';
import {hash} from '../host/storage.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-study-experiments-'));process.env.ARES_HOME=join(base,'home');
function setup(name){const root=join(base,name);mkdirSync(root);linkRoot(root);const comp=competitionCatalog().find(row=>row.id===5);initializeProject({root,name,competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'});writeFileSync(join(root,'observations.csv'),'x,y,z\n'+Array.from({length:40},(_,i)=>[i+1,3*(i+1)+2,i%7].join(',')).join('\n'));return root;}
async function ended(root,id){for(let i=0;i<800;i++){const job=getResearchJob(root,id);if(['completed','failed','cancelled'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,15));}throw new Error('actual analysis worker did not terminate');}
const spec={engine:'regression',features:['x'],target:'y',seed:42,ridge:0};

test('actual fixed Python models retain input and code fingerprints, compare real metrics and reproduce the same split',async t=>{
  const root=setup('builtin'),jobs=createResearchJobs();t.after(()=>jobs.dispose());
  const ids=[],results=[];
  for(const [index,ridge] of [0,2,0].entries()){
    const started=startAnalysis(jobs,{root,expectedRevision:readProject(root).revision,dataPath:'observations.csv',title:'真实软件模型验收 '+index,spec:{...spec,ridge},approveCompute:true});
    const job=await ended(root,started.job.id);assert.equal(job.status,'completed',job.message);
    const saved=researchEntry(root,job.result.itemId);ids.push(saved.item.id);results.push(saved.data.result);
    assert.equal(saved.data.input.object.sha256,hash(readFileSync(join(root,'observations.csv'))));
    assert.match(saved.data.workerSha256,/^[a-f0-9]{64}$/);assert.match(saved.data.result.python,/^3\./);
    assert.equal(saved.data.result.plot.length,8);assert.equal(saved.data.result.metrics.testingRows,8);
  }
  assert.ok(results[0].metrics.rmse<1e-10);assert.ok(Math.abs(results[0].coefficients.x-3)<1e-10);
  assert.deepEqual(results[0],results[2]);assert.notEqual(results[0].metrics.rmse,results[1].metrics.rmse);
  const compared=compareExperiments({root,ids:ids.slice(0,2)});assert.equal(compared.sameData,true);assert.equal(compared.sameTarget,true);assert.equal(compared.rows.length,2);
  const clustered=startAnalysis(jobs,{root,expectedRevision:readProject(root).revision,dataPath:'observations.csv',spec:{engine:'clustering',features:['x','z'],clusters:3,seed:4},approveCompute:true});
  const job=await ended(root,clustered.job.id);assert.equal(job.status,'completed');
  const cluster=researchEntry(root,job.result.itemId);assert.equal(cluster.data.result.clusters.reduce((n,row)=>n+row.count,0),40);
  assert.equal(readProject(root).progress.done,0);
});

test('invalid data fails through a real worker, cancellation preserves its outcome and retry checks frozen inputs',async t=>{
  const root=setup('errors'),jobs=createResearchJobs();t.after(()=>jobs.dispose());
  assert.throws(()=>startAnalysis(jobs,{root,expectedRevision:0,dataPath:'observations.csv',spec}),/确认/);
  const bad=startAnalysis(jobs,{root,expectedRevision:0,dataPath:'observations.csv',spec:{...spec,target:'missing'},approveCompute:true});
  const failed=await ended(root,bad.job.id);assert.equal(failed.status,'failed');assert.match(failed.message,/有效数值记录不足/);
  const started=startAnalysis(jobs,{root,expectedRevision:readProject(root).revision,dataPath:'observations.csv',spec,approveCompute:true});
  jobs.cancel(root,started.job.id);assert.equal((await ended(root,started.job.id)).status,'cancelled');
  const retry=startAnalysis(jobs,{root,expectedRevision:readProject(root).revision,dataPath:'observations.csv',spec,approveCompute:true,retryId:started.job.id});
  assert.equal((await ended(root,retry.job.id)).status,'completed');
  writeFileSync(join(root,'observations.csv'),'x,y\n1,2');
  assert.throws(()=>startAnalysis(jobs,{root,expectedRevision:readProject(root).revision,dataPath:'observations.csv',spec,approveCompute:true,retryId:started.job.id}),/已变化/);
});

test('registered dataset bytes are checked and a completed experiment can reproduce its original input after the working file changes',async t=>{
  const root=setup('dataset-reproduction'),jobs=createResearchJobs();t.after(()=>jobs.dispose());
  const original=readFileSync(join(root,'observations.csv'));
  const dataset=saveResearchVersion({root,expectedRevision:0},{kind:'dataset',title:'明确软件数据集夹具',status:'downloaded',provenance:'software-protocol',data:{fileName:'observations.csv',file:{path:'observations.csv',sha256:hash(original),bytes:original.length}}});
  const first=startAnalysis(jobs,{root,expectedRevision:dataset.revision,dataItemId:dataset.item.id,spec,approveCompute:true});
  const endedFirst=await ended(root,first.job.id);assert.equal(endedFirst.status,'completed');
  const result=researchEntry(root,endedFirst.result.itemId);
  writeFileSync(join(root,'observations.csv'),'x,y\n1,2');
  assert.throws(()=>startAnalysis(jobs,{root,expectedRevision:readProject(root).revision,dataItemId:dataset.item.id,spec,approveCompute:true}),/文件已变化/);
  const repeated=startAnalysis(jobs,{root,expectedRevision:readProject(root).revision,repeatExperimentId:result.item.id,spec,approveCompute:true});
  const repeatedJob=await ended(root,repeated.job.id);assert.equal(repeatedJob.status,'completed');
  assert.deepEqual(researchEntry(root,repeatedJob.result.itemId).data.result,result.data.result);
});

test('a reviewed custom Python script executes via the existing native-tool dispatcher and binds actual process output to its experiment',async()=>{
  const root=setup('native-protocol-real-process');
  // Explicit software test program. The dispatcher below is a protocol fixture,
  // while pwsh and Python are real processes. This is not a live DSH-model claim.
  const script='import argparse,json\np=argparse.ArgumentParser()\np.add_argument("--input");p.add_argument("--params");p.add_argument("--output")\na=p.parse_args()\nrows=json.load(open(a.input,encoding="utf8"));params=json.load(open(a.params,encoding="utf8"))\nresult={"metrics":{"count":len(rows),"total":sum(float(r["x"]) for r in rows)*params["factor"]}}\nopen(a.output,"w",encoding="utf8").write(json.dumps(result))\n';
  writeFileSync(join(root,'analyze.py'),script);
  const preview=previewScriptAnalysis({root,scriptPath:'analyze.py'});
  assert.equal(preview.sha256,hash(Buffer.from(script)));
  const input={root,expectedRevision:0,dataPath:'observations.csv',scriptPath:'analyze.py',scriptSha256:preview.sha256,parameters:{factor:2},title:'自定义软件实验',approveScript:true};
  assert.throws(()=>prepareScriptAnalysis({...input,scriptSha256:'0'.repeat(64)}),/审阅预览/);
  const plan=prepareScriptAnalysis(input);assert.equal(plan.item.status,'prepared');
  const calls=[],events=[];
  const ctx={tools:{schemas:()=>[{name:'pwsh'}],async execute(request){
    calls.push(request);assert.equal(request.name,'pwsh');
    const result=await new Promise(resolve=>execFile('pwsh',['-NoProfile','-NonInteractive','-Command',request.arguments.command],{windowsHide:true,encoding:'utf8',timeout:30000},(error,stdout)=>resolve({error,stdout})));
    return {isError:!!result.error,value:{kind:'foreground',exitCode:result.error?1:0},content:[{type:'text',text:result.stdout}]};
  }}};
  const exec={agent:{id:'explicit-native-protocol-test',session:{header:{cwd:root},append:(kind,value)=>events.push({kind,value})}},token:{},callId:'analysis-protocol',signal:new AbortController().signal};
  const result=await runScriptAnalysis({root,id:plan.item.id,expectedRevision:plan.revision},{ctx,exec});
  assert.equal(result.item.status,'completed');assert.equal(calls.length,1);
  assert.ok(events.some(row=>row.kind==='tool/ptc-dispatch-start'));assert.ok(events.some(row=>row.kind==='tool/ptc-dispatch'));
  const actual=researchEntry(root,result.item.id);assert.deepEqual(actual.data.result.metrics,{count:40,total:1640});
  assert.equal(actual.data.nativeRunId.length,64);assert.equal(readProject(root).progress.done,0);
});
