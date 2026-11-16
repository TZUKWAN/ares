import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeKdocsResponse} from '../host/kdocs-client.js';

// Protocol fixtures reproduce the envelope shape observed from the actual CLI.
// They do not assert that cloud writes or account operations have succeeded.
test('actual nested CLI/API envelopes unwrap to the service payload',()=>{
 const payload={items:[{id:'explicit-protocol-fixture'}],next_page_token:''};assert.deepEqual(decodeKdocsResponse({code:0,data:{code:0,data:payload,msg:'ok'}}),payload);assert.deepEqual(decodeKdocsResponse({code:0,data:payload}),payload);assert.deepEqual(decodeKdocsResponse({code:'0',data:{ucode:0,result:'OK',data:payload}}),payload);
});
test('an inner business error is not returned as an empty successful listing',()=>{
 assert.throws(()=>decodeKdocsResponse({code:0,data:{code:400001,data:{next_actions:['list_my_files']},msg:'sensitive server detail'}}),error=>error.status===502&&error.message.includes('400001')&&!error.message.includes('sensitive'));
 assert.throws(()=>decodeKdocsResponse({code:0,data:{isError:true,content:[{type:'text',text:'sensitive'}]}}),/失败/);
 assert.throws(()=>decodeKdocsResponse({code:0,data:{ucode:403001,result:'ERROR',data:{}}}),/403001/);
});
test('a service-disabled comment capability has a safe actionable reason rather than an opaque generic failure',()=>{
 assert.throws(()=>decodeKdocsResponse({code:0,data:{code:400100,message:'第三方服务错误：全文评论已关闭，请联系作者团队管理员开启'}}),error=>error.status===409&&error.reasonCode==='document-comments-disabled'&&/作者|管理员/.test(error.message));
});
