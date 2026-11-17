import './helpers/environment.mjs';
/** Neural UI integration using actual client/client.js, React DOM portals,
 * actual ARES assets and production routes/editor/storage. Native session
 * create/retain/provider/input and tool metadata are explicit ABI fixtures.
 * They never send a model prompt, execute tools or operate a user's DSH window.
 * Saves and project creation below write only this test's owned temporary home. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable,Writable} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {createRoutes} from '../host/routes.js';
import {createEditorWorkspace} from '../host/editor-workspace.js';
import {createNodeExecution} from '../host/node-execution.js';
import {EDITOR_PRESET_ID} from '../host/editor-definition.js';
import {initializeProject,linkRoot,changeProject,readProject} from '../host/projects.js';
import {competitionCatalog,readConfiguration,saveConfiguration,configPath} from '../host/catalog.js';
import {reactBrowserRuntime} from './helpers/react-browser-runtime.mjs';
import {nativeThemeSurface} from './helpers/native-theme-surface.mjs';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-neural-native-'));
process.env.ARES_HOME=join(base,'home');
saveConfiguration(readConfiguration(),0);
const root=join(base,'project');mkdirSync(root);linkRoot(root);
let project=initializeProject({root,name:'神经网络界面与原生聊天验证 · 非竞赛成果',competitionId:5,
  track:competitionCatalog().find(row=>row.id===5).tracks[0].track,workflowId:'modeling'});
const projectSession='neural-project-protocol',projectPreset='neural-project-preset';
project=changeProject({root,expectedRevision:project.revision},value=>value.workbench.nodeSession={sessionId:projectSession,presetId:projectPreset,definitionId:project.definitionId});
mkdirSync(join(root,project.outputDir),{recursive:true});
writeFileSync(join(root,project.outputDir,'inventory.md'),'# 真实本地验证文件\n\n仅验证神经网络界面、作品详情与原生Portal，未执行在线模型任务。\n');
const projectBytes=readFileSync(join(root,'.ares/project.json')),configurationBytes=readFileSync(configPath());
const agents=new Map(),created=[],projectCreated=[],visualProof=[];let allowedNewRoot=null;
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
    create(options){
      assert.ok(allowedNewRoot,'No project creation metadata was authorized by this owned test');
      assert.equal(options.cwd,allowedNewRoot);assert.equal(options.agentPreset,projectPreset);
      const id='neural-new-project-protocol-'+randomUUID();registerSession(id,options.cwd,options.agentPreset);
      projectCreated.push({id,...options,source:'explicit-native-session-metadata-boundary-fixture'});return {sessionId:id};
    },
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
const origin='http://127.0.0.1:64359',errors=[],external=[],requests=[];
const runtime=reactBrowserRuntime(process.env.ARES_REACT_TEST_MODULES),surface=nativeThemeSurface(process.env.ARES_NATIVE_CONVERSATION_SOURCE);
const {chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);let browser;
const assetHashes=()=>Object.fromEntries(['client.js','app.js','editor-session.js','project-session.js','style.css','neural-scene.js','neural-theme.css','workshop-scene.js'].map(name=>[name,createHash('sha256').update(readFileSync(new URL('../client/'+name,import.meta.url))).digest('hex')]));
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
    const editorFailure=window.failNextAresEditorRetain&&id.startsWith('owned-editor-boundary-'),projectFailure=window.failNextAresProjectRetain&&id==='neural-project-protocol',fail=editorFailure||projectFailure;if(editorFailure)window.failNextAresEditorRetain=false;if(projectFailure)window.failNextAresProjectRetain=false;
    return {id,sessionId:id,ready:fail?Promise.reject(Error('Explicit native lease recovery fixture')):Promise.resolve(bindings.get(id)),release(){portalProof.releases.push(id);}};}}};
 plugin.apply({inject(names,fn){const scope={effect(){}};for(const name of names)scope[name]=services[name];fn(scope);},slots:{inject(_name,fn){fn();},register(descriptor,view){if(descriptor.name==='main')Main=view;else registered[descriptor.name]=view;return()=>{};}}});
}};
function Provider({session,children}){return h(Session.Provider,{value:session},children);}
function Slot({name,manager,hint,layout,inputContextReady}){
 (window.ownedAresManagers??={})[manager.kind]=manager;
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

async function residentInput(page,kind,reference,stage){
 const input=page.getByLabel(kind+'原生协议输入',{exact:true});await input.waitFor({state:'visible'});
 assert.equal(await page.locator('.galaxy-chat [data-action=chat-collapse]').count(),0,stage+' assistant remains resident without a collapse control');
 const info=await input.evaluate((node,{reference})=>{
  const r=node.getBoundingClientRect(),chat=node.closest('.galaxy-chat'),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
  return {connected:node.isConnected,same:window[reference]===node,inert:!!node.closest('[inert]'),
   inChat:!!chat,chatMode:chat?.dataset.chatMode,hit:at===node,rect:{x:r.x,y:r.y,width:r.width,height:r.height},
   viewport:{width:innerWidth,height:innerHeight},background:chat?getComputedStyle(chat).backgroundColor:null};
 },{reference});
 assert.equal(info.connected,true,stage);assert.equal(info.same,true,stage);assert.equal(info.inert,false,stage);
 assert.equal(info.inChat,true,stage);assert.equal(info.hit,true,stage+' native composer must be unobstructed');
 assert.equal(info.chatMode,kind==='项目'?'project':'editor',stage);
 assert.ok(info.rect.width>=200&&info.rect.height>=40,stage+' native composer has useful dimensions');
 assert.ok(info.rect.x>=0&&info.rect.y>=0&&info.rect.x+info.rect.width<=info.viewport.width+1&&info.rect.y+info.rect.height<=info.viewport.height+1,stage+' native composer is within viewport');
 await input.click();assert.equal(await input.evaluate(node=>document.activeElement===node),true,stage+' native composer receives real pointer focus');
 visualProof.push({stage,kind,...info});return input;
}

async function neutralTheme(page,stage){
 await page.waitForFunction(()=>{const root=document.querySelector('.ares-app');return root&&getComputedStyle(root).getPropertyValue('--ui-bg').trim();});
 const theme=await page.evaluate(()=>{
  const root=document.querySelector('.ares-app'),style=getComputedStyle(root),value=style.getPropertyValue('--ui-bg').trim();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
  if(value){ctx.fillStyle=value;ctx.fillRect(0,0,1,1);}
  return {value,pixel:[...ctx.getImageData(0,0,1,1).data],className:root.className,background:style.backgroundColor};
 });
 assert.ok(theme.value,stage+' actual neural theme variable is present');
 const rgb=theme.pixel.slice(0,3);assert.ok(Math.max(...rgb)-Math.min(...rgb)<=18,stage+' uses a neutral rather than blue background');
 assert.ok(Math.max(...rgb)<=40&&theme.pixel[3]===255,stage+' uses an opaque dark background');
 visualProof.push({stage,theme});
}

test('neural UI retains actual native chat portals through focused steps, workpiece expansion and both workspaces, then really saves and adopts a competition workflow',async()=>{
 const sourceHashes=assetHashes();
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
  await page.locator('[data-neural-scene=true][data-neural-intro=complete]').waitFor();
  await page.locator('[data-neural-scene=true] canvas.ff-gl').waitFor();
  assert.ok(await page.locator('[data-neural-scene=true] canvas.ff-gl').evaluate(node=>node.width>0&&node.height>0));
  assert.equal(await page.locator('[data-neural-scene=true]').getAttribute('data-renderer'),'reference-video-canvas');
  await neutralTheme(page,'project');await residentInput(page,'项目','keptProjectInput','project');
  await page.screenshot({path:join(base,'neural-project.png')});
  const firstStep=project.workflow.steps[0].id;
  await page.locator('.process-step[data-process-step="'+firstStep+'"]').click();
  await page.locator('[data-neural-focus]').waitFor({state:'visible'});
  await residentInput(page,'项目','keptProjectInput','focused-step');
  await page.locator('[data-neural-focus] [data-action=nebula-node-open]').click();
  await page.getByRole('dialog',{name:project.workflow.steps[0].title,exact:true}).waitFor();
  await residentInput(page,'项目','keptProjectInput','step-details');
  assert.equal(await page.getByLabel('项目原生协议输入',{exact:true}).inputValue(),'项目原生输入草稿，切换后保留，不发送。');
  await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
  await page.locator('[data-neural-scene=true] .neural-output[data-action=project-artifact-select]').first().click();
  await page.locator('[data-neural-scene=true][data-phase=note]').waitFor();
  await page.locator('.ff-right [data-document-body]').getByRole('heading',{name:'真实本地验证文件',exact:true}).waitFor();
  await residentInput(page,'项目','keptProjectInput','selected-workpiece-preview');
  await page.screenshot({path:join(base,'neural-selected-workpiece.png')});
  await page.locator('.ff-right [data-action=work-preview-expand]').first().click();
  const workpiece=page.locator('.galaxy-console[data-galaxy-panel=workpiece]');await workpiece.waitFor({state:'visible'});
  await workpiece.locator('[data-document-body]').getByRole('heading',{name:'真实本地验证文件',exact:true}).waitFor();
  await neutralTheme(page,'workpiece');await residentInput(page,'项目','keptProjectInput','expanded-workpiece');
  assert.equal(await page.getByLabel('项目原生协议输入',{exact:true}).inputValue(),'项目原生输入草稿，切换后保留，不发送。');
  await page.screenshot({path:join(base,'neural-workpiece-chat.png')});
  await page.setViewportSize({width:1280,height:950});
  await residentInput(page,'项目','keptProjectInput','expanded-workpiece-1280');
  await page.screenshot({path:join(base,'neural-workpiece-chat-1280.png')});
  await page.setViewportSize({width:1920,height:1080});
  await page.getByRole('button',{name:'返回项目',exact:true}).click();
  await residentInput(page,'项目','keptProjectInput','project-after-workpiece');
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
  const goal='神经网络双工作区验证中的未保存步骤目标，非竞赛成果。';
  const responsePromise=page.waitForResponse(response=>response.url().includes('/assistant/context')&&response.request().postData()?.includes(goal)&&response.status()===200);
  await page.getByLabel('本步目标',{exact:true}).fill(goal);await responsePromise;
  const context=await editor.read(editorAgent,{kind:'context'}),step=await editor.read(editorAgent,{kind:'step'}),flow=await editor.read(editorAgent,{kind:'workflow'});
  assert.equal(context.activeStepId,stepId);assert.equal(step.step.id,stepId);assert.equal(step.step.objective,goal);
  assert.equal(flow.workflow.id,context.workflowId);assert.equal(flow.workflow.competitionScope.competitionId,5);
  const latest=requests.filter(row=>row.path==='assistant/context').at(-1);
  assert.equal(latest.data.workflowId,context.workflowId);assert.equal(latest.data.activeStepId,stepId);
  assert.equal(latest.data.configuration.workflows.find(row=>row.id===context.workflowId).steps.find(row=>row.id===stepId).objective,goal);
  await neutralTheme(page,'composer');await residentInput(page,'编排','keptEditorInput','composer-unsaved');
  await page.screenshot({path:join(base,'neural-composer-unsaved.png')});
  await page.setViewportSize({width:1280,height:950});
  await residentInput(page,'编排','keptEditorInput','composer-1280');
  await page.screenshot({path:join(base,'neural-composer-1280.png')});
  await page.setViewportSize({width:1920,height:1080});
  for(let i=0;i<2;i++){
   await page.locator('[data-action=workspace][data-id=projects]').click();
   await page.getByLabel('项目原生协议输入',{exact:true}).waitFor({state:'visible'});
   assert.equal(await page.getByLabel('项目原生协议输入',{exact:true}).inputValue(),'项目原生输入草稿，切换后保留，不发送。');
   assert.equal(await page.evaluate(()=>window.keptProjectInput===document.querySelector('[aria-label="项目原生协议输入"]')),true);
   await residentInput(page,'项目','keptProjectInput','return-project-'+i);
   await page.locator('[data-action=workspace][data-id=composer]').click();
   await page.getByLabel('编排原生协议输入',{exact:true}).waitFor({state:'visible'});
   assert.equal(await page.getByLabel('编排原生协议输入',{exact:true}).inputValue(),'编排原生输入草稿，切换后保留，不发送。');
   assert.equal(await page.evaluate(()=>window.keptEditorInput===document.querySelector('[aria-label="编排原生协议输入"]')),true);
   assert.equal(await page.getByLabel('本步目标',{exact:true}).inputValue(),goal);
   await residentInput(page,'编排','keptEditorInput','return-composer-'+i);
  }
  const proof=await page.evaluate(()=>window.portalProof);
  assert.equal(proof.creates.length,1);assert.equal(proof.retains.filter(id=>id===projectSession).length,1);
  assert.equal(proof.retains.filter(id=>id===created[0].id).length,1);assert.deepEqual(proof.releases,[]);
  assert.equal(proof.prompts,0);assert.equal(proof.attempts,0);
  assert.ok(proof.layouts.some(row=>row.kind==='项目'&&row.args.hero===false&&row.args.variant==='embedded'));
  assert.ok(proof.layouts.some(row=>row.kind==='编排'&&row.args.hero===false&&row.args.variant==='embedded'));
  assert.deepEqual(readFileSync(configPath()),configurationBytes);assert.deepEqual(readFileSync(join(root,'.ares/project.json')),projectBytes);
  assert.equal(readProject(root).progress.done,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const saveResponsePromise=page.waitForResponse(response=>response.url().includes('/competition/workflow/save')&&response.request().method()==='POST');
  await page.locator('[data-action=competition-flow-save]').click();
  const saveResponse=await saveResponsePromise,saved=await saveResponse.json();
  assert.equal(saveResponse.status(),200,JSON.stringify(saved));assert.equal(saved.ok,true);
  const stored=readConfiguration().workflows.find(row=>row.id===context.workflowId);
  assert.equal(stored.steps.find(row=>row.id===stepId).objective,goal);
  assert.notDeepEqual(readFileSync(configPath()),configurationBytes);
  assert.deepEqual(readFileSync(join(root,'.ares/project.json')),projectBytes,'Saving competition flow leaves existing project fixed');
  await residentInput(page,'编排','keptEditorInput','composer-saved');
  assert.equal(await page.getByLabel('编排原生协议输入',{exact:true}).inputValue(),'编排原生输入草稿，切换后保留，不发送。');
  await page.locator('[data-action=competition-flow-create-project]').click();
  const dialog=page.getByRole('dialog',{name:'创建竞赛项目',exact:true});await dialog.waitFor();
  allowedNewRoot=join(base,'new-project-from-saved-workflow');mkdirSync(allowedNewRoot);
  await dialog.getByLabel('项目名称',{exact:true}).fill('神经网络界面保存与新建验证 · 非竞赛成果');
  await dialog.getByLabel('项目目录',{exact:true}).fill(allowedNewRoot);
  await dialog.locator('[data-action=project-create]').click();await dialog.waitFor({state:'detached'});
  const adopted=readProject(allowedNewRoot);assert.equal(adopted.workflow.id,stored.id);
  assert.equal(adopted.workflow.steps.find(row=>row.id===stepId).objective,goal);
  assert.equal(adopted.competition.id,5);assert.equal(adopted.competition.track,stored.competitionTemplate.track);
  assert.equal(adopted.progress.done,0);
  const initialization=requests.find(row=>row.path==='project/init')?.data;
  assert.equal(initialization.flowMode,'library');assert.equal(initialization.workflowId,stored.id);
  assert.match(initialization.expectedWorkflowHash,/^[a-f0-9]{64}$/);assert.ok(Number.isInteger(initialization.expectedConfigurationRevision));
  await page.getByLabel('项目原生协议输入',{exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('.ares-app')?.dataset.workspace==='projects');
  await page.waitForFunction(()=>window.portalProof.retains.some(id=>id.startsWith('neural-new-project-protocol-')));
  assert.equal(projectCreated.length,1);assert.equal(projectCreated[0].cwd,allowedNewRoot);
  const finalProof=await page.evaluate(()=>window.portalProof);
  assert.equal(finalProof.prompts,0);assert.equal(finalProof.attempts,0);assert.equal(finalProof.creates.length,1);
  assert.equal(finalProof.retains.filter(id=>id===created[0].id).length,1,'Editor lease survives explicit project creation');
  assert.deepEqual(readFileSync(join(root,'.ares/project.json')),projectBytes);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await page.screenshot({path:join(base,'neural-new-project.png')});
  assert.deepEqual(assetHashes(),sourceHashes,'Production assets must stay unchanged during the recorded verification');
  writeFileSync(join(base,'neural-native-workspaces-evidence.json'),JSON.stringify({mode:'Actual ARES client/client.js + React DOM portals + real routes/editor/storage/assets. Native session/provider/input/tool metadata are explicit protocol fixtures; no model prompt, tool execution, cloud write or user DSH operation.',sourceHashes,proofBeforeSave:proof,proof:finalProof,created,projectCreated,visualProof,editorContext:context,unsavedStep:step.step,savedWorkflowId:stored.id,adopted:{id:adopted.id,definitionId:adopted.definitionId,competition:adopted.competition,objective:adopted.workflow.steps.find(row=>row.id===stepId).objective,done:adopted.progress.done},requestPaths:requests.map(row=>row.path),nativeCss:surface.provenance,errors,external},null,2));
  console.log('NEURAL_NATIVE_WORKSPACES_EVIDENCE',base);
 }catch(error){writeFileSync(join(base,'failure.json'),JSON.stringify({message:error.message,errors,external,requests:requests.map(row=>({path:row.path,workflowId:row.data?.workflowId,activeStepId:row.data?.activeStepId})),body:await page.locator('body').textContent()},null,2));await page.screenshot({path:join(base,'failure.png')});throw error;}
 finally{await page.close();}
});

test('flow assistant retries only after a failed native lease and keeps the same session and flow draft',async()=>{
 const page=await browser.newPage({viewport:{width:1280,height:950},reducedMotion:'reduce'}),caseErrors=[],caseExternal=[];page.setDefaultTimeout(10000);
 await page.addInitScript(()=>{window.failNextAresEditorRetain=true;});page.on('pageerror',error=>caseErrors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){caseExternal.push(url.href);await route.abort();return;}
  if(url.pathname==='/'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>html,body,#native-root{margin:0;width:100%;height:100%}[data-composer-input]{resize:none;min-height:65px;width:100%}</style><style>'+surface.css+'</style></head><body><div id="native-root"></div><script src="/owned-react.js"></script><script>'+harness+'</script><script src="/owned-client.js"></script><script>mountNative()</script></body></html>'});return;}
  if(url.pathname==='/owned-react.js'){await route.fulfill({contentType:'text/javascript',body:runtime});return;}
  if(url.pathname==='/owned-client.js'){await route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../client/client.js',import.meta.url),'utf8')});return;}
  const data=request.postData()?JSON.parse(request.postData()):undefined;
  if(url.pathname==='/owned-native-session'){
   assert.deepEqual(Object.keys(data).sort(),['agentPreset','cwd']);assert.equal(data.agentPreset,EDITOR_PRESET_ID);assert.ok(data.cwd.startsWith(process.env.ARES_HOME));
   const id='owned-editor-boundary-'+randomUUID();registerSession(id,data.cwd,data.agentPreset);created.push({id,...data});await route.fulfill({contentType:'application/json',body:JSON.stringify({sessionId:id})});return;
  }
  if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';
  const response=await productionRequest(url.pathname.slice('/ares/api/v2/'.length)+url.search,data,request.headers());await route.fulfill({status:response.status,headers:response.headers,body:response.body});
 });
 try{
  await page.goto(origin);await page.locator('[data-action=workspace][data-id=composer]').click();
  await page.getByLabel('步骤名称',{exact:true}).waitFor();await page.locator('.galaxy-chat [role=alert]').filter({hasText:'Explicit native lease recovery fixture'}).first().waitFor();
  const draft='重连时应保留的实际流程草稿，仅用于软件验证。';await page.getByLabel('本步目标',{exact:true}).fill(draft);
  const before=await page.evaluate(()=>window.portalProof),editorId=before.retains.find(id=>id.startsWith('owned-editor-boundary-'));assert.ok(editorId);
  assert.equal(await page.locator('.galaxy-chat').getByRole('button',{name:'重试连接',exact:true}).count(),1);await page.locator('.galaxy-chat').getByRole('button',{name:'重试连接',exact:true}).click();await page.getByLabel('编排原生协议输入',{exact:true}).waitFor({state:'visible'});
  assert.equal(await page.getByLabel('本步目标',{exact:true}).inputValue(),draft);assert.equal(await page.locator('.galaxy-chat [role=alert]').filter({hasText:'Explicit native lease recovery fixture'}).count(),0);
  const after=await page.evaluate(()=>window.portalProof);assert.equal(after.creates.length,before.creates.length);assert.equal(after.retains.filter(id=>id===editorId).length,before.retains.filter(id=>id===editorId).length+1);assert.ok(after.releases.includes(editorId));assert.equal(after.prompts,0);assert.equal(after.attempts,0);
  await page.getByLabel('编排原生协议输入',{exact:true}).fill('连接已恢复的输入草稿，不发送。');await page.evaluate(()=>window.reconnectedDraftNode=document.querySelector('[aria-label="编排原生协议输入"]'));
  assert.equal(await page.locator('.galaxy-chat').getByRole('button',{name:'重试连接',exact:true}).count(),0);await page.locator('.galaxy-chat [data-native-connection-state=connected]').waitFor();const reopened=page.waitForResponse(r=>r.url().includes('/assistant/session')&&r.status()===200);await page.evaluate(()=>window.ownedAresManagers.editor.reconnect());await reopened;await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  assert.equal(await page.getByLabel('编排原生协议输入',{exact:true}).inputValue(),'连接已恢复的输入草稿，不发送。');assert.equal(await page.evaluate(()=>window.reconnectedDraftNode===document.querySelector('[aria-label="编排原生协议输入"]')),true);assert.deepEqual(await page.evaluate(()=>window.portalProof.retains),after.retains);assert.equal(await page.getByLabel('本步目标',{exact:true}).inputValue(),draft);assert.deepEqual(caseErrors,[]);assert.deepEqual(caseExternal,[]);
  await page.screenshot({path:join(base,'assistant-reconnected.png')});writeFileSync(join(base,'assistant-reconnect-evidence.json'),JSON.stringify({mode:'Actual client/client.js and React Portal; explicitly failing native lease fixture followed by successful same-ID retain. No model calls or user desktop.',editorId,before,after,flowDraftRetained:true,healthyReconnectPreservesNativeDraftAndElement:true,errors:caseErrors,external:caseExternal},null,2));console.log('ARES_ASSISTANT_RECONNECT_EVIDENCE',base);
 }catch(error){writeFileSync(join(base,'reconnect-failure.json'),JSON.stringify({message:error.message,proof:await page.evaluate(()=>window.portalProof),body:await page.locator('body').textContent(),errors:caseErrors},null,2));throw error;}finally{await page.close();}
});

test('project assistant shows one retry for metadata or native-lease failure and only status when actually connected',async()=>{
 const initialProjectCreates=projectCreated.length;
 const page=await browser.newPage({viewport:{width:1280,height:950},reducedMotion:'reduce'}),caseErrors=[],caseExternal=[],stages=[];let metadataCalls=0;page.setDefaultTimeout(10000);
 await page.addInitScript(()=>{window.failNextAresProjectRetain=true;});page.on('pageerror',error=>caseErrors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){caseExternal.push(url.href);await route.abort();return;}
  if(url.pathname==='/'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>html,body,#native-root{margin:0;width:100%;height:100%}[data-composer-input]{resize:none;min-height:65px;width:100%}</style><style>'+surface.css+'</style></head><body><div id="native-root"></div><script src="/owned-react.js"></script><script>'+harness+'</script><script src="/owned-client.js"></script><script>mountNative()</script></body></html>'});return;}
  if(url.pathname==='/owned-react.js'){await route.fulfill({contentType:'text/javascript',body:runtime});return;}
  if(url.pathname==='/owned-client.js'){await route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../client/client.js',import.meta.url),'utf8')});return;}
  const data=request.postData()?JSON.parse(request.postData()):undefined;
  if(url.pathname==='/owned-native-session'){
   assert.equal(data.agentPreset,EDITOR_PRESET_ID);assert.ok(data.cwd.startsWith(process.env.ARES_HOME));const id='owned-editor-boundary-'+randomUUID();registerSession(id,data.cwd,data.agentPreset);created.push({id,...data});await route.fulfill({contentType:'application/json',body:JSON.stringify({sessionId:id})});return;
  }
  if(url.pathname==='/ares/api/v2/project/assistant/connect'&&metadataCalls++===0){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Explicit project metadata failure fixture'})});return;}
  if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';const response=await productionRequest(url.pathname.slice('/ares/api/v2/'.length)+url.search,data,request.headers());await route.fulfill({status:response.status,headers:response.headers,body:response.body});
 });
 try{
  await page.goto(origin);const chat=page.locator('.galaxy-chat'),retry=chat.getByRole('button',{name:'重试连接',exact:true});
  await chat.getByRole('alert').filter({hasText:'Explicit project metadata failure fixture'}).waitFor();assert.equal(await retry.count(),1);await chat.locator('[data-native-connection-state=error]').waitFor();stages.push({phase:'metadata-error',retryButtons:await retry.count()});
  await retry.click();await chat.getByRole('alert').filter({hasText:'Explicit native lease recovery fixture'}).waitFor();assert.equal(await retry.count(),1);await chat.locator('[data-native-connection-state=error]').waitFor();stages.push({phase:'native-lease-error',retryButtons:await retry.count()});await page.screenshot({path:join(base,'project-connection-failed.png')});
  const before=await page.evaluate(()=>window.portalProof);await retry.click();const input=page.getByLabel('项目原生协议输入',{exact:true});await input.waitFor({state:'visible'});await chat.locator('[data-native-connection-state=connected]').waitFor();assert.equal(await retry.count(),0);assert.equal(await chat.getByRole('button',{name:'重新连接',exact:true}).count(),0);assert.equal(await chat.getByRole('alert').count(),0);stages.push({phase:'connected',retryButtons:0});
  await input.fill('项目助手未发送草稿，连接状态变化仍保留。');await page.evaluate(()=>window.projectConnectionDraft=document.querySelector('[aria-label="项目原生协议输入"]'));await page.evaluate(()=>window.ownedAresManagers.project.reconnect());await chat.locator('[data-native-connection-state=connected]').waitFor();assert.equal(await input.inputValue(),'项目助手未发送草稿，连接状态变化仍保留。');assert.equal(await page.evaluate(()=>window.projectConnectionDraft===document.querySelector('[aria-label="项目原生协议输入"]')),true);
  const after=await page.evaluate(()=>window.portalProof);assert.equal(after.retains.filter(id=>id===projectSession).length,before.retains.filter(id=>id===projectSession).length+1);assert.equal(after.creates.length,before.creates.length);assert.equal(after.prompts,0);assert.equal(after.attempts,0);assert.equal(projectCreated.length,initialProjectCreates);assert.deepEqual(readFileSync(join(root,'.ares/project.json')),projectBytes);assert.deepEqual(caseErrors,[]);assert.deepEqual(caseExternal,[]);
  await page.screenshot({path:join(base,'project-connection-ready.png')});writeFileSync(join(base,'project-connection-evidence.json'),JSON.stringify({mode:'Actual production client, React Portal, routes, metadata managers and owned project. One metadata fault and one native-lease fault are explicit ABI fixtures. No model/cloud/desktop.',sourceHashes:assetHashes(),sessionId:projectSession,stages,before,after,sameDraftAndInput:true,projectBytesUnchanged:true,errors:caseErrors,external:caseExternal},null,2));console.log('ARES_PROJECT_CONNECTION_EVIDENCE',base);
 }catch(error){writeFileSync(join(base,'project-connection-failure.json'),JSON.stringify({message:error.message,body:await page.locator('body').textContent(),errors:caseErrors,stages},null,2));await page.screenshot({path:join(base,'project-connection-failure.png')});throw error;}finally{await page.close();}
});
