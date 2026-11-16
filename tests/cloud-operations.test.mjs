import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertCloudPublicationIdle,withCloudPublication} from '../host/cloud-operations.js';
import {linkRoot,initializeProject,changeProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {connectCollaboration,publishCloudRelease,reconcileCloudPublication} from '../host/project-collaboration.js';
// Real owned promises and filesystem aliases. No cloud operation is simulated.
const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-cloud-operation-')),root=join(base,'project'),other=join(base,'other'),alias=join(base,'alias');mkdirSync(root);mkdirSync(other);symlinkSync(root,alias,process.platform==='win32'?'junction':'dir');
test('a live publication excludes reconciliation, rebinding and duplicate launch through aliases',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve),active=withCloudPublication(root,()=>pending);
 assert.throws(()=>assertCloudPublicationIdle(alias),error=>error.status===409);await assert.rejects(withCloudPublication(alias,()=>assert.fail('A duplicate publication must not execute')),error=>error.status===409);
 assert.doesNotThrow(()=>assertCloudPublicationIdle(other));release('actual promise settled');assert.equal(await active,'actual promise settled');assert.doesNotThrow(()=>assertCloudPublicationIdle(alias));
});
test('a failed request is terminal locally and leaves subsequent recovery possible',async()=>{
 await assert.rejects(withCloudPublication(root,async()=>{throw new Error('Owned real failure fixture');}),/real failure/);assert.doesNotThrow(()=>assertCloudPublicationIdle(root));assert.equal(await withCloudPublication(root,async()=>42),42);
});
test('production collaboration entries refuse a live publication before any CLI operation or project write',async()=>{
 process.env.ARES_HOME=join(base,'home');linkRoot(root);const competition=competitionCatalog().find(v=>v.id===5);let project=initializeProject({root,name:'Explicit cloud guard software fixture',competitionId:5,track:competition.tracks[0].track,workflowId:'modeling'});
 project=changeProject({root,expectedRevision:project.revision},p=>{p.workbench.collaboration={provider:'kdocs',driveId:'explicit-fixture-drive',folderId:'0',publisherId:'owner',documents:[],publications:[]};});
 const before=readFileSync(join(root,'.ares/project.json'),'utf8');let release;const active=withCloudPublication(root,()=>new Promise(resolve=>release=resolve)),body={root,expectedRevision:project.revision,driveId:'explicit-fixture-drive',folderId:'0'};
 try{for(const operation of [connectCollaboration,publishCloudRelease,reconcileCloudPublication])await assert.rejects(operation(body),error=>error.status===409&&/云发布请求/.test(error.message));assert.equal(readFileSync(join(root,'.ares/project.json'),'utf8'),before);}
 finally{release();await active;}
});
