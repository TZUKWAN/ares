import './helpers/environment.mjs';
import {sceneBrowserArgs} from './helpers/environment.mjs';
/** Production drawing/UI and real files in an owned headless browser.
 * Native slots are explicit fixtures; no online model or cloud calls. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {directRoutes} from './helpers/direct-routes.mjs';
import {readConfiguration,saveConfiguration,competitionCatalog} from '../host/catalog.js';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {forgeModel} from '../client/forge-data.js';
import {neuralSceneTargets} from '../client/neural-scene.js';
import {recordProjectWork} from '../host/project-progress.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-neural-scene-'));
process.env.ARES_HOME=join(base,'home');
const configuration=readConfiguration(),template=configuration.workflows.find(w=>w.id==='modeling'),fixtures=[];
for(const count of [1,9,40]){
 const workflow={...structuredClone(template),id:'neural-check-'+count,title:'神经场景'+count+'步骤软件验证',steps:Array.from({length:count},(_,i)=>({...structuredClone(template.steps[0]),id:'step-'+i,title:'研究阶段 '+String(i+1).padStart(2,'0'),objective:'在自有测试目录验证真实步骤、作品预览与交互，不代表竞赛成果。',dependsOn:i?['step-'+(i-1)]:[],outputs:[{id:'artifact-'+i,title:'阶段'+(i+1)+'工作稿',kind:'file',path:'step-'+i+'.md',format:'md',requirement:'required'}]}))};configuration.workflows.push(workflow);fixtures.push({count,workflow});
}
saveConfiguration(configuration,configuration.revision);
for(const f of fixtures){f.root=join(base,'project-'+f.count);mkdirSync(f.root);linkRoot(f.root);f.project=initializeProject({root:f.root,name:'神经界面软件验证 · '+f.count+'步 · 非竞赛成果',competitionId:5,track:competitionCatalog().find(c=>c.id===5).tracks[0].track,workflowId:f.workflow.id});mkdirSync(join(f.root,f.project.outputDir),{recursive:true});writeFileSync(join(f.root,f.project.outputDir,'step-0.md'),'# 真实本地工作稿\n\n仅验证 ARES 界面与文件读取，未执行线上模型任务。\n');f.bytes=readFileSync(join(f.root,'.ares/project.json'));}

test('neural targets keep all 1/9/40 real steps and bounded selectable pages without changing any project fact',()=>{
 for(const f of fixtures)for(const [w,h]of [[950,800],[480,680],[360,280]]){
  const model=forgeModel(f.project,{productCentric:true}),before=JSON.stringify(model),first=neuralSceneTargets(model,{x:20,y:150,w,h});
  assert.equal(first.steps.length,f.count);const visited=new Set();
  for(let page=0;page<first.pages;page++){const g=neuralSceneTargets(model,{x:20,y:150,w,h},{page});for(const n of g.steps){assert.ok(Number.isFinite(n.x)&&Number.isFinite(n.y)&&n.scale>0);if(n.visible){visited.add(n.id);assert.ok(n.x>20&&n.x<20+w);assert.ok(n.y>150&&n.y<150+h);}}}
  assert.equal(visited.size,f.count);const focused=neuralSceneTargets(model,{x:20,y:150,w,h},{focusId:'step-0'});assert.ok(focused.steps.filter(n=>n.visible).length<=focused.capacity);assert.equal(focused.focused.id,'step-0');assert.ok(focused.core.r<first.core.r||w<480);assert.equal(JSON.stringify(model),before);assert.deepEqual(readFileSync(join(f.root,'.ares/project.json')),f.bytes);
 }
});

const api=directRoutes(),origin='http://127.0.0.1:64357',errors=[],external=[],{chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);let browser;
before(async()=>browser=await chromium.launch({headless:true,args:sceneBrowserArgs}));after(async()=>{await browser?.close();api.dispose();});
async function ownedPage({motion=false,record=false}={}){const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:motion?'no-preference':'reduce',...(record?{recordVideo:{dir:join(base,'recordings'),size:{width:1920,height:1080}}}:{})});page.setDefaultTimeout(14000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url());if(url.origin!==origin){external.push(url.href);await route.abort();return;}
 if(url.pathname==='/'){await route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{margin:0;width:100%;height:100%}.neural-native-fixture{height:100%;display:flex;flex-direction:column;color:#aaa;font:12px sans-serif}.neural-native-fixture textarea{margin-top:auto;min-height:90px;background:#1b1d1a;border:1px solid #d1c99f33;border-radius:15px;color:#ddd;padding:15px;font:15px/1.8 sans-serif}</style></head><body><div id="root"></div><script type="module">import{mountAres}from'/ares/api/v2/app.js';const seat=document.createElement('div');seat.className='neural-native-fixture';seat.innerHTML='<small>界面验证 · 原生服务协议夹具 · 不调用模型</small><textarea aria-label="项目助手协议草稿">驻留输入，切换后保留</textarea>';const ed=seat.cloneNode(true);ed.querySelector('textarea').setAttribute('aria-label','编排助手协议草稿');const editorSession={subscribe(){return()=>{}},getState(){return{running:false}},setVisible(){},updateContext(){}};const projectSession={subscribe(){return()=>{}},getState(){return{running:false}},setProject(){},setView(){}};window.app=mountAres(document.querySelector('#root'),{editorSession,projectSession,mountProject(n){if(!n.contains(seat))n.append(seat)},mountEditor(n){if(!n.contains(ed))n.append(ed)}});</script></body></html>`});return;}
 if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';const r=await api.request(url.pathname.slice('/ares/api/v2/'.length)+url.search,request.postData()?JSON.parse(request.postData()):undefined,{raw:true,host:url.host,headers:request.headers()});await route.fulfill({status:r.status,headers:r.headers,body:r.body});
 });await page.goto(origin);await page.locator('#root[data-galaxy-ready=true]').waitFor();await page.evaluate(()=>document.fonts.ready);return page;}
async function select(page,f){await page.locator('[data-action=galaxy-projects]').first().click();await page.locator('.galaxy-project-choice').filter({hasText:f.project.name}).click();await page.waitForFunction(count=>window.app.inspectGalaxy()?.facts.total===count,f.count);}
async function hit(page,selector){return page.locator(selector).first().evaluate(el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {hit:top===el||el.contains(top),x:r.x,y:r.y,w:r.width,h:r.height};});}

test('actual neural scene opens a real stage and artifact, retains chat, and pages all forty nodes',async()=>{
 const page=await ownedPage(),evidence=[];try{for(const f of fixtures){await select(page,f);assert.equal(await page.locator('[data-neural-scene=true]').count(),1);assert.equal(await page.locator('.process-step').count(),f.count);const state=await page.evaluate(()=>window.app.inspectGalaxy());assert.equal(state.renderer,'reference-video-canvas');assert.equal(state.facts.done,0);assert.equal(state.effects.queued,0);
  const visited=new Set();for(let index=0;index<state.sceneGraph.pages;index++){for(const id of await page.locator('.process-step:visible').evaluateAll(nodes=>nodes.map(n=>n.dataset.id)))visited.add(id);if(index<state.sceneGraph.pages-1)await page.locator('[data-neural-action=next]').click();}assert.equal(visited.size,f.count);
  if(state.sceneGraph.pages>1)while(await page.locator('[data-neural-action=previous]').isEnabled())await page.locator('[data-neural-action=previous]').click();
  await page.screenshot({path:join(base,'overview-'+f.count+'.png')});await page.locator('.process-step[data-id=step-0]').click();await page.locator('[data-neural-focus]:visible').waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.match(await page.locator('.neural-focus h2').textContent(),/研究阶段 01/);assert.ok((await hit(page,'.neural-output')).hit);assert.ok((await hit(page,'[aria-label="项目助手协议草稿"]')).hit);await page.screenshot({path:join(base,'focus-'+f.count+'.png')});
  await page.locator('.neural-output').click();await page.getByRole('heading',{name:'真实本地工作稿',exact:true}).waitFor();assert.ok((await hit(page,'[aria-label="项目助手协议草稿"]')).hit);await page.locator('.ff-right [data-action=work-preview-expand]').click();await page.locator('.galaxy-console').waitFor();await page.locator('[data-action=galaxy-home]').first().click();await page.locator('[data-neural-action=overview]').click();assert.equal(await page.locator('[data-neural-focus]:visible').count(),0);assert.equal(await page.getByLabel('项目助手协议草稿').inputValue(),'驻留输入，切换后保留');assert.deepEqual(readFileSync(join(f.root,'.ares/project.json')),f.bytes);evidence.push({count:f.count,renderer:state.renderer,pages:state.sceneGraph.pages,done:readProject(f.root).progress.done});}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);writeFileSync(join(base,'interaction-evidence.json'),JSON.stringify(evidence,null,2));console.log('NEURAL_SCENE_EVIDENCE',base);
 }finally{await page.close();}
});

test('neural motion really changes pixels, pauses/reduces/hides, and never advances acceptance',async()=>{
 const page=await ownedPage();try{await select(page,fixtures[1]);await page.emulateMedia({reducedMotion:'no-preference'});await page.mouse.move(10,12);await page.waitForFunction(()=>window.app.inspectGalaxy().holding===false&&window.app.inspectGalaxy().renderStats.media.every(video=>video.ready>=2));const capture=()=>page.evaluate(()=>{const c=document.querySelector('.ff-gl'),ctx=c.getContext('2d'),data=ctx.getImageData(0,0,c.width,c.height).data;let hash=2166136261;for(let i=0;i<data.length;i+=17)hash=Math.imul(hash^data[i],16777619);return{hash,scene:window.app.inspectGalaxy()};});
  const a=await capture();await page.waitForFunction(frames=>window.app.inspectGalaxy().renderStats.frames>frames+5,a.scene.renderStats.frames);const b=await capture();assert.notEqual(a.hash,b.hash);assert.ok(b.scene.time>a.scene.time);
  await page.locator('[data-neural-action=pause]').click();const paused=await capture();await page.waitForTimeout(160);const still=await capture();assert.equal(still.hash,paused.hash);assert.equal(still.scene.time,paused.scene.time);
  await page.locator('[data-neural-action=pause]').click();await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelector('[data-neural-scene]').dataset.motion==='reduced');const reduced=await capture();await page.waitForTimeout(140);assert.equal((await capture()).hash,reduced.hash);
  await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('[data-action=workspace][data-id=composer]').click();await page.locator('#root[data-workspace=composer]').waitFor();const hidden=await page.evaluate(()=>window.app.inspectGalaxy());await page.waitForTimeout(160);assert.equal((await page.evaluate(()=>window.app.inspectGalaxy())).renderStats.frames,hidden.renderStats.frames);await page.locator('[data-action=workspace][data-id=projects]').click();
  for(const f of fixtures)assert.deepEqual(readFileSync(join(f.root,'.ares/project.json')),f.bytes);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);writeFileSync(join(base,'motion-evidence.json'),JSON.stringify({initial:a.scene,animated:b.scene,paused:still.scene,reduced:reduced.scene,hidden},null,2));
 }finally{await page.close();}
});

test('stage controls and resident chat stay usable at 1280, 800 and 390 without horizontal overflow',async()=>{const page=await ownedPage();try{for(const [width,height]of [[1280,1000],[800,1000],[390,844]]){await page.setViewportSize({width,height});await select(page,fixtures[1]);const native=await hit(page,'[aria-label="项目助手协议草稿"]');assert.ok(native.hit);assert.ok(native.w>120&&native.h>35);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const node=await hit(page,'.process-step:visible');assert.ok(node.w>50&&node.hit);await page.screenshot({path:join(base,'responsive-'+width+'.png')});}assert.deepEqual(errors,[]);}finally{await page.close();}});

test('preserved reference entrance, decoded media, spring focus and fan reveal run in the actual ARES interface',async()=>{
 const page=await ownedPage({motion:true,record:process.env.ARES_NEURAL_RECORD==='1'}),video=page.video(),trace={boundary:'Real ARES interface and original reference media; native service slot fixture, no model or cloud execution'};
 try{
  await select(page,fixtures[1]);await page.getByRole('button',{name:'重播开场动画',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-neural-scene]').dataset.neuralIntro==='playing');
  trace.start=await page.evaluate(()=>window.app.inspectGalaxy());
  await page.waitForFunction(()=>document.querySelector('[data-neural-scene]').dataset.neuralIntro==='complete');
  await page.waitForFunction(()=>window.app.inspectGalaxy().renderStats.media.every(v=>v.ready>=2&&!v.paused));
  trace.hub=await page.evaluate(()=>window.app.inspectGalaxy());
  assert.ok(trace.hub.time>trace.start.time+2);assert.ok(trace.hub.renderStats.frames>trace.start.renderStats.frames+30);
  const initialVideoTimes=trace.hub.renderStats.media.map(v=>[v.id,v.time]);
  await page.waitForFunction(times=>{const current=window.app.inspectGalaxy().renderStats.media;return current.every(v=>Math.abs(v.time-times.find(row=>row[0]===v.id)[1])>.08);},initialVideoTimes);
  await page.screenshot({path:join(base,'reference-animated-hub.png')});
  const stageTarget=await page.locator('.process-step[data-id=step-0]').boundingBox();
  await page.mouse.move(stageTarget.x+stageTarget.width/2,stageTarget.y+stageTarget.height/2);
  await page.waitForFunction(()=>window.app.inspectGalaxy().holding===true);
  await page.locator('.process-step[data-id=step-0]').click();
  trace.focusFrames=await page.evaluate(()=>new Promise(resolve=>{const samples=[];function sample(){const state=window.app.inspectGalaxy();samples.push({time:performance.now(),core:state.sceneGraph.core,fanOpacity:getComputedStyle(document.querySelector('.neural-output')).opacity,fanPath:document.querySelector('.fan-thread')?.getAttribute('d')});if(samples.length<80)requestAnimationFrame(sample);else resolve(samples);}requestAnimationFrame(sample);}));
  assert.ok(Math.max(...trace.focusFrames.map(s=>s.core.x))-Math.min(...trace.focusFrames.map(s=>s.core.x))>80,'Original spring visibly moves the core into the module column');
  assert.ok(trace.focusFrames.some(s=>Number(s.fanOpacity)<.5)&&Number(trace.focusFrames.at(-1).fanOpacity)>.98,'Original staggered fan visibly reveals its actual artifact');
  assert.ok(new Set(trace.focusFrames.map(s=>s.fanPath)).size>10);assert.equal(await page.locator('[data-neural-scene]').getAttribute('data-phase'),'module');
  await page.screenshot({path:join(base,'reference-animated-module.png')});await page.evaluate(()=>window.keptReferenceFan=document.querySelector('.neural-output'));
  const artifactTarget=await page.locator('.neural-output').boundingBox();
  await page.mouse.move(artifactTarget.x+artifactTarget.width/2,artifactTarget.y+artifactTarget.height/2);
  await page.waitForFunction(()=>window.app.inspectGalaxy().holding===true);
  await page.locator('.neural-output').click();await page.getByRole('heading',{name:'真实本地工作稿',exact:true}).waitFor();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.ff-right')).opacity==='1');
  assert.equal(await page.evaluate(()=>window.keptReferenceFan===document.querySelector('.neural-output')),true);
  trace.note=await page.evaluate(()=>window.app.inspectGalaxy());assert.equal(trace.note.phase,'note');assert.ok(Math.abs(trace.note.sceneGraph.core.x-trace.focusFrames.at(-1).core.x)<5,'Note reveals beside the same module scene');
  assert.ok((await hit(page,'[aria-label="项目助手协议草稿"]')).hit);await page.screenshot({path:join(base,'reference-animated-note.png')});
  await page.locator('[data-action=neural-back]').click();assert.equal(await page.locator('[data-neural-scene]').getAttribute('data-phase'),'module');await page.locator('[data-neural-action=overview]').click();assert.equal(await page.locator('[data-neural-scene]').getAttribute('data-phase'),'hub');
  for(const f of fixtures)assert.deepEqual(readFileSync(join(f.root,'.ares/project.json')),f.bytes);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);trace.end=await page.evaluate(()=>window.app.inspectGalaxy());
 }finally{await page.close();if(video)trace.video=await video.path();writeFileSync(join(base,'reference-animation-evidence.json'),JSON.stringify(trace,null,2));}
 console.log('REFERENCE_ANIMATION_EVIDENCE',base);
});

test('history replay reads actual owner-recorded work and leaves project acceptance and bytes untouched',async()=>{
 const f=fixtures[0],p=readProject(f.root),text='本机负责人登记的界面回放验证记录，不是线上队员编辑监控。';
 const result=recordProjectWork({root:f.root,expectedRevision:p.revision,requestId:'reference-history-check-0001',memberId:'owner',stepId:'step-0',kind:'update',summary:text});f.bytes=readFileSync(join(f.root,'.ares/project.json'));
 const page=await ownedPage();try{await select(page,f);await page.locator('.ff-tools [data-action=project-tab][data-id=progress]').click();await page.getByRole('button',{name:'回放最近活动',exact:true}).click();await page.locator('.reference-history:visible').waitFor();assert.match(await page.locator('.reference-history').textContent(),/历史回放/);assert.match(await page.locator('.reference-history').textContent(),new RegExp(text));assert.equal(await page.locator('.reference-history').getAttribute('data-history-id'),result.record.id);assert.equal(await page.evaluate(()=>window.app.inspectGalaxy().effects.replay),true);await page.getByRole('button',{name:'关闭历史回放',exact:true}).click();assert.equal(await page.locator('.reference-history:visible').count(),0);assert.deepEqual(readFileSync(join(f.root,'.ares/project.json')),f.bytes);assert.equal(readProject(f.root).progress.done,0);assert.deepEqual(errors,[]);}finally{await page.close();}
});

test('switching two real stage artifacts and expanding them never reuses another artifact file path',async()=>{
 const current=readConfiguration(),flow=structuredClone(fixtures[0].workflow);flow.id='neural-two-artifacts';flow.steps[0].id='multi-step';flow.steps[0].outputs=[['first','第一份工作稿'],['second','第二份工作稿']].map(([id,title])=>({id:'artifact-'+id,title,kind:'file',path:id+'.md',format:'md',requirement:'required'}));current.workflows.push(flow);saveConfiguration(current,current.revision);
 const root=join(base,'two-artifact-project');mkdirSync(root);linkRoot(root);const project=initializeProject({root,name:'两份作品路径切换软件验证 · 非竞赛成果',competitionId:5,track:competitionCatalog().find(c=>c.id===5).tracks[0].track,workflowId:flow.id});mkdirSync(join(root,project.outputDir),{recursive:true});for(const id of ['first','second'])writeFileSync(join(root,project.outputDir,id+'.md'),'# '+id+' 实际文件\n\n独立真实本地工作稿，用于检查路径隔离。\n');
 const bytes=readFileSync(join(root,'.ares/project.json')),files=['first','second'].map(id=>readFileSync(join(root,project.outputDir,id+'.md'))),page=await ownedPage();
 try{await select(page,{project,count:1});await page.locator('.process-step[data-id=multi-step]').click();for(const id of ['first','second']){await page.locator('.neural-output[data-id=artifact-'+id+']').click();await page.locator('.ff-right').getByRole('heading',{name:id+' 实际文件',exact:true}).waitFor();await page.locator('.ff-right [data-action=work-preview-expand]').click();await page.locator('.galaxy-console').getByRole('heading',{name:id+' 实际文件',exact:true}).waitFor();await page.getByRole('button',{name:'返回项目',exact:true}).click();}
  assert.deepEqual(readFileSync(join(root,'.ares/project.json')),bytes);for(let i=0;i<2;i++)assert.deepEqual(readFileSync(join(root,project.outputDir,['first','second'][i]+'.md')),files[i]);assert.equal(readProject(root).progress.done,0);assert.ok((await hit(page,'[aria-label="项目助手协议草稿"]')).hit);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 }finally{await page.close();}
});


test('four viewport layouts keep real phase controls clear of progress and measure actual scene cost', {timeout:180000},async()=>{
 const started=performance.now(),page=await ownedPage(),results=[];
 try{
  await select(page,fixtures[1]);const actualPageReadyMs=performance.now()-started;
  for(const [width,height] of [[1920,1080],[1366,768],[1024,768],[390,844]]){
   await page.setViewportSize({width,height});await page.mouse.move(1,1);
   await page.waitForFunction(()=>window.app.inspectGalaxy()?.layout?.width>0);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const layout=await page.evaluate(()=>{
    const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const dock=rect(document.querySelector('.reference-project-dock')),actors=[...document.querySelectorAll('.process-step:not([hidden])')].map(node=>({id:node.dataset.id,...rect(node)}));
    const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1;
    return {dock,actors,overlapping:actors.filter(row=>overlap(row,dock)).map(row=>row.id),overflow:document.documentElement.scrollWidth-innerWidth,chatMounted:document.querySelector('[aria-label="项目助手协议草稿"]')?.isConnected===true,scene:window.app.inspectGalaxy().layout,heapBytes:performance.memory?.usedJSHeapSize??null};
   });
   await page.screenshot({path:join(base,'layout-audit-'+width+'.png'),timeout:30000,animations:'disabled'});
   const switchStart=performance.now();await page.locator('.galaxy-nav [data-action=workspace][data-id=composer]').click();await page.locator('#root[data-workspace=composer]').waitFor();const composerSwitchMs=performance.now()-switchStart;
   await page.locator('.galaxy-nav [data-action=workspace][data-id=projects]').click();await page.locator('#root[data-workspace=projects]').waitFor();
   assert.equal(await page.getByLabel('项目助手协议草稿').inputValue(),'驻留输入，切换后保留');
   await page.emulateMedia({reducedMotion:'no-preference'});await page.mouse.move(1,1);const before=await page.evaluate(()=>({at:performance.now(),frames:window.app.inspectGalaxy().renderStats.frames}));await page.waitForTimeout(1600);const after=await page.evaluate(()=>({at:performance.now(),frames:window.app.inspectGalaxy().renderStats.frames}));await page.emulateMedia({reducedMotion:'reduce'});
   results.push({width,height,...layout,composerSwitchMs,sceneFramesPerSecond:(after.frames-before.frames)*1000/(after.at-before.at),source:'actual headless CPU browser/production routes; native chat is an explicit protocol fixture'});
  }
  writeFileSync(join(base,'layout-performance.json'),JSON.stringify({pageReadyAndInitialProjectMs:actualPageReadyMs,totalMeasurementMs:performance.now()-started,results},null,2));console.log('UI_LAYOUT_PERFORMANCE_EVIDENCE',base);
  for(const row of results){assert.equal(row.overflow<=1,true,JSON.stringify(row));assert.equal(row.chatMounted,true);assert.deepEqual(row.overlapping,[],String(row.width)+' phase labels must not be covered by the progress dock');}
  assert.deepEqual(readFileSync(join(fixtures[1].root,'.ares/project.json')),fixtures[1].bytes);
 }finally{await page.close();}
});
