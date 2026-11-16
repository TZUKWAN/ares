/** Real pre-fix source warms Node's old dependency cache; no DSH host/model. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const sha=value=>createHash('sha256').update(value).digest('hex');
test('the actual entry bypasses cached pre-fix assistant/workspace/health dependencies',async()=>{
 const fixtures=new Map(),sourceHashes={};
 for(const name of ['native-health','editor-workspace','assistant']){
  const source=readFileSync(new URL('./fixtures/'+name+'-pre-healthfix.txt',import.meta.url),'utf8');
  fixtures.set(new URL('../host/'+name+'.js',import.meta.url).href,source);sourceHashes[name]=sha(source);
 }
 const oldHook=registerHooks({load(url,context,next){return fixtures.has(url)?{format:'module',source:fixtures.get(url),shortCircuit:true}:next(url,context);}});
 let oldAssistant,oldHealth;
 try{oldAssistant=await import(new URL('../host/assistant.js',import.meta.url));oldHealth=await import(new URL('../host/native-health.js',import.meta.url));}finally{oldHook.deregister();}
 assert.match(oldHealth.runNativeHealth.toString(),/agent\.session\.append\('ares\/health-call'/);
 const loads=[],trace=registerHooks({load(url,context,next){loads.push(url);return next(url,context);}});let currentAssistant,currentHealth;
 try{
  const plugin=await import(new URL('../index.js?health-restore-check=1',import.meta.url));assert.equal(typeof plugin.apply,'function');
  currentAssistant=await import(new URL('../host/assistant.js?v=2.3.0-directory1',import.meta.url));
  currentHealth=await import(new URL('../host/native-health.js?v=2.3.0-healthfix1',import.meta.url));
 }finally{trace.deregister();}
 for(const name of ['assistant','editor-workspace','native-health'])assert.ok(loads.includes(new URL('../host/'+name+'.js?v=2.3.0-'+(name==='native-health'?'healthfix1':'directory1'),import.meta.url).href),name+' must load the fixed dependency');
 assert.notEqual(currentAssistant.createAssistant,oldAssistant.createAssistant);assert.notEqual(currentHealth.runNativeHealth,oldHealth.runNativeHealth);assert.doesNotMatch(currentHealth.runNativeHealth.toString(),/agent\.session\.append/);
 const directory=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-health-cache-'));writeFileSync(join(directory,'cache-loading-receipt.json'),JSON.stringify({mode:'Actual old ARES modules cached in the same Node process, followed by the running index and its versioned dependency graph. No host/model request.',oldFixtureSha256:sourceHashes,loads,fixedHealthSourceSha256:sha(readFileSync(new URL('../host/native-health.js',import.meta.url))),modelRequests:0},null,2));console.log('ARES_HEALTH_CACHE_EVIDENCE',directory);
});
