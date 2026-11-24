import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {PassThrough} from 'node:stream';
import {createKdocsAccount,kdocsAccountStatus} from '../host/kdocs-account.js';

function stubExec(handler) {
  mock.method(childProcess,'execFile',(_exe,args,_options,done)=>handler(args,done));
  syncBuiltinESMExports();
}
function processStub(){return {stdin:new PassThrough(),stdout:new PassThrough(),kill(){this.killed=true;}};}
function restore(){mock.restoreAll();syncBuiltinESMExports();}

test('account status reports real access only after both auth and directory receipts and drops all credential fields',async()=>{
  const calls=[];
  try{
    stubExec((args,done)=>{
      calls.push(args);
      const response=args[0]==='version'?'2.6.1':args[0]==='auth'?JSON.stringify({authenticated:true,source:'system keychain',token:'PRIVATE_CREDENTIAL',keychain:{token:'PRIVATE_CREDENTIAL'}}):JSON.stringify({code:0,data:{drive_id:'cloud-protocol-test',items:[]}});
      queueMicrotask(()=>done(null,response));return processStub();
    });
    const status=await kdocsAccountStatus();
    assert.equal(status.connected,true);assert.equal(status.accessVerified,true);
    assert.equal(status.authenticated,true);assert.equal(status.status,'connected');
    assert.equal(JSON.stringify(status).includes('PRIVATE_CREDENTIAL'),false);
    assert.ok(calls.some(args=>args[0]==='drive'&&args[1]==='list-my-files'));
    assert.equal(calls.some(args=>args.includes('login')),false);
  }finally{restore();}
});

test('local cached authentication never conceals an expired cloud credential',async()=>{
  try{
    stubExec((args,done)=>{
      const response=args[0]==='version'?'2.6.1':args[0]==='auth'?JSON.stringify({authenticated:true,token:'PRIVATE_CREDENTIAL'}):JSON.stringify({code:400006,msg:'PRIVATE_CREDENTIAL'});
      queueMicrotask(()=>done(null,response));return processStub();
    });
    const status=await kdocsAccountStatus();
    assert.equal(status.connected,false);assert.equal(status.status,'login-required');
    assert.equal(status.authenticated,false);assert.equal(JSON.stringify(status).includes('PRIVATE_CREDENTIAL'),false);
  }finally{restore();}
});

test('ARES login needs explicit intent, deduplicates pending logins, and exposes only its official authorization URL',()=>{
  const spawned=[];let account;
  try{
    stubExec((args,done)=>{const child=processStub();spawned.push({args,done,child});return child;});
    account=createKdocsAccount();
    assert.throws(()=>account.login({}),error=>error.status===403);
    assert.equal(spawned.length,0);
    const login=account.login({confirmLogin:true});
    assert.deepEqual(spawned[0].args,['auth','login']);
    assert.equal(account.login({confirmLogin:true}).id,login.id);assert.equal(spawned.length,1);
    spawned[0].child.stdout.write('token=PRIVATE_CREDENTIAL https://evil.invalid/?auth_code=bad\n');
    assert.equal(account.read().url,undefined);
    spawned[0].child.stdout.write('https://mcp-center.wps.cn/kdocs-auth/auth-guide?auth_code=7bbf7de4-8688-44de-b1a2-7e96545168a4\n');
    assert.match(account.read().url,/^https:\/\/mcp-center\.wps\.cn\//);
    assert.equal(JSON.stringify(account.read()).includes('PRIVATE_CREDENTIAL'),false);
    account.dispose();assert.equal(spawned[0].child.killed,true);
  }finally{account?.dispose();restore();}
});
