/** Actual client/client.js, React portals, app.js, editor-session.js and real
 * production editor routes/storage. DSH create/retain/provider/input services are
 * explicit metadata/transport boundary fixtures. No model prompt is sent. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable,Writable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createRoutes} from '../host/routes.js';
import {createEditorWorkspace} from '../host/editor-workspace.js';
import {createNodeExecution} from '../host/node-execution.js';
import {EDITOR_PRESET_ID} from '../host/editor-definition.js';
import {initializeProject,linkRoot,changeProject,readProject} from '../host/projects.js';
import {competitionCatalog,readConfiguration,saveConfiguration,configPath} from '../host/catalog.js';
import {reactBrowserRuntime} from './helpers/react-browser-runtime.mjs';
import {nativeThemeSurface} from './helpers/native-theme-surface.mjs';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-native-two-workspaces-'));
process.env.ARES_HOME=join(base,'home');
saveConfiguration(readConfiguration(),0);
const root=join(base,'project');mkdirSync(root);linkRoot(root);
let project=initializeProject({root,name:'双工作区原生挂载验证 · 非竞赛成果',competitionId:5,
  track:competitionCatalog().find(row=>row.id===5).tracks[0].track,workflowId:'modeling'});
const projectSession='native-two-project-protocol',projectPreset='native-two-project-preset';
project=changeProject({root,expectedRevision:project.revision},value=>value.workbench.nodeSession={sessionId:projectSession,presetId:projectPreset,definitionId:project.definitionId});
mkdirSync(join(root,project.outputDir),{recursive:true});
writeFileSync(join(root,project.outputDir,'inventory.md'),'# 真实本地验证文件\n\n仅验证双工作区与原生Portal，未执行在线模型任务。\n');
const projectBytes=readFileSync(join(root,'.ares/project.json')),configurationBytes=readFileSync(configPath());
const agents=new Map(),created=[];
function registerSession(id,cwd,preset){
  const agent={id,status:'idle',inbox:{nextTurn:[],nextStep:[]},session:{header:{id,cwd,agentPreset:preset},snapshotEvents:()=>[]}};
  agents.set(id,agent);return agent;
}
registerSession(projectSession,root,projectPreset);
let nodeService;
const ctx={get(name){
  if(name==='agents')return {get:id=>agents.get(id),list:()=>[...agents.values()],isOwnedBy:()=>false};
  if(name==='jobs')return {list:()=>[]};
  if(name==='tools')return {schemas:()=>[{name:'read'},{name:'write'},{name:'ares_project'},{name:'ares_config_read'},{name:'ares_config_edit'}]};
  if(name==='sessionController')return {
    create(){assert.fail('The project seat is already bound; no real native creation is allowed');},
    prompt(){assert.fail('This UI verification must not send a model prompt');},
    inspect(id){const agent=agents.get(id);if(!agent)throw Error('Unknown explicit session fixture');return {meta:{...agent.session.header},events:[]};},
    resolveAgent:async id=>({agent:agents.get(id)})};
  if(name==='aresNodeExecution')return nodeService;
}};
const native={capability:()=>({available:true,source:'explicit-native-metadata-boundary-fixture'}),
  forEditor:async()=>EDITOR_PRESET_ID,forProject:async()=>projectPreset,
  inspectEditorTools:async agent=>({ready:true,pending:false,visibleCount:5,missing:[],sessionId:agent.id,source:'explicit-native-tool-metadata-boundary-fixture'})};
nodeService=createNodeExecution(ctx,native);
const editor=createEditorWorkspace(ctx,native),server=createRoutes(ctx,native,editor,{standalone:true});
const origin='http://127.0.0.1:64351',errors=[],external=[],requests=[];
const runtime=reactBrowserRuntime(process.env.ARES_REACT_TEST_MODULES),surface=nativeThemeSurface(process.env.ARES_NATIVE_CONVERSATION_SOURCE);
const {chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);let browser;
before(async()=>browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}));
after(async()=>{server.dispose();nodeService.dispose();editor.dispose();await browser?.close();});

async function productionRequest(path,data,headers){
  const url='/ares/api/v2/'+path,route=server.routes.find(row=>row.path===url.split('?')[0]);
  if(!route)throw Error('Missing actual route: '+url);
  const request=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);
  request.method=data===undefined?'GET':'POST';request.url=url;request.headers={...headers,host:new URL(origin).host,'content-type':'application/json'};request.socket={remoteAddress:'127.0.0.1'};
  const chunks=[];let status=200,responseHeaders={},finish;
  const ended=new Promise(resolve=>finish=resolve),response=new Writable({write(chunk,_encoding,next){chunks.push(Buffer.from(chunk));next();},final(next){next();finish();}});
  response.headersSent=false;response.writeHead=(code,next={})=>{status=code;responseHeaders=next;response.headersSent=true;};
  await route.handler(request,response);await ended;return {status,headers:responseHeaders,body:Buffer.concat(chunks)};
}

const harness=`
const React=window.ownedReact,h=React.createElement,registered={},Session=React.createContext(null);let Main;
window.portalProof={retains:[],releases:[],creates:[],layouts:[],attempts:0,prompts:0};
window.__ModuleLoader__={load(descriptor){
 const plugin=descriptor.factory(name=>name==='react'?React:name==='react-dom'?window.ownedReactDOM:name==='@deepseek-ai/dsh-client-ui-conversation'?{conversationPhase:()=> 'blank'}:(()=>{throw Error('Unexpected dependency '+name)})());
 const shells=new WeakMap(),bindings=new Map();
 const services={conversation:{input:{for(context){if(!shells.has(context))shells.set(context,{core:{beginAttempt(){portalProof.attempts++;return {signal:new AbortController().signal};}},deps:{defaultSink(){throw Error('Native boundary UI verification never sends');}}});return shells.get(context);}},sendSession(){throw Error('Native boundary UI verification never sends');}},
  sessions:{async create(options){portalProof.creates.push(structuredClone(options));const response=await fetch('/owned-native-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(options)});if(!response.ok)throw Error('Metadata boundary registration failed');return (await response.json()).sessionId;},
   retain(id){portalProof.retains.push(id);if(!bindings.has(id))bindings.set(id,{sessionId:id,ctx:{effect(fn){fn();}},session:{beginSubmission(){return {requestId:crypto.randomUUID(),abandon(){}};},prompt(){portalProof.prompts++;throw Error('No model prompt is permitted');}}});
    return {id,sessionId:id,ready:Promise.resolve(bindings.get(id)),release(){portalProof.releases.push(id);}};}}};
 plugin.apply({inject(names,fn){const scope={effect(){}};for(const name of names)scope[name]=services[name];fn(scope);},slots:{inject(_name,fn){fn();},register(descriptor,view){if(descriptor.name==='main')Main=view;else registered[descriptor.name]=view;return()=>{};}}});
}};
function Provider({session,children}){return h(Session.Provider,{value:session},children);}
function Slot({name,manager,hint,layout,inputContextReady}){
 const lease=React.useContext(Session),[draft,setDraft]=React.useState(''),actions=React.useMemo(()=>({setDraft}),[]);
 const session=React.useMemo(()=>({id:lease.id,sessionId:lease.id,openState:'open',running:false}),[lease.id]);
 const view=registered[name],kind=manager.kind==='project'?'项目':'编排';
 return h(view,{manager,hint,layout,inputContextReady,useSession:select=>select(session),useConversation:select=>select({}),inputActions:actions,
  renderFactorySlot(slot,args){portalProof.layouts.push({slot,args,kind,sessionId:lease.id});return h('div',{'data-conversation-content':''},
   h('div',{'data-conversation-scroll':''},h('small',{className:'native-two-proof'},'原生Portal协议验证 · 会话服务为边界夹具 · 未请求模型')),
   h('div',{'data-composer-seat':''},h('div',{className:'GRgSLq_root'},h('div',{className:'GRgSLq_card','data-composer-card':true},
    h('textarea',{className:'GRgSLq_input','data-composer-input':true,'aria-label':kind+'原生协议输入',value:draft,onInput:event=>setDraft(event.currentTarget.value),placeholder:'输入目标，或调用工具…'}),
    h('div',{className:'GRgSLq_row'},h('button',{className:'GRgSLq_add',type:'button'},'+'),h('div',{className:'GRgSLq_trailing'},h('span',null,'原生服务边界验证'),h('button',{className:'GRgSLq_primary',disabled:true,'aria-label':'验证不发送'},'↑')))))));}});
}
window.mountNative=()=>window.ownedReactDOMClient.createRoot(document.querySelector('#native-root')).render(h(Main,{SessionProvider:Provider,renderSlot:(name,props)=>h(Slot,{...props,name})}));
`;

test('actual client and React portals retain both project and competition composer sessions while real editor context follows unsaved step changes',async()=>{
 const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});page.setDefaultTimeout(16000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){external.push(url.href);await route.abort();return;}
  if(url.pathname==='/'){
   await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>html,body,#native-root{margin:0;width:100%;height:100%}.native-two-proof{font:10px/1.7 sans-serif;color:#6f93ae}[data-composer-input]{resize:none;background:transparent;border:0;min-height:65px;width:100%}</style><style>'+surface.css+'</style></head><body><div id="native-root"></div><script src="/owned-react.js"></script><script>'+harness+'</script><script src="/owned-client.js"></script><script>mountNative()</script></body></html>'});return;
  }
  if(url.pathname==='/owned-react.js'){await route.fulfill({contentType:'text/javascript',body:runtime});return;}
  if(url.pathname==='/owned-client.js'){await route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../client/client.js',import.meta.url),'utf8')});return;}
  const data=request.postData()?JSON.parse(request.postData()):undefined;
  if(url.pathname==='/owned-native-session'){
   assert.deepEqual(Object.keys(data).sort(),['agentPreset','cwd']);assert.equal(data.agentPreset,EDITOR_PRESET_ID);assert.ok(data.cwd.startsWith(process.env.ARES_HOME));
   const id='owned-editor-boundary-'+randomUUID();registerSession(id,data.cwd,data.agentPreset);created.push({id,...data});
   await route.fulfill({contentType:'application/json',body:JSON.stringify({sessionId:id})});return;
  }
  if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';
  const path=url.pathname.slice('/ares/api/v2/'.length);if(data)requests.push({path,data:structuredClone(data)});
  const response=await productionRequest(path+url.search,data,request.headers());
  await route.fulfill({status:response.status,headers:response.headers,body:response.body});
 });
 try{
  await page.goto(origin);
  await page.getByLabel('项目原生协议输入',{exact:true}).waitFor({state:'visible'});
  await page.getByLabel('项目原生协议输入',{exact:true}).fill('项目原生输入草稿，切换后保留，不发送。');
  await page.evaluate(()=>window.keptProjectInput=document.querySelector('[aria-label="项目原生协议输入"]'));
  await page.screenshot({path:join(base,'native-project.png')});
  await page.locator('[data-action=workspace][data-id=composer]').click();
  await page.getByLabel('选择比赛',{exact:true}).selectOption('5');
  await page.getByLabel('步骤名称',{exact:true}).waitFor();
  await page.waitForFunction(()=>Number(document.querySelector('.ares-composer-editor')?.dataset.competitionId)===5&&document.querySelector('.ares-composer-editor')?.getAttribute('aria-busy')==='false');
  await page.getByLabel('编排原生协议输入',{exact:true}).waitFor({state:'visible'});
  await page.getByLabel('编排原生协议输入',{exact:true}).fill('编排原生输入草稿，切换后保留，不发送。');
  await page.evaluate(()=>window.keptEditorInput=document.querySelector('[aria-label="编排原生协议输入"]'));
  assert.equal(created.length,1);const editorAgent=agents.get(created[0].id);
  assert.equal(await page.getByText('选择工作区',{exact:true}).count(),0);
  const second=page.locator('.ares-composer-editor .ares-step').nth(1),stepId=await second.getAttribute('data-id');
  await second.click();
  const goal='双工作区原生Portal验证中的未保存步骤目标，非竞赛成果。';
  const responsePromise=page.waitForResponse(response=>response.url().includes('/assistant/context')&&response.request().postData()?.includes(goal)&&response.status()===200);
  await page.getByLabel('本步目标',{exact:true}).fill(goal);await responsePromise;
  const context=await editor.read(editorAgent,{kind:'context'}),step=await editor.read(editorAgent,{kind:'step'}),flow=await editor.read(editorAgent,{kind:'workflow'});
  assert.equal(context.activeStepId,stepId);assert.equal(step.step.id,stepId);assert.equal(step.step.objective,goal);
  assert.equal(flow.workflow.id,context.workflowId);assert.equal(flow.workflow.competitionScope.competitionId,5);
  const latest=requests.filter(row=>row.path==='assistant/context').at(-1);
  assert.equal(latest.data.workflowId,context.workflowId);assert.equal(latest.data.activeStepId,stepId);
  assert.equal(latest.data.configuration.workflows.find(row=>row.id===context.workflowId).steps.find(row=>row.id===stepId).objective,goal);
  await page.screenshot({path:join(base,'native-composer-unsaved.png')});
  for(let i=0;i<2;i++){
   await page.locator('[data-action=workspace][data-id=projects]').click();
   await page.getByLabel('项目原生协议输入',{exact:true}).waitFor({state:'visible'});
   assert.equal(await page.getByLabel('项目原生协议输入',{exact:true}).inputValue(),'项目原生输入草稿，切换后保留，不发送。');
   assert.equal(await page.evaluate(()=>window.keptProjectInput===document.querySelector('[aria-label="项目原生协议输入"]')),true);
   await page.locator('[data-action=workspace][data-id=composer]').click();
   await page.getByLabel('编排原生协议输入',{exact:true}).waitFor({state:'visible'});
   assert.equal(await page.getByLabel('编排原生协议输入',{exact:true}).inputValue(),'编排原生输入草稿，切换后保留，不发送。');
   assert.equal(await page.evaluate(()=>window.keptEditorInput===document.querySelector('[aria-label="编排原生协议输入"]')),true);
   assert.equal(await page.getByLabel('本步目标',{exact:true}).inputValue(),goal);
  }
  const proof=await page.evaluate(()=>window.portalProof);
  assert.equal(proof.creates.length,1);assert.equal(proof.retains.filter(id=>id===projectSession).length,1);
  assert.equal(proof.retains.filter(id=>id===created[0].id).length,1);assert.deepEqual(proof.releases,[]);
  assert.equal(proof.prompts,0);assert.equal(proof.attempts,0);
  assert.ok(proof.layouts.some(row=>row.kind==='项目'&&row.args.hero===false&&row.args.variant==='embedded'));
  assert.ok(proof.layouts.some(row=>row.kind==='编排'&&row.args.hero===false&&row.args.variant==='embedded'));
  assert.deepEqual(readFileSync(configPath()),configurationBytes);assert.deepEqual(readFileSync(join(root,'.ares/project.json')),projectBytes);
  assert.equal(readProject(root).progress.done,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  writeFileSync(join(base,'native-two-workspace-evidence.json'),JSON.stringify({mode:'Actual ARES client/client.js + React Portal + production editor workspace endpoints. Native session/provider/input/tool-surface metadata are explicit boundary fixtures; no model prompt, cloud or user DSH operation.',proof,created,editorContext:context,unsavedStep:step.step,requestPaths:requests.map(row=>row.path),nativeCss:surface.provenance,errors,external},null,2));
  console.log('NATIVE_TWO_WORKSPACE_EVIDENCE',base);
 }catch(error){writeFileSync(join(base,'failure.json'),JSON.stringify({message:error.message,errors,external,requests:requests.map(row=>({path:row.path,workflowId:row.data?.workflowId,activeStepId:row.data?.activeStepId})),body:await page.locator('body').textContent()},null,2));await page.screenshot({path:join(base,'failure.png')});throw error;}
 finally{await page.close();}
});
