import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function copyDirectory(source,target){mkdirSync(target,{recursive:true});for(const entry of readdirSync(source,{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false);if(entry.isDirectory())copyDirectory(join(source,entry.name),join(target,entry.name));else copyFileSync(join(source,entry.name),join(target,entry.name));}}

test('FORGE emits identical canonical bytes from LF and CRLF sources, independent of cwd',()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-build-eol-')),copy=join(base,'source');mkdirSync(join(copy,'scripts'),{recursive:true});
 for(const path of ['client','assets/forge-fonts','assets/neural-reference'])copyDirectory(join(root,path),join(copy,path));
 copyFileSync(join(root,'scripts/build_forge.mjs'),join(copy,'scripts/build_forge.mjs'));
 const generated=['workshop-scene.js','workshop.css'];
 const inputs=readdirSync(join(copy,'client')).filter(name=>/\.(?:js|css)$/.test(name)&&!generated.includes(name));
 function run(check=false){const result=spawnSync(process.execPath,[join(copy,'scripts/build_forge.mjs'),...(check?['--check']:[])],{cwd:base,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:65536});assert.equal(result.error,undefined);assert.equal(result.status,0,(result.stderr||result.stdout).slice(-2000));return JSON.parse(result.stdout);}
 function hashes(){return generated.map(name=>sha(readFileSync(join(copy,'client',name))));}
 for(const name of inputs){const path=join(copy,'client',name);writeFileSync(path,readFileSync(path,'utf8').replace(/\r\n?/g,'\n'));}
 const lf=run(),expected=hashes();run(true);
 for(const name of inputs){const path=join(copy,'client',name);writeFileSync(path,readFileSync(path,'utf8').replace(/\n/g,'\r\n'));}
 const crlf=run();assert.deepEqual(hashes(),expected);assert.deepEqual(crlf.outputs,lf.outputs);run(true);
 console.log(JSON.stringify({evidence:base,inputs:inputs.length,outputs:lf.outputs,mode:'Real builders and assets; scalar hashes only'}));
});

test('portable page, dependency notices and build receipt verify from an unrelated working directory',()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-portable-build-cwd-'));
 const result=spawnSync(process.execPath,[join(root,'scripts/build_portable_ui.mjs'),'--check'],{cwd:base,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:65536});
 assert.equal(result.error,undefined);assert.equal(result.status,0,(result.stderr||result.stdout).slice(-2000));
 const receipt=JSON.parse(result.stdout);assert.equal(receipt.mode,'verified');assert.equal(receipt.mediaAreSeparateBoundedResources,true);
});

test('a broken separately served application entry fails the real builder before overwriting any generated resource',()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-build-syntax-'));mkdirSync(join(base,'scripts'));mkdirSync(join(base,'client'));
 copyFileSync(join(root,'scripts/build_forge.mjs'),join(base,'scripts/build_forge.mjs'));
 writeFileSync(join(base,'client/app.js'),'export function intentionallyBroken(');
 const previous='Explicit pre-existing output marker, not a generated build.';
 for(const name of ['workshop-scene.js','workshop.css'])writeFileSync(join(base,'client',name),previous);
 const result=spawnSync(process.execPath,[join(base,'scripts/build_forge.mjs')],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536});
 assert.notEqual(result.status,0);assert.match(result.stderr,/Client JS syntax check failed: app\.js/);
 for(const name of ['workshop-scene.js','workshop.css'])assert.equal(readFileSync(join(base,'client',name),'utf8'),previous);
});
