import './helpers/environment.mjs';
/** Real ARES routes/files and rendering. Native HTML/CSS is explicitly a
 * structural fixture from the actual component; no model or cloud execution. */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {directRoutes} from './helpers/direct-routes.mjs';
import {nativeThemeSurface} from './helpers/native-theme-surface.mjs';
import {initializeProject, linkRoot, readProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';

const base = mkdtempSync(join(process.env.ARES_TEST_ROOT || tmpdir(), 'ares-interface-polish-'));
process.env.ARES_HOME = join(base, 'home');
const root = join(base, 'project'); mkdirSync(root); linkRoot(root);
const project = initializeProject({root, name: 'ARES 界面精修验证 · 非竞赛成果', competitionId: 5,
  track: competitionCatalog().find(row => row.id === 5).tracks[0].track, workflowId: 'modeling'});
mkdirSync(join(root, project.outputDir), {recursive: true});
writeFileSync(join(root, project.outputDir, 'inventory.md'), '# 项目工作稿\n\n## 当前目标\n\n此文件用于界面验证，不是竞赛研究成果。\n\n- 读取原始资料\n- 核对本届要求\n');
const original = readFileSync(join(root, '.ares/project.json'));
const api = directRoutes(), origin = 'http://127.0.0.1:64345';
const surface = nativeThemeSurface(process.env.ARES_NATIVE_CONVERSATION_SOURCE);
const {chromium} = createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);
let browser;
before(async () => browser = await chromium.launch({headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']}));
after(async () => { api.dispose(); await browser?.close(); });

async function ownedPage({width = 1920, height = 1080, motion = 'reduce', record = false} = {}) {
  const errors = [], external = [], page = await browser.newPage({viewport: {width, height}, reducedMotion: motion, ...(record?{recordVideo:{dir:join(base,'recordings'),size:{width,height}}}:{})});
  const recording = record?{video:page.video(),born:Date.now(),clip:null}:null;
  let hold = null;
  const controller = {hold(path) {
    let release; const pending = new Promise(resolve => release = resolve);
    hold = {path, pending}; return () => { release(); hold = null; };
  }};
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.href); await route.abort(); return; }
    if (url.pathname === '/') {
      await route.fulfill({contentType: 'text/html', body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{margin:0;width:100%;height:100%}</style><style>${surface.css}</style></head><body><div id="root"></div><script type="module">import {mountAres} from '/ares/api/v2/app.js';window.chat=document.createElement('div');chat.innerHTML=${JSON.stringify(surface.html)};window.app=mountAres(document.querySelector('#root'),{projectSession:{subscribe(){return()=>{}},setProject(){},getState(){return {running:false}}},mountProject(node){if(!node.contains(chat))node.append(chat)}});</script></body></html>`}); return;
    }
    if (url.pathname === '/ares/api/host/extension-form.js') url.pathname = '/ares/api/v2/extension-form.js';
    const path = url.pathname.slice('/ares/api/v2/'.length);
    if (hold?.path === path) await hold.pending;
    const response = await api.request(path + url.search, request.postData() ? JSON.parse(request.postData()) : undefined,
      {raw: true, host: url.host, headers: request.headers()});
    await route.fulfill({status: response.status, headers: response.headers, body: response.body});
  });
  await page.goto(origin);
  await page.locator('#root[data-galaxy-ready=true]').waitFor();
  await page.locator('.work-live-preview h1').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return {page, errors, external, controller, recording};
}
const closeModal = async page => page.getByRole('button', {name: '关闭对话框', exact: true}).click();
const home = async page => { if (await page.locator('.galaxy-console').count()) await page.getByRole('button', {name: '返回项目', exact: true}).click(); };
const unchanged = () => { assert.deepEqual(readFileSync(join(root, '.ares/project.json')), original); assert.equal(readProject(root).progress.done, 0); };

test('button light/press, panel and modal animations actually run; reduced motion immediately cancels them', async () => {
  const {page, errors, external, recording} = await ownedPage({motion: 'no-preference', record: process.env.ARES_POLISH_RECORD === '1'});
  try {
    const settings = page.locator('.ff-tools [data-action=project-settings]'), box = await settings.boundingBox();
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
    await page.mouse.down();
    assert.equal(await settings.locator('.ares-press-wave').count(), 1);
    assert.ok(await settings.locator('.ares-press-wave').evaluate(node => node.getAnimations().some(animation => animation.playState === 'running')));
    await page.mouse.up();
    const dialog = page.getByRole('dialog');
    assert.ok(await dialog.evaluate(node => node.getAnimations().some(animation => animation.playState === 'running')));
    await page.evaluate(() => { window.reducedMotionChanged = new Promise(resolve => matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', resolve, {once:true})); });
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.evaluate(() => window.reducedMotionChanged.then(() => true));
    const stopped = await dialog.evaluate(node => ({matches:matchMedia('(prefers-reduced-motion: reduce)').matches, css:getComputedStyle(node).animationName, running:node.getAnimations().map(a=>({name:a.animationName,id:a.id,state:a.playState,frames:a.effect.getKeyframes()}))})); writeFileSync(join(base,'reduced-motion-debug.json'),JSON.stringify(stopped,null,2));
    assert.equal(stopped.running.length, 0);
    await closeModal(page);
    await page.locator('.galaxy-nav [data-id=projects]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.galaxy-console').evaluate(node => node.getAnimations().length), 0);
    await home(page); await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.locator('.galaxy-nav [data-id=projects]').click();
    const started = await page.locator('.galaxy-console').evaluate(node => node.getAnimations().map(a => ({duration:a.effect.getTiming().duration, frames:a.effect.getKeyframes()})));
    assert.ok(started.some(animation => animation.duration >= 200 && animation.frames[0].opacity === '0'));
    await page.locator('.galaxy-console').evaluate(node => Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
    assert.equal(await page.locator('.galaxy-console').evaluate(node => node.getAnimations().length), 0);
    await page.screenshot({path: join(base, 'projects.png')});
    await home(page); await page.locator('.process-step[data-id=context]').click();
    await page.getByRole('dialog').evaluate(node => Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
    await page.getByRole('dialog').getByRole('heading',{name:'目标与资料盘点',exact:true}).waitFor();
    writeFileSync(join(base,'dialog-evidence.json'),JSON.stringify(await page.getByRole('dialog').evaluate(node=>({rect:node.getBoundingClientRect().toJSON(),opacity:getComputedStyle(node).opacity,css:getComputedStyle(node).animationName})),null,2));
    await page.screenshot({path: join(base, 'step-detail.png')});
    await closeModal(page); unchanged(); assert.deepEqual(errors, []); assert.deepEqual(external, []);
    writeFileSync(join(base, 'motion-evidence.json'), JSON.stringify({started, reducedMotionCancelled: true, errors, external}, null, 2));
    if(recording){
      const start=(Date.now()-recording.born)/1000;
      await page.waitForTimeout(400);
      await page.locator('.galaxy-nav [data-id=projects]').hover();await page.waitForTimeout(250);
      await page.locator('.galaxy-nav [data-id=projects]').click();await page.waitForTimeout(650);
      await page.locator('.galaxy-nav [data-id=skills]').click();await page.waitForTimeout(750);
      await home(page);await page.waitForTimeout(450);
      await page.locator('.process-step[data-id=context]').click();
      await page.getByRole('dialog').evaluate(node=>Promise.all(node.getAnimations().map(a=>a.finished.catch(()=>{}))));
      await page.waitForTimeout(650);await closeModal(page);await page.waitForTimeout(350);
      recording.clip={start,duration:(Date.now()-recording.born)/1000-start};
    }
    await page.locator('.ff-tools [data-action=project-settings]').click();
    await page.getByRole('dialog').getByText('维护与高级配置',{exact:true}).click();
    await page.getByRole('button',{name:'减少动态效果',exact:true}).click();
    assert.equal(await page.locator('#root').getAttribute('data-ares-motion'),'off');
    assert.equal(await page.getByRole('dialog').evaluate(node=>node.getAnimations().length),0);
    await closeModal(page);await page.locator('.galaxy-nav [data-id=projects]').click();
    assert.equal(await page.locator('.galaxy-console').evaluate(node=>node.getAnimations().length),0);
    console.log('INTERFACE_POLISH_EVIDENCE', base);
  } finally { await page.close();if(recording?.clip)writeFileSync(join(base,'video-evidence.json'),JSON.stringify({...recording.clip,path:await recording.video.path(),mode:'Actual owned ARES browser; native structure fixture, no live model'},null,2)); }
});

test('a real pending flow request shows activity without replaying the panel; native draft and project stay intact', async () => {
  const {page, errors, controller} = await ownedPage({motion: 'no-preference'});
  let release;
  try {
    await page.getByLabel('原生输入结构验证').fill('保留的助手输入，不发送。');
    await page.evaluate(() => window.keptInput = document.querySelector('[data-composer-input]'));
    await page.locator('.galaxy-nav [data-id=studio]').click();
    await page.getByLabel('本步目标', {exact: true}).waitFor();
    await page.locator('.galaxy-console').evaluate(node=>Promise.all(node.getAnimations().map(a=>a.finished.catch(()=>{}))));
    const flip=await page.evaluate(async()=>{
      const old=document.querySelectorAll('.ares-flow-plane .ares-step')[1],id=old.dataset.id,before=old.getBoundingClientRect();
      document.querySelector('[data-action=flow-zoom][data-direction="1"]').click();
      for(let i=0;i<12&&old.isConnected;i++)await Promise.resolve();
      const next=[...document.querySelectorAll('.ares-flow-plane .ares-step')].find(node=>node.dataset.id===id);
      const animation=next.getAnimations().find(a=>a.id==='ares-ui-feedback');
      if(!animation)return {animated:false};
      animation.pause();animation.currentTime=0;const start=next.getBoundingClientRect();animation.play();
      return {animated:true,before:{x:before.x,y:before.y},start:{x:start.x,y:start.y}};
    });
    assert.equal(flip.animated,true);assert.ok(Math.abs(flip.before.x-flip.start.x)<1,JSON.stringify(flip));assert.ok(Math.abs(flip.before.y-flip.start.y)<1,JSON.stringify(flip));
    writeFileSync(join(base,'flow-motion-evidence.json'),JSON.stringify(flip,null,2));
    await page.locator('.ares-flow-plane').evaluate(node=>Promise.all(node.getAnimations({subtree:true}).filter(a=>a.id==='ares-ui-feedback').map(a=>a.finished.catch(()=>{}))));
    await page.getByLabel('本步目标', {exact: true}).fill('界面验证的流程草稿，尚未应用。');
    await page.waitForTimeout(500);
    release = controller.hold('project/flow/draft-status');
    await page.locator('.galaxy-console-heading [data-action=save]').click();
    await page.locator('.ares-ui-pending:not([hidden])').waitFor();
    assert.equal(await page.locator('.galaxy-console').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('.galaxy-console').evaluate(node => node.getAnimations().length), 0);
    assert.equal(await page.getByLabel('原生输入结构验证').isEnabled(), true);
    release(); release = null;
    await page.getByRole('dialog').getByRole('heading', {name: '将修改应用到本项目', exact: true}).waitFor();
    await page.locator('.ares-ui-pending').waitFor({state: 'hidden'});
    await closeModal(page);
    assert.equal(await page.getByLabel('本步目标', {exact: true}).inputValue(), '界面验证的流程草稿，尚未应用。');
    assert.equal(await page.evaluate(() => window.keptInput === document.querySelector('[data-composer-input]')), true);
    assert.equal(await page.getByLabel('原生输入结构验证').textContent(), '保留的助手输入，不发送。');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.screenshot({path: join(base, 'competition-flow.png')});
    unchanged(); assert.deepEqual(errors, []);
  } finally { release?.(); await page.close(); }
});

test('all functional surfaces and native composer remain readable and clickable on desktop and narrow screens', async () => {
  const {page, errors, external} = await ownedPage();
  const sizes = [];
  try {
    await page.screenshot({path: join(base, 'workspace-1920.png')});
    for (const id of ['catalog', 'skills']) {
      await page.locator('.galaxy-nav [data-id=' + id + ']').click();
      if (id === 'skills') await page.getByRole('status').filter({hasText: /项候选/}).waitFor();
      await page.screenshot({path: join(base, id + '.png')});
      await home(page);
    }
    await page.locator('.ff-tools [data-action=project-tab][data-id=progress]').click();
    await page.screenshot({path: join(base, 'progress.png')}); await home(page);
    for (const id of ['materials', 'facts', 'tasks']) {
      await page.locator('.ff-tools [data-action=project-settings]').click();
      await page.getByRole('dialog').locator('[data-action=project-tab][data-id=' + id + ']').click();
      await page.screenshot({path: join(base, id + '.png')}); await home(page);
    }
    await page.locator('.work-artifact [data-action=work-preview-expand]').click();
    await page.locator('.galaxy-console [data-view-action=edit]').click();
    await page.getByLabel('作品编辑草稿').fill('# 仅保留界面草稿\n\n没有保存到文件。');
    await page.screenshot({path: join(base, 'work-editor.png')}); await home(page);
    for (const width of [1440, 1280, 800, 390]) {
      await page.setViewportSize({width, height: 1000});
      await page.waitForTimeout(80);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.equal(await page.getByLabel('原生输入结构验证').isVisible(), true);
      const composer = await page.getByLabel('原生输入结构验证').boundingBox();
      assert.ok(composer.height >= 20 && composer.y + composer.height <= 1001, JSON.stringify({width, composer}));
      assert.equal(await page.locator('.galaxy-nav>button').count(), 4);
      sizes.push({width, composer});
      await page.screenshot({path: join(base, 'workspace-' + width + '.png')});
      await page.locator('.galaxy-nav [data-id=projects]').click();
      const font = await page.getByLabel('找项目').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
      assert.ok(font >= 14);
      await page.screenshot({path: join(base, 'projects-' + width + '.png')}); await home(page);
    }
    unchanged(); assert.deepEqual(errors, []); assert.deepEqual(external, []);
    writeFileSync(join(base, 'layout-evidence.json'), JSON.stringify({sizes, native:surface.provenance, errors, external}, null, 2));
  } finally { await page.close(); }
});
