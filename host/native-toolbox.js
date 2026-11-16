import {readFileSync} from 'node:fs';

function materialize(value){
 if(Array.isArray(value))return value.map(materialize);
 if(value&&typeof value==='object'){
  const condition=value.$aresPlatform||value.$metisPlatform;
  if(condition)return condition==='equals'?process.platform===value.value:process.platform!==value.value;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,materialize(item)]));
 }
 return value;
}

/** The static declaration is retained only for pre-2.1 immutable versions. */
export function nativePlugins(prefix,source){
 const plugins=source===undefined?materialize(JSON.parse(readFileSync(new URL('./base-plugins.json',import.meta.url),'utf8'))):structuredClone(source);
 if(!Array.isArray(plugins))throw new Error('ARES缺少DSH原生工具组合');
 const persona=plugins.find(plugin=>plugin.name==='@deepseek-ai/dsh-persona');
 if(persona)persona.config={...persona.config,prefix};
 else plugins.push({id:'ares-persona',name:'@deepseek-ai/dsh-persona',config:{prefix}});
 return plugins;
}

/** Preserve both the actual standard declaration and its module resolution realm. */
export function standardSource(registry){
 const record=registry?.definitions?.get('standard');
 if(!Array.isArray(record?.config?.plugins)||!record.context?.agentPresets)throw new Error('DSH standard真实组成或解析Context尚未就绪，未回退到静态工具清单');
 return {record,plugins:structuredClone(record.config.plugins),registry:record.context.agentPresets};
}
