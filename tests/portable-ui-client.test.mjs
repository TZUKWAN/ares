import './helpers/environment.mjs';
/** Actual official MCP Apps AppBridge + PostMessageTransport, the real portable
 * HTML, and a real official SDK stdio client/server process. Only the host chat
 * and updateModelContext are explicit capture-only fixtures. No model, cloud
 * write, real Codex/ZCode panel, DSH instance or user's window is involved. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Client} from '../platforms/shared/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import {StdioClientTransport} from '../platforms/shared/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';
import {build} from '../platforms/ui-tools/node_modules/esbuild/lib/main.js';

const source=dirname(dirname(fileURLToPath(import.meta.url))),sha=value=>createHash('sha256').update(value).digest('hex');
const evidence=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-portable-ui-'));
const root=join(evidence,'project'),home=join(evidence,'home');mkdirSync(root);
const scope={competitionId:1,track:'高教主赛道',edition:'2026',group:''};
const origin='http://127.0.0.1:64371';
const {chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);

function valueOf(result){if(result.structuredContent!==undefined)return result.structuredContent;return JSON.parse(result.content.filter(row=>row.type==='text').map(row=>row.text).join('\n'));}
async function connected(){
 const client=new Client({name:'ares-owned-browser-host-protocol-fixture',version:'1.0.0'},{capabilities:{}}),env={...process.env};
 delete env.DSH_HOME;delete env.ARES_HOME;delete env.ARES_ALLOWED_ROOTS;
 const transport=new StdioClientTransport({command:process.execPath,args:[join(source,'scripts/ares-mcp.mjs'),'--host','codex','--home',home,'--root',root,'--require-ui'],cwd:source,env,stderr:'pipe'});
 let stderr='';transport.stderr?.on('data',chunk=>stderr+=chunk);await client.connect(transport);
 return {client,get stderr(){return stderr;},async call(name,args){const result=await client.callTool({name,arguments:args});assert.notEqual(result.isError,true,JSON.stringify(valueOf(result)));return valueOf(result);}};
}

async function hostBundle(initial){
 const code=`import{AppBridge,PostMessageTransport}from'@modelcontextprotocol/ext-apps/app-bridge';
 window.hostProtocolFixture={connected:false,initialized:false,errors:[],messages:[],contexts:[],logs:[]};
 const fixture=window.hostProtocolFixture,iframe=document.querySelector('#ares-frame');
 const bridge=new AppBridge(null,{name:'Explicit owned MCP Apps browser host fixture',version:'1.0.0'},
  {serverTools:{},serverResources:{},logging:{},updateModelContext:{text:{},structuredContent:{}},message:{text:{}}},
  {hostContext:{theme:'dark',locale:'zh-CN',displayMode:'inline'}});
 window.officialAppBridge=bridge;
 bridge.oncalltool=params=>window.__aresRealTool(params);
 bridge.onreadresource=params=>window.__aresRealResource(params);
 bridge.onmessage=async params=>{fixture.messages.push(structuredClone(params));return {};};
 bridge.onupdatemodelcontext=async params=>{fixture.contexts.push(structuredClone(params));return {};};
 bridge.onloggingmessage=params=>fixture.logs.push(structuredClone(params));
 bridge.onerror=error=>fixture.errors.push(String(error?.message||error));
 bridge.oninitialized=()=>{fixture.initialized=true;bridge.sendToolInput({arguments:${JSON.stringify(initial)}}).catch(error=>fixture.errors.push(String(error)));};
 bridge.connect(new PostMessageTransport(iframe.contentWindow,iframe.contentWindow)).then(()=>{fixture.connected=true;iframe.src='/workbench';}).catch(error=>fixture.errors.push(String(error)));
 `;
 const output=await build({stdin:{contents:code,resolveDir:join(source,'platforms/ui-tools'),sourcefile:'owned-official-appbridge-host.mjs',loader:'js'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'});
 return output.outputFiles[0].text;
}

async function noOverflow(frame,label){
 await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const size=await frame.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,app:document.querySelector('#app').scrollWidth}));
 assert.ok(size.document<=size.width+1&&size.body<=size.width+1&&size.app<=size.width+1,label+': '+JSON.stringify(size));return {label,...size};
}
async function mediaState(frame){return frame.evaluate(()=>[...document.querySelectorAll('video[src]')].map(video=>({blob:video.currentSrc.startsWith('blob:'),ready:video.readyState,width:video.videoWidth,height:video.videoHeight,error:video.error?.message||null})));}

test('official browser MCP Apps handshake drives real project files and editable competition workflows, with explicit host-context gestures and honest conflicts', {timeout:120000},async()=>{
 const s=await connected(),calls=[],resources=[],errors=[],external=[],responsive=[];let browser,page,frame,appFrame;
 const receipt={mode:'Official AppBridge(null) + PostMessageTransport iframe + actual portable HTML + official SDK Client/StdioClientTransport to real scripts/ares-mcp.mjs. Host chat/model context are capture-only fixtures; no actual Codex/ZCode panel, online model, cloud write or desktop operation.'};
 try{
  const opened=await s.call('ares_workflow',{action:'read',...scope});
  const workflow=structuredClone(opened.workflow);workflow.steps[0].title='真实浏览器软件验收记录';
  const saved=await s.call('ares_workflow',{action:'save',...scope,workflow,configuration:opened.configuration,expectedRevision:opened.expectedRevision,expectedWorkflowHash:opened.workflowHash,expectedSkillHashes:opened.skillHashes});
  const project=await s.call('ares_project',{action:'init',root,name:'Portable 浏览器协议验证 · 非竞赛成果',...scope,flowMode:'library',workflowId:saved.workflow.id,expectedWorkflowHash:saved.workflowHash,expectedConfigurationRevision:saved.expectedRevision});
  const step=project.workflow.steps[0],output=step.outputs.find(row=>row.kind==='file'&&row.format==='md');assert.ok(output);
  const artifactPath=join(root,project.outputDir,output.path);mkdirSync(dirname(artifactPath),{recursive:true});
  // The artifact API intentionally edits existing registered files only. Seed
  // real owned bytes, then write the final document through the actual MCP API.
  writeFileSync(artifactPath,'# 自有软件验证初始文件\n\n仅用于获取实际文件哈希，不是竞赛成果。\n');
  const seed=await s.call('ares_artifact',{action:'read',root,id:output.id});
  const text='# Portable UI 真实文件\n\n此正文通过真实 MCP 保存并读取，仅验证软件界面，不含模拟赛事成果。\n';
  const written=await s.call('ares_artifact',{action:'save',root,id:output.id,version:seed.version,expectedRevision:project.revision,text});
  assert.equal(readFileSync(artifactPath,'utf8'),text);receipt.artifactSetup={localSeedRequiredByExistingFileContract:true,finalBodySavedThroughActualMcp:true,version:written.version};
  assert.equal((await s.call('ares_artifact',{action:'read',root,id:output.id})).text,text);
  const projectBytes=readFileSync(join(root,'.ares/project.json'));
  const entry=await s.call('ares_workbench',{root,workspace:'projects'});
  const resource=await s.client.readResource({uri:'ui://ares/workbench.html'}),html=resource.contents.find(row=>typeof row.text==='string').text;
  assert.equal(sha(html),sha(readFileSync(join(source,'platforms/ui/workbench.html'))));receipt.html={sha256:sha(html),bytes:Buffer.byteLength(html)};
  const host=await hostBundle({root,workspace:entry.workspace});receipt.hostBundleSha256=sha(host);
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1280,height:950},reducedMotion:'reduce'});page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));
  await page.exposeBinding('__aresRealTool',async(_source,params)=>{const response=await s.client.callTool(params),value=valueOf(response);calls.push({name:params.name,args:structuredClone(params.arguments),isError:!!response.isError,code:value?.code,status:value?.status,message:value?.message});return response;});
  await page.exposeBinding('__aresRealResource',async(_source,params)=>{const response=await s.client.readResource(params);resources.push({uri:params.uri,contents:response.contents.map(row=>({mimeType:row.mimeType,bytes:row.blob?Buffer.from(row.blob,'base64').length:Buffer.byteLength(row.text||'')}))});return response;});
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(['blob:','data:'].includes(url.protocol)){await route.continue();return;}if(url.origin!==origin){external.push(url.href);await route.abort();return;}
   if(url.pathname==='/'){await route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe id="ares-frame" title="ARES MCP App · explicit protocol host fixture"></iframe><script src="/official-host.js"></script></body></html>'});return;}
   if(url.pathname==='/official-host.js'){await route.fulfill({contentType:'text/javascript',body:host});return;}
   if(url.pathname==='/workbench'){await route.fulfill({contentType:'text/html',body:html});return;}
   if(url.pathname==='/favicon.ico'){await route.fulfill({status:204,body:''});return;}
   throw Error('Portable self-contained UI requested an unregistered URL: '+url.href);
  });
  await page.goto(origin);await page.waitForFunction(()=>window.hostProtocolFixture?.initialized===true);
  frame=page.frameLocator('#ares-frame');
  await frame.locator('[data-neural-scene=true][data-neural-intro=complete]').waitFor();
  await frame.locator('video').first().waitFor({state:'attached'});
  appFrame=page.frames().find(value=>value.url()===origin+'/workbench');
  await appFrame.waitForFunction(()=>document.querySelectorAll('video[src]').length>1&&[...document.querySelectorAll('video[src]')].every(video=>video.readyState>=2&&video.videoWidth>0&&!video.error));
  receipt.media=await mediaState(appFrame);assert.ok(receipt.media.every(row=>row.blob&&row.ready>=2&&row.width>0&&row.height>0&&!row.error));
  assert.ok(resources.some(row=>row.uri==='ares://media/index'));assert.ok(resources.some(row=>row.uri.startsWith('ares://media/')&&row.contents.some(part=>part.bytes>0)));
  let hostState=await page.evaluate(()=>window.hostProtocolFixture);assert.deepEqual(hostState.messages,[]);assert.deepEqual(hostState.contexts,[]);
  await frame.locator('.process-step[data-id="'+step.id+'"]').click();await frame.locator('[data-neural-stage=module]').waitFor();
  await frame.locator('.neural-output[data-id="'+output.id+'"]').click();
  await frame.locator('.portable-preview pre').filter({hasText:'Portable UI 真实文件'}).waitFor();
  assert.equal(await frame.locator('.portable-preview pre').textContent(),text);
  assert.equal(readFileSync(artifactPath,'utf8'),text);
  hostState=await page.evaluate(()=>window.hostProtocolFixture);assert.equal(hostState.messages.length,0);assert.equal(hostState.contexts.length,0);
  await frame.locator('.portable-header [data-action=assistant]').click();
  await page.waitForFunction(()=>window.hostProtocolFixture.contexts.length===1&&window.hostProtocolFixture.messages.length===1);
  await frame.locator('[data-feedback]').filter({hasText:'当前步骤已交给宿主原生对话'}).waitFor();
  hostState=await page.evaluate(()=>window.hostProtocolFixture);assert.equal(hostState.contexts[0].structuredContent.step.id,step.id);
  responsive.push(await noOverflow(appFrame,'project-1280'));
  const labelBox=await frame.locator('.process-step[data-id="'+step.id+'"]').boundingBox(),outputBox=await frame.locator('.neural-output[data-id="'+output.id+'"]').boundingBox();
  receipt.noteGeometry={stageLabel:labelBox,artifact:outputBox};
  assert.ok(labelBox.x+labelBox.width<=outputBox.x+2||outputBox.x+outputBox.width<=labelBox.x+2||labelBox.y+labelBox.height<=outputBox.y+2||outputBox.y+outputBox.height<=labelBox.y+2,'The selected stage label and artifact card remain separately readable');
  await page.screenshot({path:join(evidence,'portable-project-1280.png')});
  await page.setViewportSize({width:390,height:900});responsive.push(await noOverflow(appFrame,'project-390'));
  const crumbs=await appFrame.evaluate(()=>{const overview=document.querySelector('[data-neural-action=overview]'),pages=document.querySelector('[data-neural-pages]'),range=document.createRange();range.selectNodeContents(pages);return {overviewHeight:overview.getBoundingClientRect().height,pageLines:range.getClientRects().length};});
  assert.ok(crumbs.overviewHeight<=44&&crumbs.pageLines===1,'Mobile navigation remains on one readable line');receipt.mobileCrumbs=crumbs;
  await page.screenshot({path:join(evidence,'portable-project-390.png')});
  await page.setViewportSize({width:1280,height:950});
  await frame.locator('.portable-footer [data-action=workspace][data-id=composer]').click();
  await frame.getByLabel('步骤名称',{exact:true}).waitFor();
  const flowRead=calls.filter(row=>row.name==='ares_workflow'&&row.args.action==='read').at(-1);assert.ok(flowRead);const flowScope={competitionId:flowRead.args.competitionId,track:flowRead.args.track,edition:flowRead.args.edition,group:flowRead.args.group};
  const title='通过真实 MCP 保存的浏览器流程步骤';await frame.getByLabel('步骤名称',{exact:true}).fill(title);await frame.getByLabel(/^执行目标/).fill('只验证实际保存和作用域，不作为比赛研究成果。');
  hostState=await page.evaluate(()=>window.hostProtocolFixture);assert.equal(hostState.contexts.length,1,'Editing cannot silently push model context');assert.equal(hostState.messages.length,1);
  await frame.locator('.portable-header [data-action=assistant]').click();await page.waitForFunction(()=>window.hostProtocolFixture.contexts.length===2&&window.hostProtocolFixture.messages.length===2);
  hostState=await page.evaluate(()=>window.hostProtocolFixture);assert.equal(hostState.contexts[1].structuredContent.kind,'competition-workflow');assert.equal(hostState.contexts[1].structuredContent.workflow.steps[0].title,title);assert.equal(hostState.contexts[1].structuredContent.unsaved,true);
  await frame.locator('[data-action=flow-save]').click();await frame.locator('[data-feedback]').filter({hasText:'比赛流程已保存'}).waitFor();
  const actual=await s.call('ares_workflow',{action:'read',...flowScope});assert.equal(actual.workflow.steps[0].title,title);assert.equal(actual.saved,true);
  assert.deepEqual(readFileSync(join(root,'.ares/project.json')),projectBytes,'A saved library flow cannot silently change the existing fixed project');
  const secondStep=actual.workflow.steps[1];assert.ok(secondStep);
  await frame.locator('.ares-step[data-id="'+secondStep.id+'"]').click();assert.equal(await frame.getByLabel('步骤名称',{exact:true}).inputValue(),secondStep.title);
  await frame.locator('.portable-footer [data-action=workspace][data-id=projects]').click();
  await frame.locator('[data-neural-scene=true]').waitFor();
  await frame.locator('.portable-header [data-action=assistant]').click();await page.waitForFunction(()=>window.hostProtocolFixture.contexts.length===3&&window.hostProtocolFixture.messages.length===3);
  hostState=await page.evaluate(()=>window.hostProtocolFixture);const returned=hostState.contexts[2].structuredContent;
  assert.equal(returned.step.id,step.id,'A composer selection cannot change the project step sent to the host');assert.equal(returned.viewedArtifact.id,output.id);
  await frame.locator('.portable-footer [data-action=workspace][data-id=composer]').click();assert.equal(await frame.getByLabel('步骤名称',{exact:true}).inputValue(),secondStep.title,'The composer retains its own selected step');
  receipt.crossWorkspaceContext={projectStepId:returned.step.id,projectArtifactId:returned.viewedArtifact.id,composerStepId:secondStep.id};
  await frame.locator('.ares-step[data-id="'+actual.workflow.steps[0].id+'"]').click();
  responsive.push(await noOverflow(appFrame,'composer-1280'));await page.screenshot({path:join(evidence,'portable-composer-1280.png')});
  await page.setViewportSize({width:390,height:900});responsive.push(await noOverflow(appFrame,'composer-390'));await page.screenshot({path:join(evidence,'portable-composer-390.png')});
  await page.setViewportSize({width:1280,height:950});
  await frame.getByLabel('步骤名称',{exact:true}).fill('必须保留的未保存浏览器草稿');
  const concurrent=structuredClone(actual.workflow);concurrent.steps[0].title='另一真实客户端已保存的版本';
  const changed=await s.call('ares_workflow',{action:'save',...flowScope,workflow:concurrent,configuration:actual.configuration,expectedRevision:actual.expectedRevision,expectedWorkflowHash:actual.workflowHash,expectedSkillHashes:actual.skillHashes});
  await frame.locator('[data-action=flow-save]').click();await frame.locator('[data-feedback][data-error=true]').filter({hasText:/更新|保留|草稿|变化/}).waitFor();
  assert.equal(await frame.getByLabel('步骤名称',{exact:true}).inputValue(),'必须保留的未保存浏览器草稿');
  assert.equal((await s.call('ares_workflow',{action:'read',...flowScope})).workflow.steps[0].title,changed.workflow.steps[0].title);
  assert.ok(calls.some(row=>row.name==='ares_workflow'&&row.args.action==='save'&&row.isError&&row.status===409),'The visible conflict must come from the actual MCP server');
  await page.screenshot({path:join(evidence,'portable-real-conflict.png')});
  hostState=await page.evaluate(()=>window.hostProtocolFixture);assert.equal(hostState.messages.length,3);assert.equal(hostState.contexts.length,3);assert.deepEqual(hostState.errors,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(s.stderr,'');
  assert.equal(sha(html),sha(readFileSync(join(source,'platforms/ui/workbench.html'))),'Portable HTML must remain unchanged throughout this verification');
  Object.assign(receipt,{projectId:project.id,artifactPath,stepId:step.id,artifactId:output.id,responsive,calls,resources,hostFixture:hostState,errors,external,stderr:s.stderr});writeFileSync(join(evidence,'portable-ui-receipt.json'),JSON.stringify(receipt,null,2));console.log('PORTABLE_UI_EVIDENCE',evidence);
 }catch(error){
  Object.assign(receipt,{failure:error.message,calls,resources,errors,external,stderr:s.stderr,media:appFrame?await mediaState(appFrame).catch(()=>null):null,hostFixture:page?await page.evaluate(()=>window.hostProtocolFixture||null).catch(()=>null):null,body:frame?await frame.locator('body').innerText().then(text=>text.slice(0,12000)).catch(()=>null):null});writeFileSync(join(evidence,'failure.json'),JSON.stringify(receipt,null,2));if(page)await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});console.log('PORTABLE_UI_FAILURE',evidence);throw error;
 }finally{await browser?.close();await s.client.close();}
});
