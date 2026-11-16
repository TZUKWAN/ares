import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {addLibrarySource,libraryInfo,searchLibrary,materializeLibrarySkill,knownSourceAllows} from '../host/skill-library.js';
import {prepareSkillEdits} from '../host/editor-skill-operations.js';
import {applyEdits} from '../host/editor-operations.js';
import {defaults,skillCatalog,freezeWorkflow} from '../host/catalog.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-library-'));process.env.ARES_HOME=join(base,'home');const root=join(base,'source');
for(const name of ['one','two']){mkdirSync(join(root,name,'scripts'),{recursive:true});writeFileSync(join(root,name,'SKILL.md'),'---\nname: fixture-'+name+'\ndescription: Explicit fixture source, not tested competition content.\n---\n# '+name+'\nRead scripts/check.py before use.\n');writeFileSync(join(root,name,'scripts/check.py'),'print("fixture resource")\n');}
let indexed,id,loaded;
test('only user-authorized sources are indexed; metadata search is paged without loading all bodies',async()=>{
 await assert.rejects(()=>addLibrarySource({kind:'local',path:root},0),/真实用户消息/);
 indexed=await addLibrarySource({kind:'local',path:root},0,{authorization:'Please index the explicitly provided folder '+root});assert.equal(indexed.total,2);const first=searchLibrary([],{source:indexed.sources[0].id,limit:1});assert.equal(first.items.length,1);assert.equal('content' in first.items[0],false);assert.equal(first.nextOffset,1);id=first.items[0].id;
 await assert.rejects(()=>addLibrarySource({kind:'local',path:root},0,{ownerAction:true}),/已更新/);
});
test('one selected skill materializes real resources; unread versions cannot be bound',async()=>{
 const configuration=defaults(),edits=[{type:'bind_skill',stepId:'problem',skillId:id}];loaded=await materializeLibrarySkill(id);assert.match(loaded.pack.content,/Read scripts/);assert.equal(loaded.pack.files.length,2);
 await assert.rejects(()=>prepareSkillEdits(configuration,'modeling',edits),/先读取/);
 const prepared=await prepareSkillEdits(configuration,'modeling',edits,{readReceipts:{[id]:loaded.readToken}}),next=applyEdits(configuration,'modeling',prepared.edits);assert.ok(next.workflows.find(item=>item.id==='modeling').steps.find(item=>item.id==='problem').skills.includes(id));assert.equal(next.skills[0].packageId,loaded.pack.id);assert.equal('content' in next.skills[0],false);
 const snapshot=freezeWorkflow(next.workflows.find(item=>item.id==='modeling'),next),skill=snapshot.skills.find(item=>item.id===id);assert.ok(skill.resources.some(item=>item.path==='scripts/check.py'));assert.match(skill.content,/Read scripts/);
});
test('package resource edits and body changes preserve immutable originals and actual resources',()=>{
 const configuration=defaults();configuration.skills.push(loaded.skill);const before=skillCatalog(configuration,{ids:new Set([id])})[0];
 const next=applyEdits(configuration,'modeling',[{type:'update_skill',skillId:id,expectedContentHash:(awaitHash=>awaitHash)(loaded.pack.files.find(item=>item.path==='SKILL.md').sha256),replacements:[{find:'Read scripts/check.py before use.',replace:'Read and verify scripts/check.py before use.'}]}]);
 assert.notEqual(next.skills[0].packageId,configuration.skills[0].packageId);assert.equal(before.packageId,loaded.pack.id);assert.ok(skillCatalog(next,{ids:new Set([id])})[0].files.some(item=>item.path==='scripts/check.py'));
});
test('registered local sources cannot authorize a Junction pointing outside their real root',()=>{
 const outside=join(base,'outside');mkdirSync(outside);const link=join(root,'escape');symlinkSync(outside,link,'junction');assert.equal(knownSourceAllows({kind:'local',path:link}),false);assert.equal(libraryInfo().revision,1);
});
