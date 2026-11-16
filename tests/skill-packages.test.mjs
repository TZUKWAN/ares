import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {hash} from '../host/storage.js';
import {readLocalPackage,loadPackage,readPackageResource,editPackage,storePackage,resourcePath,gitBlobHash} from '../host/skill-packages.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-package-'));process.env.ARES_HOME=join(base,'home');
const root=join(base,'actual-local-skill');mkdirSync(join(root,'scripts'),{recursive:true});
writeFileSync(join(root,'SKILL.md'),'---\nname: actual-test-skill\ndescription: >\n  Explicit software test fixture.\n  Never competition evidence.\n---\n# Test fixture skill\nUse scripts/check.py.\n');
writeFileSync(join(root,'scripts/check.py'),'print("Actual packaged script source, not executed during import")\n');
writeFileSync(join(root,'binary.dat'),Buffer.from([0,255,1,254]));
let pack;
test('local package preserves real body, scripts, binary bytes and content-addressed provenance',()=>{
 pack=readLocalPackage(root);assert.equal(pack.metadata.name,'actual-test-skill');assert.match(pack.metadata.description,/Never competition evidence/);assert.equal(pack.files.length,3);assert.equal(pack.origin.path,root);assert.equal(readPackageResource(pack.id,'binary.dat').binary,true);assert.match(loadPackage(pack.id,{body:true}).content,/check.py/);assert.equal(hash(readFileSync(join(root,'binary.dat'))),pack.files.find(item=>item.path==='binary.dat').sha256);
});
test('editing a resource creates a new immutable package and keeps unread resources intact',()=>{
 const old=readPackageResource(pack.id,'scripts/check.py'),next=editPackage(pack.id,{resources:[{path:'scripts/check.py',expectedContentHash:old.bodyHash,content:'print("new explicit fixture")\n'}]});assert.notEqual(next.id,pack.id);assert.match(readPackageResource(pack.id,'scripts/check.py').content,/not executed/);assert.match(readPackageResource(next.id,'scripts/check.py').content,/new explicit/);assert.equal(next.files.find(item=>item.path==='binary.dat').sha256,pack.files.find(item=>item.path==='binary.dat').sha256);assert.throws(()=>editPackage(pack.id,{resources:[{path:'scripts/check.py',expectedContentHash:'outdated',content:'bad'}]}),/资源已变化/);
});
test('credential paths, traversal, case conflicts, links and unresolved LFS pointers are rejected',()=>{
 for(const path of ['../escape','x/../../escape','.env','keys/private.pem','bad\\name','CON.txt'])assert.throws(()=>resourcePath(path));
 const body=Buffer.from('# Explicit fixture\n');assert.throws(()=>storePackage(new Map([['SKILL.md',body],['A.txt',body],['a.txt',body]]),{kind:'test-fixture'}),/大小写冲突/);
 assert.throws(()=>storePackage(new Map([['SKILL.md',body],['pointer.txt',Buffer.from('version https://git-lfs.github.com/spec/v1\n')]]),{kind:'test-fixture'}),/LFS/);
 const outside=join(base,'outside');mkdirSync(outside);symlinkSync(outside,join(root,'linked'),'junction');assert.throws(()=>readLocalPackage(root),/符号链接/);
});
test('a changed cached resource fails hash verification instead of appearing ready',()=>{
 const file=join(pack.root,'scripts/check.py'),original=readFileSync(file);writeFileSync(file,'tampered');assert.throws(()=>loadPackage(pack.id,{verify:true}),/哈希不匹配/);writeFileSync(file,original);assert.equal(loadPackage(pack.id,{verify:true}).id,pack.id);
});
test('Git blob checks use the actual object header and bytes',()=>{assert.equal(gitBlobHash(Buffer.from('hello\n')),'ce013625030ba8dba906f756967f9e9ca394464a');});
