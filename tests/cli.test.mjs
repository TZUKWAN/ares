import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {competitionCatalog} from '../host/catalog.js';
const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-cli-')),root=join(base,'owned-project'),home=join(base,'home'),script=resolve('scripts/ares.mjs');mkdirSync(root);
function cli(...args){const run=spawnSync(process.execPath,[script,...args],{windowsHide:true,encoding:'utf8',timeout:20000,env:{...process.env,ARES_HOME:home}});assert.equal(run.error,undefined);return {status:run.status,text:run.stdout||run.stderr,value:JSON.parse(run.stdout||run.stderr)};}
test('the actual CLI reads its installed catalog and initializes a real local project',()=>{
 assert.equal(cli('catalog').value.length,132);assert.equal(cli('workflows').value.length,12);
 const competition=competitionCatalog().find(v=>v.id===5),file=join(base,'init.json');writeFileSync(file,JSON.stringify({name:'CLI software fixture',competitionId:5,track:competition.tracks[0].track,workflowId:'modeling'}));
 assert.equal(cli('init','--root',root,'--input',file).status,0);assert.equal(cli('status','--root',root).value.progress.done,0);assert.equal(JSON.parse(readFileSync(join(root,'.ares/project.json'))).name,'CLI software fixture');
});
test('a failed CLI completion returns a nonzero exit and retains the real failure',()=>{
 const run=cli('complete','--root',root,'--step','context');assert.equal(run.value.tasks.context.status,'failed');assert.equal(run.status,1);assert.equal(JSON.parse(readFileSync(join(root,'.ares/project.json'))).tasks.context.status,'failed');
});
test('unknown, duplicate and valueless CLI flags are rejected before touching project state',()=>{
 const before=readFileSync(join(root,'.ares/project.json'),'utf8');
 for(const args of [['status','--root',root,'--bogus','unused'],['status','--root',root,'--root',root],['status','--root']]){const run=cli(...args);assert.equal(run.status,1,args.join(' '));assert.equal(run.value.ok,false);}
 assert.equal(readFileSync(join(root,'.ares/project.json'),'utf8'),before);
});
