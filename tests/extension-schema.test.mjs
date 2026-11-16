import {test} from 'node:test';
import assert from 'node:assert/strict';
import {surveyExtension,validateExtension,validateInput} from '../host/project-extensions.js';

test('a built extension rejects malformed supported schema constraints before activation',()=>{
 for(const schema of [{type:[]},{type:'object',properties:[]},{type:'object',additionalProperties:'false'},{type:'number',minimum:'9'},{type:'number',minimum:10,maximum:1},{type:'array',minItems:-1},{type:'string',maxLength:1.5},{type:'string',enum:'not-an-array'},{type:'array',items:false}])assert.throws(()=>validateExtension({...surveyExtension,inputSchema:schema}),undefined,JSON.stringify(schema));
});
test('native fixed arguments and HTTP request headers are validated while building',()=>{
 assert.throws(()=>validateExtension({...surveyExtension,kind:'native-tool',dataKind:'unverified',config:{tool:'pwsh',arguments:'not an argument object'}}),/参数|对象/);
 assert.throws(()=>validateExtension({...surveyExtension,kind:'http-json',dataKind:'unverified',config:{url:'https://example.com',headerEnv:{Host:'EXPLICIT_TEST_VARIABLE'}}}),/请求头/);
});
test('ordinary JSON fields do not accidentally resolve inherited schema properties',()=>{
 const value={toString:'a legitimate JSON field'};assert.deepEqual(validateInput({type:'object',properties:{},additionalProperties:true},value),value);
});
