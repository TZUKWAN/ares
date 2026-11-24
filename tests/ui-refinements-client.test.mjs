import {capture} from './helpers/capture.mjs';
import {sceneBrowserArgs} from './helpers/environment.mjs';
/** Actual app, files and production routes. ARES's actual native empty-state
 * view is evaluated with explicit blank-session hooks and input-slot markup.
 * This is a style/interaction fixture, not an online model or native Portal. */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {Readable, Writable} from 'node:stream';
import {createRoutes} from '../host/routes.js';
import {initializeProject, linkRoot, readProject} from '../host/projects.js';
import {competitionCatalog, configPath, readConfiguration, saveConfiguration} from '../host/catalog.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-owned-ui-'));
process.env.ARES_HOME=join(base,'home');saveConfiguration(readConfiguration(),0);
const root=join(base,'project');mkdirSync(root);linkRoot(root);
const project=initializeProject({root,name:'ARES 自写界面精修验证 · 非竞赛成果',competitionId:5,
  track:competitionCatalog().find(row=>row.id===5).tracks.find(row=>!row.legacy).track,workflowId:'modeling'});
mkdirSync(join(root,project.outputDir),{recursive:true});
writeFileSync(join(root,project.outputDir,'inventory.md'),'# 真实本地界面验证文件\n\n本文件仅验证作品预览排版，不是竞赛成果。\n\n- 检查输入\n- 核对字段与按钮反馈\n');
const projectBytes=readFileSync(join(root,'.ares/project.json')),configurationBytes=readFileSync(configPath());

