#!/usr/bin/env node
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {serveStdio} from '../platforms/shared/sdk.mjs';
import {createPortableMcpServer} from '../platforms/shared/server.mjs';

export {createPortableMcpServer} from '../platforms/shared/server.mjs';
export function parsePortableArguments(argv=process.argv.slice(2),env=process.env) {
  const options={host:'portable',roots:[]};
  if(env.ARES_ALLOWED_ROOTS) {
    let roots;try{roots=JSON.parse(env.ARES_ALLOWED_ROOTS);}catch{throw new Error('ARES_ALLOWED_ROOTS must be a JSON array of absolute directory paths');}
    if(!Array.isArray(roots)||roots.some(value=>typeof value!=='string'))throw new Error('ARES_ALLOWED_ROOTS must be a JSON array of absolute directory paths');
    options.roots.push(...roots);
  }
  if(env.ARES_HOME)options.home=env.ARES_HOME;
  for(let index=0;index<argv.length;index++) {
    const name=argv[index];
    if(name==='--no-ui'){options.ui=false;continue;}
    if(name==='--require-ui'){options.requireUi=true;continue;}
    if(name==='--help'){options.help=true;continue;}
    if(!['--host','--root','--home'].includes(name)||!argv[index+1]||argv[index+1].startsWith('--'))throw new Error('Unknown or incomplete option: '+name);
    const value=argv[++index];
    if(name==='--host')options.host=value;
    if(name==='--home')options.home=value;
    if(name==='--root')options.roots.push(value);
  }
  if(!['portable','codex','zcode'].includes(options.host))throw new Error('--host must be portable, codex or zcode');
  if(options.home&&!isAbsolute(options.home))throw new Error('--home / ARES_HOME must be absolute');
  return options;
}
export function startPortableStdio(options={}) {
  return serveStdio(async()=>{
    const {server}=await createPortableMcpServer(options);return server;
  },{onerror:error=>console.error('ARES MCP: '+error.message)});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const options=parsePortableArguments();
    if(options.help)console.error('ARES MCP stdio\n  node scripts/ares-mcp.mjs --host codex|zcode [--root ABSOLUTE_DIR]... [--home ABSOLUTE_DIR]\nClient roots/list is supported. With no client roots and no explicit --root, project tools are denied.\nDefault config is ~/.ares/<host>; sharing DSH storage requires explicit --home or ARES_HOME.');
    else {
      const service=startPortableStdio(options);
      for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{service.close().catch(error=>{console.error(error.message);process.exitCode=1;});});
    }
  } catch(error) {console.error('ARES MCP startup failed: '+error.message);process.exitCode=1;}
}
