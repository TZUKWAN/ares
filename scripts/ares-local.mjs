#!/usr/bin/env node
/** Explicit-root native-host CLI; identical agent permissions to ARES MCP. */
import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createPortableAres} from '../platforms/shared/core.mjs';

const usage='node scripts/ares-local.mjs --host codex|zcode --root ABSOLUTE_PROJECT [--home ABSOLUTE_HOME] --tool ARES_TOOL [--input JSON_FILE]';
let core;
try{
 const argv=process.argv.slice(2),options={host:'codex',roots:[]};let tool,input;
 if(argv.includes('--help')){console.log(usage);process.exit(0);}
 for(let i=0;i<argv.length;i+=2){const name=argv[i],value=argv[i+1];if(!['--host','--root','--home','--tool','--input'].includes(name)||!value||value.startsWith('--'))throw Error(usage);if(name==='--root'){if(!isAbsolute(value))throw Error('--root must be absolute');options.roots.push(value);}else if(name==='--host')options.host=value;else if(name==='--home'){if(!isAbsolute(value))throw Error('--home must be absolute');options.home=value;}else if(name==='--tool')tool=value;else input=value;}
 if(!['codex','zcode'].includes(options.host)||!tool)throw Error(usage);
 let args={};if(input){try{args=JSON.parse(readFileSync(input,'utf8'));}catch{throw Error('输入JSON文件不存在或内容无效');}}
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('工具输入必须是JSON对象');
 core=createPortableAres(options);await core.ready;
 const value=await core.dispatch(tool,args,{principal:'agent'});
 console.log(JSON.stringify(value,null,2));
 if(tool==='ares_project'&&(args.action==='check'&&value.passed===false||args.action==='verify'&&value.checksPassed===false))process.exitCode=1;
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'invalid-input',error:error.message}));process.exitCode=1;}
finally{core?.dispose();}
