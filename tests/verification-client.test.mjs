import {sceneBrowserArgs} from './helpers/environment.mjs';
import {projectTab} from './helpers/workbench-navigation.mjs';
import {capture} from './helpers/capture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {linkRoot,initializeProject,verifyProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {directRoutes} from './helpers/direct-routes.mjs';

test('the actual verification dialog explains real blockers, exports its actual report and preserves project bytes on four sizes',async()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-verification-ui-')),root=join(base,'project');process.env.ARES_HOME=join(base,'home');mkdirSync(root);linkRoot(root);
 const p=initializeProject({root,name:'验收报告界面软件验证（非竞赛成果）',competitionId:5,track:competitionCatalog().find(row=>row.id===5).tracks[0].track,workflowId:'modeling'});mkdirSync(join(root,p.outputDir),{recursive:true});writeFileSync(join(root,p.outputDir,'inventory.md'),'# Actual software QA file\nOnly a software test, no real contest assertion.');
 const original=readFileSync(join(root,'.ares/project.json')),expected=verifyProject(root),api=directRoutes(),{chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE),browser=await chromium.launch({headless:true,args:sceneBrowserArgs}),page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce',acceptDownloads:true}),errors=[];
 page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,'http://127.0.0.1:64361');if(url.pathname==='/'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{height:100%;width:100%;margin:0}</style></head><body><div id="root"></div><script type="module">import{mountAres}from"/ares/api/v2/app.js";window.app=mountAres(document.querySelector("#root"));</script></body></html>'});return;}if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';const response=await api.request(url.pathname.slice('/ares/api/v2/'.length)+url.search,request.postData()?JSON.parse(request.postData()):undefined,{raw:true,host:url.host,headers:request.headers()});await route.fulfill({status:response.status,headers:response.headers,body:response.body});});
 try{
  await page.goto('http://127.0.0.1:64361/');await page.locator('#root[data-galaxy-ready=true]').waitFor();await projectTab(page,'tasks');await page.locator('.galaxy-section-actions [data-action=project-verify]').click();
  const dialog=page.getByRole('dialog'),report=dialog.locator('.ares-verification');await report.waitFor();assert.equal(await report.getAttribute('data-report-ready'),'false');assert.equal(await report.locator('[data-report-blocker]').count(),expected.blocking.length);assert.match(await report.textContent(),/负责人复核.*必需规则.*实际必需作品.*固定流程/s);
  assert.equal(await dialog.locator('pre').isVisible(),false);const downloaded=page.waitForEvent('download');await dialog.getByRole('button',{name:'下载检查报告',exact:true}).click();const download=await downloaded,path=join(base,'downloaded-report.json');await download.saveAs(path);const value=JSON.parse(readFileSync(path,'utf8'));assert.equal(value.projectId,p.id);assert.equal(value.definitionId,p.definitionId);assert.equal(value.checksPassed,false);assert.deepEqual(value.blocking,expected.blocking);
  for(const [width,height]of [[1920,1080],[1366,768],[1024,768],[390,844]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await report.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);assert.equal(await page.locator('.galaxy-chat').isVisible(),true);await capture(page,join(base,'report-'+width+'.png'));}
  await dialog.getByRole('button',{name:'查看步骤',exact:true}).first().click();await dialog.getByRole('heading',{name:'目标与资料盘点',exact:true}).waitFor();await dialog.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.route('**/ares/api/v2/project/verify',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,result:{checksPassed:true,blocking:[]}})}));await projectTab(page,'tasks');await page.locator('.galaxy-section-actions [data-action=project-verify]').click();await dialog.getByRole('heading',{name:'验收服务尚未更新',exact:true}).waitFor();assert.match(await dialog.textContent(),/旧结果未作提交依据/);assert.equal(await dialog.locator('[data-action=verification-export]').count(),0);assert.deepEqual(readFileSync(join(root,'.ares/project.json')),original);assert.deepEqual(errors,[]);console.log('VERIFICATION_UI_EVIDENCE',base);
 }finally{api.dispose();await browser.close();}
});
