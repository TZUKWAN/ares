/** Actual ARES UI, project binding and handlers. A browser lease/webview adapter
 * and remote document are explicit protocol fixtures, not an online cloud test. */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {directRoutes} from './helpers/direct-routes.mjs';
import {initializeProject, linkRoot, changeProject, readProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-two-workspace-cloud-'));
process.env.ARES_HOME=join(base,'home');
const root=join(base,'project');mkdirSync(root);linkRoot(root);
const track=competitionCatalog().find(row=>row.id===5).tracks.find(row=>!row.legacy).track;
let project=initializeProject({root,name:'双工作区云视口验证 · 非竞赛成果',competitionId:5,track,workflowId:'modeling'});
mkdirSync(join(root,project.outputDir),{recursive:true});
writeFileSync(join(root,project.outputDir,'inventory.md'),'# 本地实际工作稿\n\n自有软件验证文件，不是竞赛成果。\n');
const documentUrl='https://www.kdocs.cn/l/aresTwoWorkspaceProtocol';
project=changeProject({root,expectedRevision:project.revision},value=>value.workbench.collaboration={provider:'kdocs',status:'connected',documents:[{id:'two-workspace-cloud-protocol',artifactId:'inventory',name:'金山载体协议验证',link:documentUrl}]});
const original=readFileSync(join(root,'.ares/project.json'));
const api=directRoutes(),origin='http://127.0.0.1:64349';
const {chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);
let browser;
before(async()=>browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}));
after(async()=>{api.dispose();await browser?.close();});

// Same DSH approved lease contract as cloud-viewport.test.mjs. Chromium has no
// Electron webview, so only this explicit native boundary returns an iframe.
const nativeBrowserFixture=`
  window.cloudProtocol={acquires:[],releases:[],urls:[],ready:0,unsubscribed:0};
  window.dshDesktop={protocolVersion:1,browser:{
    async acquire(account){cloudProtocol.acquires.push(account);return{lease:'ares-owned-two-workspace-lease',partition:'persist:ares-owned-two-workspace'}},
    async release(lease){cloudProtocol.releases.push(lease)},
    onOpenRequested(_lease,_handler){return()=>cloudProtocol.unsubscribed++}
  }};
  const actualCreateElement=document.createElement.bind(document);
  document.createElement=function(tag,...args){
    if(String(tag).toLowerCase()!=='webview')return actualCreateElement(tag,...args);
    const view=actualCreateElement('iframe');let current='about:blank',ready=false,loading=false;
    view.dataset.protocolFixture='native-webview-over-iframe';view.title='云网页载体协议夹具';
    view.loadURL=async url=>{cloudProtocol.urls.push(url);current=url;loading=true;view.src=url};
    view.getURL=()=>current;view.getTitle=()=> '云网页载体协议夹具';view.isLoading=()=>loading;
    view.reload=()=>{throw Error('This persistence check must not reload its cloud guest')};
    view.addEventListener('load',()=>{loading=false;view.dispatchEvent(new Event('did-stop-loading'))});
    // The native protocol fixture delivers dom-ready after actual insertion,
    // independently of Chromium's non-network about:blank iframe load event.
    queueMicrotask(()=>{if(view.isConnected&&!ready){ready=true;cloudProtocol.ready++;view.dispatchEvent(new Event('dom-ready'))}});
    return view;
  };
`;

