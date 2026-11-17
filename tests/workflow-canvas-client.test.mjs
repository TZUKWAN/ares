import './helpers/environment.mjs';
/** Actual production app/routes/storage in owned headless Chromium. The native
 * session and composer seat are explicitly labeled protocol fixtures; no model,
 * tool execution, cloud write, DSH instance or user's window is involved. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable,Writable} from 'node:stream';
import {createRoutes} from '../host/routes.js';
import {competitionCatalog,readConfiguration,configPath} from '../host/catalog.js';
import {readCompetitionWorkflow,saveCompetitionWorkflow} from '../host/competition-workflows.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-workflow-canvas-'));
const origin='http://127.0.0.1:64365';
const {chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);let browser;
before(async()=>browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}));
after(async()=>browser?.close());

function seedWorkflow(count){
 const scope={competitionId:5,track:competitionCatalog().find(row=>row.id===5).tracks.find(row=>!row.legacy).track,edition:'',group:''};
 const entry=readCompetitionWorkflow(scope),w=structuredClone(entry.workflow),source=w.steps[0];
 w.steps=Array.from({length:count},(_,index)=>({...structuredClone(source),id:'ui-stage-'+index,
  title:index===1?'核对竞赛原始材料并明确各阶段可验证的实际交付要求':'界面验证阶段 '+String(index+1).padStart(2,'0'),
  objective:'用于流程画布的软件验证，非竞赛工作成果。',dependsOn:index?['ui-stage-'+(index-1)]:[],
  outputs:[{id:'ui-artifact-'+index,title:'本阶段实际记录',path:'stage-'+index+'.md',kind:'file',format:'md',requirement:'required'}]}));
 if(count>3)w.steps[count-1].dependsOn=[w.steps[0].id];
 return saveCompetitionWorkflow({...scope,workflow:w,expectedRevision:entry.expectedRevision,expectedWorkflowHash:entry.workflowHash});
}

function productionRoutes(){
 const ctx={get(name){if(name==='agents')return {get(){return null;},list:()=>[],isOwnedBy:()=>false};
  if(name==='jobs')return {list:()=>[]};if(name==='sessionController')return {inspect(){assert.fail('This UI fixture must not inspect a real DSH session');}};}};
 const native={capability:()=>({available:false,source:'explicit-native-ui-protocol-fixture'}),forEditor(){assert.fail('No actual native preset creation');},inspectEditorTools(){assert.fail('No actual tool inspection');}};
 const server=createRoutes(ctx,native,undefined,{standalone:true});
 return {dispose:server.dispose,async request(path,data,headers){
  const url='/ares/api/v2/'+path,route=server.routes.find(row=>row.path===url.split('?')[0]);if(!route)throw Error('Missing actual route '+url);
  const req=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);req.method=data===undefined?'GET':'POST';req.url=url;req.headers={...headers,host:new URL(origin).host,'content-type':'application/json'};req.socket={remoteAddress:'127.0.0.1'};
  const chunks=[];let status=200,outHeaders={},finish;const ended=new Promise(resolve=>finish=resolve),res=new Writable({write(chunk,_encoding,next){chunks.push(Buffer.from(chunk));next();},final(next){next();finish();}});
  res.headersSent=false;res.writeHead=(code,values={})=>{status=code;outHeaders=values;res.headersSent=true;};await route.handler(req,res);await ended;return {status,headers:outHeaders,body:Buffer.concat(chunks)};
 }};
}

async function ownedPage(count){
 const home=join(base,'steps-'+count);mkdirSync(home);process.env.ARES_HOME=join(home,'home');const saved=seedWorkflow(count),configurationBytes=readFileSync(configPath());
 const api=productionRoutes(),errors=[],external=[],page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});page.setDefaultTimeout(14000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){external.push(url.href);await route.abort();return;}
  if(url.pathname==='/'){await route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{margin:0;width:100%;height:100%}.canvas-native-fixture{height:100%;display:flex;flex-direction:column;min-height:0}.canvas-native-fixture small{font:11px/1.6 sans-serif;color:#999}.canvas-native-fixture textarea{margin-top:auto;box-sizing:border-box;width:100%;min-height:85px;resize:none;background:#202020;color:#ddd;border:1px solid #555;border-radius:10px;padding:12px;font:14px/1.6 sans-serif}</style></head><body><div id="root"></div><script type="module">
  import{mountAres}from'/ares/api/v2/app.js';
  function seat(label){const node=document.createElement('div');node.className='canvas-native-fixture';node.innerHTML='<small>原生会话座位协议夹具 · 未调用模型</small><textarea aria-label="'+label+'"></textarea>';return node;}
  const editor=seat('编排原生座位协议草稿'),project=seat('项目原生座位协议草稿');window.editorSeat=editor;
  const editorSession={kind:'editor',subscribe(){return()=>{}},setVisible(){},updateContext(value){window.editorContext=structuredClone(value)},setContextProvider(){},getState:()=>({running:false}),hint(){}};
  const projectSession={kind:'project',subscribe(){return()=>{}},setProject(){},setView(){},setViewProvider(){},getState:()=>({running:false})};
  window.app=mountAres(document.querySelector('#root'),{editorSession,projectSession,mountEditor(node){if(!node.contains(editor))node.append(editor)},mountProject(node){if(!node.contains(project))node.append(project)}});
  </script></body></html>`});return;}
  if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';const data=req.postData()?JSON.parse(req.postData()):undefined,response=await api.request(url.pathname.slice('/ares/api/v2/'.length)+url.search,data,req.headers());await route.fulfill({status:response.status,headers:response.headers,body:response.body});
 });
 await page.goto(origin);await page.locator('#root[data-galaxy-ready=true]').waitFor();await page.locator('[data-action=workspace][data-id=composer]').click();await page.getByLabel('选择比赛',{exact:true}).selectOption('5');
 await page.waitForFunction(count=>document.querySelector('.ares-composer-editor')?.getAttribute('aria-busy')==='false'&&document.querySelectorAll('.ares-flow-plane .ares-step').length===count,count);
 await page.evaluate(()=>document.fonts.ready);await page.getByLabel('编排原生座位协议草稿').fill('原生座位草稿保留，不发送。');
 return {page,home,saved,errors,external,configurationBytes,async dispose(){await page.close();api.dispose();}};
}

async function geometry(page){return page.evaluate(()=>{
 const viewport=document.querySelector('.ares-flow-viewport'),plane=document.querySelector('.ares-flow-plane'),map=viewport.closest('.ares-flow-map'),details=document.querySelector('.ares-composer-editor .ares-editor');
 const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 return {width:innerWidth,viewport:{...rect(viewport),clientWidth:viewport.clientWidth,scrollWidth:viewport.scrollWidth,scrollHeight:viewport.scrollHeight,scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop},plane:rect(plane),map:rect(map),details:rect(details),mode:map.dataset.flowMode,columns:Number(map.dataset.flowColumns),zoom:Number(map.dataset.flowZoom),nodes:[...plane.querySelectorAll('.ares-step')].map(node=>({id:node.dataset.id,...rect(node),font:Number.parseFloat(getComputedStyle(node.querySelector('.ares-step-title')).fontSize),active:node.classList.contains('active')})),paths:[...plane.querySelectorAll('.ares-flow-wires path')].map(node=>({from:node.dataset.from,to:node.dataset.to,d:node.getAttribute('d')}))};
});}

async function waitLayout(page){await page.waitForFunction(()=>document.querySelector('.ares-flow-map')?.dataset.flowReady==='true');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}

for(const count of process.env.ARES_CANVAS_BASELINE?[8]:[1,8,40])test((process.env.ARES_CANVAS_BASELINE?'baseline capture (not acceptance): ':'')+'actual workflow canvas adapts '+count+' steps without clipping cards, details or the resident assistant',async()=>{
 const f=await ownedPage(count),{page}=f,evidence=[];
 try{
  if(process.env.ARES_CANVAS_BASELINE){
   for(const width of [1920,1280]){await page.setViewportSize({width,height:1080});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));evidence.push(await geometry(page));await page.screenshot({path:join(base,'before-'+count+'-'+width+'.png')});}
   writeFileSync(join(base,'before-'+count+'.json'),JSON.stringify(evidence,null,2));console.log('WORKFLOW_CANVAS_BEFORE',base);return;
  }
  await waitLayout(page);
  for(const width of [1920,1280,800]){
   await page.setViewportSize({width,height:1080});await waitLayout(page);const g=await geometry(page);evidence.push(g);
   assert.equal(g.mode,'auto');assert.ok(g.columns>=1);assert.ok(g.viewport.scrollWidth<=g.viewport.clientWidth+1,JSON.stringify(g));
   assert.ok(g.nodes.every(node=>node.width>=180&&node.font>=13),'Cards and labels remain readable');
   assert.ok(g.map.right<=g.details.x+2||g.map.bottom<=g.details.y+2,'Canvas stays out of the detail editor');
   assert.equal(await page.getByLabel('编排原生座位协议草稿').inputValue(),'原生座位草稿保留，不发送。');
   await page.screenshot({path:join(base,'after-'+count+'-'+width+'.png')});
  }
  await page.setViewportSize({width:1920,height:1080});await waitLayout(page);
  const originalGeometry=await geometry(page);
  for(let i=0;i<6;i++){await page.getByRole('separator',{name:'调整聊天窗口宽度'}).focus();await page.keyboard.press('ArrowLeft');}
  await waitLayout(page);const narrowed=await geometry(page);evidence.push({assistantWidth:640,...narrowed});
  assert.equal(narrowed.mode,'auto');assert.equal(narrowed.zoom,1);assert.notEqual(narrowed.viewport.width,originalGeometry.viewport.width,'Assistant resize changes the real canvas container');
  assert.ok(narrowed.viewport.scrollWidth<=narrowed.viewport.clientWidth+1);
  await page.getByRole('separator',{name:'调整聊天窗口宽度'}).focus();await page.keyboard.press('Home');await waitLayout(page);
  await page.locator('[data-action=flow-zoom][data-direction="1"]').click();let manual=await geometry(page);assert.equal(manual.mode,'manual');assert.ok(manual.zoom>1);
  await page.setViewportSize({width:1600,height:1000});await waitLayout(page);assert.equal((await geometry(page)).zoom,manual.zoom,'User zoom survives container resize');
  await page.locator('[data-action=flow-reset]').click();await waitLayout(page);assert.equal((await geometry(page)).mode,'auto');
  const last=page.locator('.ares-flow-plane .ares-step').last();await last.scrollIntoViewIfNeeded();await last.click();await waitLayout(page);
  assert.equal(await page.getByLabel('步骤名称',{exact:true}).inputValue(),f.saved.workflow.steps.at(-1).title);
  if(count>1){
   const movedId=await last.getAttribute('data-id');await page.locator('.ares-step[data-id="'+movedId+'"]').focus();await page.keyboard.press('Alt+ArrowUp');await waitLayout(page);
   assert.equal(await page.locator('.ares-flow-plane .ares-step').nth(count-2).getAttribute('data-id'),movedId);
   assert.equal(await page.evaluate(id=>document.activeElement?.dataset.id===id,movedId),true,'Keyboard sorting keeps focus');
   if(count===8){
    await page.evaluate(()=>{window.canvasDragEvents=[];for(const type of ['dragstart','dragenter','dragover','drop','dragend'])document.addEventListener(type,event=>{if(window.canvasDragEvents.length<60)window.canvasDragEvents.push({type,trusted:event.isTrusted,target:event.target.closest?.('.ares-step')?.dataset.id||event.target.tagName,text:event.dataTransfer?.getData('text/plain')});},true);});
    const beforeCross=await page.locator('.ares-flow-plane .ares-step').evaluateAll(nodes=>nodes.map(node=>node.dataset.id));
    await page.locator('.ares-step[data-id="'+movedId+'"]').dragTo(page.locator('.ares-flow-plane .ares-step').nth(1));await waitLayout(page);
    const crossAccepted=await page.locator('.ares-flow-plane .ares-step').nth(1).getAttribute('data-id')===movedId;
    const crossEvents=await page.evaluate(()=>window.canvasDragEvents);
    if(!crossAccepted)assert.deepEqual(await page.locator('.ares-flow-plane .ares-step').evaluateAll(nodes=>nodes.map(node=>node.dataset.id)),beforeCross,'An unstarted native drag cannot change the workflow');
    evidence.push({crossRowNativeGesture:{accepted:crossAccepted,events:crossEvents,limitation:crossAccepted?null:'The browser did not start the default-center native drag across offscreen rows; not counted as a successful drag.'}});
    await page.evaluate(()=>window.canvasDragEvents.length=0);
    const targetId=crossAccepted?'ui-stage-1':'ui-stage-6',expectedIndex=crossAccepted?2:7;
    await page.locator('.ares-step[data-id="'+movedId+'"]').dragTo(page.locator('.ares-step[data-id="'+targetId+'"]'),{sourcePosition:{x:18,y:18},targetPosition:{x:18,y:18}});await waitLayout(page);
    assert.equal(await page.locator('.ares-flow-plane .ares-step').nth(expectedIndex).getAttribute('data-id'),movedId);
    const drag=await page.evaluate(()=>window.canvasDragEvents);assert.ok(drag.some(event=>event.type==='dragstart'&&event.trusted));assert.ok(drag.some(event=>event.type==='drop'&&event.trusted));
    const order=await page.locator('.ares-flow-plane .ares-step').evaluateAll(nodes=>nodes.map(node=>node.dataset.id));
    await page.locator('.ares-step[data-id="ui-stage-1"]').dragTo(page.locator('.ares-step[data-id="ui-stage-0"]'),{sourcePosition:{x:18,y:18},targetPosition:{x:18,y:18}});
    await page.getByRole('alert').filter({hasText:'移动会使依赖倒置'}).waitFor();
    assert.deepEqual(await page.locator('.ares-flow-plane .ares-step').evaluateAll(nodes=>nodes.map(node=>node.dataset.id)),order,'Invalid DAG reordering is rejected');
    evidence.push({trustedDrag:drag,blockedReorder:true});
   }
  }
  await page.locator('.ares-flow-viewport').focus();await page.keyboard.press('+');assert.equal((await geometry(page)).mode,'manual');await page.keyboard.press('0');assert.equal((await geometry(page)).mode,'auto');
  assert.deepEqual(readFileSync(configPath()),f.configurationBytes,'Layout, selection and unsaved sorting do not publish a configuration');
  assert.equal(await page.evaluate(()=>window.editorSeat===document.querySelector('.canvas-native-fixture:has([aria-label="编排原生座位协议草稿"])')),true);
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.external,[]);
  writeFileSync(join(base,'after-'+count+'.json'),JSON.stringify({mode:'Production app/routes/storage with explicit native seat protocol fixtures; no model/cloud/desktop operations',count,evidence,errors:f.errors,external:f.external},null,2));console.log('WORKFLOW_CANVAS_EVIDENCE',count,base);
 }catch(error){writeFileSync(join(base,'failure-'+count+'.json'),JSON.stringify({message:error.message,errors:f.errors,external:f.external,geometry:await geometry(page),drag:await page.evaluate(()=>window.canvasDragEvents||[]),alerts:await page.getByRole('alert').allTextContents()},null,2));await page.screenshot({path:join(base,'failure-'+count+'.png')});console.log('WORKFLOW_CANVAS_FAILURE',base);throw error;}
 finally{await f.dispose();}
});
