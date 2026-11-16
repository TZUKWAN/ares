import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,unlinkSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {defaults,readConfiguration,readStoredConfiguration,configurationForEditor,saveConfiguration,skillCatalog} from '../host/catalog.js';
import {readLocalPackage,packageReference} from '../host/skill-packages.js';
import {projectNativeBinding} from '../host/native-versions.js';
import {environmentOptions} from '../host/skill-execution.js';
import {applyEdits} from '../host/editor-operations.js';

test('missing package metadata stays visible and the valid revision can be repaired',()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-recovery-'));process.env.ARES_HOME=join(base,'home');const source=join(base,'source');mkdirSync(source);writeFileSync(join(source,'SKILL.md'),'# Explicit recovery fixture\nNot competition evidence.\n');const pack=readLocalPackage(source),configuration=defaults();configuration.skills.push(packageReference(pack,'recovery-fixture'));saveConfiguration(configuration,0);
 unlinkSync(join(pack.root,'..','manifest.json'));assert.throws(()=>readConfiguration());const damaged=configurationForEditor();assert.equal(damaged.configuration.revision,1);assert.ok(damaged.configurationError);assert.equal(skillCatalog(damaged.configuration,{content:false,tolerant:true}).find(item=>item.id==='recovery-fixture').verification,'unavailable');
 const repaired=readLocalPackage(source);assert.equal(repaired.id,pack.id);assert.equal(repaired.cacheRepaired,true);assert.equal(readConfiguration().revision,1);
 const clean=readStoredConfiguration();clean.skills=[];assert.equal(saveConfiguration(clean,1).revision,2);
});
test('a malformed native binding cannot be silently replaced with a new workflow version',()=>{
 const root=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-binding-'));mkdirSync(join(root,'.ares'));const path=join(root,'.ares/native-binding.json');writeFileSync(path,JSON.stringify({schema_version:1,presetId:'../../wrong',definitionId:'a'.repeat(64)}));const original=readFileSync(path,'utf8');assert.throws(()=>projectNativeBinding(root,'b'.repeat(64),'ares-native-'+'c'.repeat(64)),/绑定损坏/);assert.equal(readFileSync(path,'utf8'),original);
});
test('native preparation rejects traversal module/package names while allowing real package identifiers',()=>{
 const requirements={declaredFiles:[],runtimeHints:{node:true}};for(const modules of [['../model'],['node:fs/..'],['@scope/../x']])assert.throws(()=>environmentOptions({runtime:'node',modules},requirements,''),/模块探测名称无效/);
 for(const packages of [['..@1.0.0'],['@../x@1.2.3'],['pkg@latest'],['https://example.invalid/pkg']])assert.throws(()=>environmentOptions({runtime:'node',packages},requirements,''),/固定具体版本/);
 assert.deepEqual(environmentOptions({runtime:'node',packages:['@scope/tool@1.2.3'],modules:['node:fs','node:fs/promises']},requirements,'').modules,['node:fs','node:fs/promises']);
});
test('adding a resource to an inline override preserves the actual edited body',()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-override-resource-'));process.env.ARES_HOME=base;const configuration=defaults(),original=skillCatalog(configuration).find(item=>item.id==='ares-intake'),content=original.content+'\nExplicit test-only inline override.\n';configuration.skills.push({id:original.id,title:original.title,description:original.description,content,source:'user'});
 const next=applyEdits(configuration,'venture',[{type:'update_skill_resource',skillId:original.id,path:'references/test-note.txt',expectedContentHash:null,content:'Actual text resource fixture\n'}]),updated=skillCatalog(next,{ids:new Set([original.id])})[0];assert.equal(updated.content,content);assert.ok(updated.files.some(item=>item.path==='references/test-note.txt'));assert.equal(readFileSync(join(original.root,'SKILL.md'),'utf8'),original.content);
});
