import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRoutes} from '../host/routes.js';
import {registerRuntimeWorkbench} from '../host/runtime-workbench.js';
import {createPortableAres} from '../platforms/shared/core.mjs';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {researchEntry} from '../host/project-research.js';
import {artifactHistory} from '../host/project-workbench.js';
import {makeQuestion} from '../client/research-survey-model.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-research-admission-'));
process.env.ARES_HOME=join(base,'home');
const root=join(base,'project');mkdirSync(root);linkRoot(root);
const comp=competitionCatalog().find(c=>c.id===5);
const project=initializeProject({root,name:'研究项目门禁软件验收',competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'});
const proposal={schemaVersion:1,title:'研究工具上手情况',study:'比较首次使用的查找和操作体验',
  pages:[{id:'screen',title:'使用体验',questions:[makeQuestion('likert','find','find','我知道从哪里打开研究工具。')]}]};

test('real owner routes bind exact research versions and stage checked output without elevating acceptance',async t=>{
  const ctx={get:name=>name==='connection'?{admit:req=>req.headers.authorization==='Case owner'?{peer:{principal:{kind:'owner'}}}:
    req.headers.authorization==='Case guest'?{peer:{principal:{kind:'guest'}}}:{rejection:401}}:null};
  const api=createRoutes(ctx),routes=new Map(api.routes.map(row=>[row.path,row.handler]));
  const listener=createServer((req,res)=>routes.get(req.url.split('?')[0])?.(req,res));
  listener.listen(0,'127.0.0.1');await once(listener,'listening');t.after(()=>{api.dispose();listener.close();});
  const url='http://127.0.0.1:'+listener.address().port+'/ares/api/v2/research/';
  async function post(path,body,headers={}){
    const result=await fetch(url+path,{method:'POST',headers:{authorization:'Case owner','content-type':'application/json',
      connection:'close',...headers},body:JSON.stringify(body)});
    return {status:result.status,body:await result.json()};
  }
  assert.equal((await post('survey/save',{root,definition:proposal},{authorization:'Case guest'})).status,403);
  assert.equal((await post('interview/upload',{}, {authorization:''})).status,401);
  assert.equal((await post('dataset/search',{provider:'hf',query:'software',root,expectedRevision:0})).status,403);
  assert.equal((await post('survey/save',{root,definition:proposal},{origin:'https://unrelated.invalid'})).status,403);
  assert.equal(readProject(root).revision,0);
  const saved=await post('survey/save',{root,definition:proposal,expectedRevision:0});
  assert.equal(saved.status,200);
  const {item,version,revision}=saved.body;
  const step=project.workflow.steps[0],artifact=step.outputs.find(row=>row.kind==='file'&&row.format==='md');
  const binding=await post('bind',{root,id:item.id,versionId:version.id,stepId:step.id,expectedRevision:revision});
  assert.equal(binding.status,200);
  const next=await post('survey/save',{root,id:item.id,baseVersion:version.id,definition:{...proposal,title:'修改后的研究问卷'},expectedRevision:binding.body.revision});
  assert.equal(next.status,200);
  const work={root,id:item.id,versionId:version.id,format:'md',stepId:step.id,artifactId:artifact.id,expectedRevision:next.body.revision};
  const staged=await post('work-draft',work);
  assert.equal(staged.status,200,JSON.stringify(staged.body));
  assert.equal(staged.body.tasksAutoCompleted,false);
  const history=artifactHistory(root,artifact.id);
  assert.deepEqual(history.acceptedVersionIds,[]);
  assert.equal(history.versions[0].payload.provenance.versionId,version.id);
  assert.match(readFileSync(join(root,staged.body.path),'utf8'),/^# 研究工具上手情况/);
  assert.equal(researchEntry(root,item.id).item.bindings[0].versionId,version.id);
  const duplicate=await post('work-draft',{...work,expectedRevision:staged.body.revision});
  assert.equal(duplicate.status,409);
  assert.equal(readProject(root).progress.done,0);
  const mime=await fetch(url+'index?'+new URLSearchParams({root}),{headers:{authorization:''}});
  assert.equal(mime.status,401);
  const caller=await fetch(url+'index?'+new URLSearchParams({root}),{headers:{authorization:'Case owner'}});
  const registry=await caller.json();
  assert.equal(registry.tools.length,8);
  assert.ok(registry.history.some(row=>row.type==='research.artifact-draft'));
});

test('native and portable assistant contracts save pending proposals inside their scoped actual project',async t=>{
  const tools=new Map(),p=readProject(root),exec={agent:{id:'explicit-protocol-test',session:{header:{cwd:root}}}};
  registerRuntimeWorkbench({}, {id:p.definitionId},tool=>tools.set(tool.name,tool));
  const native=tools.get('ares_workbench');
  const view=JSON.parse(await native.execute({action:'research'},exec));
  const saved=JSON.parse(await native.execute({action:'research-proposal',proposalKind:'survey',design:proposal,expectedRevision:view.revision},exec));
  assert.equal(saved.item.status,'proposal');assert.equal(saved.version.payload.actor.kind,'agent');
  assert.equal(researchEntry(root,saved.item.id).item.status,'proposal');
  const portable=createPortableAres({home:join(base,'portable'),host:'software-protocol',roots:[root]});
  t.after(()=>portable.dispose());await portable.ready;
  assert.equal((await portable.dispatch('ares_project',{root,action:'research'})).projectId,p.id);
  const add=await portable.dispatch('ares_project',{root,action:'research-proposal',proposalKind:'survey',design:proposal,expectedRevision:saved.revision});
  assert.equal(add.item.status,'proposal');assert.equal(add.version.payload.actor.id,'software-protocol-agent');
  const outside=join(base,'different');mkdirSync(outside);
  await assert.rejects(portable.dispatch('ares_project',{action:'research',root:outside}),/范围|未获宿主/);
  assert.equal(readProject(root).progress.done,0);
});
