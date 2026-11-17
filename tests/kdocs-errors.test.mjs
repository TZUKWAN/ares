/** Documented CLI envelopes and explicit process faults, not cloud success. */
import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {PassThrough} from 'node:stream';
import {decodeKdocsResponse,kdocsCall,kdocsCapability} from '../host/kdocs-client.js';

test('documented authentication, permission and service errors stay distinct without raw details',()=>{
 for(const [code,status,reasonCode] of [[400006,401,'cloud-auth-required'],[403001,403,'cloud-permission-denied'],[429001,503,'cloud-service-unavailable']])assert.throws(()=>decodeKdocsResponse({code:0,data:{code,msg:'token=DO_NOT_LOG',data:{}}}),error=>error.status===status&&error.reasonCode===reasonCode&&!error.message.includes('DO_NOT_LOG'));
});

function fault(error,stdout=''){
 mock.method(childProcess,'execFile',(_exe,_args,_options,done)=>{queueMicrotask(()=>done(error,stdout,'token=DO_NOT_LOG'));return {stdin:new PassThrough()};});syncBuiltinESMExports();
}
function restore(){mock.restoreAll();syncBuiltinESMExports();}
test('a timed-out write remains unknown, and a structured nonzero auth exit is not hidden',async()=>{
 try{fault(Object.assign(new Error('token=DO_NOT_LOG'),{killed:true,code:'ETIMEDOUT'}));await assert.rejects(kdocsCall('share-file',{}),error=>error.reasonCode==='cloud-write-unknown'&&error.outcome==='unknown'&&error.retryable===false&&!error.message.includes('DO_NOT_LOG'));}finally{restore();}
 try{fault(Object.assign(new Error('process exit'),{code:1}),JSON.stringify({code:400006,msg:'token=DO_NOT_LOG'}));await assert.rejects(kdocsCall('read-file',{}),error=>error.reasonCode==='cloud-auth-required'&&error.status===401);}finally{restore();}
});
test('an inaccessible executable is unavailable, rather than falsely described as uninstalled',async()=>{
 try{fault(Object.assign(new Error('private path'),{code:'EACCES'}));const value=await kdocsCapability();assert.equal(value.installed,true);assert.equal(value.available,false);assert.equal(value.reasonCode,'cloud-tool-unavailable');assert.equal(value.authenticated,null);}finally{restore();}
});
