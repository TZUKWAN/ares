/** Real packager CLI against owned paths only; no host install or user data. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,linkSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/package_plugins.mjs',import.meta.url));
const version=JSON.parse(readFileSync(new URL('../platforms/packaging/codex-plugin.json',import.meta.url),'utf8')).version;
function setup(){const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-package-path-')),out=join(base,'output'),outside=join(base,'outside-owned');mkdirSync(out);mkdirSync(outside);return {base,out,outside};}
function run(out){return spawnSync(process.execPath,[script,'--out',out],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:65536});}
function denied(result){assert.notEqual(result.status,0,'The actual CLI must refuse this destination');assert.match(result.stderr,/symlink|link|destination|路径|链接/i);}

test('packaging refuses an output-directory symlink before creating anything outside the selected path',()=>{
 const f=setup(),alias=join(f.base,'output-alias');symlinkSync(f.outside,alias,process.platform==='win32'?'junction':'dir');
 const result=run(alias);denied(result);assert.deepEqual(readdirSync(f.outside),[]);
});
test('packaging refuses a marketplace ancestor symlink, not just the immediate file parent',()=>{
 const f=setup();symlinkSync(f.outside,join(f.out,'codex-marketplace'),process.platform==='win32'?'junction':'dir');
 mkdirSync(join(f.outside,'ares'));writeFileSync(join(f.outside,'ares','PACKAGE_FILES.json'),JSON.stringify({files:{}}));
 const before=readFileSync(join(f.outside,'ares','PACKAGE_FILES.json'));
 const result=run(f.out);denied(result);assert.deepEqual(readdirSync(f.outside),['ares']);assert.deepEqual(readdirSync(join(f.outside,'ares')),['PACKAGE_FILES.json']);assert.deepEqual(readFileSync(join(f.outside,'ares','PACKAGE_FILES.json')),before);
});
test('packaging refuses a hard-linked archive rather than overwriting its other filename',()=>{
 const f=setup(),external=join(f.outside,'keep.txt'),bytes=Buffer.from('Owned path boundary marker.');writeFileSync(external,bytes);
 linkSync(external,join(f.out,'ARES-Codex-'+version+'.zip'));
 const result=run(f.out);denied(result);assert.deepEqual(readFileSync(external),bytes);assert.deepEqual(readdirSync(f.out),['ARES-Codex-'+version+'.zip']);
});
