import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {competitionCatalog} from '../host/catalog.js';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {saveSurvey} from '../host/research-surveys.js';
import {makeQuestion} from '../client/research-survey-model.js';
import {researchEntry} from '../host/project-research.js';
import {readProjectObject} from '../host/project-objects.js';
import {inspectCollection,saveCollection,pullCollection,reviewCollection,adoptCollection} from '../host/study-collection.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-collection-protocol-'));process.env.ARES_HOME=join(base,'home');
const url='https://www.kdocs.cn/l/ExplicitProtocolFixture';
const schema={sheets:[{id:2,name:'协议答卷',fields:[{id:'B',name:'数量',type:'Number'}],views:[]}]};
function setup(name){
  const root=join(base,name);mkdirSync(root);linkRoot(root);const comp=competitionCatalog().find(c=>c.id===5);
  initializeProject({root,name,competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'});
  const q=makeQuestion('number','amount','amount','数量');q.min=1;q.max=30;
  const survey=saveSurvey({root,expectedRevision:0,status:'final',confirmFinal:true,definition:{schemaVersion:1,title:'软件协议验收问卷',pages:[{id:'p1',title:'测试',questions:[q]}]}});
  return {root,survey};
}
async function linked(name,options={}){
  const {root,survey}=setup(name);let records=[{id:'row1',fields:{'数量':20}},{id:'row2',fields:{'数量':0}}];
  const call=async(action)=>action==='get-schema'?structuredClone(schema):{records:structuredClone(records),offset:''};
  const view=await inspectCollection({root,url,approveRead:true},{call});
  const config=await saveCollection({root,url,expectedRevision:1,surveyId:survey.item.id,surveyVersion:survey.version.id,sheetId:2,schemaSha256:view.sheets[0].schemaSha256,mapping:{amount:'数量'},approveRead:true,...options},{call});
  return {root,survey,config,call,setRecords(value){records=value;}};
}
test('a real collection business transaction preserves raw protocol rows, requires review, imports valid answers and records exclusions',async()=>{
  const {root,config,call}=await linked('formal');
  const pull=await pullCollection({root,id:config.item.id,approveRead:true},{call});
  let data=researchEntry(root,config.item.id).data;
  assert.equal(data.rows.length,2);assert.ok(data.rows[1].errors.amount);assert.equal(data.rows[0].decision,'pending');
  assert.equal(JSON.parse(readProjectObject(root,data.rawObject.sha256)).length,2);
  assert.throws(()=>adoptCollection({root,expectedRevision:pull.revision,id:config.item.id,confirmActual:true}),/逐份/);
  assert.throws(()=>reviewCollection({root,expectedRevision:pull.revision,id:config.item.id,decisions:[{sourceId:'row2',decision:'approved',reason:''}]}),/无效答卷/);
  const review=reviewCollection({root,expectedRevision:pull.revision,id:config.item.id,decisions:[{sourceId:'row1',decision:'approved',reason:'协议样例，验证采用通路'},{sourceId:'row2',decision:'rejected',reason:'超出问卷范围'}]});
  const adopted=adoptCollection({root,expectedRevision:review.revision,id:config.item.id,confirmActual:true});
  const response=researchEntry(root,adopted.item.id);
  assert.deepEqual(response.data.rows,[{amount:20}]);assert.deepEqual(response.data.lineage.sourceIds,['row1']);assert.deepEqual(response.data.lineage.excludedIds,['row2']);
  assert.equal(response.version.payload.source.itemId,config.version.payload.source.itemId);
  assert.equal(researchEntry(root,config.item.id).item.status,'adopted');assert.equal(readProject(root).progress.done,0);
  assert.throws(()=>adoptCollection({root,expectedRevision:adopted.revision,id:config.item.id,confirmActual:true}),/已经采用/);
});
test('resync preserves only byte-identical decisions and never loses the last complete batch after an invalid pagination response',async()=>{
  const {root,config,call,setRecords}=await linked('resync');
  const first=await pullCollection({root,id:config.item.id,approveRead:true},{call});
  reviewCollection({root,expectedRevision:first.revision,id:config.item.id,decisions:[{sourceId:'row1',decision:'approved',reason:'复核'}]});
  setRecords([{id:'row1',fields:{'数量':20}},{id:'row2',fields:{'数量':10}}]);
  await pullCollection({root,id:config.item.id,approveRead:true},{call});
  const before=researchEntry(root,config.item.id);assert.equal(before.data.rows[0].decision,'approved');assert.equal(before.data.rows[1].decision,'pending');
  setRecords([{id:'row1',fields:{'数量':21}}]);await pullCollection({root,id:config.item.id,approveRead:true},{call});
  assert.equal(researchEntry(root,config.item.id).data.rows[0].decision,'pending');
  const head=researchEntry(root,config.item.id).version.id;
  setRecords([{id:'row1',fields:{'数量':21}},{id:'row3',fields:{'数量':21}}]);
  const reviewed=reviewCollection({root,expectedRevision:readProject(root).revision,id:config.item.id,decisions:[{sourceId:'row1',decision:'approved',reason:'原先无重复的记录'}]});
  await pullCollection({root,id:config.item.id,approveRead:true},{call});
  assert.equal(researchEntry(root,config.item.id).data.rows[0].decision,'pending','a newly detected duplicate must be reviewed again');
  assert.ok(researchEntry(root,config.item.id).data.rows[0].flags.includes('duplicate-answers'));
  const unchanged=researchEntry(root,config.item.id).version.id;
  const repeated=async(action)=>action==='get-schema'?schema:{records:[{id:'duplicate',fields:{'数量':10}}],offset:'same'};
  await assert.rejects(pullCollection({root,id:config.item.id,approveRead:true},{call:repeated}),/重复/);
  assert.equal(researchEntry(root,config.item.id).version.id,unchanged);
  const missing=async(action)=>action==='get-schema'?schema:{};
  await assert.rejects(pullCollection({root,id:config.item.id,approveRead:true},{call:missing}),/缺少实际记录/);
});
test('empty WPS tables, stale schemas and software-only rows are handled without inventing actual respondents',async()=>{
  const {root,config,call,setRecords}=await linked('software',{softwareTest:true});
  setRecords(null);const empty=await pullCollection({root,id:config.item.id,approveRead:true},{call});
  assert.deepEqual(researchEntry(root,config.item.id).data.rows,[]);
  assert.throws(()=>adoptCollection({root,expectedRevision:empty.revision,id:config.item.id,confirmActual:true}),/软件测试/);
  setRecords([{id:'qa',fields:{'数量':20,'标记':'SOFTWARE_QA_ONLY_A'}}]);await pullCollection({root,id:config.item.id,approveRead:true},{call});
  assert.equal(researchEntry(root,config.item.id).version.payload.provenance,'synthetic');
  const changed=async()=>({sheets:[{...schema.sheets[0],fields:[{id:'B',name:'数量已改',type:'Number'}]}]});
  await assert.rejects(pullCollection({root,id:config.item.id,approveRead:true},{call:changed}),/字段已变化/);
  await assert.rejects(inspectCollection({root,url:'https://example.com/token',approveRead:true},{call}),/正式文档/);
  await assert.rejects(inspectCollection({root,url,approveRead:false},{call}),/确认/);
});
