/** Actual filesystem and root registry; no external service or user directory. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {linkRoot,requireRoot,roots} from '../host/projects.js';

test('root authorization follows filesystem case identity and unlink affects only that identity',()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-root-identity-'));
 process.env.ARES_HOME=join(base,'home');
 const upper=join(base,'Project'),lower=join(base,'project');mkdirSync(upper);
 if(process.platform!=='win32')mkdirSync(lower);
 linkRoot(upper);assert.equal(requireRoot(upper),realpathSync(upper));
 if(process.platform==='win32'){
  assert.equal(requireRoot(lower).toLowerCase(),realpathSync(upper).toLowerCase());linkRoot(lower);assert.equal(roots().length,1);
  linkRoot(upper,true);assert.throws(()=>requireRoot(lower),{status:403});
 }else{
  assert.throws(()=>requireRoot(lower),{status:403});linkRoot(lower);assert.equal(roots().length,2);
  linkRoot(upper,true);assert.throws(()=>requireRoot(upper),{status:403});assert.equal(requireRoot(lower),realpathSync(lower));
 }
});

test('a linked directory alias grants exactly its real root and is deduplicated',()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-root-alias-'));
 process.env.ARES_HOME=join(base,'home');const target=join(base,'actual'),alias=join(base,'alias');mkdirSync(target);
 symlinkSync(target,alias,process.platform==='win32'?'junction':'dir');linkRoot(alias);
 assert.equal(requireRoot(target),realpathSync(target));linkRoot(target);assert.equal(roots().length,1);
 linkRoot(alias,true);assert.throws(()=>requireRoot(target),{status:403});
});
