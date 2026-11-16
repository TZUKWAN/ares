import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectOutput,sourceFiles} from '../host/projects.js';
import {syntheticEvidence,sensitiveFile} from '../host/project-artifacts.js';
import {resourcePath} from '../host/skill-packages.js';
const root=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-provenance-'));mkdirSync(join(root,'output'));const p={id:'explicit-file-contract-fixture',outputDir:'output'};
test('spreadsheet BOM and quoted reserved headers cannot erase a simulation marker',()=>{const output={id:'csv',kind:'file',title:'协议CSV',format:'csv',path:'data.csv',requirement:'required'};writeFileSync(join(root,'output/data.csv'),'\uFEFF"__data_kind","__synthetic_seed","Q1"\n"synthetic","explicit-fixture","4"\n');const checked=inspectOutput(root,p,output,[output]);assert.equal(checked.valid,true);assert.equal(syntheticEvidence(root,p,checked,output,{sourceFiles}),true);});
test('source documentation quoting a JSON data marker is not itself simulated observations',()=>{const path=join(root,'output/source');mkdirSync(path);writeFileSync(join(path,'README.md'),'# Software documentation\n```json\n{"dataKind":"synthetic"}\n```\n');const output={id:'source',kind:'directory',title:'协议源码',format:'directory',path:'source',requirement:'required'},checked=inspectOutput(root,p,output,[output]);assert.equal(checked.valid,true);assert.equal(syntheticEvidence(root,p,checked,output,{sourceFiles}),false);});
test('the actual DSH credential filename and backups cannot enter exported artifacts or skills',()=>{for(const path of ['.credentials.yaml','assets/.credentials.yaml.bak','nested/.secrets.json']){assert.equal(sensitiveFile(path),true,path);assert.throws(()=>resourcePath(path),/凭据/);}});
test('credential fixtures cannot be previewed as artifacts or included in source inspection',()=>{
 writeFileSync(join(root,'output/.credentials.yaml'),'explicit-software-fixture: never-a-real-secret\n');
 const output={id:'credential',kind:'file',title:'拒绝凭据测试',format:'yaml',path:'.credentials.yaml',requirement:'required'},checked=inspectOutput(root,p,output,[output]);
 assert.equal(checked.valid,false);assert.match(checked.error,/凭据/);assert.throws(()=>sourceFiles(join(root,'output')),/凭据/);
});
