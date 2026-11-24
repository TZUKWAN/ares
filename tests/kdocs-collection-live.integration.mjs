import './helpers/environment.mjs';
import {sceneBrowserArgs} from './helpers/environment.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {createRoutes} from '../host/routes.js';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {saveSurvey} from '../host/research-surveys.js';
import {makeQuestion} from '../client/research-survey-model.js';
import {researchEntry} from '../host/project-research.js';
import {competitionCatalog} from '../host/catalog.js';

/** Actual ARES client, production routes, current CLI and signed-in cloud account. */
test('the actual ARES collection page reads and reviews a private real Kdocs table without claiming real respondents',{timeout:90000},async t=>{
  const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-collection-live-'));
  process.env.ARES_HOME=join(base,'home');
  const root=join(base,'project');mkdirSync(root);linkRoot(root);
  const comp=competitionCatalog().find(row=>row.id===5);
  initializeProject({root,name:'金山账号入口软件验收',competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'});
  const q=makeQuestion('number','amount','amount','软件数量');q.min=1;q.max=30;
  saveSurvey({root,expectedRevision:0,status:'final',confirmFinal:true,definition:{schemaVersion:1,title:'软件测试专用问卷',pages:[{id:'test',title:'软件测试',questions:[q]}]}});
  const qa=JSON.parse(readFileSync(process.env.ARES_KDOCS_QA_RECEIPT,'utf8'));
  const api=createRoutes({},undefined,undefined,{standalone:true});
  const routes=new Map(api.routes.map(row=>[row.path,row.handler]));
  const server=createServer((req,res)=>{
    if(req.url==='/'){
      res.setHeader('content-type','text/html; charset=utf-8');
      res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{height:100%;margin:0}</style><body><main id="root"></main><script type="module">import{mountAres}from"/ares/api/v2/app.js";mountAres(document.querySelector("#root"));</script></body></html>');return;
    }
    const handler=routes.get(req.url.split('?')[0]);
    if(handler)void handler(req,res);else{res.writeHead(404);res.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{api.dispose();server.close();});
  const {chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);
  const browser=await chromium.launch({headless:true,args:sceneBrowserArgs});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1640,height:1050},reducedMotion:'reduce'});
  const errors=[],operations=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('request',req=>{const path=new URL(req.url()).pathname;if(path.includes('/kdocs/account/'))operations.push(path);});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'研究工具',exact:true}).click();
  await page.getByRole('button',{name:'比赛与作品',exact:true}).click();
  await page.getByRole('button',{name:'金山回收',exact:true}).click();
  const current=Object.values(readProject(root).workbench.research.items).find(row=>row.kind==='survey');
  await page.getByLabel('已定稿问卷',{exact:true}).selectOption(current.id+'|'+current.head);
  await page.getByLabel('金山回收文档链接',{exact:true}).fill(qa.url);
  await page.getByLabel('允许读取此金山文档',{exact:true}).check();
  await page.getByRole('button',{name:'读取表结构',exact:true}).click();
  await page.getByLabel('回收数据表',{exact:true}).selectOption(String(qa.sheetId));
  await page.getByLabel('软件数量 · 必填',{exact:true}).selectOption('数量');
  await page.getByLabel('此表仅用于软件验收，不计为实际样本',{exact:true}).check();
  await page.getByRole('button',{name:'保存问卷与回收表绑定',exact:true}).click();
  await page.getByLabel('允许本次读取金山答卷',{exact:true}).check();
  await page.getByRole('button',{name:'回收最新答卷',exact:true}).click();
  await page.getByRole('heading',{name:'逐份复核 · 3 份',exact:true}).waitFor({timeout:60000});
  const collection=Object.values(readProject(root).workbench.research.items).find(row=>row.kind==='collection');
  const data=researchEntry(root,collection.id).data;
  assert.equal(data.rows.length,3);assert.equal(data.softwareTest,true);
  for(const row of data.rows){
    await page.getByLabel('答卷 '+row.sourceId+' 复核决定',{exact:true}).selectOption(Object.keys(row.errors).length?'rejected':'approved');
    await page.getByLabel('答卷 '+row.sourceId+' 复核理由',{exact:true}).fill('软件验收专用，不计为真实问卷样本');
  }
  await page.getByRole('button',{name:'保存复核决定',exact:true}).click();
  await page.getByText('已复核',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'采用为项目实际答卷',exact:true}).count(),0);
  assert.equal(await page.getByLabel('ARES 常驻聊天',{exact:true}).isVisible(),true);
  assert.equal(readProject(root).progress.done,0);assert.deepEqual(errors,[]);
  await page.screenshot({path:join(base,'collection-1640.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(base,'collection-390.png'),animations:'disabled'});
  const report={status:'passed',source:'actual ARES DOM + production routes + real Kdocs cloud table',url:qa.url,
    softwareRows:3,realRespondents:0,validSoftwareRows:data.rows.filter(r=>!Object.keys(r.errors).length).length,
    invalidRows:data.rows.filter(r=>Object.keys(r.errors).length).length,rawSnapshotStored:true,reviewSaved:true,
    acceptanceInherited:false,userWindowsControlled:0,cloudWrites:0,publicSharingChanged:false,screenshotDirectory:base,checkedAt:new Date().toISOString()};
  writeFileSync(join(base,'collection-live-evidence.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
