/** Actual ARES source, production routes and local files in owned Chromium.
 * Native session/composer slots are explicit protocol fixtures, no online model. */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable, Writable} from 'node:stream';
import {createRequire} from 'node:module';
import {createRoutes} from '../host/routes.js';
import {initializeProject, linkRoot, readProject, listProjects} from '../host/projects.js';
import {competitionCatalog, readConfiguration} from '../host/catalog.js';
import {readCompetitionWorkflow, saveCompetitionWorkflow} from '../host/competition-workflows.js';

const base = mkdtempSync(join(process.env.ARES_TEST_ROOT || tmpdir(), 'ares-two-workspaces-'));
const origin = 'http://127.0.0.1:64348';
const {chromium} = createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);
let browser;
before(async () => browser = await chromium.launch({headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']}));
after(async () => browser?.close());

function actualRoutes() {
  const ctx = {get(name) {
    if (name === 'sessionController') return {inspect() { assert.fail('No actual native session inspection in a UI protocol fixture'); }};
    if (name === 'agents') return {get() { return null; }, list() { return []; }, isOwnedBy() { return false; }};
    if (name === 'jobs') return {list() { return []; }};
  }};
  const native = {capability: () => ({available:false, source:'explicit-ui-native-protocol-fixture'}),
    forEditor() { assert.fail('UI fixture must never create an actual editor preset'); },
    inspectEditorTools() { assert.fail('UI fixture must never claim an actual native tool inspection'); }};
  const server = createRoutes(ctx, native, undefined, {standalone:true});
  return {dispose:server.dispose, async request(path, data, headers={}) {
    const url='/ares/api/v2/'+path, route=server.routes.find(row=>row.path===url.split('?')[0]);
    if(!route)throw Error('Missing actual production route: '+url);
    const request=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);
    request.method=data===undefined?'GET':'POST';request.url=url;request.headers={...headers,host:new URL(origin).host,'content-type':'application/json'};request.socket={remoteAddress:'127.0.0.1'};
    const chunks=[];let status=200,responseHeaders={},finish;
    const ended=new Promise(resolve=>finish=resolve),response=new Writable({write(chunk,_encoding,next){chunks.push(Buffer.from(chunk));next();},final(next){next();finish();}});
    response.headersSent=false;response.writeHead=(code,next={})=>{status=code;responseHeaders=next;response.headersSent=true;};
    await route.handler(request,response);await ended;
    return {status,headers:responseHeaders,body:Buffer.concat(chunks)};
  }};
}

function projectFixture(home, name='已有参赛项目') {
  const root=join(home,'project');mkdirSync(root);linkRoot(root);
  const competition=competitionCatalog().find(row=>row.id===5);
  const project=initializeProject({root,name,competitionId:competition.id,track:competition.tracks.find(row=>!row.legacy).track,workflowId:'modeling'});
  mkdirSync(join(root,project.outputDir),{recursive:true});
  writeFileSync(join(root,project.outputDir,'inventory.md'),'# 实际本地项目作品\n\n自有软件验证文件，非竞赛成果。\n');
  return project;
}

async function ownedPage(label, {existing=false,width=1920,height=1080}={}) {
  const home=join(base,label);mkdirSync(home);process.env.ARES_HOME=join(home,'home');
  const project=existing?projectFixture(home):null, api=actualRoutes(),errors=[],external=[],businessRequests=[];
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.setDefaultTimeout(14000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin){external.push(url.href);await route.abort();return;}
    if(url.pathname==='/'){
      await route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{margin:0;width:100%;height:100%}.workspace-native-fixture{display:flex;flex:1;min-height:0;flex-direction:column;height:100%;color:#8daec6}.workspace-native-fixture small{font-size:11px;line-height:1.7}.workspace-native-fixture textarea{margin-top:auto;min-height:78px;padding:12px;background:#10202e;color:#d0e5f3;border:1px solid #a0c9e33d;border-radius:9px;resize:none;font:14px/1.7 sans-serif}</style></head><body><div id="root"></div><script type="module">
      import{mountAres}from'/ares/api/v2/app.js';
      window.editorContexts=[];window.projectContexts=[];window.viewContexts=[];
      function slot(kind){const node=document.createElement('div');node.className='workspace-native-fixture';node.innerHTML='<small>'+kind+'助手协议夹具 · 不调用模型</small><textarea aria-label="'+kind+'助手协议草稿"></textarea>';return node;}
      window.editorSlot=slot('编排');window.projectSlot=slot('项目');
      const editorSession={subscribe(){return()=>{}},setVisible(value){window.editorVisible=value},updateContext(value){window.editorContexts.push(structuredClone(value));},getState(){return{running:false}},hint(value){window.editorHint=value}};
      const projectSession={subscribe(){return()=>{}},setProject(value){window.projectContexts.push(value?structuredClone(value):null)},getState(){return{running:false}},hint(value){window.projectHint=value},setView(value){window.viewContexts.push(structuredClone(value))},updateContext(value){window.viewContexts.push(structuredClone(value))},updateViewContext(value){window.viewContexts.push(structuredClone(value))}};
      window.app=mountAres(document.querySelector('#root'),{editorSession,projectSession,mountEditor(node){if(!node.contains(editorSlot))node.append(editorSlot)},mountProject(node){if(!node.contains(projectSlot))node.append(projectSlot)}});
      </script></body></html>`});return;
    }
    if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';
    const path=url.pathname.slice('/ares/api/v2/'.length),data=request.postData()?JSON.parse(request.postData()):undefined;
    if(data)businessRequests.push({path,data});
    const response=await api.request(path+url.search,data,request.headers());
    await route.fulfill({status:response.status,headers:response.headers,body:response.body});
  });
  await page.goto(origin);await page.locator('#root[data-galaxy-ready=true]').waitFor();await page.evaluate(()=>document.fonts.ready);
  return {page,home,project,api,errors,external,businessRequests,async dispose(){await page.close();api.dispose();}};
}

async function composer(page) {
  await page.locator('[data-action=workspace][data-id=composer]').click();
  await page.locator('#root[data-workspace=composer]').waitFor();
  await page.getByLabel('选择比赛',{exact:true}).waitFor();
}
async function chooseCompetition(page,id) {
  await page.getByLabel('选择比赛',{exact:true}).selectOption(String(id));
  await page.getByLabel('步骤名称',{exact:true}).waitFor();
  await page.waitForFunction(id=>{const editor=document.querySelector('.ares-composer-editor');return Number(document.querySelector('[data-composer-competition]')?.value)===id&&Number(editor?.dataset.competitionId)===id&&editor?.getAttribute('aria-busy')==='false';},id);
}
async function savedFlow(page) {
  const responsePromise=page.waitForResponse(response=>response.url().includes('/competition/workflow/save')&&response.request().method()==='POST');
  await page.locator('[data-action=competition-flow-save]').click();
  const response=await responsePromise,body=await response.json();
  assert.equal(response.status(),200,JSON.stringify(body));assert.equal(body.ok,true,JSON.stringify(body));
  return body;
}

test('a competition and track workflow can really be saved without a project and adopted by a new project',async()=>{
  const f=await ownedPage('library-before-project');const {page}=f;
  try{
    assert.equal(listProjects().length,0);
    await composer(page);await chooseCompetition(page,5);
    const track=await page.getByLabel('选择赛道',{exact:true}).inputValue();assert.ok(track);
    await page.getByLabel('步骤名称',{exact:true}).fill('界面保存的本赛第一阶段');
    await page.getByLabel('本步目标',{exact:true}).fill('直接验证保存与项目采用，不是竞赛研究成果。');
    await savedFlow(page);
    const saved=readConfiguration().workflows.find(row=>row.steps[0]?.title==='界面保存的本赛第一阶段');
    assert.ok(saved,'No actual saved competition workflow');assert.equal(listProjects().length,0);
    await chooseCompetition(page,2);assert.notEqual(await page.getByLabel('步骤名称',{exact:true}).inputValue(),'界面保存的本赛第一阶段');
    await chooseCompetition(page,5);assert.equal(await page.getByLabel('步骤名称',{exact:true}).inputValue(),'界面保存的本赛第一阶段');
    await page.locator('[data-action=competition-flow-create-project]').click();
    const dialog=page.getByRole('dialog',{name:'创建竞赛项目'});await dialog.waitFor();
    const root=join(f.home,'created-project');mkdirSync(root);
    await dialog.getByLabel('项目名称',{exact:true}).fill('真实采用本赛流程的验证项目');
    await dialog.getByLabel('项目目录',{exact:true}).fill(root);
    await dialog.locator('[data-action=project-create]').click();await dialog.waitFor({state:'detached'});
    const project=readProject(root);assert.equal(project.workflow.id,saved.id);assert.equal(project.workflow.steps[0].title,'界面保存的本赛第一阶段');assert.equal(project.competition.id,5);assert.equal(project.competition.track,track);assert.equal(project.progress.done,0);
    const initialization=f.businessRequests.find(row=>row.path==='project/init')?.data;
    assert.equal(initialization?.flowMode,'library');assert.equal(initialization?.workflowId,saved.id);
    assert.match(initialization?.expectedWorkflowHash||'',/^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(initialization?.expectedConfigurationRevision));
    assert.equal(await page.locator('#root').getAttribute('data-workspace'),'projects');
    assert.equal(await page.getByLabel('项目助手协议草稿').isVisible(),true);
    assert.deepEqual(f.errors,[]);assert.deepEqual(f.external,[]);
    await page.screenshot({path:join(base,'saved-flow-new-project.png')});
    writeFileSync(join(base,'library-project-evidence.json'),JSON.stringify({savedWorkflowId:saved.id,projectId:project.id,definitionId:project.definitionId,competition:project.competition,done:project.progress.done,requests:f.businessRequests.map(row=>row.path)},null,2));
    console.log('TWO_WORKSPACE_EVIDENCE',base);
  }finally{await f.dispose();}
});

test('an external update to the same competition flow retains local edits and requires explicit conflict resolution',async()=>{
  const f=await ownedPage('same-flow-concurrency');const {page}=f;
  try{
    await composer(page);await chooseCompetition(page,5);await savedFlow(page);
    const scope={competitionId:5,track:await page.getByLabel('选择赛道',{exact:true}).inputValue(),edition:'',group:''};
    const remote=readCompetitionWorkflow(scope),originalTitle=remote.workflow.steps[0].title;
    await page.getByLabel('步骤名称',{exact:true}).fill('需要保留的本地第一步修改');
    const external=structuredClone(remote.workflow);external.steps[1].objective='外部真实保存的第二步目标，不可静默丢失。';
    await saveCompetitionWorkflow({...scope,workflow:external,expectedRevision:remote.expectedRevision,expectedWorkflowHash:remote.workflowHash});
    await page.locator('[data-action=competition-flow-reload]').click();
    await page.getByRole('alert').filter({hasText:'外部流程已更新，您的草稿已保留'}).waitFor();
    assert.equal(await page.getByLabel('步骤名称',{exact:true}).inputValue(),'需要保留的本地第一步修改');
    assert.equal(await page.locator('[data-action=competition-flow-save]').isDisabled(),true);
    const stored=readCompetitionWorkflow(scope).workflow;
    assert.equal(stored.steps[0].title,originalTitle);assert.equal(stored.steps[1].objective,external.steps[1].objective);
    await page.screenshot({path:join(base,'same-flow-conflict.png')});
    await page.locator('[data-action=competition-flow-use-remote]').click();
    assert.equal(await page.getByLabel('步骤名称',{exact:true}).inputValue(),originalTitle);
    await page.locator('[data-action=competition-flow-retained]').click();
    assert.match(await page.getByRole('dialog').textContent(),/需要保留的本地第一步修改/);
    await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    await page.locator('.ares-composer-editor .ares-step').nth(1).click();
    assert.equal(await page.getByLabel('本步目标',{exact:true}).inputValue(),external.steps[1].objective);
    await page.locator('.ares-composer-editor .ares-step').first().click();
    await page.getByLabel('步骤名称',{exact:true}).fill('明确采用最新后重新加入的本地修改');await savedFlow(page);
    const resolved=readCompetitionWorkflow(scope).workflow;
    assert.equal(resolved.steps[0].title,'明确采用最新后重新加入的本地修改');assert.equal(resolved.steps[1].objective,external.steps[1].objective);
    assert.equal(listProjects().length,0);assert.deepEqual(f.errors,[]);assert.deepEqual(f.external,[]);
    writeFileSync(join(base,'concurrency-evidence.json'),JSON.stringify({originalTitle,externalSecondObjective:external.steps[1].objective,resolvedFirstTitle:resolved.steps[0].title,projects:listProjects().length},null,2));
  }finally{await f.dispose();}
});

test('the two workspaces retain separate native drafts and saved composing never changes an existing project',async()=>{
  const f=await ownedPage('scope-and-drafts',{existing:true});const {page,project}=f;
  const bytes=readFileSync(join(project.root,'.ares/project.json'));
  try{
    await page.locator('[data-action=workspace][data-id=projects]').click();
    await page.getByLabel('项目助手协议草稿').fill('项目会话草稿，需要保留。');
    await page.evaluate(()=>window.keptProjectDraft=document.querySelector('[aria-label="项目助手协议草稿"]'));
    await composer(page);await chooseCompetition(page,5);
    await page.getByLabel('编排助手协议草稿').fill('编排会话草稿，需要保留。');
    await page.evaluate(()=>window.keptEditorDraft=document.querySelector('[aria-label="编排助手协议草稿"]'));
    const second=page.locator('.ares-composer-editor .ares-step').nth(1),id=await second.getAttribute('data-id');await second.click();
    await page.waitForFunction(id=>window.editorContexts.at(-1)?.activeStepId===id,id);
    await page.getByLabel('步骤名称',{exact:true}).fill('本赛流程独立保存的阶段');await savedFlow(page);
    assert.deepEqual(readFileSync(join(project.root,'.ares/project.json')),bytes);
    await page.locator('[data-action=workspace][data-id=projects]').click();
    assert.equal(await page.getByLabel('项目助手协议草稿').inputValue(),'项目会话草稿，需要保留。');
    assert.equal(await page.evaluate(()=>window.keptProjectDraft===document.querySelector('[aria-label="项目助手协议草稿"]')),true);
    await composer(page);
    assert.equal(await page.getByLabel('编排助手协议草稿').inputValue(),'编排会话草稿，需要保留。');
    assert.equal(await page.evaluate(()=>window.keptEditorDraft===document.querySelector('[aria-label="编排助手协议草稿"]')),true);
    assert.deepEqual(readFileSync(join(project.root,'.ares/project.json')),bytes);
    assert.equal(readProject(project.root).progress.done,0);assert.deepEqual(f.errors,[]);assert.deepEqual(f.external,[]);
    await page.screenshot({path:join(base,'composer-existing-project-independent.png')});
  }finally{await f.dispose();}
});

test('a late competition read cannot replace the selected project step and restores its exact composer scope on return',async()=>{
  const f=await ownedPage('delayed-competition-read',{existing:true});const {page,project}=f;
  const original=readFileSync(join(project.root,'.ares/project.json'));
  const target=competitionCatalog().find(row=>row.id===2),track=target.tracks.find(row=>!row.legacy).track;
  let release;const gate=new Promise(resolve=>release=resolve);let entered;
  const held=new Promise(resolve=>entered=resolve);let delaying=true;
  try{
    await composer(page);await chooseCompetition(page,5);
    // Delay the real request, then resume the existing production route handler.
    // No business response or workflow payload is substituted by the fixture.
    await page.route('**/ares/api/v2/competition/workflow',async route=>{
      const body=route.request().postDataJSON();
      if(delaying&&Number(body.competitionId)===target.id){delaying=false;entered();await gate;}
      await route.fallback();
    });
    const responseReady=page.waitForResponse(response=>response.url().endsWith('/ares/api/v2/competition/workflow')&&Number(response.request().postDataJSON()?.competitionId)===target.id);
    await page.getByLabel('选择比赛',{exact:true}).selectOption(String(target.id));await held;
    await page.locator('[data-action=workspace][data-id=projects]').click();
    await page.locator('.process-step[data-id=rules]').click();
    await page.locator('[data-action=nebula-node-open][data-id=rules]').click();
    await page.getByRole('dialog').getByRole('heading',{name:'规则与提交要求',exact:true}).waitFor();
    await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    assert.equal(await page.locator('.process-step[data-id=rules]').evaluate(node=>node.classList.contains('is-selected')),true);
    release();const response=await responseReady;await response.finished();
    assert.equal(response.status(),200);
    assert.equal(await page.locator('#root').getAttribute('data-workspace'),'projects');
    assert.equal(await page.locator('.process-step[data-id=rules]').evaluate(node=>node.classList.contains('is-selected')),true);
    assert.deepEqual(readFileSync(join(project.root,'.ares/project.json')),original);
    await composer(page);
    await page.waitForFunction(id=>{const editor=document.querySelector('.ares-composer-editor');return Number(editor?.dataset.competitionId)===id&&editor?.getAttribute('aria-busy')==='false';},target.id);
    assert.equal(await page.getByLabel('选择比赛',{exact:true}).inputValue(),String(target.id));
    assert.equal(await page.getByLabel('选择赛道',{exact:true}).inputValue(),track);
    await page.waitForFunction(({id,track})=>{const context=window.editorContexts.at(-1),workflow=context?.configuration?.workflows?.find(row=>row.id===context.workflowId);return workflow?.competitionTemplate?.competitionId===id&&workflow.competitionTemplate.track===track&&workflow.steps.some(row=>row.id===context.activeStepId);},{id:target.id,track});
    const context=await page.evaluate(()=>{const value=window.editorContexts.at(-1),workflow=value.configuration.workflows.find(row=>row.id===value.workflowId);return {workflowId:value.workflowId,activeStepId:value.activeStepId,scope:workflow.competitionTemplate};});
    assert.deepEqual(readFileSync(join(project.root,'.ares/project.json')),original);assert.equal(readProject(project.root).progress.done,0);
    assert.deepEqual(f.errors,[]);assert.deepEqual(f.external,[]);
    writeFileSync(join(base,'delayed-read-evidence.json'),JSON.stringify({selectedProjectStep:'rules',responseStatus:response.status(),returnedEditor:context,projectUnchanged:true},null,2));
  }finally{release();await f.dispose();}
});

test('competition taxonomy, editable flow and resident native inputs fit both workspaces at desktop and narrow widths',async()=>{
  const f=await ownedPage('responsive-workspaces',{existing:true});const {page}=f;const evidence=[];
  try{
    for(const width of [1920,1280,800,390]){
      await page.setViewportSize({width,height:1000});await composer(page);await chooseCompetition(page,5);
      assert.equal(await page.locator('.galaxy-nav>[data-action=workspace]').count(),2);
      assert.equal(await page.getByLabel('选择比赛',{exact:true}).locator('option:not([value=""])').count(),competitionCatalog().length);
      assert.equal(await page.getByLabel('选择赛道',{exact:true}).isVisible(),true);
      assert.equal(await page.getByLabel('编排助手协议草稿').isVisible(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      const editor=await page.locator('.ares-composer-editor').boundingBox();assert.ok(editor.height>=90&&editor.width>=250,JSON.stringify({width,editor}));
      const canvas=await page.locator('.ares-composer-editor .ares-flow-map').boundingBox();assert.ok(canvas.width>=250&&canvas.height>=220,JSON.stringify({width,canvas}));
      const composerLayout=await page.evaluate(()=>{const box=node=>{const r=node.getBoundingClientRect(),c=getComputedStyle(node);return {className:node.className,x:r.x,y:r.y,width:r.width,height:r.height,scrollTop:node.scrollTop,display:c.display,order:c.order,gridRow:c.gridRow,gridColumn:c.gridColumn};};return [...document.querySelectorAll('.ares-composer-editor,.ares-composer-editor .ares-studio,.ares-composer-editor .ares-studio>*')].map(box)});
      await page.screenshot({path:join(base,'composer-'+width+'.png')});
      await page.locator('[data-action=workspace][data-id=projects]').click();
      assert.equal(await page.getByLabel('项目助手协议草稿').isVisible(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      await page.screenshot({path:join(base,'project-'+width+'.png')});evidence.push({width,editor,composerLayout});
    }
    assert.equal(readProject(f.project.root).progress.done,0);assert.deepEqual(f.errors,[]);assert.deepEqual(f.external,[]);
    writeFileSync(join(base,'responsive-evidence.json'),JSON.stringify(evidence,null,2));
  }finally{await f.dispose();}
});
