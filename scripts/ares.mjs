#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {readConfiguration,competitionCatalog,skillCatalog} from '../host/catalog.js';
import {linkRoot,initializeProject,readProject,taskChecks,taskAction,updateFacts,recordRules,verifyProject} from '../host/projects.js';
const usage='用法：node scripts/ares.mjs catalog|workflows|skills|init|status|start|check|complete|block|facts|rules|verify [--root 目录] [--step ID] [--input JSON文件]';
const taskActions=new Set(['start','check','complete','block']);
const commands=new Set(['catalog','workflows','skills','init','status',...taskActions,'facts','rules','verify']);
try{
 const action=process.argv[2],args=process.argv.slice(3),options={};
 if(['--help','-h'].includes(action)){console.log(usage);process.exit(0);}
 if(!commands.has(action))throw new Error(usage);
 const metadata=['catalog','workflows','skills'].includes(action),allowed=new Set(metadata?[]:['root',...(taskActions.has(action)?['step']:[]),...(['init','start','complete','block','facts','rules'].includes(action)?['input']:[])]);
 for(let index=0;index<args.length;index+=2){const flag=args[index],key=flag.startsWith('--')?flag.slice(2):null,value=args[index+1];if(!allowed.has(key))throw new Error('未知或不适用的参数：'+flag);if(Object.hasOwn(options,key))throw new Error('参数重复：'+flag);if(!value||value.startsWith('--'))throw new Error('参数缺少值：'+flag);options[key]=value;}
 if(taskActions.has(action)&&!options.step)throw new Error('此动作需要 --step 步骤ID');
 if(['init','facts','rules'].includes(action)&&!options.input)throw new Error('此动作需要 --input JSON文件');
 const root=options.root||process.cwd(),data=options.input?JSON.parse(readFileSync(options.input,'utf8')):{};
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('输入JSON需要对象');
 if(['start','complete','block','facts','rules'].includes(action)&&data.expectedRevision===undefined)data.expectedRevision=readProject(root).revision;
 let result;
 if(action==='catalog')result=competitionCatalog();else if(action==='workflows')result=readConfiguration().workflows;else if(action==='skills')result=skillCatalog(readConfiguration()).map(({content,root,...s})=>s);
 else if(action==='init'){linkRoot(root);result=initializeProject({...data,root});}else if(action==='status')result=readProject(root);else if(action==='check')result=taskChecks(root,options.step);else if(action==='verify')result=verifyProject(root);else if(action==='facts')result=updateFacts({...data,root});else if(action==='rules')result=recordRules({...data,root});else if(['start','complete','block'].includes(action))result=taskAction({...data,root,stepId:options.step,action});
 console.log(JSON.stringify(result,null,2));if(action==='verify'&&!result.checksPassed||action==='check'&&!result.passed||action==='complete'&&result.tasks?.[options.step]?.status!=='done')process.exitCode=1;
}catch(e){console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}
