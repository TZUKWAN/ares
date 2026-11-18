import {capture} from './helpers/capture.mjs';
import {projectTab as currentProjectTab,projectFlow,refresh} from './helpers/workbench-navigation.mjs';
import {sceneBrowserArgs} from './helpers/environment.mjs';
/** Owned headless UI against actual production handlers/files; no DSH window or cloud calls. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {directRoutes} from './helpers/direct-routes.mjs';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {captureDraft} from '../host/project-workbench.js';
import {projectProgress} from '../host/project-progress.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-progress-ui-'));
process.env.ARES_HOME=join(base,'home');
const root=join(base,'project');mkdirSync(root);linkRoot(root);
let initial=initializeProject({root,name:'成员与进度软件验证（非竞赛）',competitionId:5,track:competitionCatalog().find(row=>row.id===5).tracks[0].track,workflowId:'modeling'});
mkdirSync(join(root,initial.outputDir),{recursive:true});
writeFileSync(join(root,initial.outputDir,'inventory.md'),'# 软件验证工作文件\n明确验证素材，不作竞赛结论。');
initial=captureDraft({root,expectedRevision:initial.revision,stepId:'context'});
const versionId=initial.workbench.artifacts.inventory.currentVersionId;
const api=directRoutes(),origin='http://127.0.0.1:64330',errors=[],unexpected=[];
const {chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);let browser;
before(async()=>{browser=await chromium.launch({headless:true,args:sceneBrowserArgs});});
after(async()=>{api.dispose();await browser?.close();});

async function pageFor({oldBackend=false}={}){
 const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(12000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){unexpected.push(url.origin);await route.abort();return;}
  if(url.pathname==='/'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{height:100%;width:100%;margin:0}</style></head><body><div id="root"></div><script type="module">import{mountAres}from"/ares/api/v2/app.js?v=2.3.0-polish1";window.app=mountAres(document.querySelector("#root"));</script></body></html>'});return;}
  if(oldBackend&&url.pathname==='/ares/api/v2/project/progress'){await route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Explicit old-route-table compatibility condition'})});return;}
  if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';
  const response=await api.request(url.pathname.slice('/ares/api/v2/'.length)+url.search,request.postData()?JSON.parse(request.postData()):undefined,{raw:true,host:url.host,headers:request.headers()});
  await route.fulfill({status:response.status,headers:response.headers,body:response.body});
 });
 await page.goto(origin);await page.locator('#root[data-galaxy-ready=true]').waitFor();await page.evaluate(()=>document.fonts.ready);return page;
}
const noDialog=page=>page.getByRole('dialog').waitFor({state:'hidden'});
async function projectTab(page,id){await currentProjectTab(page,id);}
async function click(page,action){let target=page.getByRole('dialog').locator('[data-action="'+action+'"]').filter({visible:true});if(!await target.count())target=page.locator('.galaxy-console [data-action="'+action+'"]').filter({visible:true});if(!await target.count())target=page.locator('[data-action="'+action+'"]').filter({visible:true});await target.first().click();}

test('real progress UI saves a member, assignment, deadlines, sourced work and evidence without accepting the step',async()=>{
 const page=await pageFor();try{
  await projectTab(page,'progress');
  await page.locator('.process-progress').waitFor();
  await click(page,'board-member');await page.getByLabel('队员姓名',{exact:true}).fill('软件队员甲');
  await page.getByRole('dialog').locator('[data-action=board-member-save]').click();await noDialog(page);
  const member=readProject(root).workbench.team.find(row=>row.name==='软件队员甲');assert.ok(member);
  await click(page,'board-plan');
  await page.getByLabel('项目截止时间',{exact:true}).fill('2030-11-30T18:00');
  await page.getByLabel('节点负责人 context',{exact:true}).selectOption(member.id);
  await page.getByLabel('节点截止 context',{exact:true}).fill('2030-11-01T18:00');
  await page.getByLabel('节点用时 context',{exact:true}).fill('3.5');
  await click(page,'board-plan-save');await noDialog(page);
  const planned=readProject(root);assert.equal(planned.tasks.context.assigneeId,member.id);assert.equal(planned.workbench.plan.steps.context.estimateHours,3.5);assert.ok(planned.workbench.plan.deadline);assert.equal(planned.progress.done,0);
  await page.getByLabel('进度负责人筛选',{exact:true}).selectOption(member.id);
  assert.equal(await page.locator('[data-progress-step]').count(),1);assert.match(await page.locator('[data-progress-step=context]').textContent(),/软件队员甲/);
  await page.getByLabel('进度负责人筛选',{exact:true}).selectOption('');
  await page.locator('[data-progress-step=context] [data-action=board-work-log]').click();
  assert.equal(await page.getByLabel('工作记录队员',{exact:true}).inputValue(),member.id);
  await page.getByLabel('工作记录类型',{exact:true}).selectOption('submitted');
  const summary='负责人登记：整理了测试目录，关联实际工作版本，等待原有验收。';
  await page.getByLabel('工作说明',{exact:true}).fill(summary);
  await page.getByLabel('关联工作版本',{exact:true}).selectOption(versionId);
  const before=readProject(root),tasks=JSON.stringify(before.tasks),file=readFileSync(join(root,before.outputDir,'inventory.md'));
  const effectsBefore=await page.evaluate(()=>window.app.inspectGalaxy().effects);
  await click(page,'board-work-log-save');await noDialog(page);
  const after=readProject(root),record=projectProgress(root).events.find(row=>row.payload.type==='work.recorded');
  assert.ok(record);assert.equal(record.payload.detail.memberId,member.id);assert.equal(record.payload.detail.artifactVersionId,versionId);assert.equal(record.payload.detail.provenance,'owner-reported');assert.deepEqual(record.payload.actor,{kind:'user',id:'owner'});
  assert.equal(JSON.stringify(after.tasks),tasks);assert.equal(after.progress.done,0);assert.deepEqual(readFileSync(join(root,after.outputDir,'inventory.md')),file);
  assert.match(await page.locator('.process-activity').filter({hasText:summary}).textContent(),/软件队员甲.*负责人登记/s);
  assert.match(await page.locator('[data-progress-step=context]').textContent(),/已登记待检查/);
  const effectsAfter=await page.evaluate(()=>window.app.inspectGalaxy().effects);assert.equal(effectsAfter.seen,effectsBefore.seen+1);assert.equal(effectsAfter.queued,effectsBefore.queued+1);
  await refresh(page);await page.locator('.process-progress').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.app.inspectGalaxy().effects),effectsAfter);
  await capture(page,join(base,'progress.png'));
  await page.getByRole('button',{name:'返回项目',exact:true}).click();
  await page.mouse.move(4,980);await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('.process-activity-caption').waitFor({state:'visible'});assert.match(await page.locator('.process-activity-caption').textContent(),/软件队员甲.*负责人登记.*整理了测试目录/s);
  await capture(page,join(base,'actual-activity.png'));await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.process-member[data-id="'+member.id+'"]').click();
  await page.getByRole('dialog').locator('[data-action=work-participant-details]').click();await page.locator('.process-member-detail').waitFor();assert.match(await page.locator('.process-member-detail').textContent(),/软件队员甲.*负责人登记.*整理了测试目录/s);
  await capture(page,join(base,'member.png'));
  const bytes=readFileSync(join(root,'.ares/project.json'));
  await page.locator('.process-member-detail [data-action=scene-activity-replay]').click();
  assert.equal(await page.locator('.ff-scene').getAttribute('data-activity-mode'),'history-replay');
  assert.match(await page.locator('[data-process-replay-note]').textContent(),/历史回放/);
  assert.equal((await page.evaluate(()=>window.app.inspectGalaxy().effects)).replay,true);
  await page.mouse.move(4,980);await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(350);
  assert.match(await page.locator('.process-activity-caption').textContent(),/历史回放/);
  const moving=await page.evaluate(()=>window.app.inspectGalaxy());assert.equal(moving.renderer,'reference-video-canvas');assert.equal(moving.renderStats.glError,null);assert.ok(moving.orbitTime>0);assert.equal(moving.renderStats.memberNodes,2);
  await capture(page,join(base,'activity-replay.png'));
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.deepEqual(readFileSync(join(root,'.ares/project.json')),bytes);
  await page.setViewportSize({width:390,height:844});
  await projectTab(page,'progress');await page.locator('.process-progress').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  writeFileSync(join(base,'mobile-render-state.json'),JSON.stringify(await page.evaluate(()=>({scene:window.app.inspectGalaxy(),canvases:[...document.querySelectorAll('canvas')].map(n=>({w:n.width,h:n.height,box:n.getBoundingClientRect().toJSON()})),animations:document.getAnimations().map(a=>({id:a.id,state:a.playState}))})),null,2));await capture(page,join(base,'progress-mobile.png'));
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  writeFileSync(join(base,'evidence.json'),JSON.stringify({root,record,plannedRevision:planned.revision,finalRevision:after.revision,effectsBefore,effectsAfter,moving,accepted:after.progress.done},null,2));
  console.log('PROCESS_PROGRESS_UI_EVIDENCE',base);
 }finally{await page.close();}
});

test('an old host without the new progress route still opens real steps and progress, while unsupported work registration is disabled',async()=>{
 const bytes=readFileSync(join(root,'.ares/project.json')),page=await pageFor({oldBackend:true});try{
  await projectTab(page,'progress');
  assert.match(await page.locator('.process-progress').textContent(),/负责人工作登记需一键重载插件后启用/);
  assert.equal(await page.locator('.process-progress .galaxy-section-actions [data-action=board-work-log]').isDisabled(),true);
  assert.ok(await page.locator('[data-progress-step]').count()>1);
  await page.locator('[data-progress-step=context] [data-action=workshop-step]').click();
  await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').textContent(),/交付物.*前置依赖/s);
  assert.equal(await page.getByRole('dialog').locator('[data-action=board-work-log]').isDisabled(),true);
  assert.deepEqual(readFileSync(join(root,'.ares/project.json')),bytes);assert.deepEqual(errors,[]);
 }finally{await page.close();}
});

test('progress polling resumes after another in-scene editor, and discovers a real later owner record once',async()=>{
 const page=await pageFor();try{
  await projectFlow(page);
  await page.waitForTimeout(5200);
  const current=readProject(root),member=current.workbench.team.find(row=>row.name==='软件队员甲'),summary='后台读回验证：负责人登记的后续说明，不代表云端实时身份。';
  const response=await api.request('project/progress/work',{root,expectedRevision:current.revision,requestId:'poll-cycle-request-0001',memberId:member.id,stepId:'context',kind:'update',summary});assert.equal(response.status,200);
  const bytes=readFileSync(join(root,'.ares/project.json'));
  await projectTab(page,'progress');
  await page.locator('.process-activity').filter({hasText:summary}).waitFor({timeout:12000});
  assert.equal(await page.locator('.process-activity').filter({hasText:summary}).count(),1);
  assert.deepEqual(readFileSync(join(root,'.ares/project.json')),bytes);assert.equal(readProject(root).progress.done,0);assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
