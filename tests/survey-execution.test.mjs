import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {linkRoot,initializeProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {buildExtension,runExtension,surveyExtension} from '../host/project-extensions.js';
function setup(){const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-survey-execution-'));process.env.ARES_HOME=join(base,'home');const root=join(base,'project');mkdirSync(root);linkRoot(root);const comp=competitionCatalog().find(c=>c.id===5);let p=initializeProject({root,name:'问卷计算软件执行测试',competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'});p=buildExtension({root,expectedRevision:p.revision,manifest:surveyExtension,enabled:true}).project;return {root,p};}
const questions=n=>Array.from({length:n},(_,i)=>({id:'Q'+i,type:'likert'}));
test('real survey calculations allow the host event loop to process other work',async()=>{const f=setup();let hostTurn=false;setTimeout(()=>{hostTurn=true;},0);const result=await runExtension({root:f.root,expectedRevision:f.p.revision,id:surveyExtension.id,input:{count:2000,seed:'owned-software-computation',questions:questions(16)}});assert.equal(result.run.payload.status,'succeeded');assert.equal(hostTurn,true,'The computation must yield to the host before finishing');assert.equal(result.project.progress.done,0);});
test('cancelling an in-flight owned computation never writes a late successful result',async()=>{const f=setup(),controller=new AbortController();const promise=runExtension({root:f.root,expectedRevision:f.p.revision,id:surveyExtension.id,input:{count:20000,seed:'owned-software-cancellation',questions:questions(40)}},undefined,{signal:controller.signal});const timer=setTimeout(()=>controller.abort(),10);const result=await promise;clearTimeout(timer);assert.equal(result.run.payload.status,'cancelled');assert.equal(result.run.payload.files.length,0);assert.equal(existsSync(join(f.root,result.run.payload.path)),false);assert.equal(result.project.progress.done,0);});
