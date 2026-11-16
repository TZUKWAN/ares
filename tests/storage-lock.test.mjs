import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as pause} from 'node:timers/promises';
import {locked} from '../host/storage.js';
import {withLockRecoveryGuard} from '../host/lock-recovery.js';
const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-storage-lock-')),helper=resolve('tests/helpers/hold-storage-lock.mjs');
async function holder(name,program=helper){const target=join(base,name),ready=target+'.ready',release=target+'.release',child=spawn(process.execPath,[program,target,ready,release],{windowsHide:true,stdio:'ignore'}),exited=once(child,'exit');for(let i=0;i<150&&!existsSync(ready);i++)await pause(20);assert.ok(existsSync(ready),'The actual owned child must acquire its lock');return {target,ready,release,child,exited,async stop(){if(child.exitCode===null)child.kill('SIGKILL');await exited;}};}
test('a live writer cannot be displaced and a normal release leaves the file usable',async()=>{
 const h=await holder('live.json');try{assert.throws(()=>locked(h.target,()=>assert.fail('A live lock cannot be entered')),e=>e.status===409);writeFileSync(h.release,'release');await h.exited;assert.equal(readFileSync(h.target,'utf8'),'committed by owned fixture');assert.equal(locked(h.target,()=>42),42);assert.equal(existsSync(h.target+'.lock'),false);}finally{await h.stop();}
});
test('a truly terminated writer can be recovered without deleting its lock evidence',async()=>{
 const h=await holder('crashed.json');await h.stop();assert.ok(existsSync(h.target+'.lock'));
 assert.equal(locked(h.target,()=>{writeFileSync(h.target,'actually recovered');return true;}),true);assert.equal(readFileSync(h.target,'utf8'),'actually recovered');
 const saved=readdirSync(base).filter(name=>name.startsWith('crashed.json.lock.abandoned-'));assert.equal(saved.length,1);assert.equal(JSON.parse(readFileSync(join(base,saved[0]))).pid,h.child.pid);assert.equal(existsSync(h.target+'.lock'),false);
});
test('exceptions release only the caller lock while legacy or unknown locks remain intact',()=>{
 const file=join(base,'throw.json');assert.throws(()=>locked(file,()=>{throw new Error('Owned actual failure');}),/actual failure/);assert.equal(locked(file,()=>7),7);
 writeFileSync(file+'.lock','');assert.throws(()=>locked(file,()=>assert.fail('An unidentified lock must not be removed')),e=>e.status===409);assert.equal(readFileSync(file+'.lock','utf8'),'');
});
test('the actual recovery mutex excludes another process and disappears when its owner is killed',async()=>{
 const h=await holder('recovery-guard',resolve('tests/helpers/hold-recovery-guard.mjs'));
 try{assert.throws(()=>withLockRecoveryGuard(h.target,()=>assert.fail('Concurrent recovery is forbidden')),e=>e.status===409);await h.stop();assert.equal(withLockRecoveryGuard(h.target,()=>42),42);assert.equal(withLockRecoveryGuard(h.target,()=>7),7);}finally{await h.stop();}
});
