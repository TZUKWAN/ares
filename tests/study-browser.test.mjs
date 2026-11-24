import './helpers/environment.mjs';
import {sceneBrowserArgs} from './helpers/environment.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRoutes} from '../host/routes.js';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';

async function studyPage(t) {
  const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-study-browser-'));
  process.env.ARES_HOME=join(base,'home');
  const root=join(base,'project');mkdirSync(root);linkRoot(root);
  const comp=competitionCatalog().find(row=>row.id===5);
  const project=initializeProject({root,name:'研究联动软件验收',competitionId:5,track:comp.tracks[0].track,workflowId:'modeling',edition:'SOFTWARE-QA'});
  const api=createRoutes({},undefined,undefined,{standalone:true}),routes=new Map(api.routes.map(row=>[row.path,row.handler]));
  const server=createServer((req,res)=>{
    if(req.url==='/'){
      res.setHeader('content-type','text/html; charset=utf-8');
      res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{height:100%;margin:0}</style><body><main id="root"></main><script type="module">import{mountAres}from"/ares/api/v2/app.js";mountAres(document.querySelector("#root"));</script></body></html>');return;
    }
    const handler=routes.get(req.url.split('?')[0]);if(handler)void handler(req,res);else{res.writeHead(404);res.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{api.dispose();server.close();});
  const {chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);
  const browser=await chromium.launch({headless:true,args:sceneBrowserArgs});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1640,height:1050},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'研究工具',exact:true}).click();
  await page.getByRole('button',{name:'比赛与作品',exact:true}).click();
  return {page,base,root,project,errors};
}

