import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudLink,resolveCloudLink} from '../host/kdocs-client.js';

test('cloud links retain only an official document URL without credentials or custom ports',()=>{
 for(const url of ['https://other.invalid/l/test','https://user:secret@kdocs.cn/l/test','https://kdocs.cn:8443/l/test','https://kdocs.cn/download?token=secret','javascript:alert(1)'])assert.equal(cloudLink(url),null,url);
 assert.equal(cloudLink('https://www.kdocs.cn/l/test?from=fixture#section'),'https://www.kdocs.cn/l/test');
});
test('document links use actual metadata or a read-only link response with the same file id',async()=>{
 assert.equal(await resolveCloudLink({id:'fixture-id',link_url:'https://kdocs.cn/l/fixture'}, {},async()=>{throw new Error('A known official link needs no second call');}),'https://kdocs.cn/l/fixture');
 let called=0;assert.equal(await resolveCloudLink({id:'fixture-id'}, {},async(action,params)=>{called++;assert.equal(action,'get-file-link');assert.deepEqual(params,{file_id:'fixture-id'});return {file_id:'fixture-id',file_url:'https://kdocs.cn/l/fixture'};}),'https://kdocs.cn/l/fixture');assert.equal(called,1);
 assert.equal(await resolveCloudLink({id:'fixture-id'}, {},async()=>({id:'fixture-id',link_url:'https://365.kdocs.cn/l/fixture'})),'https://365.kdocs.cn/l/fixture');
 await assert.rejects(resolveCloudLink({id:'fixture-id'}, {},async()=>({id:'different-file',link_url:'https://www.kdocs.cn/l/other'})),/ID与实际文件不符/);
 await assert.rejects(resolveCloudLink({id:'fixture-id'}, {},async()=>({file_id:'different-file',file_url:'https://kdocs.cn/l/other'})),/ID与实际文件不符/);
 await assert.rejects(resolveCloudLink({id:'fixture-id'}, {},async()=>({file_id:'fixture-id',file_url:'https://download.invalid/?token=secret'})),/官方文档链接/);
});
