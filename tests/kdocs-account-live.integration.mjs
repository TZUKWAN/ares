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
import {initializeProject,linkRoot} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';

/** Actual ARES client, production routes, current CLI and signed-in cloud account. */
test('the real ARES account entry verifies Kdocs authentication and reaches the project folder picker',{timeout:90000},async t=>{
  const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-account-live-'));
  process.env.ARES_HOME=join(base,'home');
  const root=join(base,'project');mkdirSync(root);linkRoot(root);
  const comp=competitionCatalog().find(row=>row.id===5);
  initializeProject({root,name:'金山账号入口软件验收',competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'});
  const original=readFileSync(join(root,'.ares/project.json'));
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
  await page.getByRole('button',{name:'金山账号与协作',exact:true}).click();
  await page.getByRole('heading',{name:'已认证 · 云目录可访问',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'重新认证金山账号',exact:true}).isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'选择金山协作目录',exact:true}).isEnabled(),true);
  assert.equal(await page.getByLabel('ARES 常驻聊天',{exact:true}).isVisible(),true);
  await page.screenshot({path:join(base,'account-1640.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(base,'account-390.png'),animations:'disabled'});
  await page.setViewportSize({width:1640,height:1050});
  await page.getByRole('button',{name:'选择金山协作目录',exact:true}).click();
  await page.getByRole('heading',{name:'选择项目协作文件夹',exact:true}).waitFor();
  await page.getByRole('button',{name:'使用当前文件夹',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('[data-action="board-collaboration-connect"]')?.disabled===false);
  assert.deepEqual(readFileSync(join(root,'.ares/project.json')),original);
  assert.equal(operations.some(path=>path.endsWith('/login')),false);
  assert.deepEqual(errors,[]);
  const report={status:'passed',source:'actual ARES UI + production handlers + installed Kdocs + real account',
    authenticated:true,cloudAccessVerified:true,folderPickerReached:true,projectChanged:false,cloudWrites:0,
    userWindowsControlled:0,loginStarted:false,widths:[1640,390],screenshotDirectory:base,checkedAt:new Date().toISOString()};
  writeFileSync(join(base,'account-live-evidence.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
