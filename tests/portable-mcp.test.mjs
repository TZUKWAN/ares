/** Real SDK clients and real files only. No model, cloud writes or desktop control. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {Client} from '../platforms/shared/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import {StdioClientTransport} from '../platforms/shared/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';
import {createPortableAres,defaultPortableHome} from '../platforms/shared/core.mjs';
import {parsePortableArguments} from '../scripts/ares-mcp.mjs';

const source=dirname(dirname(fileURLToPath(import.meta.url)));
const evidence=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-portable-mcp-'));
const scope={competitionId:1,track:'高教主赛道',edition:'2026',group:''};
console.log('Portable MCP evidence: '+evidence);
function fixture(name) {
  const base=join(evidence,name),root=join(base,'project'),outside=join(base,'outside'),home=join(base,'home');
  mkdirSync(root,{recursive:true});mkdirSync(outside,{recursive:true});return {base,root,outside,home};
}
async function session(f,{clientRoots,explicitRoot=false,modern=false,requireUi=false}={}) {
  const client=new Client({name:'ares-real-protocol-test',version:'1.0.0'}, {
    capabilities:clientRoots?{roots:{listChanged:true}}:{},
    ...(modern?{versionNegotiation:{mode:{pin:'2026-07-28'}}}:{}),
  });
  let roots=clientRoots||[];
  if(clientRoots)client.setRequestHandler('roots/list',async()=>({roots:roots.map(path=>({uri:pathToFileURL(path).href,name:'Owned protocol test project'}))}));
  const env={...process.env};delete env.DSH_HOME;delete env.ARES_ALLOWED_ROOTS;delete env.ARES_HOME;
  const transport=new StdioClientTransport({command:process.execPath,args:[join(source,'scripts/ares-mcp.mjs'),'--host','codex','--home',f.home,requireUi?'--require-ui':'--no-ui',...(explicitRoot?['--root',f.root]:[])],cwd:source,env,stderr:'pipe'});
  let stderr='';transport.stderr?.on('data',chunk=>{stderr+=chunk;});
  await client.connect(transport);
  return {client,transport,get stderr(){return stderr;},async roots(values){roots=values;if(!modern)await client.sendRootsListChanged();},async call(name,args,ok=true){
    const response=await client.callTool({name,arguments:args});
    let value=response.structuredContent;
    if(!value){const message=response.content.find(item=>item.type==='text').text;try{value=JSON.parse(message);}catch{value={message};}}
    if(ok)assert.notEqual(response.isError,true,JSON.stringify(value));else assert.equal(response.isError,true,JSON.stringify(value));
    return value;
  },async close(){await client.close();}};
}

test('portable startup options are explicit and DSH environment is not inherited as a default home',async()=>{
  const options=parsePortableArguments(['--host','zcode','--root',evidence],{DSH_HOME:'C:/never-read-dsh'});
  assert.equal(options.home,undefined);assert.match(defaultPortableHome(options.host),/[\\/]\.ares[\\/]zcode$/);
  assert.throws(()=>parsePortableArguments([],{ARES_ALLOWED_ROOTS:'C:/not-json'}));
  assert.throws(()=>parsePortableArguments(['--root','--home'],{}));
  const f=fixture('home-isolation'),prior=process.env.ARES_HOME;
  const core=createPortableAres({home:f.home,host:'codex',roots:[f.root]});
  await core.ready;await core.dispatch('ares_project',{action:'status',root:f.root});
  assert.equal(process.env.ARES_HOME,prior);assert.equal(existsSync(join(f.home,'ares-mode.json')),true);
  core.dispose();
});

test('real stdio initialize, tools/list, saved workflow, project, actual artifact edit/check/version and owner boundaries',async()=>{
  const f=fixture('protocol-files'),s=await session(f,{explicitRoot:true});
  try {
    const tools=await s.client.listTools();assert.equal(tools.tools.length,9);
    assert.ok(tools.tools.every(row=>row.inputSchema.additionalProperties===false));
    const capabilities=await s.call('ares_capabilities',{});assert.equal(capabilities.dshNativeExecution,false);assert.deepEqual(capabilities.roots,[f.root]);
    const opened=await s.call('ares_workflow',{action:'read',...scope});
    const workflow=structuredClone(opened.workflow);workflow.steps[0].title='本地协议验收文件';
    const saved=await s.call('ares_workflow',{action:'save',...scope,workflow,configuration:opened.configuration,expectedRevision:opened.expectedRevision,expectedWorkflowHash:opened.workflowHash,expectedSkillHashes:opened.skillHashes});
    assert.equal(saved.saved,true);assert.equal(saved.expectedRevision,1);assert.ok(existsSync(join(f.home,'ares-workflows.json')));
    const stale=await s.call('ares_workflow',{action:'save',...scope,workflow,configuration:opened.configuration,expectedRevision:0},false);assert.equal(stale.status,409);
    let project=await s.call('ares_project',{action:'init',root:f.root,name:'ARES本地协议文件验收',...scope,flowMode:'library',workflowId:saved.workflow.id,expectedWorkflowHash:saved.workflowHash,expectedConfigurationRevision:saved.expectedRevision});
    assert.equal(project.workflow.steps[0].title,'本地协议验收文件');assert.equal(project.progress.done,0);
    const step=await s.call('ares_project',{action:'step',root:f.root});assert.equal(step.dshSessionCreated,false);assert.ok(step.instructions.includes(step.step.title));assert.ok(step.skills.length>0);
    const missing=await s.call('ares_project',{action:'check',root:f.root,stepId:step.step.id});assert.equal(missing.passed,false);
    const output=step.step.outputs.find(row=>row.kind==='file'&&row.format==='md');assert.ok(output);
    const path=join(f.root,project.outputDir,output.path);mkdirSync(dirname(path),{recursive:true});
    // A genuine local software-verification artifact, never a fabricated contest result.
    const before='# ARES 本地协议软件验收\n\n本文件记录当前测试进程创建并读取的本地文件，仅用于软件读写检查。\n\n不包含调查样本、赛事结论或在线模型运行结果。\n';
    writeFileSync(path,before,'utf8');
    const view=await s.call('ares_artifact',{action:'read',root:f.root,id:output.id});assert.equal(view.text,before);assert.equal(view.editable,true);
    const after=before+'\n实际通过 MCP 作品保存写入的追加记录。\n';
    const edited=await s.call('ares_artifact',{action:'save',root:f.root,id:output.id,expectedRevision:project.revision,version:view.version,text:after});
    project=edited.project;assert.equal(readFileSync(path,'utf8'),after);assert.equal(project.progress.done,0);
    const conflict=await s.call('ares_artifact',{action:'save',root:f.root,id:output.id,expectedRevision:project.revision,version:view.version,text:'不得覆盖当前文件'},false);assert.equal(conflict.status,409);assert.equal(readFileSync(path,'utf8'),after);
    const checked=await s.call('ares_project',{action:'check',root:f.root,stepId:step.step.id});assert.equal(checked.passed,true);assert.equal(checked.checks[0].sha256,edited.version);
    const history=await s.call('ares_artifact',{action:'history',root:f.root,id:output.id});assert.ok(history.versions.length>=1);
    // Artifact versions identify content; actor attribution lives in the edit event.
    assert.equal(history.versions[0].payload.provenance.kind,'unverified');
    assert.deepEqual(history.acceptedVersionIds,[]);
    const bench=await s.call('ares_version',{action:'list',root:f.root});
    const editEvent=bench.timeline.find(row=>row.payload.type==='artifact.edited');
    assert.deepEqual(editEvent.payload.actor,{kind:'agent',id:'codex-agent'});assert.equal(bench.project.progress.done,0);
    const frozen=await s.call('ares_version',{action:'freeze',root:f.root,expectedRevision:project.revision,kind:'checkpoint',stepIds:[step.step.id],title:'真实本地协议检查快照'});project=frozen.project;
    const read=await s.call('ares_version',{action:'read',root:f.root,releaseId:frozen.release.id});assert.equal(read.id,frozen.release.id);assert.ok(read.payload.files.some(row=>row.sha256===edited.version));
    const owner=await s.call('ares_project',{action:'complete',root:f.root,stepId:step.step.id,expectedRevision:project.revision,review:{summary:'模型不可自行批准',findings:[]}},false);assert.equal(owner.code,'needs-owner');
    const forgery=await s.call('ares_team',{action:'member',root:f.root,expectedRevision:project.revision,name:'未授权更改',principal:'owner'},false);assert.match(forgery.message,/principal|Unrecognized/);
    const native=await s.call('ares_project',{action:'execute-native',root:f.root},false);assert.equal(native.code,'unsupported');
    const cloud=await s.call('ares_collaboration',{action:'publish',root:f.root,expectedRevision:project.revision},false);assert.equal(cloud.code,'needs-owner');
    const denied=await s.call('ares_project',{action:'status',root:f.outside},false);assert.equal(denied.code,'scope-denied');
    const directory=await s.call('ares_artifact',{action:'read',root:f.root,id:output.id,file:'../../outside/secret.txt'},false);assert.equal(directory.isError,undefined);assert.ok(directory.status>=400);
    const current=await s.call('ares_project',{action:'status',root:f.root});assert.equal(current.progress.done,0);
    writeFileSync(join(f.base,'protocol-receipt.json'),JSON.stringify({toolNames:tools.tools.map(row=>row.name),capabilities,checks:checked,releaseId:frozen.release.id,owner,denied,native,artifactPath:path},null,2));
    assert.equal(s.stderr,'');
  } finally {await s.close();}
});

test('actual client roots/list grants and revokes exact roots; no root tool or parameter can enlarge the scope',async()=>{
  const f=fixture('client-roots'),s=await session(f,{clientRoots:[f.root]});
  try {
    let capabilities=await s.call('ares_capabilities',{});assert.deepEqual(capabilities.roots,[f.root]);
    const p=await s.call('ares_project',{action:'status',root:f.root});assert.equal(p.kind,'empty');
    const no=await s.call('ares_project',{action:'status',root:f.outside},false);assert.equal(no.code,'scope-denied');
    const child=join(f.root,'child');mkdirSync(child);assert.equal((await s.call('ares_project',{action:'status',root:child},false)).code,'scope-denied');
    const link=join(f.root,'linked-outside');symlinkSync(f.outside,link,'junction');assert.equal((await s.call('ares_project',{action:'status',root:link},false)).code,'scope-denied');
    await s.roots([]);
    for(let i=0;i<20;i++){capabilities=await s.call('ares_capabilities',{});if(!capabilities.roots.length)break;await pause(10);}
    assert.deepEqual(capabilities.roots,[]);assert.equal((await s.call('ares_project',{action:'status',root:f.root},false)).code,'scope-denied');
    assert.equal(s.stderr,'');
  } finally {await s.close();}
  const blank=await session(f);
  try {assert.deepEqual((await blank.call('ares_capabilities',{})).roots,[]);assert.equal((await blank.call('ares_project',{action:'status',root:f.root},false)).code,'scope-denied');}
  finally {await blank.close();}
});

test('portable core serializes distinct homes and rejects writes to a DSH-bound project without pretending its session is idle',async()=>{
  const a=fixture('core-a'),b=fixture('core-b'),first=createPortableAres({home:a.home,roots:[a.root]}),second=createPortableAres({home:b.home,roots:[b.root]});
  try {
    await Promise.all([first.ready,second.ready]);
    const contexts=await Promise.all([first.dispatch('ares_workflow',{action:'read',...scope}),second.dispatch('ares_workflow',{action:'read',...scope})]);
    await Promise.all(contexts.map((context,index)=>[first,second][index].dispatch('ares_workflow',{action:'save',...scope,workflow:{...context.workflow,title:'独立配置 '+index},configuration:context.configuration,expectedRevision:0})));
    assert.match(JSON.parse(readFileSync(join(a.home,'ares-workflows.json'),'utf8')).workflows.at(-1).title,/0/);
    assert.match(JSON.parse(readFileSync(join(b.home,'ares-workflows.json'),'utf8')).workflows.at(-1).title,/1/);
    const p=await first.dispatch('ares_project',{action:'init',root:a.root,name:'会话边界软件验收',...scope});
    const projectFile=join(a.root,'.ares/project.json'),stored=JSON.parse(readFileSync(projectFile,'utf8'));
    stored.workbench.nodeSession={sessionId:'explicitly-unresolvable-dsh-binding',definitionId:p.definitionId};writeFileSync(projectFile,JSON.stringify(stored));
    await assert.rejects(first.dispatch('ares_project',{action:'facts',root:a.root,expectedRevision:p.revision,facts:{name:'不可写'}}),{code:'unsupported'});
    assert.equal(JSON.parse(readFileSync(projectFile,'utf8')).revision,p.revision);
  } finally {first.dispose();second.dispose();}
});

test('2026-07-28 official protocol client fulfils real roots/list input rounds and root revocation',async()=>{
  const f=fixture('modern-roots'),s=await session(f,{clientRoots:[f.root],modern:true});
  try {
    assert.equal((await s.client.listTools()).tools.length,9);
    const capability=await s.call('ares_capabilities',{});assert.deepEqual(capability.roots,[f.root]);
    assert.equal((await s.call('ares_project',{action:'status',root:f.root})).kind,'empty');
    await s.roots([]);
    assert.equal((await s.call('ares_project',{action:'status',root:f.root},false)).code,'scope-denied');
    assert.equal(s.stderr,'');
  } finally {await s.close();}
});

test('required UI resources are real local bytes and the modern workbench entry keeps roots and owner boundaries',async()=>{
  const f=fixture('ui-resources'),s=await session(f,{explicitRoot:true,requireUi:true});
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const receipt={serverVersion:null,html:null,media:[],uiRootChecks:null};
  try {
    receipt.serverVersion=s.client.getServerVersion().version;assert.equal(receipt.serverVersion,'2.4.0');
    const tools=await s.client.listTools(),entry=tools.tools.find(row=>row.name==='ares_workbench');
    assert.ok(entry);assert.equal(entry._meta.ui.resourceUri,'ui://ares/workbench.html');
    const resources=await s.client.listResources();
    assert.ok(resources.resources.some(row=>row.uri==='ui://ares/workbench.html'));
    assert.ok(resources.resources.some(row=>row.uri==='ares://media/index'));
    const html=await s.client.readResource({uri:'ui://ares/workbench.html'}),page=html.contents.find(row=>typeof row.text==='string');
    const actual=readFileSync(join(source,'platforms/ui/workbench.html'));
    assert.equal(page.mimeType,'text/html;profile=mcp-app');assert.equal(Buffer.byteLength(page.text),actual.length);assert.equal(sha(Buffer.from(page.text)),sha(actual));
    assert.ok(actual.length>1000000);assert.ok(page.text.includes('ARES'));assert.ok(page.text.includes('ares://media/index'));
    assert.deepEqual(page._meta.ui.csp.connectDomains,[]);assert.deepEqual(page._meta.ui.csp.resourceDomains,[]);
    receipt.html={bytes:actual.length,sha256:sha(actual),uri:page.uri};
    const indexResponse=await s.client.readResource({uri:'ares://media/index'}),index=JSON.parse(indexResponse.contents[0].text);
    assert.deepEqual(index.files.map(row=>row.file).sort(),['jellyfish.jpg','jellyfish.mp4','orb.jpg','orb.mp4']);
    for(const media of index.files) {
      const chunks=[];
      for(const uri of media.chunks) {
        assert.ok(resources.resources.some(row=>row.uri===uri));
        const response=await s.client.readResource({uri}),item=response.contents[0];
        assert.equal(item.uri,uri);assert.equal(item.mimeType,media.mimeType);
        const bytes=Buffer.from(item.blob,'base64');assert.ok(bytes.length<=512*1024);chunks.push(bytes);
      }
      const bytes=Buffer.concat(chunks),sourceBytes=readFileSync(join(source,'assets/neural-reference',media.file));
      assert.equal(bytes.length,media.bytes);assert.equal(bytes.length,sourceBytes.length);assert.equal(sha(bytes),media.sha256);assert.equal(sha(bytes),sha(sourceBytes));
      receipt.media.push({file:media.file,bytes:bytes.length,sha256:sha(bytes),parts:chunks.length});
    }
    assert.equal(s.stderr,'');
  } finally {await s.close();}
  const modern=await session(f,{clientRoots:[f.root],modern:true,requireUi:true});
  try {
    // This is the first tool call: the UI entry itself must fulfil real roots/list.
    const opened=await modern.call('ares_workbench',{root:f.root,workspace:'composer'});
    assert.equal(opened.root,f.root);assert.equal(opened.workspace,'composer');assert.deepEqual(opened.roots,[f.root]);
    const denied=await modern.call('ares_workbench',{root:f.outside},false);assert.equal(denied.code,'scope-denied');
    const forged=await modern.call('ares_workbench',{root:f.root,principal:'owner'},false);assert.match(forged.message,/principal|Unrecognized/);
    const owner=await modern.call('ares_plan',{action:'save',root:f.root,expectedRevision:0,steps:[]},false);assert.equal(owner.code,'needs-owner');
    await modern.roots([]);
    const revoked=await modern.call('ares_workbench',{root:f.root},false);assert.equal(revoked.code,'scope-denied');
    receipt.uiRootChecks={opened,denied,owner,revoked};assert.equal(modern.stderr,'');
  } finally {await modern.close();}
  writeFileSync(join(f.base,'ui-protocol-receipt.json'),JSON.stringify(receipt,null,2));
});
