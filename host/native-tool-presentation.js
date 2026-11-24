/** Inspect the selected real DSH executor, or the supported legacy wire API.
 * Never substitute the registered list for a missing model-facing description. */
import {AresError} from './storage.js';
export function nativeToolPresentation(tools,scope,toolSet){
 let schemas,presentation;
 if(typeof tools?.wireSchemas==='function'&&typeof tools.modeFor==='function'){
  const wire=tools.wireSchemas(scope);schemas=Array.isArray(wire)?wire:wire?.schemas;presentation=tools.modeFor(scope);
 }else if(typeof tools?.definitions==='function'&&typeof tools.selectExecutor==='function'){
  const definitions=tools.definitions(scope,toolSet),executor=tools.selectExecutor(scope);
  if(!Array.isArray(definitions)||typeof executor?.describe!=='function')throw new AresError('DSH原生执行器描述不可用',503);
  schemas=executor.describe(definitions)?.schemas;
  if(Array.isArray(schemas)){
   const names=new Set(definitions.map(row=>row.name));
   if(schemas.length===1&&schemas[0]?.name==='run_code')presentation='ptc';
   else if(schemas.length===names.size&&schemas.every(row=>names.has(row?.name))&&new Set(schemas.map(row=>row.name)).size===names.size)presentation='native';
  }
 }
 if(!Array.isArray(schemas)||!schemas.every(row=>row&&typeof row.name==='string')||!['native','ptc'].includes(presentation))throw new AresError('DSH原生工具展示接口尚未就绪或不受支持，未猜测可用性',503);
 return {schemas,presentation};
}
