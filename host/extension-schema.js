import {AresError,hash} from './storage.js';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeKey=key=>!['__proto__','constructor','prototype'].includes(key);
const types=new Set(['object','array','string','number','integer','boolean','null']);
const supported=new Set(['type','title','description','required','properties','items','enum','minimum','maximum','minLength','maxLength','minItems','maxItems','additionalProperties','default']);
export function validateSchema(schema,depth=0){
 if(depth>8||!object(schema))throw new AresError('扩展输入约束须为深度不超过8的JSON对象');
 for(const key of Object.keys(schema))if(!supported.has(key))throw new AresError('此版不支持输入约束关键字 '+key);
 if(Object.hasOwn(schema,'type')){const values=Array.isArray(schema.type)?schema.type:[schema.type];if(!values.length||new Set(values).size!==values.length||values.some(type=>!types.has(type)))throw new AresError('输入约束type须包含不重复的已支持类型');}
 for(const key of ['title','description'])if(Object.hasOwn(schema,key)&&(typeof schema[key]!=='string'||schema[key].length>5000))throw new AresError('输入约束'+key+'须为5000字以内文本');
 if(Object.hasOwn(schema,'properties')){if(!object(schema.properties)||Object.keys(schema.properties).length>200)throw new AresError('properties须为200个字段以内的JSON对象');for(const [key,value]of Object.entries(schema.properties)){if(!safeKey(key)||!key||key.length>150)throw new AresError('输入属性名无效');validateSchema(value,depth+1);}}
 if(Object.hasOwn(schema,'required')&&(!Array.isArray(schema.required)||schema.required.length>200||new Set(schema.required).size!==schema.required.length||schema.required.some(key=>typeof key!=='string'||!key||!safeKey(key))))throw new AresError('必填字段须为不重复的有效名称数组');
 if(Object.hasOwn(schema,'items'))validateSchema(schema.items,depth+1);
 if(Object.hasOwn(schema,'additionalProperties')&&typeof schema.additionalProperties!=='boolean')throw new AresError('此版additionalProperties只支持布尔值');
 if(Object.hasOwn(schema,'enum')&&(!Array.isArray(schema.enum)||!schema.enum.length||schema.enum.length>256||new Set(schema.enum.map(value=>hash(value))).size!==schema.enum.length))throw new AresError('enum须为1至256个不重复选项的数组');
 for(const key of ['minimum','maximum'])if(Object.hasOwn(schema,key)&&(typeof schema[key]!=='number'||!Number.isFinite(schema[key])))throw new AresError(key+'须为有限数值');
 for(const key of ['minLength','maxLength','minItems','maxItems'])if(Object.hasOwn(schema,key)&&(!Number.isSafeInteger(schema[key])||schema[key]<0))throw new AresError(key+'须为非负安全整数');
 for(const [low,high] of [['minimum','maximum'],['minLength','maxLength'],['minItems','maxItems']])if(Object.hasOwn(schema,low)&&Object.hasOwn(schema,high)&&schema[low]>schema[high])throw new AresError(low+'不能大于'+high);
 if(Object.hasOwn(schema,'default')){const {default:defaultValue,...constraints}=schema;validateInput(constraints,defaultValue,'default');}
 return schema;
}
export function validateInput(schema,value,path='input',depth=0){
 if(depth>40||!object(schema))throw new AresError('输入约束或数据深度无效');
 if(value===undefined||typeof value==='number'&&!Number.isFinite(value)||['function','symbol','bigint'].includes(typeof value))throw new AresError(path+'须为有效JSON值');
 if(schema.type){const values=Array.isArray(schema.type)?schema.type:[schema.type],ok=values.some(type=>type==='null'?value===null:type==='integer'?Number.isInteger(value):type==='number'?Number.isFinite(value):type==='array'?Array.isArray(value):type==='object'?object(value):typeof value===type);if(!ok)throw new AresError(path+' 类型不符合扩展声明');}
 if(schema.enum&&!schema.enum.some(item=>hash(item)===hash(value)))throw new AresError(path+' 不在允许选项中');
 if(typeof value==='number'&&(value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))throw new AresError(path+' 超出数值范围');
 if(typeof value==='string'&&(value.length>(schema.maxLength??100000)||value.length<(schema.minLength??0)))throw new AresError(path+' 长度超限');
 if(Array.isArray(value)){if(value.length>(schema.maxItems??20000)||value.length<(schema.minItems??0))throw new AresError(path+' 数量超限');value.forEach((item,index)=>validateInput(schema.items||{},item,path+'['+index+']',depth+1));}
 if(object(value)){for(const key of schema.required||[])if(!Object.hasOwn(value,key))throw new AresError(path+' 缺少 '+key);for(const [key,item]of Object.entries(value)){if(!safeKey(key))throw new AresError('不接受原型属性');const child=schema.properties&&Object.hasOwn(schema.properties,key)?schema.properties[key]:null;if(child)validateInput(child,item,path+'.'+key,depth+1);else if(schema.additionalProperties===false)throw new AresError(path+' 包含未声明字段 '+key);else validateInput({},item,path+'.'+key,depth+1);}}
 return value;
}