test('the ARES requirements editor imports original bytes, maps real steps and adopts only after owner review',{timeout:60000},async t=>{
  const {page,base,root,project,errors}=await studyPage(t);
  const text='软件验收专用通知，非赛事规则。\n必须提交报告。\n报告正文不超过30页。\n不得在匿名材料中填写姓名。';
  const source=join(base,'software-notice.txt');writeFileSync(source,text);
  await page.getByLabel('原文文件',{exact:true}).setInputFiles(source);
  await page.getByRole('button',{name:'提取条款草稿',exact:true}).click();
  await page.getByRole('link',{name:'下载原文快照',exact:true}).waitFor();
  assert.equal(await page.locator('.study-requirement').count(),3);
  const first=page.locator('.study-requirement').first();
  await first.getByLabel('对应步骤',{exact:true}).selectOption(project.workflow.steps[0].id);
  await first.getByLabel('对应作品',{exact:true}).selectOption(project.workflow.steps[0].outputs.find(row=>row.kind==='file').id);
  await page.getByRole('button',{name:'保存条款与映射',exact:true}).click();
  await page.locator('[data-research-form="requirements-adopt"] input[type=checkbox]').check();
  await page.getByRole('button',{name:'采用到本项目要求',exact:true}).click();
  await page.getByText('已采用',{exact:true}).waitFor();
  const actual=readProject(root),item=Object.values(actual.workbench.research.items).find(row=>row.kind==='requirements');
  assert.equal(item.status,'adopted');assert.equal(actual.competition.ruleStatus,'unreviewed');assert.equal(actual.progress.done,0);
  assert.equal(await page.getByLabel('ARES 常驻聊天',{exact:true}).isVisible(),true);
  await page.screenshot({path:join(base,'requirements-1640.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(base,'requirements-390.png'),animations:'disabled'});
  assert.deepEqual(errors,[]);console.log('STUDY_REQUIREMENTS_UI_EVIDENCE',base);
});

test('the ARES evidence editor saves sourced facts, locates a real citation and applies its reviewed change',{timeout:60000},async t=>{
  const {page,base,root,project,errors}=await studyPage(t);
  const source=join(root,'observations.txt');writeFileSync(source,'Software test observations. Count = 100');
  const output=project.workflow.steps[0].outputs.find(row=>row.kind==='file'&&row.format==='md'),path=join(root,project.outputDir,output.path);
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'# Software test report\n有效样本数为100份。');
  await page.getByRole('button',{name:'事实与证据',exact:true}).click();
  await page.getByLabel('事实名称',{exact:true}).fill('测试样本数');
  await page.getByLabel('事实标识',{exact:true}).fill('sample_count');
  await page.getByLabel('事实值',{exact:true}).fill('100');
  await page.getByLabel('单位',{exact:true}).fill('份');
  await page.getByLabel('项目内证据文件',{exact:true}).fill('observations.txt');
  await page.getByLabel('证据逐字摘录',{exact:true}).fill('Count = 100');
  await page.getByLabel('已核对事实值与原始证据',{exact:true}).check();
  await page.getByRole('button',{name:'保存事实与来源',exact:true}).click();
  await page.getByRole('button',{name:'关联实际引用',exact:true}).waitFor();
  await page.getByLabel('作品',{exact:true}).selectOption(output.id);
  await page.getByLabel('作品中包含该事实值的原句',{exact:true}).fill('有效样本数为100份');
  await page.getByLabel('章节或幻灯片位置',{exact:true}).fill('测试第一节');
  await page.getByRole('button',{name:'关联实际引用',exact:true}).click();
  await page.getByText('引用有效',{exact:true}).waitFor();
  writeFileSync(source,'Software test observations. Count = 120');
  await page.getByRole('button',{name:'测试样本数',exact:true}).click();
  await page.getByLabel('事实值',{exact:true}).fill('120');
  await page.getByLabel('证据逐字摘录',{exact:true}).fill('Count = 120');
  await page.getByLabel('已核对事实值与原始证据',{exact:true}).check();
  await page.getByRole('button',{name:'保存新的事实版本',exact:true}).click();
  await page.getByText('事实已更新',{exact:true}).waitFor();
  await page.getByRole('button',{name:'查看变化',exact:true}).click();
  await page.getByRole('button',{name:'确认更新这处引用',exact:true}).click();
  await page.getByText('引用有效',{exact:true}).waitFor();
  assert.equal(readFileSync(path,'utf8'),'# Software test report\n有效样本数为120份。');
  assert.equal(readProject(root).progress.done,0);
  assert.equal(await page.getByLabel('ARES 常驻聊天',{exact:true}).isVisible(),true);
  await page.screenshot({path:join(base,'evidence-1640.png'),animations:'disabled'});
  assert.deepEqual(errors,[]);console.log('STUDY_FACT_UI_EVIDENCE',base);
});

test('the ARES experiment page executes two real models and compares their metrics without losing the current form',{timeout:60000},async t=>{
  const {page,base,root,errors}=await studyPage(t);
  writeFileSync(join(root,'model-data.csv'),'x,y\n'+Array.from({length:40},(_,i)=>[i+1,3*(i+1)+2].join(',')).join('\n'));
  await page.getByRole('button',{name:'模型实验',exact:true}).click();
  await page.getByLabel('实验名称',{exact:true}).fill('软件线性基线');
  await page.getByLabel('项目数据文件',{exact:true}).fill('model-data.csv');
  await page.getByRole('button',{name:'读取数据字段',exact:true}).click();
  await page.locator('[data-analysis-feature="x"]').check();
  await page.getByLabel('目标变量',{exact:true}).selectOption('y');
  await page.getByLabel('确认本次本机分析',{exact:true}).check();
  await page.getByRole('button',{name:'运行本次实验',exact:true}).click();
  await page.locator('[data-analysis-compare]').first().waitFor();
  assert.equal(await page.getByLabel('项目数据文件',{exact:true}).inputValue(),'model-data.csv');
  assert.equal(await page.locator('[data-analysis-feature="x"]').isChecked(),true);
  await page.getByLabel('实验名称',{exact:true}).fill('软件岭回归方案');
  await page.getByLabel('岭回归参数',{exact:true}).fill('2');
  await page.getByLabel('确认本次本机分析',{exact:true}).check();
  await page.getByRole('button',{name:'运行本次实验',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-analysis-compare]').length===2);
  await page.locator('[data-analysis-compare]').nth(0).check();await page.locator('[data-analysis-compare]').nth(1).check();
  await page.getByRole('button',{name:'比较所选方案',exact:true}).click();
  await page.getByRole('heading',{name:'方案对比',exact:true}).waitFor();
  assert.equal(await page.getByRole('columnheader',{name:'rmse',exact:true}).count(),1);
  assert.equal(readProject(root).progress.done,0);assert.deepEqual(errors,[]);
  await page.screenshot({path:join(base,'experiments-1640.png'),animations:'disabled'});
  console.log('STUDY_EXPERIMENTS_UI_EVIDENCE',base);
});


test('the ARES defense page prepares fixed work, adopts a sourced assistant proposal and preserves a typed real answer',{timeout:60000},async t=>{
  const {page,base,root,project,errors}=await studyPage(t);
  const {captureDraft,artifactHistory}=await import('../host/project-workbench.js');
  const {proposeDefense}=await import('../host/study-defense.js');
  const {researchEntry}=await import('../host/project-research.js');
  const step=project.workflow.steps[0],output=step.outputs.find(o=>o.kind==='file'&&o.format==='md'),path=join(root,project.outputDir,output.path);
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'# 软件验收材料\n这是用于答辩工作流的软件测试文档。');
  captureDraft({root,expectedRevision:0,stepId:step.id,artifactId:output.id});
  const id=artifactHistory(root,output.id).versions[0].id;
  await page.getByRole('button',{name:'答辩演练',exact:true}).click();
  await page.locator('input[name="work"][value="'+id+'"]').check();
  await page.getByRole('button',{name:'刷新',exact:true}).last().click();
  await page.locator('input[name="work"][value="'+id+'"]').check();
  await page.getByRole('button',{name:'准备演练材料',exact:true}).click();
  await page.getByRole('button',{name:'请助手设计演练问题',exact:true}).waitFor();
  let p=readProject(root);const item=Object.values(p.workbench.research.items).find(i=>i.kind==='defense');
  const proposal=proposeDefense({root,expectedRevision:p.revision,design:{sourceId:item.id,sourceVersion:item.head,questions:[{id:'q1',stepId:step.id,question:'这份材料的用途是什么？',evidence:[{sourceId:'s1',quote:'这是用于答辩工作流的软件测试文档。'}]}]}},{kind:'agent',id:'explicit-browser-protocol'});
  await page.getByRole('button',{name:'刷新',exact:true}).last().click();
  await page.locator('[data-r="defense-open"][data-id="'+proposal.item.id+'"]').click();
  await page.getByLabel('已核对演练问题与反馈的原文依据',{exact:true}).check();
  await page.getByRole('button',{name:'采用此演练建议',exact:true}).click();
  await page.getByLabel('回答 q1',{exact:true}).fill('这份材料仅用于软件流程验收。');
  await page.getByRole('button',{name:'保存本次回答',exact:true}).click();
  await page.getByRole('button',{name:'请助手检查已保存回答',exact:true}).waitFor();
  p=readProject(root);const adopted=Object.values(p.workbench.research.items).find(i=>i.kind==='defense'&&i.status==='draft');
  assert.equal(researchEntry(root,adopted.id).data.answers.q1,'这份材料仅用于软件流程验收。');
  assert.equal(p.progress.done,0);assert.equal(await page.getByLabel('ARES 常驻聊天',{exact:true}).isVisible(),true);assert.deepEqual(errors,[]);
  await page.screenshot({path:join(base,'defense-1640.png'),animations:'disabled'});console.log('STUDY_DEFENSE_UI_EVIDENCE',base);
});


test('the ARES reuse page maps a fixed work into a new competition project and keeps the source unchanged',{timeout:60000},async t=>{
  const {page,base,root,project,errors}=await studyPage(t);
  const {captureDraft,artifactHistory}=await import('../host/project-workbench.js');
  const {reuseTargets}=await import('../host/study-reuse.js');
  const step=project.workflow.steps[0],output=step.outputs.find(o=>o.kind==='file'&&o.format==='md'),path=join(root,project.outputDir,output.path);
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'# 软件验收材料\n用于跨赛改编页面验收的固定文档。');
  captureDraft({root,expectedRevision:0,stepId:step.id,artifactId:output.id});const id=artifactHistory(root,output.id).versions[0].id;
  const source=readFileSync(join(root,'.ares/project.json')),targetComp=competitionCatalog().find(c=>c.id===1),track=targetComp.tracks[0].track;
  const target=reuseTargets({root,competitionId:targetComp.id,track}).targets.find(o=>o.kind==='file'&&o.format==='md');
  await page.getByRole('button',{name:'跨赛改编',exact:true}).click();
  await page.getByLabel('目标比赛',{exact:true}).selectOption(String(targetComp.id));
  await page.getByLabel('目标赛道',{exact:true}).selectOption(track);
  await page.getByRole('button',{name:'读取目标比赛的交付要求',exact:true}).click();
  await page.getByLabel('新项目名称',{exact:true}).fill('改编软件验收');
  await page.getByLabel('新项目空目录',{exact:true}).fill(join(base,'adapted'));
  await page.locator('[data-reuse-map="'+id+'"]').selectOption(target.id);
  await page.getByRole('button',{name:'预览改编项目',exact:true}).click();
  await page.getByLabel('确认创建新项目并复制所选固定作品',{exact:true}).check();
  await page.getByRole('button',{name:'创建改编项目',exact:true}).click();
  await page.getByRole('button',{name:'打开新项目',exact:true}).waitFor();
  assert.deepEqual(readFileSync(join(root,'.ares/project.json')),source);
  const adapted=readProject(join(base,'adapted'));assert.equal(adapted.progress.done,0);assert.equal(adapted.competition.id,targetComp.id);
  assert.equal(readFileSync(join(adapted.root,adapted.outputDir,target.path),'utf8'),'# 软件验收材料\n用于跨赛改编页面验收的固定文档。');
  assert.equal(await page.getByLabel('ARES 常驻聊天',{exact:true}).isVisible(),true);assert.deepEqual(errors,[]);
  await page.screenshot({path:join(base,'reuse-1640.png'),animations:'disabled'});console.log('STUDY_REUSE_UI_EVIDENCE',base);
});
