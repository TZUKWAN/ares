import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {importRequirements,saveRequirements,adoptRequirements,requirementsCoverage} from '../host/study-requirements.js';
import {researchEntry} from '../host/project-research.js';
import {readProjectObject} from '../host/project-objects.js';
import {hash} from '../host/storage.js';
import {modelResearchIndex} from '../host/research-model.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-study-requirements-'));
process.env.ARES_HOME=join(base,'home');
function project(name){const root=join(base,name);mkdirSync(root);linkRoot(root);const comp=competitionCatalog().find(c=>c.id===5);return initializeProject({root,name,competitionId:5,track:comp.tracks[0].track,workflowId:'modeling',edition:'SOFTWARE-QA'});}
const original='软件测试规则原文，非真实赛事通知。\n必须提交项目报告。\n报告正文不超过30页。\n不得在匿名作品中填写姓名。\n截止前应当完成作品审核。\n';

test('requirements retain actual source bytes and exact quotes, editable mapping and explicit adoption keeps original gates',async()=>{
  const p=project('requirements'),root=p.root;
  writeFileSync(join(root,'notice.txt'),original);
  const saved=await importRequirements({root,expectedRevision:0,sourcePath:'notice.txt'});
  assert.equal(saved.item.status,'draft');
  const view=researchEntry(root,saved.item.id);
  assert.equal(view.data.source.object.sha256,hash(Buffer.from(original)));
  assert.deepEqual(readProjectObject(root,view.data.source.object.sha256),Buffer.from(original));
  assert.equal(view.data.rows.length,4);
  assert.ok(view.data.rows.every(row=>original.slice(row.start,row.end)===row.quote));
  assert.equal(readProject(root).progress.done,0);
  const rows=structuredClone(view.data.rows),step=p.workflow.steps[0];
  rows[0].stepId=step.id;rows[0].artifactId=step.outputs.find(row=>row.kind==='file').id;
  assert.throws(()=>saveRequirements({root,id:view.item.id,baseVersion:view.version.id,rows:[{...rows[0],quote:'编造的官方要求'}],expectedRevision:1}),/找不到摘录/);
  const next=saveRequirements({root,id:view.item.id,baseVersion:view.version.id,rows,expectedRevision:1});
  assert.equal(requirementsCoverage(root)[0].rows[0].stepTitle,step.title);
  assert.throws(()=>adoptRequirements({root,id:view.item.id,versionId:next.version.id,expectedRevision:2}),/负责人/);
  const adopted=adoptRequirements({root,id:view.item.id,versionId:next.version.id,expectedRevision:2,confirmOriginal:true});
  assert.equal(adopted.item.status,'adopted');
  const after=readProject(root);
  assert.equal(after.competition.ruleStatus,'unreviewed');
  assert.equal(after.competition.ruleChecklist.items.filter(row=>row.sourceId===view.item.id).length,4);
  assert.equal(after.progress.done,0);
  assert.deepEqual(readFileSync(join(root,'notice.txt')),Buffer.from(original));
});

test('PDF originals are extracted by the installed parser and source, project and version tampering are rejected',async()=>{
  const p=project('pdf-requirements'),root=p.root;
  const file=join(root,'rules.pdf');
  execFileSync('python',['-c','from pypdf import PdfWriter; import sys; w=PdfWriter(); w.add_blank_page(width=300,height=300); w.write(sys.argv[1])',file],{windowsHide:true});
  await assert.rejects(importRequirements({root,expectedRevision:0,sourcePath:'rules.pdf'}),/原文为空/);
  await assert.rejects(importRequirements({root,expectedRevision:0,url:'https://127.0.0.1/rules.pdf'}),/确认/);
  await assert.rejects(importRequirements({root,expectedRevision:0,url:'https://127.0.0.1/rules.pdf',approveNetwork:true}),/私网/);
  execFileSync('python',['-c','from pypdf import PdfWriter; from pypdf.generic import NameObject,DictionaryObject,DecodedStreamObject; import sys; w=PdfWriter(); p=w.add_blank_page(width=300,height=300); f=w._add_object(DictionaryObject({NameObject("/Type"):NameObject("/Font"),NameObject("/Subtype"):NameObject("/Type1"),NameObject("/BaseFont"):NameObject("/Helvetica")})); p[NameObject("/Resources")]=DictionaryObject({NameObject("/Font"):DictionaryObject({NameObject("/F1"):f})}); s=DecodedStreamObject(); s.set_data(b"BT /F1 12 Tf 20 250 Td (You must submit a report.) Tj ET"); p[NameObject("/Contents")]=w._add_object(s); w.write(sys.argv[1])',file],{windowsHide:true});
  const saved=await importRequirements({root,expectedRevision:0,sourcePath:'rules.pdf'});
  const pdf=researchEntry(root,saved.item.id);
  assert.equal(pdf.data.rows[0].quote,'You must submit a report.');
  assert.equal(pdf.data.source.object.sha256,hash(readFileSync(file)));
  const row=researchEntry(root,saved.item.id).data.rows[0];
  assert.throws(()=>saveRequirements({root,id:saved.item.id,baseVersion:saved.version.id,rows:[{...row,stepId:'foreign-step'}],expectedRevision:1}),/不属于/);
  assert.throws(()=>saveRequirements({root,id:saved.item.id,baseVersion:'0'.repeat(64),rows:[row],expectedRevision:1}),/版本/);
  const other=project('different-project');
  assert.throws(()=>researchEntry(other.root,saved.item.id),/不属于/);
});


test('an original with no heuristic keywords remains editable and its exact immutable text is readable by the host assistant',async()=>{
  const p=project('manual-original'),root=p.root,original='软件测试活动说明。正文介绍背景与作品范围。';
  const saved=await importRequirements({root,expectedRevision:0,text:original});
  assert.equal(researchEntry(root,saved.item.id).data.rows.length,0);
  const actual=modelResearchIndex(root,{researchId:saved.item.id,researchVersionId:saved.version.id,researchSourceId:'original'});
  assert.equal(actual.text,original);assert.equal(actual.nextOffset,null);assert.equal(actual.sha256,hash(original));
  assert.throws(()=>modelResearchIndex(root,{researchId:saved.item.id,researchSourceId:'unknown'}),{status:404});
  const next=saveRequirements({root,expectedRevision:1,id:saved.item.id,baseVersion:saved.version.id,rows:[{id:'manual',label:'核对作品范围',quote:'作品范围',kind:'advisory'}]});
  assert.equal(researchEntry(root,next.item.id).data.rows[0].quote,'作品范围');
});
