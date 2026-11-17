import './helpers/environment.mjs';
/** Regression for already-running hosts whose route table predates FORGE. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {directRoutes} from './helpers/direct-routes.mjs';
import {linkRoot,initializeProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-module-loading-'));
process.env.ARES_HOME=join(base,'owned-home');const projectRoot=join(base,'project');mkdirSync(projectRoot);linkRoot(projectRoot);
initializeProject({root:projectRoot,name:'模块加载软件回归（非竞赛成果）',competitionId:5,track:competitionCatalog().find(row=>row.id===5).tracks[0].track,workflowId:'modeling'});
const api=directRoutes(),origin='http://127.0.0.1:64324',errors=[],unexpected=[],resources=[];
const {chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);let browser;
before(async()=>{browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});});
after(async()=>{api.dispose();await browser?.close();});

test('full ARES starts using only the already-registered routes, with new renderer, font and media routes absent',async()=>{
 const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){unexpected.push(url.href);await route.abort();return;}
  if(url.pathname==='/'){
   await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script type="module">try{const{mountAres}=await import("/ares/api/v2/app.js?v=2.3.0-polish1");window.app=mountAres(document.querySelector("#root"));window.aresLoaded=true;}catch(error){window.aresLoadError=error.message;}</script></body></html>'});return;
  }
  if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';
  if(!url.pathname.startsWith('/ares/api/v2/')){unexpected.push(url.pathname);await route.abort();return;}
  const name=url.pathname.slice('/ares/api/v2/'.length);resources.push(name);
  // This is the actual failure condition observed on the running listener: the
  // old routes exist, but every newly introduced FORGE static URL returns 404.
  if(name.startsWith('forge-')||name.startsWith('neural-')||/\.(?:mp4|jpe?g)$/.test(name)){await route.fulfill({status:404,body:''});return;}
  const response=await api.request(name+url.search,request.postData()?JSON.parse(request.postData()):undefined,{raw:true,host:url.host,headers:request.headers()});
  if(name==='style.css'){
   // The installed pre-FORGE handler concatenates these two existing files only.
   await route.fulfill({status:200,contentType:'text/css',body:readFileSync(new URL('../client/style.css',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../client/workshop.css',import.meta.url),'utf8')});return;
  }
  await route.fulfill({status:response.status,headers:response.headers,body:response.body});
 });
 try{
  await page.goto(origin);await page.waitForFunction(()=>window.aresLoaded||window.aresLoadError,null,{timeout:12000});
  assert.equal(await page.evaluate(()=>window.aresLoadError),undefined);
  await page.locator('.ff-scene[data-renderer="reference-video-canvas"]').waitFor({timeout:12000});
  await page.waitForFunction(()=>window.app.inspectGalaxy()?.renderStats.media.every(video=>video.ready>=2));
  await page.evaluate(async()=>{await document.fonts.load('700 20px "ARES Forge Display"');await document.fonts.load('400 12px "ARES Forge Mono"');await document.fonts.load('500 16px "ARES Forge Cjk"');await document.fonts.ready;});
  const state=await page.evaluate(async()=>{return{scene:window.app.inspectGalaxy(),background:getComputedStyle(document.querySelector('.ff-scene')).backgroundColor,fonts:[...document.fonts].filter(face=>face.family.startsWith('ARES Forge')).map(face=>({family:face.family,status:face.status}))};});
  assert.equal(state.scene.renderer,'reference-video-canvas');assert.equal(state.scene.renderStats.glError,null);assert.equal(state.scene.renderStats.processNodes,state.scene.facts.total);assert.ok(state.scene.renderStats.media.length>0&&state.scene.renderStats.media.length<=6);assert.ok(state.scene.renderStats.media.every(video=>video.ready>=2));assert.equal(state.scene.facts.done,0);
  assert.equal(state.fonts.length,3);assert.ok(state.fonts.every(face=>face.status==='loaded'));assert.ok(state.background!=='rgba(0, 0, 0, 0)');
  assert.equal(resources.some(name=>name.startsWith('forge-')||name.startsWith('neural-')||/\.(?:mp4|jpe?g)$/.test(name)),false);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  assert.equal(await page.locator('.ff-heading h1').textContent(),'ARES');assert.equal(await page.locator('.ff-heading .ff-eyebrow,.ff-heading .ff-subtitle,.ff-heading h1 em').count(),0);assert.doesNotMatch(await page.locator('.ff-heading').textContent(),/HORIZON|FORGE|视界熔炉|ARES PROJECT/);
  await page.locator('.ff-heading').screenshot({path:join(base,'ares-title-desktop.png')});
  await page.screenshot({path:join(base,'existing-host-routes-workbench.png'),fullPage:true});writeFileSync(join(base,'loading-evidence.json'),JSON.stringify({state,resources,errors,unexpected,newStaticRoutesAvailable:false,mode:'Owned headless production handlers with the observed old static-route table. No user window or actual DSH authentication.'},null,2));console.log('ARES_MODULE_LOADING_EVIDENCE',base);
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'打开总作品',exact:true}).waitFor({state:'visible'});assert.equal(await page.locator('.ff-title').textContent(),'ARES');await page.screenshot({path:join(base,'ares-title-mobile.png')});assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
