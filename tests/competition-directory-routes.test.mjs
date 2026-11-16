/** Actual routes, persisted directory and native catalogue tool. Admission,
 * lifecycle and tool registration are explicit ABI fixtures; no DSH/model. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync,mkdtempSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable,Writable} from 'node:stream';
const sha=b=>createHash('sha256').update(b).digest('hex');
const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-directory-routes-'));
async function request(api,path,data,{origin,principal='owner',authenticated=true,admission=true}={}){
 api.access={principal,authenticated,admission};
 const route=api.routes.find(r=>r.path==='/ares/api/v2/'+path);assert.ok(route);
 const req=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);Object.assign(req,{method:data===undefined?'GET':'POST',url:route.path,headers:{host:'127.0.0.1',...(origin?{origin}:{}),'content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}});
 const chunks=[];let status=200,done;const finished=new Promise(resolve=>done=resolve),res=new Writable({write(c,_e,next){chunks.push(Buffer.from(c));next();},final(next){next();done();}});res.writeHead=code=>{status=code;res.headersSent=true;};
 await route.handler(req,res);await finished;return {status,body:JSON.parse(Buffer.concat(chunks).toString())};
}
async function apiFor(label){
 process.env.ARES_HOME=join(base,label);const {createRoutes}=await import('../host/routes.js?v=2.3.0-directory1');
 const api={access:{principal:'owner',authenticated:true,admission:true}},ctx={get(key){if(key==='connection')return api.access.admission?{admit:()=>api.access.authenticated?{peer:{principal:{kind:api.access.principal}}}:{rejection:401}}:undefined;}};
 Object.assign(api,createRoutes(ctx));return api;
}
test('cached pre-directory catalogue cannot hide user entries from the actual entry or its native catalogue tool',async()=>{
 const fixture=readFileSync(new URL('./fixtures/catalog-pre-directory.txt',import.meta.url),'utf8'),oldUrls=['../host/catalog.js','../host/catalog.js?v=2.3.0-loadfix1'].map(p=>new URL(p,import.meta.url).href),hook=registerHooks({load(url,context,next){return oldUrls.includes(url)?{format:'module',source:fixture,shortCircuit:true}:next(url,context);}});let old;
 try{old=await import(oldUrls[1]);await import(oldUrls[0]);}finally{hook.deregister();}
 const loaded=[],trace=registerHooks({load(url,context,next){loaded.push(url);return next(url,context);}});let plugin;
 try{plugin=await import('../index.js?directory-regression=1');}finally{trace.deregister();}
 assert.equal(typeof plugin.apply,'function');assert.ok(loaded.includes(new URL('../host/catalog.js?v=2.3.0-directory1',import.meta.url).href));
 const api=await apiFor('warm');try{
  const before=await request(api,'competition/directory');assert.equal(before.status,200);
  const added=await request(api,'competition/directory/change',{action:'competition-add',name:'缓存重载目录软件验证',pipeline:'L4',expectedRevision:before.body.directory.revision});assert.equal(added.status,200,JSON.stringify(added.body));assert.ok(added.body.competitions.some(c=>c.id===added.body.competitionId));
  assert.equal(old.competitionCatalog().some(c=>c.id===added.body.competitionId),false,'Real pre-change source remains cached and cannot see the overlay');
  const catalog=await import('../host/catalog.js?v=2.3.0-directory1'),native=await import('../host/native.js?v=2.3.0-directory1'),configuration=catalog.readConfiguration(),version=catalog.freezeWorkflow(configuration.workflows.find(w=>w.id==='modeling'),configuration);
  const legacy=native.presetDefinition(version),modern=native.presetDefinition(version,[]);assert.equal(legacy.plugins.find(p=>p.id==='ares-runtime').name,'ares/runtime');const entry=modern.plugins.find(p=>p.id==='ares-runtime');assert.equal(entry.name,'ares/runtime-directory');
  assert.equal(import.meta.resolve('ares/runtime-directory'),new URL('../host/runtime-directory.js',import.meta.url).href);const runtime=await import(entry.name),tools=new Map();runtime.apply({tools:{register(t){tools.set(t.name,t);return()=>tools.delete(t.name);}},effect(){},on(){return()=>{};}},entry.config);
  const result=JSON.parse(await tools.get('ares_project').execute({action:'catalog',query:'缓存重载目录软件验证'},{signal:new AbortController().signal}));assert.equal(result.records.length,1);assert.equal(result.records[0].id,added.body.competitionId);assert.equal(result.records[0].tracks[0].name,'默认赛道');assert.equal(result.records[0].tracks[0].track,added.body.track);
  writeFileSync(join(base,'warm-native-receipt.json'),JSON.stringify({mode:'Actual old source cached; actual index, routes, persisted catalogue, fixed version, package self-resolution and registered native catalogue tool. Lifecycle/admission are explicit protocol fixtures, no agent/model.',oldSourceSha256:sha(fixture),loaded,newEntry:entry.name,legacyEntry:legacy.plugins.find(p=>p.id==='ares-runtime').name,records:result.records,modelRequests:0},null,2));
 }finally{api.dispose();}console.log('ARES_DIRECTORY_WARM_NATIVE',base);
});
test('directory endpoints retain owner/origin admission and refuse stale or malformed writes without changing the file',async()=>{
 const api=await apiFor('admission');try{
  const {directoryPath}=await import('../host/competition-directory.js'),body={action:'competition-add',name:'API门禁软件验证',pipeline:'L2',expectedRevision:0};
  for(const [access,status]of [[{admission:false},503],[{authenticated:false},401],[{principal:'agent'},403],[{origin:'http://example.invalid'},403]]){const refused=await request(api,'competition/directory/change',body,access);assert.equal(refused.status,status,JSON.stringify(refused.body));assert.equal(existsSync(directoryPath()),false);}
  const added=await request(api,'competition/directory/change',body);assert.equal(added.status,200);const bytes=readFileSync(directoryPath());
  const stale=await request(api,'competition/directory/change',{...body,name:'旧修订拒绝'});assert.equal(stale.status,409);assert.deepEqual(readFileSync(directoryPath()),bytes);
  const malformed=await request(api,'competition/directory/change',{...body,expectedRevision:1,principal:'owner'});assert.equal(malformed.status,400);assert.deepEqual(readFileSync(directoryPath()),bytes);
  const read=await request(api,'competition/directory');assert.equal(read.status,200);assert.ok(read.body.directory.competitions.some(c=>c.id===added.body.competitionId));
  writeFileSync(join(base,'api-admission-receipt.json'),JSON.stringify({mode:'Actual production route guards with explicit owner/nonowner authentication ABI fixture; no live DSH identity.',statuses:{missing:503,unauthenticated:401,nonowner:403,crossOrigin:403,stale:stale.status,malformed:malformed.status,write:added.status,read:read.status},storedSha256:sha(bytes)},null,2));
 }finally{api.dispose();}console.log('ARES_DIRECTORY_API_GUARDS',base);
});
