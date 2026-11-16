import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {readConfiguration,saveConfiguration,competitionCatalog} from '../host/catalog.js';
import {linkRoot,initializeProject,readProject,taskAction} from '../host/projects.js';
import {createArtifactViewer} from '../host/artifact-viewer.js';
import {hash} from '../host/storage.js';
import {readProjectObject} from '../host/project-objects.js';
import {directRoutes} from './helpers/direct-routes.mjs';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-viewer-'));process.env.ARES_HOME=join(base,'home');
const root=join(base,'project');mkdirSync(root);linkRoot(root);
const configuration=readConfiguration(),workflow=structuredClone(configuration.workflows.find(row=>row.id==='modeling'));
workflow.id='viewer-software-qa';workflow.steps=[{...workflow.steps[0],outputs:[
 {id:'note',title:'真实软件测试文本',kind:'file',format:'md',path:'note.md',requirement:'required'},
 ...[['document','docx'],['slides','pptx'],['table','xlsx'],['pages','pdf'],['image','png'],['web','html']].map(([id,format])=>({id,title:id,kind:'file',format,path:id+'.'+format,requirement:'optional'})),
 {id:'code',title:'软件测试源码',kind:'directory',path:'source',requirement:'optional'},
 {id:'missing',title:'未生成作品',kind:'file',format:'txt',path:'missing.txt',requirement:'optional'}
]}];configuration.workflows.push(workflow);saveConfiguration(configuration,configuration.revision);
let project=initializeProject({root,name:'只用于软件预览验收',competitionId:5,track:competitionCatalog().find(row=>row.id===5).tracks[0].track,workflowId:workflow.id});
const output=join(root,project.outputDir);mkdirSync(join(output,'source'),{recursive:true});
writeFileSync(join(output,'note.md'),'# Viewer software fixture\n\nReal file bytes.');writeFileSync(join(output,'source/model.py'),'print(4)\n');writeFileSync(join(output,'source/.env'),'PRIVATE_SOFTWARE_TEST_VALUE');writeFileSync(join(output,'web.html'),'<h1>Local artifact</h1><script>parent.bad=1</script>');
const generated=spawnSync('python',['-c',[
 'import sys, pathlib, fitz',
 'from docx import Document',
 'from pptx import Presentation',
 'from pptx.util import Inches',
 'from openpyxl import Workbook',
 'p=pathlib.Path(sys.argv[1])',
 'd=fitz.open(); page=d.new_page(); page.insert_text((72,72),"Real PDF page one"); page2=d.new_page(); page2.insert_text((72,72),"Real PDF page two"); d.save(p/"pages.pdf"); (p/"image.png").write_bytes(d[0].get_pixmap().tobytes("png"))',
 'w=Document(); w.add_paragraph("Real DOCX paragraph"); w.save(p/"document.docx")',
 's=Presentation(); slide=s.slides.add_slide(s.slide_layouts[6]); slide.shapes.add_textbox(Inches(1),Inches(1),Inches(5),Inches(1)).text="Real PPTX slide"; s.save(p/"slides.pptx")',
 'x=Workbook(); x.active["A1"]="Real cell"; x.active["B1"]="=2+3"; x.save(p/"table.xlsx")',
].join('\n'),output],{encoding:'utf8',windowsHide:true});assert.equal(generated.status,0,generated.stderr);
const viewer=createArtifactViewer(),api=directRoutes();after(()=>{viewer.dispose();api.dispose();});
const args=(id,extra={})=>({root,id,...extra});

