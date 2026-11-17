import './helpers/environment.mjs';
/** Explicit native-slot protocol fixtures in owned headless pages; no real DSH/model execution. */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {directRoutes} from './helpers/direct-routes.mjs';import {linkRoot,initializeProject,readProject} from '../host/projects.js';import {competitionCatalog} from '../host/catalog.js';
import {nativeThemeSurface} from './helpers/native-theme-surface.mjs';
const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-resident-chat-'));process.env.ARES_HOME=join(base,'home');
const projects=[];for(const label of ['甲','乙']){const root=join(base,'project-'+label);mkdirSync(root);linkRoot(root);projects.push(initializeProject({root,name:'常驻聊天软件验证'+label+'（非竞赛）',competitionId:5,track:competitionCatalog().find(row=>row.id===5).tracks[0].track,workflowId:'modeling'}));}
const api=directRoutes(),origin='http://127.0.0.1:64331',errors=[],unexpected=[];const {chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);let browser;
before(async()=>{browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});});after(async()=>{api.dispose();await browser?.close();});
async function pageFor({empty=false}={}){const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin){unexpected.push(url.href);await route.abort();return;}
  if(url.pathname==='/'){await route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{height:100%;width:100%;margin:0}.native-slot-protocol{height:100%;display:flex;flex-direction:column;gap:8px;padding:10px;color:#a5c5de;background:#081521}.native-slot-protocol small{font-size:10px}.native-slot-protocol [role=log]{flex:1;min-height:0;overflow:auto}.native-slot-protocol textarea{flex:none;min-height:70px;width:100%;background:#112335;border:1px solid #7198b855;color:#d0e5f6;resize:none}</style></head><body><div id="root"></div><script type="module">
import{mountAres}from'/ares/api/v2/app.js?v=2.3.0-polish1';window.protocol={contexts:[],visibility:[],projectRoots:[],hints:[]};
function slot(mode){const node=document.createElement('div');node.className='native-slot-protocol';node.innerHTML='<small>原生槽位协议夹具 · 非真实DSH对话</small><div role="log">验证原有原生会话槽位及输入保留。</div><textarea aria-label="'+mode+'槽位协议草稿"></textarea>';return node;}
window.projectSlot=slot('项目');window.editorSlot=slot('配置');
const projectSession={kind:'project',subscribe(){return()=>{};},setProject(p){const last=window.protocol.projectRoots.at(-1);if(p?.root!==last)window.protocol.projectRoots.push(p?.root||null);},hintArtifact(c){window.protocol.hints.push(c);},reconnect(){},getState(){return {running:false};}};
const editorSession={subscribe(){return()=>{};},getState(){return {sessionId:'explicit-native-slot-protocol',running:false};},setVisible(value){window.protocol.visibility.push(value);},updateContext(c){window.protocol.contexts.push(c);},reconnect(){}};
window.app=mountAres(document.querySelector('#root'),{projectSession,editorSession,mountProject(node){if(!node.contains(window.projectSlot))node.append(window.projectSlot);},mountEditor(node){if(!node.contains(window.editorSlot))node.append(window.editorSlot);}});
</script></body></html>`});return;}
  if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';
  const response=await api.request(url.pathname.slice('/ares/api/v2/'.length)+url.search,request.postData()?JSON.parse(request.postData()):undefined,{raw:true,host:url.host,headers:request.headers()});
  if(url.pathname==='/ares/api/v2/bootstrap'){const body=JSON.parse(response.body.toString());body.capabilities.assistant={...body.capabilities.assistant,available:true,transport:'dsh-native-session'};if(empty)body.projects=[];await route.fulfill({status:response.status,headers:response.headers,body:JSON.stringify(body)});return;}
  await route.fulfill({status:response.status,headers:response.headers,body:response.body});
 });await page.goto(origin);await page.locator('#root[data-galaxy-ready=true]').waitFor();await page.evaluate(()=>document.fonts.ready);return page;}
async function projectTab(page,id){const menu=page.locator(".galaxy-more");if(await menu.getAttribute("open")===null)await menu.locator("summary").click();await menu.locator("[data-action=project-tab][data-id="+id+"]").click();}
const rects=page=>page.evaluate(()=>{const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};return{scene:box('.galaxy-stage'),chat:box('.galaxy-chat'),viewport:{w:innerWidth,h:innerHeight},scrollWidth:document.documentElement.scrollWidth};});

test('chat is visible on entry and survives step/progress/file navigation, draft focus, and explicit folding',async()=>{const page=await pageFor(),before=projects.map(p=>readFileSync(join(p.root,'.ares/project.json')));try{
 await page.locator('.galaxy-chat[data-chat-mode=project]').waitFor({state:'visible'});assert.equal(await page.locator('.galaxy-console').count(),0);
 await page.getByLabel('项目槽位协议草稿').fill('常驻项目草稿，不自动发送');await page.evaluate(()=>window.keptCanvas=document.querySelector('.ff-gl'));
 const boxes=await rects(page);assert.ok(boxes.scene.x+boxes.scene.w<=boxes.chat.x+1);assert.ok(boxes.chat.w>=320);assert.ok(boxes.chat.h>=900);
 await page.locator('.process-step[data-id=context]').click();await page.getByRole('dialog').waitFor();assert.equal(await page.getByLabel('项目槽位协议草稿').isVisible(),true);await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
 await projectTab(page,'progress');await page.locator('.process-progress').waitFor();assert.equal(await page.getByLabel('项目槽位协议草稿').inputValue(),'常驻项目草稿，不自动发送');
 await projectTab(page,'files');await page.locator('.galaxy-console[data-galaxy-panel=files]').waitFor();assert.equal(await page.getByLabel('项目槽位协议草稿').isVisible(),true);
 await page.getByRole('button',{name:'返回星河',exact:true}).click();
 await page.getByLabel('项目槽位协议草稿').focus();await page.getByLabel('项目槽位协议草稿').evaluate(node=>node.setSelectionRange(2,5));await page.evaluate(()=>document.querySelector('.galaxy-context-nav [data-action=refresh]').click());
 await page.waitForFunction(()=>!document.querySelector('[data-action=refresh]').disabled);const focusEvidence=await page.getByLabel('项目槽位协议草稿').evaluate(node=>({active:document.activeElement===node,activeTag:document.activeElement?.tagName,activeLabel:document.activeElement?.getAttribute('aria-label'),start:node.selectionStart,end:node.selectionEnd,value:node.value}));writeFileSync(join(base,'focus-evidence.json'),JSON.stringify(focusEvidence,null,2));assert.deepEqual(focusEvidence,{active:true,activeTag:'TEXTAREA',activeLabel:'项目槽位协议草稿',start:2,end:5,value:'常驻项目草稿，不自动发送'});
 await page.getByRole('button',{name:'收起聊天窗口',exact:true}).click();await page.locator('.galaxy-chat').waitFor({state:'hidden'});assert.ok((await rects(page)).scene.w>=1598);
 await page.getByRole('button',{name:'打开聊天窗口',exact:true}).click();await page.locator('.galaxy-chat').waitFor({state:'visible'});assert.equal(await page.getByLabel('项目槽位协议草稿').inputValue(),'常驻项目草稿，不自动发送');
 assert.equal(await page.evaluate(()=>window.projectSlot===document.querySelector('.galaxy-chat .native-slot-protocol')),true);assert.equal(await page.evaluate(()=>window.keptCanvas===document.querySelector('.ff-gl')),true);
 const handle=page.getByRole('separator',{name:'调整聊天窗口宽度',exact:true});await handle.focus();const width=(await rects(page)).chat.w;await page.keyboard.press('ArrowLeft');assert.ok((await rects(page)).chat.w>=width+39);
 await page.screenshot({path:join(base,'resident-project.png')});assert.equal(readProject(projects[0].root).progress.done,0);projects.forEach((p,i)=>assert.deepEqual(readFileSync(join(p.root,'.ares/project.json')),before[i]));assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 console.log('RESIDENT_CHAT_EVIDENCE',base);
 }finally{await page.close();}});

test('configuration chat stays next to the editor, preserves both native slots, and follows the selected real project',async()=>{const page=await pageFor();try{
 await page.getByLabel('项目槽位协议草稿').fill('项目草稿');await page.locator('.galaxy-nav [data-id=studio]').click();await page.locator('.galaxy-chat[data-chat-mode=editor]').waitFor();
 await page.getByLabel('配置槽位协议草稿').fill('配置草稿');await page.getByLabel('步骤名称',{exact:true}).fill('常驻聊天步骤标题（软件草稿）');
 assert.equal(await page.getByLabel('配置槽位协议草稿').isVisible(),true);assert.equal(await page.getByLabel('步骤名称',{exact:true}).isVisible(),true);
 const context=await page.evaluate(()=>window.protocol.contexts.at(-1));assert.ok(context);assert.equal(context.configuration.workflows.find(w=>w.id===context.workflowId).steps.find(s=>s.id===context.activeStepId).title,'常驻聊天步骤标题（软件草稿）');
 await page.locator('.galaxy-chat [data-action=chat-mode][data-id=project]').click();assert.equal(await page.getByLabel('项目槽位协议草稿').inputValue(),'项目草稿');
 await page.locator('.galaxy-chat [data-action=chat-mode][data-id=editor]').click();assert.equal(await page.getByLabel('配置槽位协议草稿').inputValue(),'配置草稿');
 assert.equal(await page.locator('.ares-native-conversation').count(),2);await page.screenshot({path:join(base,'resident-editor.png')});
 await page.locator('.galaxy-nav [data-id=projects]').click();await page.locator('.galaxy-project-choice').filter({hasText:projects[1].name}).click();
 await page.waitForFunction(root=>window.protocol.projectRoots.at(-1)===root,projects[1].root);assert.equal(await page.locator('.galaxy-chat[data-chat-mode=project]').isVisible(),true);assert.match(await page.locator('.galaxy-chat-context').textContent(),/常驻聊天软件验证乙/);assert.deepEqual(errors,[]);
 }finally{await page.close();}});

test('chat and galaxy remain visible without overlap on narrow layouts; no-project entry exposes configuration chat',async()=>{const page=await pageFor();try{
 const evidence=[];for(const width of [390,800,1280,1900]){await page.setViewportSize({width,height:950});await page.waitForTimeout(70);const boxes=await rects(page);evidence.push({width,...boxes});assert.ok(boxes.scrollWidth<=width+1);assert.ok(boxes.scene.w>250&&boxes.scene.h>220);assert.ok(boxes.chat.w>=300&&boxes.chat.h>=220);assert.ok(boxes.scene.x+boxes.scene.w<=boxes.chat.x+1||boxes.scene.y+boxes.scene.h<=boxes.chat.y+1);assert.equal(await page.getByLabel('项目槽位协议草稿').isVisible(),true);await page.screenshot({path:join(base,'resident-'+width+'.png')});}
 writeFileSync(join(base,'layout-evidence.json'),JSON.stringify(evidence,null,2));assert.deepEqual(errors,[]);
 }finally{await page.close();}const empty=await pageFor({empty:true});try{await empty.locator('.galaxy-chat[data-chat-mode=editor]').waitFor({state:'visible'});assert.equal(await empty.getByLabel('配置槽位协议草稿').isVisible(),true);assert.equal((await empty.evaluate(()=>window.app.inspectGalaxy())).facts.total,0);assert.equal(await empty.locator('.galaxy-chat [data-action=chat-mode][data-id=project]').isDisabled(),true);assert.deepEqual(errors,[]);}finally{await empty.close();}});

test('FORGE chat theme covers the actual ARES empty view and installed native composer style contract without replacing controls',async()=>{
 const surface=nativeThemeSurface(process.env.ARES_NATIVE_CONVERSATION_SOURCE),page=await pageFor();try{
  assert.equal(surface.shortcutCount,4);assert.equal(surface.hints.length,4);assert.ok(surface.hints.every(text=>typeof text==='string'&&text.length>10));
  await page.addStyleTag({content:surface.css});await page.locator('.galaxy-chat .ares-project-native').evaluate((node,html)=>node.innerHTML=html,surface.html);
  await page.getByRole('heading',{name:'推进当前项目',exact:true}).waitFor();assert.equal(await page.locator('[data-ares-chat-shortcut]').count(),4);
  const evidence=await page.evaluate(()=>{const css=selector=>{const s=getComputedStyle(document.querySelector(selector));return {background:s.backgroundColor,borderRadius:s.borderRadius,fontSize:s.fontSize,borderWidth:s.borderTopWidth};};return {chat:css('.galaxy-chat'),card:css('[data-composer-card]'),activeTab:css('.galaxy-chat-tabs [aria-selected=true]'),input:css('[data-composer-input]'),shortcuts:[...document.querySelectorAll('[data-ares-chat-shortcut]')].map(node=>({radius:getComputedStyle(node).borderRadius,label:node.textContent}))};});
  assert.equal(evidence.chat.background,'rgb(5, 7, 10)');assert.equal(evidence.card.background,'rgb(8, 13, 18)');assert.equal(evidence.card.borderRadius,'2px');assert.equal(evidence.card.borderWidth,'1px');assert.equal(evidence.activeTab.background,'rgba(0, 0, 0, 0)');assert.equal(evidence.activeTab.borderWidth,'0px');assert.equal(evidence.activeTab.borderRadius,'0px');assert.ok(evidence.shortcuts.every(row=>row.radius==='1px'));
  await page.getByRole('textbox',{name:'原生输入结构验证',exact:true}).fill('仅验证原生输入结构的样式，不发送。');assert.match(await page.getByRole('textbox',{name:'原生输入结构验证',exact:true}).textContent(),/不发送/);assert.equal(await page.getByRole('button',{name:'发送（未接会话）',exact:true}).isDisabled(),true);
  await page.screenshot({path:join(base,'forge-native-theme.png')});
  await page.setViewportSize({width:390,height:950});await page.screenshot({path:join(base,'forge-native-theme-mobile.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  writeFileSync(join(base,'theme-evidence.json'),JSON.stringify({evidence,...surface.provenance},null,2));assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log('RESIDENT_CHAT_THEME_EVIDENCE',base);
 }finally{await page.close();}
});