async function pageFor(){
  const errors=[],unexpected=[],businessRequests=[],page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
  page.setDefaultTimeout(14000);page.on('pageerror',error=>errors.push(error.message));let cloudRequests=0;
  await page.addInitScript({content:nativeBrowserFixture});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.href===documentUrl){cloudRequests++;await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body style="background:#eef2f5;color:#233443;font-family:sans-serif;padding:28px"><h1>云网页载体协议夹具</h1><p>只验证视口、租约及界面保活，不冒充真实金山在线编辑。</p></body></html>'});return;}
    if(url.origin!==origin){unexpected.push(url.href);await route.abort();return;}
    if(url.pathname==='/'){
      await route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{margin:0;width:100%;height:100%}.cloud-chat-fixture{display:flex;flex-direction:column;flex:1;height:100%;padding:12px;color:#8aaac0}.cloud-chat-fixture small{font-size:11px;line-height:1.7}.cloud-chat-fixture textarea{margin-top:auto;min-height:86px;padding:12px;background:#112330;color:#d4e9f7;border:1px solid #9bc6e13d;border-radius:8px;font:14px/1.7 sans-serif;resize:none}</style></head><body><div id="root"></div><script type="module">
      import{mountAres}from'/ares/api/v2/app.js';
      window.projectChat=document.createElement('div');projectChat.className='cloud-chat-fixture';projectChat.innerHTML='<small>项目聊天协议夹具 · 不调用在线模型</small><textarea aria-label="云视口项目聊天草稿"></textarea>';
      const native={root:${JSON.stringify(root)},sessionId:'owned-cloud-project-session',definitionId:${JSON.stringify(project.definitionId)},running:false};
      window.app=mountAres(document.querySelector('#root'),{projectSession:{subscribe(){return()=>{}},setProject(){},getState(){return native},updateView(){},setView(){},updateContext(){}},browserWorkspaces:()=>({list:{getSnapshot:()=>({phase:'ready',items:[{path:${JSON.stringify(root)},sessionIds:[native.sessionId]}]}),subscribe(){return()=>{}}}}),mountProject(node){if(!node.contains(projectChat))node.append(projectChat)}});
      </script></body></html>`});return;
    }
    if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';
    const path=url.pathname.slice('/ares/api/v2/'.length),data=request.postData()?JSON.parse(request.postData()):undefined;
    if(data)businessRequests.push({path,data});
    const response=await api.request(path+url.search,data,{raw:true,host:url.host,headers:request.headers()});
    await route.fulfill({status:response.status,headers:response.headers,body:response.body});
  });
  await page.goto(origin);await page.locator('#root[data-galaxy-ready=true][data-workspace=projects]').waitFor();await page.evaluate(()=>document.fonts.ready);
  return{page,errors,unexpected,businessRequests,cloudRequests:()=>cloudRequests};
}

async function alignedCloud(page,selector){
  await page.waitForFunction(selector=>{
    const frame=document.querySelector('.ares-cloud-frame'),anchor=document.querySelector(selector);
    if(!frame||!anchor||getComputedStyle(frame).visibility!=='visible')return false;
    const a=frame.getBoundingClientRect(),b=anchor.getBoundingClientRect();
    return a.width>100&&a.height>100&&Math.abs(a.x-b.x)<2&&Math.abs(a.y-b.y)<2&&Math.abs(a.width-b.width)<2&&Math.abs(a.height-b.height)<2;
  },selector);
  return page.locator('.ares-cloud-frame').boundingBox();
}

test('one cloud guest and approved lease survive composer/project switching, expansion and comparison with the project chat intact',async()=>{
  const f=await pageFor(),{page}=f,positions={};
  try{
    await page.getByLabel('云视口项目聊天草稿').fill('切换编排与项目后保留的输入，不发送。');
    await page.locator('.process-step:visible').first().click();
    await page.locator('.neural-output').first().click();
    await page.locator('[data-neural-scene][data-phase=note]').waitFor();
    await page.locator('[data-action=artifact-source][data-id=cloud]').click();
    await page.frameLocator('.ares-cloud-host iframe').getByRole('heading',{name:'云网页载体协议夹具',exact:true}).waitFor();
    positions.embedded=await alignedCloud(page,'.nebula-cloud-surface [data-cloud-anchor]');
    assert.equal(f.cloudRequests(),1);
    await page.evaluate(()=>{window.keptCloudGuest=document.querySelector('.ares-cloud-host iframe');window.keptProjectInput=document.querySelector('[aria-label="云视口项目聊天草稿"]');});
    const initial=await page.evaluate(()=>({src:keptCloudGuest.src,name:keptCloudGuest.getAttribute('name'),partition:keptCloudGuest.getAttribute('partition'),node:keptCloudGuest.getAttribute('nodeintegration'),preload:keptCloudGuest.getAttribute('preload')}));
    assert.equal(initial.src,documentUrl);assert.equal(initial.name,'ares-owned-two-workspace-lease');assert.equal(initial.partition,'persist:ares-owned-two-workspace');assert.equal(initial.node,null);assert.equal(initial.preload,null);
    await page.screenshot({path:join(base,'project-cloud-embedded.png')});

    await page.locator('[data-action=workspace][data-id=composer]').click();
    await page.locator('#root[data-workspace=composer]').waitFor();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.ares-cloud-frame')).visibility==='hidden');
    assert.equal(await page.locator('.ares-cloud-frame').evaluate(node=>getComputedStyle(node).pointerEvents),'none');
    assert.equal(await page.evaluate(()=>keptCloudGuest===document.querySelector('.ares-cloud-host iframe')),true);
    assert.equal(f.cloudRequests(),1);assert.deepEqual(await page.evaluate(()=>cloudProtocol.releases),[]);
    await page.screenshot({path:join(base,'composer-cloud-suspended.png')});

    await page.locator('[data-action=workspace][data-id=projects]').click();
    positions.returned=await alignedCloud(page,'.nebula-cloud-surface [data-cloud-anchor]');
    assert.equal(await page.evaluate(()=>keptCloudGuest===document.querySelector('.ares-cloud-host iframe')),true);
    assert.equal(await page.evaluate(()=>keptCloudGuest.src),documentUrl);assert.equal(f.cloudRequests(),1);
    assert.equal(await page.getByLabel('云视口项目聊天草稿').inputValue(),'切换编排与项目后保留的输入，不发送。');
    assert.equal(await page.getByLabel('云视口项目聊天草稿').isVisible(),true);

    await page.locator('[data-action=cloud-page-expand]').click();
    await page.locator('.galaxy-console[data-galaxy-panel=cloud]').waitFor();
    positions.expanded=await alignedCloud(page,'.galaxy-console [data-cloud-anchor]');
    assert.ok(positions.expanded.width>positions.embedded.width);
    assert.equal(await page.getByLabel('云视口项目聊天草稿').isVisible(),true);
    await page.screenshot({path:join(base,'project-cloud-expanded.png')});
    await page.getByRole('button',{name:'返回项目',exact:true}).click();

    await page.locator('[data-action=artifact-compare-view]').click();
    await page.locator('.nebula-compare-grid').waitFor();
    await page.locator('[data-compare-local-seat]').getByRole('heading',{name:'本地实际工作稿',exact:true}).waitFor();
    positions.compare=await alignedCloud(page,'.nebula-compare-grid [data-cloud-anchor]');
    assert.equal(await page.evaluate(()=>keptCloudGuest===document.querySelector('.ares-cloud-host iframe')),true);
    assert.equal(await page.evaluate(()=>keptProjectInput===document.querySelector('[aria-label="云视口项目聊天草稿"]')),true);
    assert.equal(await page.getByLabel('云视口项目聊天草稿').isVisible(),true);
    assert.equal(f.cloudRequests(),1);
    const proof=await page.evaluate(()=>structuredClone(cloudProtocol));
    assert.deepEqual(proof.acquires,['cwd:'+root]);assert.deepEqual(proof.releases,[]);assert.deepEqual(proof.urls,[documentUrl]);assert.equal(proof.ready,1);
    assert.equal(f.businessRequests.filter(row=>row.path==='project/cloud/view').length,1);
    assert.deepEqual(readFileSync(join(root,'.ares/project.json')),original);assert.equal(readProject(root).progress.done,0);
    assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
    await page.screenshot({path:join(base,'project-cloud-compare.png')});
    await page.evaluate(()=>window.app.destroy());
    await page.waitForFunction(()=>cloudProtocol.releases.length===1);
    assert.deepEqual(await page.evaluate(()=>cloudProtocol.releases),['ares-owned-two-workspace-lease']);
    assert.equal(await page.locator('.ares-cloud-host iframe').count(),0);
    writeFileSync(join(base,'cloud-viewport-evidence.json'),JSON.stringify({mode:'Actual ARES UI/routes/files with explicit native lease and remote-page protocol fixtures, no online cloud execution',positions,initial,proof,finalProof:await page.evaluate(()=>structuredClone(cloudProtocol)),cloudRequests:f.cloudRequests(),errors:f.errors,unexpected:f.unexpected},null,2));
    console.log('TWO_WORKSPACE_CLOUD_EVIDENCE',base);
  }catch(error){
    writeFileSync(join(base,'failure-debug.json'),JSON.stringify(await page.evaluate(()=>({body:document.body.textContent,proof:window.cloudProtocol,frame:document.querySelector('.ares-cloud-frame')?.outerHTML,cloudMessage:[...document.querySelectorAll('[data-cloud-message]')].map(n=>n.textContent)})),null,2));
    await page.screenshot({path:join(base,'failure-page.png')});throw error;
  }finally{await page.close();}
});