function nativeMarkup(kind){
  const registrations=new Map(),h=(tag,props,...children)=>({tag,props:props||{},children});
  const React={createElement:h,useRef:()=>({current:null}),useEffect(){}};
  const context={inject(){},slots:{inject(_name,fn){fn();},register(descriptor,view){registrations.set(descriptor.name,view);return()=>{};}}};
  const loader={load(descriptor){const plugin=descriptor.factory(name=>{
    if(name==='react')return React;if(name==='react-dom')return {createPortal(){assert.fail('No real native Portal in a structural fixture');}};
    if(name==='@deepseek-ai/dsh-client-ui-conversation')return {conversationPhase:()=>'blank'};
    throw Error('Unexpected native view dependency: '+name);
  });plugin.apply(context);}};
  runInNewContext(readFileSync(new URL('../client/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:loader}},
    {filename:'Actual ARES native empty-state view',timeout:1000});
  const body=registrations.get(kind==='项目'?'ares.project.native':'ares.editor.native');assert.equal(typeof body,'function');
  const tree=body({useSession:select=>select({openState:'open',running:false}),useConversation:select=>select({}),
    manager:{kind:kind==='项目'?'project':'editor'},inputActions:null,layout:()=>({variant:'embedded',hero:false}),
    renderFactorySlot:()=>h('div',{'data-conversation-content':''},
      h('div',{'data-conversation-scroll':''},h('small',{className:'refinement-fixture-note'},'原生输入槽位协议夹具 · 未连接模型')),
      h('div',{'data-composer-seat':''},h('div',{'data-composer-card':''},
        h('textarea',{'data-composer-input':'','aria-label':kind+'精修协议输入',placeholder:'输入目标，或调用工具…'}))))});
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function html(node){if(node==null||node===false)return '';if(Array.isArray(node))return node.map(html).join('');
    if(typeof node!=='object')return escape(node);const attributes=Object.entries(node.props).filter(([key,value])=>
      !['key','ref','children'].includes(key)&&!key.startsWith('on')&&value!==false&&value!=null)
      .map(([key,value])=>' '+(key==='className'?'class':key)+(value===true?'':'="'+escape(value)+'"')).join('');
    return '<'+node.tag+attributes+'>'+node.children.map(html).join('')+'</'+node.tag+'>';}
  return html(tree);
}
const editorMarkup=nativeMarkup('编排'),projectMarkup=nativeMarkup('项目');
const ctx={get(name){if(name==='sessionController')return {inspect(){assert.fail('No actual session inspection');}};
  if(name==='agents')return {get(){return null;},list(){return [];},isOwnedBy(){return false;}};
  if(name==='jobs')return {list(){return [];}};}};
const native={capability:()=>({available:false,source:'explicit-owned-ui-boundary'}),
  forEditor(){assert.fail('No native preset creation');},inspectEditorTools(){assert.fail('No actual tool inspection');}};
const server=createRoutes(ctx,native,undefined,{standalone:true}),origin='http://127.0.0.1:64365';
const errors=[],external=[],proof=[];let browser;
const {chromium}=createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);
before(async()=>browser=await chromium.launch({headless:true,args:sceneBrowserArgs}));
after(async()=>{server.dispose();await browser?.close();});
async function production(path,data,headers){
  const url='/ares/api/v2/'+path,route=server.routes.find(row=>row.path===url.split('?')[0]);assert.ok(route,'Actual route '+path);
  const request=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);request.method=data===undefined?'GET':'POST';
  request.url=url;request.headers={...headers,host:new URL(origin).host,'content-type':'application/json'};request.socket={remoteAddress:'127.0.0.1'};
  const parts=[];let status=200,responseHeaders={},finish;const ended=new Promise(resolve=>finish=resolve);
  const response=new Writable({write(chunk,_encoding,next){parts.push(Buffer.from(chunk));next();},final(next){next();finish();}});
  response.headersSent=false;response.writeHead=(code,next={})=>{status=code;responseHeaders=next;response.headersSent=true;};
  await route.handler(request,response);await ended;return {status,headers:responseHeaders,body:Buffer.concat(parts)};
}
async function resident(page,kind,stage){
  const input=page.getByLabel(kind+'精修协议输入',{exact:true});await input.waitFor({state:'visible'});
  const info=await input.evaluate((node,kind)=>{const r=node.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {same:window[kind==='项目'?'keptProject':'keptEditor']===node,hit:at===node,inert:!!node.closest('[inert]'),value:node.value,
      size:parseFloat(getComputedStyle(node).fontSize),rect:{x:r.x,y:r.y,w:r.width,h:r.height},viewport:{w:innerWidth,h:innerHeight},
      pageWidth:document.documentElement.clientWidth,pageScrollWidth:document.documentElement.scrollWidth};},kind);
  assert.equal(info.same,true,stage);assert.equal(info.hit,true,stage+' input is unobstructed');assert.equal(info.inert,false,stage);
  assert.equal(info.value,kind+'保留草稿，不发送。',stage);assert.equal(info.size,16,stage);
  assert.ok(info.rect.w>=200&&info.rect.h>=40,stage+' useful input dimensions');
  assert.ok(info.rect.y>=0&&info.rect.y+info.rect.h<=info.viewport.h+1,stage+' input is within viewport');
  assert.equal(info.pageWidth,info.pageScrollWidth,stage+' no page horizontal overflow');
  await input.click();assert.equal(await input.evaluate(node=>document.activeElement===node),true,stage);
  proof.push({stage,kind,...info});
}
const snap=(page,name)=>capture(page,join(base,name+'.png'));

