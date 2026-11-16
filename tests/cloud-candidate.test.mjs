import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {storeCloudCandidate} from '../host/project-collaboration.js';
import {hash} from '../host/storage.js';
// Real local persistence only. These are not results from a live cloud read.
const root=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-local-cloud-candidate-')),text='# Explicit software candidate fixture\nActual local bytes, never cloud/contest evidence.\n';
test('a local candidate has the real source hash and identical content is reused',()=>{
 const first=storeCloudCandidate(root,'fixture-doc',3,text),again=storeCloudCandidate(root,'fixture-doc',3,text);
 assert.equal(first.path,again.path);assert.equal(hash(readFileSync(join(root,first.path))),first.sha256);
});
test('re-import preserves a locally revised candidate and returns newly verified original bytes',()=>{
 const first=storeCloudCandidate(root,'fixture-edited-doc',4,text),edited='Local teammate edits in an explicit software fixture';writeFileSync(join(root,first.path),edited);
 const next=storeCloudCandidate(root,'fixture-edited-doc',4,text);
 assert.equal(readFileSync(join(root,next.path),'utf8'),text);assert.equal(hash(readFileSync(join(root,next.path))),next.sha256);assert.notEqual(next.path,first.path);assert.equal(readFileSync(join(root,first.path),'utf8'),edited);
});
