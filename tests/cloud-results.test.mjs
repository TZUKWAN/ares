import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudHistoryPage,cloudCommentPresent,cloudPublicationMatches,cloudPublicationFiles} from '../host/cloud-results.js';
// Shapes are explicit official-document contract fixtures, never live results.
test('unknown history shapes cannot be presented as an empty successful history',()=>{
 for(const data of [{},null,{items:'not an array'},{items:[null]},{items:[],next_page_token:{}}])assert.throws(()=>cloudHistoryPage(data),error=>error.status===502);
 const r=cloudHistoryPage({items:[{id:'fixture-history',version:18,size:42,mtime:'2026-11-01T00:00:00Z',comment:'Schema fixture'}],next_page_token:'fixture-page-2'});assert.equal(r.items[0].version,18);assert.equal(r.nextPageToken,'fixture-page-2');
});
test('both official nested and flat comment records must independently match id and exact content',()=>{
 for(const item of [{comment:{id:1001,content:'Explicit schema fixture'}},{id:1001,content:'Explicit schema fixture'}])assert.equal(cloudCommentPresent({items:[item]},'1001','Explicit schema fixture'),true);
 assert.equal(cloudCommentPresent({items:[{id:1002,content:'Explicit schema fixture'}]},'1001','Explicit schema fixture'),false);
 assert.throws(()=>cloudCommentPresent({},'1001','text'),error=>error.status===502);
});
test('reconciliation cannot verify another id, drive or name just because size and folder match',()=>{
 const expected={fileId:'fixture-file',driveId:'fixture-drive',folderId:'fixture-folder',name:'fixture.zip',bytes:42,version:3},info={id:'fixture-file',drive_id:'fixture-drive',parent_id:'fixture-folder',name:'fixture.zip',size:42,version:3};
 assert.equal(cloudPublicationMatches(info,expected),true);
 for(const patch of [{id:'different'},{drive_id:'different'},{name:'different.zip'},{size:43},{parent_id:'different'},{version:4}])assert.equal(cloudPublicationMatches({...info,...patch},expected),false,JSON.stringify(patch));
});
test('an incomplete reconciliation preserves known upload receipts for a later real readback',()=>{
 const original={fileId:'fixture-receipt',version:3,sha256:'a'.repeat(64),bytes:42,verification:'pending'},files=cloudPublicationFiles([original],[],false);
 assert.deepEqual(files,[original]);assert.deepEqual(original,{fileId:'fixture-receipt',version:3,sha256:'a'.repeat(64),bytes:42,verification:'pending'});
 const verified={...original,verification:'metadata-size-verified'};assert.deepEqual(cloudPublicationFiles([original],[verified],true),[verified]);
});
