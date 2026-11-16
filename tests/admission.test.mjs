import {test} from 'node:test';
import assert from 'node:assert/strict';
import {admitOwner} from '../host/admission.js';
test('missing native admission fails closed; explicit local preview does not expose remote access',()=>{
 const req={socket:{remoteAddress:'127.0.0.1'}};
 assert.throws(()=>admitOwner({},req),error=>error.status===503);
 assert.equal(admitOwner({},req,{standalone:true}).kind,'standalone-local-preview');
 assert.throws(()=>admitOwner({},{socket:{remoteAddress:'192.0.2.2'}},{standalone:true}),error=>error.status===403);
});