test('registered real files expose actual hashes and missing state without accepting tasks',async()=>{
 const model=await viewer.open(args('note'));assert.equal(model.text,readFileSync(join(output,'note.md'),'utf8'));assert.equal(model.version,hash(readFileSync(join(output,'note.md'))));assert.equal(model.mode,'markdown');assert.equal(model.editable,true);assert.equal(model.accepted,false);assert.equal(viewer.status(args('missing')).status,'missing');assert.equal(readProject(root).tasks.context.status,'pending');
});
test('directory selection rejects traversal, credentials, non-output IDs and unregistered roots',async()=>{
 assert.deepEqual(viewer.status(args('code')).files.map(row=>row.file),['model.py']);assert.equal((await viewer.open(args('code',{file:'model.py'}))).text,'print(4)\n');for(const body of [args('code',{file:'../note.md'}),args('code',{file:'.env'}),args('note',{file:'model.py'}),args('arbitrary'),{root:base,id:'note'}])assert.throws(()=>viewer.status(body));
});
test('real PDF is read by PyMuPDF and rendered to actual PNG pages, with bounds and version checks',async()=>{
 const model=await viewer.open(args('pages'));assert.equal(model.pageCount,2);assert.equal(model.pages.length,2);const png=await viewer.page(args('pages',{version:model.version,page:2}));assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.ok(png.readUInt32BE(16)>500);await assert.rejects(()=>viewer.page(args('pages',{version:model.version,page:3})),/页码/);await assert.rejects(()=>viewer.open(args('pages',{version:'a'.repeat(64)})),/已变化/);
});
test('without DSH converter, Office content is explicitly a read-only fallback, never fake layout',async()=>{
 const docx=await viewer.open(args('document')),pptx=await viewer.open(args('slides')),xlsx=await viewer.open(args('table'));assert.equal(docx.mode,'office-text');assert.match(docx.text,/Real DOCX paragraph/);assert.match(pptx.text,/Real PPTX slide/);assert.equal(xlsx.mode,'table');assert.equal(xlsx.sheets[0].rows[0][1],'=2+3');assert.match(docx.warning,/内容视图/);assert.equal(docx.editable,false);assert.equal(docx.pageCount,undefined);
});
test('native conversion adapter passes real bytes/version and uses provider PDF (protocol fixture only)',async()=>{
 let received;const service=createArtifactViewer({get(name){assert.equal(name,'officeToPdf');return {async convert(request){received=request;return {pdf:readFileSync(join(output,'pages.pdf')),missingFonts:['Software QA font']};}};}});
 try{const model=await service.open(args('document'));assert.equal(model.pageCount,2);assert.equal(received.extension,'docx');assert.equal((await received.source.read()).version,model.version);assert.deepEqual((await received.source.read()).bytes,readFileSync(join(output,'document.docx')));assert.match(model.warning,/Software QA font/);}finally{service.dispose();}
});
test('raster and HTML are read-only bytes/content; malformed image signatures fail',async()=>{
 const model=await viewer.open(args('image')),image=await viewer.image(args('image',{version:model.version}));assert.deepEqual(image.bytes,readFileSync(join(output,'image.png')));assert.equal(image.mime,'image/png');const html=await viewer.open(args('web'));assert.equal(html.mode,'html');assert.match(html.text,/<script>/);writeFileSync(join(output,'image.png'),'<svg>not a PNG</svg>');await assert.rejects(()=>viewer.open(args('image')),/字节不符/);
});
test('stable-save detection rejects a file still changing and leaves bytes untouched',async()=>{
 const pending=viewer.open(args('note'));const timer=setTimeout(()=>writeFileSync(join(output,'note.md'),'# Changed during read\n'),50);try{await assert.rejects(()=>pending,/正在保存/);}finally{clearTimeout(timer);}assert.equal(readFileSync(join(output,'note.md'),'utf8'),'# Changed during read\n');
});
test('text save binds revision+SHA, retains previous bytes, creates a draft and invalidates acceptance',async()=>{
 // Remove the deliberately malformed optional raster before accepting this software fixture.
 const recovered=spawnSync('python',['-c','import fitz,sys,pathlib; p=pathlib.Path(sys.argv[1]); d=fitz.open(p/"pages.pdf"); (p/"image.png").write_bytes(d[0].get_pixmap().tobytes("png"))',output],{encoding:'utf8',windowsHide:true});assert.equal(recovered.status,0,recovered.stderr);
 project=readProject(root);project=taskAction({root,expectedRevision:project.revision,stepId:'context',action:'complete',review:{summary:'读取真实软件测试文件后记录的软件验收夹具，非竞赛验收。',findings:[]}},'user');assert.equal(project.tasks.context.status,'done');
 const before=readFileSync(join(output,'note.md')),model=await viewer.open(args('note'));const unchanged=viewer.save(args('note',{expectedRevision:project.revision,version:model.version,text:model.text}));assert.equal(unchanged.unchanged,true);assert.equal(unchanged.project.revision,project.revision);assert.equal(unchanged.project.tasks.context.status,'done');const result=viewer.save(args('note',{expectedRevision:project.revision,version:model.version,text:'# Saved real working draft\n'}));project=result.project;assert.equal(project.tasks.context.status,'stale');assert.equal(readFileSync(join(output,'note.md'),'utf8'),'# Saved real working draft\n');assert.deepEqual(readProjectObject(root,hash(before)),before);assert.ok(project.workbench.artifacts.note.currentVersionId);
 assert.throws(()=>viewer.save(args('note',{expectedRevision:project.revision,version:model.version,text:'Would overwrite'})),/已被其他编辑器修改/);assert.equal(readFileSync(join(output,'note.md'),'utf8'),'# Saved real working draft\n');
 const fixed=await viewer.open(args('note',{versionId:project.workbench.artifacts.note.versionIds[0]}));assert.equal(fixed.immutable,true);assert.equal(fixed.editable,false);assert.equal(fixed.text,before.toString());
});
test('non-UTF8 source cannot be edited as empty text and UTF8 BOM is retained on a no-op save',async()=>{
 writeFileSync(join(output,'note.md'),Buffer.from([0xE9,0xFF,0x20]));const invalid=await viewer.open(args('note'));assert.equal(invalid.mode,'binary');assert.equal(invalid.editable,false);assert.throws(()=>viewer.save(args('note',{expectedRevision:readProject(root).revision,version:invalid.version,text:'Not an encoding conversion'})),/不是UTF-8/);
 writeFileSync(join(output,'note.md'),Buffer.concat([Buffer.from([239,187,191]),Buffer.from('# BOM retained\n')]));const bom=await viewer.open(args('note'));const saved=viewer.save(args('note',{expectedRevision:readProject(root).revision,version:bom.version,text:bom.text}));assert.equal(saved.unchanged,true);assert.equal(readFileSync(join(output,'note.md'))[0],239);
});
test('owner API returns binary PNG and enforces cross-site guard before rendering',async()=>{
 const opened=await api.request('project/viewer/open',args('pages'));assert.equal(opened.status,200);const result=await api.request('project/viewer/page',args('pages',{version:opened.body.document.version,page:1}),{raw:true});assert.equal(result.status,200);assert.equal(result.headers['content-type'],'image/png');assert.equal(result.body[0],137);const blocked=await api.request('project/viewer/open',args('note'),{headers:{origin:'https://untrusted.example','sec-fetch-site':'cross-site'}});assert.equal(blocked.status,403);
});
