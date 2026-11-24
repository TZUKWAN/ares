import './helpers/environment.mjs';
/** Representative functional-page theme checks on actual ARES source/routes.
 * All files belong to this test's temporary home. Native slots are explicit
 * input/layout protocol fixtures; they do not create sessions or send prompts.
 * The real native React Portal is covered separately by the native UI test. */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Readable, Writable} from 'node:stream';
import {createRoutes} from '../host/routes.js';
import {initializeProject, linkRoot, readProject} from '../host/projects.js';
import {competitionCatalog, configPath, readConfiguration, saveConfiguration} from '../host/catalog.js';

const base = mkdtempSync(join(process.env.ARES_TEST_ROOT || tmpdir(), 'ares-neural-pages-'));
process.env.ARES_HOME = join(base, 'home');
saveConfiguration(readConfiguration(), 0);
const root = join(base, 'project'); mkdirSync(root); linkRoot(root);
const competition = competitionCatalog().find(row => row.id === 5);
const project = initializeProject({root, name: 'ARES 功能页面样式验证 · 非竞赛成果', competitionId: 5,
  track: competition.tracks.find(row => !row.legacy).track, workflowId: 'modeling'});
mkdirSync(join(root, project.outputDir), {recursive: true});
writeFileSync(join(root, project.outputDir, 'inventory.md'), '# 功能页面实际本地文件\n\n仅用于样式与操作验证，未执行模型任务。\n');
const originalProject = readFileSync(join(root, '.ares/project.json'));
const originalConfiguration = readFileSync(configPath());
const assetHashes = () => Object.fromEntries(['app.js', 'client.js', 'style.css', 'neural-scene.js',
  'neural-scene.css', 'neural-theme.css', 'workshop-scene.js', 'workshop.css'].map(name =>
  [name, createHash('sha256').update(readFileSync(new URL('../client/' + name, import.meta.url))).digest('hex')]));

const ctx = {get(name) {
  if (name === 'sessionController') return {inspect() { assert.fail('A page-style check must not inspect an actual native session'); }};
  if (name === 'agents') return {get() { return null; }, list() { return []; }, isOwnedBy() { return false; }};
  if (name === 'jobs') return {list() { return []; }};
}};
const native = {capability: () => ({available: false, source: 'explicit-page-style-boundary-fixture'}),
  forEditor() { assert.fail('A page-style check must not create an editor preset'); },
  inspectEditorTools() { assert.fail('A page-style check must not claim native tool inspection'); }};
