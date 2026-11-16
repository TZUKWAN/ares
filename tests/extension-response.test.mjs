import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extensionResponseValue,parseExtensionResponse} from '../host/extension-network.js';
// JSON data-shape checks only, not fabricated HTTP success responses.
test('a response path reads JSON fields and cannot manufacture data from inherited JavaScript members',()=>{
 const value=JSON.parse('{"data":{"items":[{"score":0}]},"constructor":{"actual":"own JSON key"}}');
 assert.equal(extensionResponseValue(value,'data.items.0.score'),0);
 assert.equal(extensionResponseValue(value,'constructor.actual'),'own JSON key');
 for(const path of ['__proto__','data.constructor.prototype','data.toString','data.items.length','missing'])assert.throws(()=>extensionResponseValue(value,path),error=>error.status===502,path);
});
test('the response parser refuses numeric overflow rather than persisting it as null',()=>{
 assert.deepEqual(parseExtensionResponse('{"data":{"values":[0,1.25,null]}}','data'),{values:[0,1.25,null]});
 for(const raw of ['{"data":1e999}','{"data":[-1e999]}','{"data":{"score":1e999}}'])assert.throws(()=>parseExtensionResponse(raw,'data'),error=>error.status===502);
});