test('owned controls keep steady bounds, actual loading/focus feedback and readable native-resident functional layouts',async()=>{
  const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});page.setDefaultTimeout(14000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin){external.push(url.href);await route.abort();return;}
    if(url.pathname==='/'){
      await route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{margin:0;width:100%;height:100%}.refinement-fixture-note{font:11px/1.7 sans-serif}.ares-native-layout [data-conversation-content]{display:flex;flex:1;flex-direction:column;min-height:0}.ares-native-layout [data-conversation-scroll]{flex:1;min-height:0}.ares-native-layout [data-composer-seat]{margin-top:auto}.ares-native-layout [data-composer-card]{padding:12px}.ares-native-layout [data-composer-input]{display:block;box-sizing:border-box;width:100%;min-height:82px;resize:none;background:transparent;border:0}</style></head><body><div id="root"></div><script type="module">
      import{mountAres}from'/ares/api/v2/app.js';
      const editor=document.createElement('div'),project=document.createElement('div');editor.innerHTML=${JSON.stringify(editorMarkup)};project.innerHTML=${JSON.stringify(projectMarkup)};
      editor.style.cssText=project.style.cssText='display:flex;flex-direction:column;flex:1;min-height:0';
      const session={subscribe(){return()=>{}},getState(){return{running:false}},setVisible(){},updateContext(){},setProject(){},setView(){},updateViewContext(){},hint(){}};
      window.app=mountAres(document.querySelector('#root'),{editorSession:session,projectSession:session,mountEditor(node){if(!node.contains(editor))node.append(editor)},mountProject(node){if(!node.contains(project))node.append(project)}});
      </script></body></html>`});return;}
    if(url.pathname==='/ares/api/host/extension-form.js')url.pathname='/ares/api/v2/extension-form.js';
    const path=url.pathname.slice('/ares/api/v2/'.length),data=request.postData()?JSON.parse(request.postData()):undefined;
    const result=await production(path+url.search,data,request.headers());await route.fulfill({status:result.status,headers:result.headers,body:result.body});
  });
  let release;
  try{
    await page.goto(origin);await page.locator('#root[data-galaxy-ready=true]').waitFor();
    await page.locator('[data-neural-scene=true][data-neural-intro=complete]').waitFor();
    await page.getByLabel('项目精修协议输入').fill('项目保留草稿，不发送。');
    await page.evaluate(()=>window.keptProject=document.querySelector('[aria-label="项目精修协议输入"]'));
    await resident(page,'项目','project-empty');await snap(page,'project-empty');
    await page.locator('[data-action=workspace][data-id=composer]').click();
    await page.getByLabel('选择比赛',{exact:true}).selectOption('5');
    await page.waitForFunction(()=>document.querySelector('.ares-composer-editor')?.dataset.competitionId==='5'&&document.querySelector('.ares-composer-editor')?.getAttribute('aria-busy')==='false');
    await page.getByLabel('编排精修协议输入').fill('编排保留草稿，不发送。');
    await page.evaluate(()=>window.keptEditor=document.querySelector('[aria-label="编排精修协议输入"]'));
    await resident(page,'编排','composer-goal');
    assert.equal(await page.getByLabel('本步目标',{exact:true}).evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),16);
    await snap(page,'composer-goal');
    await page.emulateMedia({reducedMotion:'no-preference'});
    const settings=page.locator('.ares-composer-flow-heading [data-action=workflow-settings]');
    await page.keyboard.press('Tab');await settings.focus();
    assert.equal(await settings.evaluate(node=>getComputedStyle(node).outlineWidth),'2px');
    const before=await settings.boundingBox();await settings.hover();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.ares-composer-flow-heading [data-action=workflow-settings]')).transform==='none');
    const hovered=await settings.boundingBox(),hoverShadow=await settings.evaluate(node=>getComputedStyle(node).boxShadow);
    assert.ok(Math.abs(before.x-hovered.x)<.5&&Math.abs(before.y-hovered.y)<.5,'Hover does not move a button hit area');
    await page.mouse.down();await page.waitForFunction(value=>getComputedStyle(document.querySelector('.ares-composer-flow-heading [data-action=workflow-settings]')).boxShadow!==value,hoverShadow);
    const pressed=await settings.boundingBox(),activeShadow=await settings.evaluate(node=>getComputedStyle(node).boxShadow);
    assert.ok(Math.abs(pressed.x-before.x)<.5&&Math.abs(pressed.y-before.y)<.5,'Press feedback does not move target');
    assert.notEqual(activeShadow,hoverShadow,'Pressed state has visible material feedback');
    await page.mouse.up();const dialog=page.getByRole('dialog',{name:'流程总控与参数',exact:true});await dialog.waitFor();
    assert.ok(await dialog.evaluate(node=>node.getAnimations().length>0),'Existing real modal entry animates');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>document.querySelector('[role=dialog]').getAnimations().length===0);
    await resident(page,'编排','workflow-modal');await snap(page,'workflow-modal');
    await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    for(const id of ['outputs','skills','prompts']){
      await page.locator('.ares-editor [data-action=tab][data-id='+id+']').click();
      await resident(page,'编排','composer-'+id);await snap(page,'composer-'+id);
    }
    let entered;const held=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);let delayed=true;
    await page.route('**/ares/api/v2/competition/workflow',async route=>{if(delayed&&route.request().postDataJSON()?.competitionId===2){delayed=false;entered();await gate;}await route.fallback();});
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.getByLabel('选择比赛',{exact:true}).selectOption('2');await held;
    const pending=page.locator('.ares-composer-editor[aria-busy=true] .competition-editor-empty');await pending.waitFor();
    assert.equal(await pending.evaluate(node=>getComputedStyle(node,'::before').animationName),'ares-owned-pending');
    await resident(page,'编排','actual-pending');await snap(page,'actual-pending');
    release();release=null;await page.waitForFunction(()=>document.querySelector('.ares-composer-editor')?.dataset.competitionId==='2'&&document.querySelector('.ares-composer-editor')?.getAttribute('aria-busy')==='false');
    assert.equal(await page.locator('.competition-editor-empty').count(),0,'Pending feedback ends with the actual response');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('[data-action=workspace][data-id=projects]').click();
    await page.locator('.process-step[data-process-step="'+project.workflow.steps[0].id+'"]').click();
    await page.locator('.neural-output[data-action=project-artifact-select]').first().click();
    await page.locator('[data-neural-scene=true][data-phase=note]').waitFor();
    await page.locator('.ff-right [data-action=work-preview-expand]').click();
    await page.locator('.galaxy-console [data-document-body]').getByRole('heading',{name:'真实本地界面验证文件',exact:true}).waitFor();
    await resident(page,'项目','expanded-workpiece');await snap(page,'expanded-workpiece');
    await page.setViewportSize({width:1280,height:950});await resident(page,'项目','workpiece-1280');await snap(page,'workpiece-1280');
    await page.getByRole('button',{name:'返回项目',exact:true}).click();
    for(const width of [800,390]){
      await page.setViewportSize({width,height:1000});await resident(page,'项目','project-'+width);
      if(width<=800){
        const actualHeading=page.locator('.ff-right [data-document-body]').getByRole('heading',{name:'真实本地界面验证文件',exact:true});
        await actualHeading.waitFor({state:'visible'});
        const contentBox=await page.locator('.ff-right .document-scroll').boundingBox(),headingBox=await actualHeading.boundingBox();
        const panelBox=await page.locator('.ff-right').boundingBox();
        const visibleHeight=Math.min(contentBox.y+contentBox.height,panelBox.y+panelBox.height)-Math.max(contentBox.y,panelBox.y);
        assert.ok(visibleHeight>=100,'Narrow live-preview keeps at least 100px visibly available for real document content: '+visibleHeight);
        assert.ok(headingBox.y>=contentBox.y-1&&headingBox.y+headingBox.height<=contentBox.y+contentBox.height+1,
          'The actual document heading is within the live-preview content viewport');
        proof.push({stage:'narrow-live-preview',width,contentBox,headingBox,panelBox,visibleHeight});
        const footerControl=page.locator('.ff-right .document-footer [data-view-action=focus]');
        await footerControl.scrollIntoViewIfNeeded();
        const footerHit=await footerControl.evaluate(node=>{const r=node.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {hit:at===node||node.contains(at),rect:{x:r.x,y:r.y,w:r.width,h:r.height}};});
        assert.equal(footerHit.hit,true,'The actual preview footer control remains reachable by scrolling its own pane');
        proof.push({stage:'narrow-preview-footer-reachable',width,...footerHit});
        await page.locator('.ff-right .nebula-local-surface').evaluate(node=>node.scrollTop=0);
      }
      await snap(page,'project-'+width);
      await page.locator('[data-action=workspace][data-id=composer]').click();
      await resident(page,'编排','composer-'+width);await snap(page,'composer-'+width);
      await page.locator('[data-action=workspace][data-id=projects]').click();
    }
    assert.deepEqual(readFileSync(join(root,'.ares/project.json')),projectBytes);assert.deepEqual(readFileSync(configPath()),configurationBytes);
    assert.equal(readProject(root).progress.done,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    writeFileSync(join(base,'ui-refinements-evidence.json'),JSON.stringify({proof,before,hovered,pressed,hoverShadow,activeShadow,
      projectUnchanged:true,configurationUnchanged:true,errors,external,nativeFixture:'Actual ARES empty-state render with explicit blank-state/input-slot hooks; no online DSH/model'},null,2));
    console.log('UI_REFINEMENTS_EVIDENCE',base);
  }catch(error){await snap(page,'failure');writeFileSync(join(base,'failure.json'),JSON.stringify({message:error.message,proof,errors,external},null,2));console.log('UI_REFINEMENTS_FAILURE',base);throw error;}
  finally{release?.();await page.close();}
});