const server = createRoutes(ctx, native, undefined, {standalone: true});
const origin = 'http://127.0.0.1:64361', requests = [], errors = [], external = [], evidence = [];
const {chromium} = createRequire(import.meta.url)(process.env.ARES_PLAYWRIGHT_PACKAGE);
let browser;
before(async () => browser = await chromium.launch({headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']}));
after(async () => { server.dispose(); await browser?.close(); });

async function productionRequest(path, data, headers) {
  const url = '/ares/api/v2/' + path, route = server.routes.find(row => row.path === url.split('?')[0]);
  assert.ok(route, 'Actual production route exists: ' + url);
  const request = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
  request.method = data === undefined ? 'GET' : 'POST'; request.url = url;
  request.headers = {...headers, host: new URL(origin).host, 'content-type': 'application/json'};
  request.socket = {remoteAddress: '127.0.0.1'};
  const chunks = []; let status = 200, responseHeaders = {}, finish;
  const ended = new Promise(resolve => finish = resolve);
  const response = new Writable({write(chunk, _encoding, next) { chunks.push(Buffer.from(chunk)); next(); },
    final(next) { next(); finish(); }});
  response.headersSent = false;
  response.writeHead = (code, next = {}) => { status = code; responseHeaders = next; response.headersSent = true; };
  await route.handler(request, response); await ended;
  return {status, headers: responseHeaders, body: Buffer.concat(chunks)};
}

const harness = `
import {mountAres} from '/ares/api/v2/app.js';
function slot(kind) {
 const node = document.createElement('div'); node.className = 'page-native-protocol';
 node.innerHTML = '<small>原生槽位布局协议夹具 · 不连接会话或模型</small><div data-composer-seat><div data-composer-card><textarea data-composer-input aria-label="'+kind+'页面协议输入"></textarea></div></div>';
 return node;
}
window.editorInputSlot = slot('编排'); window.projectInputSlot = slot('项目');
const session = {subscribe(){return()=>{}},getState(){return{running:false}},setVisible(){},
 updateContext(){},setProject(){},setView(){},updateViewContext(){},hint(){}};
window.app = mountAres(document.querySelector('#root'), {editorSession:session,projectSession:session,
 mountEditor(node){if(!node.contains(editorInputSlot))node.append(editorInputSlot)},
 mountProject(node){if(!node.contains(projectInputSlot))node.append(projectInputSlot)}});
`;

async function pageProof(page, name, content, kind = '编排') {
  await content.waitFor({state: 'visible'});
  await page.evaluate(() => document.fonts.ready);
  const input = page.getByLabel(kind + '页面协议输入', {exact: true});
  await input.waitFor({state: 'visible'});
  const info = await input.evaluate((node, {kind}) => {
    const root = document.querySelector('.ares-app'), style = getComputedStyle(root), r = node.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'); context.fillStyle = style.getPropertyValue('--ui-bg').trim();
    context.fillRect(0, 0, 1, 1);
    const panels = [...root.querySelectorAll('.ares-composer-editor,.galaxy-console-body,.ares-modal')]
      .filter(item => item.getClientRects().length).map(item => ({name:item.className,
        clientWidth:item.clientWidth, scrollWidth:item.scrollWidth}));
    const controls = [...root.querySelectorAll('.ares-btn,.ares-input,.ares-tabs>button')]
      .filter(item => item.getClientRects().length && !item.closest('[hidden]'))
      .map(item => ({name:item.getAttribute('aria-label') || item.textContent.trim().slice(0, 28),
        size:parseFloat(getComputedStyle(item).fontSize)}));
    const surfaceStyles = [...root.querySelectorAll('.ares-skill-item h3,.ares-skill-item p,.ares-artifact-head strong,' +
      '.ares-flow-map>footer>span,.ares-editor-head>div>span,.project-continuum>header,' +
      '.continuum-step:not(.status-done):not(.status-stale):not(.status-blocked),' +
      '.ares-team-list>span,.ares-board-card h3,.ares-table td')]
      .filter(item => item.getClientRects().length && !item.closest('[hidden]'))
      .map(item => { const value=getComputedStyle(item); return {name:item.className || item.tagName,
        text:item.textContent.trim().slice(0,30),color:value.color,size:parseFloat(value.fontSize),
        background:value.background,opacity:value.opacity}; });
    return {same:window[kind === '项目' ? 'keptProjectInput' : 'keptEditorInput'] === node,
      connected:node.isConnected, inert:!!node.closest('[inert]'), hit:at === node,
      chatMode:node.closest('.galaxy-chat')?.dataset.chatMode, draft:node.value,
      inputFontSize:parseFloat(getComputedStyle(node).fontSize),
      rootFontSize:parseFloat(style.fontSize), background:style.getPropertyValue('--ui-bg').trim(),
      pixel:[...context.getImageData(0, 0, 1, 1).data],
      viewport:{width:innerWidth,height:innerHeight}, rect:{x:r.x,y:r.y,width:r.width,height:r.height},
      pageWidth:document.documentElement.clientWidth, pageScrollWidth:document.documentElement.scrollWidth,
      panels, controls, surfaceStyles, libraryCards:[...root.querySelectorAll('.ares-library-card')]
        .map(item => {const value=getComputedStyle(item); return {background:value.background,backgroundImage:value.backgroundImage,
          opacity:value.opacity,filter:value.filter,backdropFilter:value.backdropFilter,
          border:value.borderColor,transform:value.transform,animations:item.getAnimations().length};})};
  }, {kind});
  assert.equal(info.same, true, name + ': same native slot input DOM');
  assert.equal(info.connected, true, name); assert.equal(info.inert, false, name);
  assert.equal(info.hit, true, name + ': input centre is unobstructed');
  assert.equal(info.chatMode, kind === '项目' ? 'project' : 'editor', name);
  assert.equal(info.draft, kind + '输入草稿，仅验证保留，不发送。', name);
  assert.ok(info.rect.width >= 200 && info.rect.height >= 40, name + ': useful input size');
  assert.ok(info.rect.x >= 0 && info.rect.y >= 0 && info.rect.x + info.rect.width <= info.viewport.width + 1 &&
    info.rect.y + info.rect.height <= info.viewport.height + 1, name + ': input is within viewport');
  assert.equal(info.rootFontSize, 16, name + ': body text size');
  assert.ok(info.inputFontSize >= 16, name + ': native public input font size');
  assert.ok(info.controls.length > 0 && info.controls.every(control => control.size >= 12 && control.size <= 18),
    name + ': readable controls ' + JSON.stringify(info.controls));
  assert.ok(info.surfaceStyles.every(surface => {
    const rgb=surface.color.match(/[\d.]+/g)?.slice(0,3).map(Number);
    return surface.size >= 12 && rgb && (Math.max(...rgb)-Math.min(...rgb)<=24 || rgb[0]>=rgb[1]&&rgb[1]>=rgb[2]);
  }), name + ': nested labels use readable neutral/champagne text ' + JSON.stringify(info.surfaceStyles));
  const rgb = info.pixel.slice(0, 3);
  assert.ok(Math.max(...rgb) - Math.min(...rgb) <= 18 && Math.max(...rgb) <= 40 && info.pixel[3] === 255,
    name + ': actual theme is opaque dark neutral');
  assert.ok(info.pageScrollWidth <= info.pageWidth + 1, name + ': no page horizontal overflow');
  assert.ok(info.panels.every(panel => panel.scrollWidth <= panel.clientWidth + 2),
    name + ': no panel horizontal overflow ' + JSON.stringify(info.panels));
  if (name === 'capability-library') assert.ok(info.libraryCards.length > 0 && info.libraryCards.every(card =>
    card.backgroundImage.includes('linear-gradient') && !card.backgroundImage.includes('rgba(')),
    'Capability cards use opaque stops so translucent paint cannot accumulate');
  await input.click(); assert.equal(await input.evaluate(node => document.activeElement === node), true,
    name + ': real pointer focus reaches input');
  const screenshot = join(base, name + '.png'); await page.screenshot({path: screenshot});
  evidence.push({name, kind, screenshot, ...info});
}

const closeModal = page => page.getByRole('button', {name:'关闭对话框', exact:true}).click();
const projectSettings = async page => {
  const panel = page.locator('.galaxy-console:visible');
  await (await panel.count() ? panel.locator('.galaxy-console-heading [data-action=project-settings]') :
    page.locator('.ff-tools [data-action=project-settings]')).click();
  await page.getByRole('dialog', {name:'设置', exact:true}).waitFor();
};

test('current functional pages use the neural theme with readable controls, real content and resident clickable native input slots', async () => {
  const sourceHashes = assetHashes();
  const page = await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
  page.setDefaultTimeout(14000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { external.push(url.href); await route.abort(); return; }
    if (url.pathname === '/') {
      await route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{margin:0;width:100%;height:100%}.page-native-protocol{height:100%;min-height:0;display:flex;flex-direction:column}.page-native-protocol>small{font:12px/1.7 sans-serif}.page-native-protocol [data-composer-seat]{margin-top:auto}.page-native-protocol [data-composer-card]{padding:12px}.page-native-protocol textarea{display:block;box-sizing:border-box;width:100%;min-height:88px;resize:none;background:transparent;border:0}</style></head><body><div id="root"></div><script type="module">'+harness+'</script></body></html>'}); return;
    }
    if (url.pathname === '/ares/api/host/extension-form.js') url.pathname = '/ares/api/v2/extension-form.js';
    const path = url.pathname.slice('/ares/api/v2/'.length), data = request.postData() ? JSON.parse(request.postData()) : undefined;
    if (data) requests.push({path, data});
    const result = await productionRequest(path + url.search, data, request.headers());
    await route.fulfill({status:result.status,headers:result.headers,body:result.body});
  });
  try {
    await page.goto(origin); await page.locator('#root[data-galaxy-ready=true]').waitFor();
    await page.locator('[data-neural-scene=true][data-neural-intro=complete]').waitFor();
    await page.getByLabel('项目页面协议输入',{exact:true}).fill('项目输入草稿，仅验证保留，不发送。');
    await page.evaluate(() => window.keptProjectInput = document.querySelector('[aria-label="项目页面协议输入"]'));
    await page.locator('[data-action=workspace][data-id=composer]').click();
    await page.getByLabel('选择比赛',{exact:true}).selectOption('5');
    await page.waitForFunction(() => document.querySelector('.ares-composer-editor')?.dataset.competitionId === '5' &&
      document.querySelector('.ares-composer-editor')?.getAttribute('aria-busy') === 'false');
    await page.getByLabel('编排页面协议输入',{exact:true}).fill('编排输入草稿，仅验证保留，不发送。');
    await page.evaluate(() => window.keptEditorInput = document.querySelector('[aria-label="编排页面协议输入"]'));
    for (const [id, control] of [['goal','本步目标'],['outputs','产物名称 1'],['skills','查找绑定技能'],['prompts','执行提示']]) {
      await page.locator('.ares-composer-editor [data-action=tab][data-id=' + id + ']').click();
      const content = page.getByLabel(control,{exact:true}); await content.scrollIntoViewIfNeeded();
      await pageProof(page, 'composer-' + id, content);
    }
    await page.locator('.ares-composer-flow-heading [data-action=workflow-settings]').click();
    await pageProof(page, 'workflow-settings', page.getByRole('dialog',{name:'流程总控与参数',exact:true}));
    await closeModal(page);
    await page.locator('.ares-composer-flow-heading [data-action=composer-capabilities]').click();
    await page.getByRole('status').filter({hasText:/项候选/}).waitFor();
    await pageProof(page, 'capability-library', page.getByLabel('搜索技能',{exact:true}));
    await page.getByRole('button',{name:'返回编排',exact:true}).click();
    await page.locator('[data-action=workspace][data-id=projects]').click();
    await page.locator('.ff-tools [data-action=project-tab][data-id=progress]').click();
    await pageProof(page, 'project-progress', page.locator('.process-progress-table'), '项目');
    await projectSettings(page);
    await page.getByRole('dialog').locator('[data-action=project-tab][data-id=tasks]').click();
    await pageProof(page, 'project-management', page.locator('.project-continuum'), '项目');
    await projectSettings(page);
    await page.getByRole('dialog').locator('[data-action=project-tab][data-id=materials]').click();
    await pageProof(page, 'project-materials', page.getByRole('button',{name:'关联本地资料',exact:true}), '项目');
    await page.locator('.galaxy-section-tabs [data-action=project-tab][data-id=facts]').click();
    await pageProof(page, 'project-facts', page.getByLabel('项目目标',{exact:true}), '项目');
    await page.getByRole('button',{name:'返回项目',exact:true}).click();
    await page.locator('.process-step[data-process-step="' + project.workflow.steps[0].id + '"]').click();
    await page.locator('.neural-output[data-action=project-artifact-select]').first().click();
    await page.locator('[data-neural-scene=true][data-phase=note]').waitFor();
    await page.locator('.ff-right [data-action=product-open]').click();
    await page.locator('.competition-product [data-action=project-tab][data-id=versions]').click();
    await pageProof(page, 'project-versions', page.getByRole('heading',{name:'项目版本',exact:true}), '项目');
    assert.deepEqual(readFileSync(join(root, '.ares/project.json')), originalProject);
    assert.deepEqual(readFileSync(configPath()), originalConfiguration);
    assert.equal(readProject(root).progress.done, 0);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    assert.deepEqual(assetHashes(), sourceHashes, 'Source assets remain frozen during this visual check');
    writeFileSync(join(base, 'functional-pages-evidence.json'), JSON.stringify({
      provenance:'Actual ARES app and production routes; explicit native input-slot fixtures, no session/model/cloud calls',
      sourceHashes, pages:evidence, projectUnchanged:true, configurationUnchanged:true,
      requests:requests.map(row => row.path), errors, external}, null, 2));
    console.log('NEURAL_THEME_PAGES_EVIDENCE', base);
  } catch (error) {
    await page.screenshot({path:join(base,'failure.png')});
    writeFileSync(join(base,'failure-evidence.json'),JSON.stringify({message:error.message,pages:evidence,errors,external},null,2));
    console.log('NEURAL_THEME_PAGES_FAILURE',base); throw error;
  } finally { await page.close(); }
});
