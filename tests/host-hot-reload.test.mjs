/** Real historic catalog source warms Node's cache; all current plugin code and
 * handlers load from the running checkout. No host restart or user-window use.
 * The owner admission/lifecycle services below are explicit protocol fixtures. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable,Writable} from 'node:stream';

const entry=new URL('../index.js',import.meta.url),oldUrl=new URL('../host/catalog.js',import.meta.url);
const fixture=new URL('./fixtures/catalog-pre-competition.txt',import.meta.url);
const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-warm-host-'));
const previousHome=process.env.ARES_HOME,cleanups=[],routes=[],services=new Map();
let oldCatalog,currentPlugin;
process.env.ARES_HOME=join(base,'owned-home');
const ctx={
 inject(names,callback){if(names.length===1&&names[0]==='webServer')callback({webServer:{register(route){routes.push(route);return()=>{};}},effect(dispose){cleanups.push(dispose);}});},
 get(name){if(name==='connection')return{admit:()=>({peer:{principal:{kind:'owner'}}})};return services.get(name);},
 provide(name,value){services.set(name,value);},effect(dispose){cleanups.push(dispose);},on(){return()=>{};},
};

before(async()=>{
 // The captured program is text; pin canonical content across checkout EOL modes.
 const source=readFileSync(fixture,'utf8').replace(/\r\n?/g,'\n');
 assert.equal(createHash('sha256').update(source).digest('hex'),'352c6fc889ca29521234b7232b7ebe55c1f87bc6401a8ea5c4a7eb31a35bdcd9');
 const hook=registerHooks({load(url,context,next){return url===oldUrl.href?{format:'module',source,shortCircuit:true}:next(url,context);}});
 try{oldCatalog=await import(oldUrl.href);}finally{hook.deregister();}
 assert.equal(oldCatalog.validateCompetitionTemplate,undefined,'The actual older catalog has no newly introduced export');
 currentPlugin=await import(entry.href+'?warm-host=current');
 currentPlugin.apply(ctx);
});
after(async()=>{
 for(const cleanup of cleanups.reverse())await cleanup();
 if(previousHome===undefined)delete process.env.ARES_HOME;else process.env.ARES_HOME=previousHome;
});

async function request(path,data){
 const route=routes.find(row=>row.path==='/ares/api/v2/'+path);assert.ok(route,'Actual plugin registered '+path);
 const req=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);
 Object.assign(req,{method:data===undefined?'GET':'POST',url:route.path,headers:{host:'127.0.0.1','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}});
 const chunks=[];let status=200,done;const completion=new Promise(resolve=>done=resolve);
 const res=new Writable({write(chunk,_encoding,callback){chunks.push(Buffer.from(chunk));callback();},final(callback){callback();done();}});
 res.writeHead=(code)=>{status=code;res.headersSent=true;};
 await route.handler(req,res);await completion;
 return{status,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))};
}

test('the actual ARES entry applies and bootstraps with the real older catalog still cached',async()=>{
 assert.equal(currentPlugin.name,'ares');assert.equal(typeof currentPlugin.apply,'function');
 assert.ok(services.get('aresEditor'));assert.ok(services.get('aresNodeExecution'));
 const boot=await request('bootstrap');assert.equal(boot.status,200,JSON.stringify(boot.body));
 assert.equal(boot.body.ok,true);assert.ok(boot.body.competitions.length>100);assert.ok(boot.body.workflowTemplates.length>0);
 const scope={competitionId:1,track:'高教主赛道',edition:'2026',group:''};
 const opened=await request('competition/workflow',scope);assert.equal(opened.status,200,JSON.stringify(opened.body));
 assert.equal(opened.body.workflow.competitionTemplate.track,scope.track);assert.equal(opened.body.saved,false);
 writeFileSync(join(base,'warm-entry-evidence.json'),JSON.stringify({entry:entry.href,cachedOlderCatalogMissingExport:true,pluginApplied:true,bootstrapStatus:boot.status,competitionReadStatus:opened.status,registeredRoutes:routes.length,onlineModelCalls:0,userWindowTouched:false,admission:'Explicit owner protocol fixture; not a live DSH authentication test'},null,2));
 console.log('ARES_WARM_HOST_EVIDENCE',base);
});

test('warm-host preview uses current competition ownership validation rather than cached old validation',async()=>{
 const opened=await request('competition/workflow',{competitionId:1,track:'高教主赛道',edition:'2026',group:''});
 assert.equal(opened.status,200);
 const configuration=structuredClone(opened.body.configuration),workflow=structuredClone(opened.body.workflow);
 workflow.competitionTemplate.track='不属于这个比赛的真实赛道';configuration.workflows.push(workflow);
 assert.doesNotThrow(()=>oldCatalog.validateConfiguration(configuration),'The historic implementation did not have this ownership validation');
 const preview=await request('preview',{configuration,workflowId:workflow.id,stepId:workflow.steps[0].id});
 assert.notEqual(preview.status,200);assert.match(preview.body.error,/比赛|赛道/);
});
