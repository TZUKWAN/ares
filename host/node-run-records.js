/** Read existing run records without importing the execution controller. */
import {AresError,readJson,safePath} from './storage.js';
export function readNodeRunRecord(project,id){
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new AresError('节点运行标识无效');
 if(!project.workbench?.nodeRunIds?.includes(id))throw new AresError('运行记录不属于此项目',403);
 const record=readJson(safePath(project.root,'.ares/node-runs/'+id+'.json',{existing:true}));
 if(record.projectId!==project.id)throw new AresError('节点运行项目不符',409);return record;
}
