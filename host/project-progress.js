import {AresError,hash} from './storage.js';
import {readProject,changeProject} from './projects.js?v=2.3.0-directory1';
import {projectEvent,artifactVersion} from './project-artifacts.js';
import {readProjectRecord} from './project-objects.js';

const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const requestKeys=new Set(['root','expectedRevision','requestId','memberId','stepId','kind','summary','artifactVersionId']);
function payloadFor(project,body){
 if(Object.keys(body).some(key=>!requestKeys.has(key)))throw new AresError('工作登记包含未支持的字段；登记不能修改验收状态');
 if(typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{12,80}$/.test(body.requestId))throw new AresError('工作登记需要有效的提交编号');
 const step=project.workflow.steps.find(row=>row.id===body.stepId),member=project.workbench.team.find(row=>row.id===body.memberId);if(!step||!member)throw new AresError('请选择此项目实际步骤和队员');
 if(!['started','update','submitted'].includes(body.kind))throw new AresError('工作登记类型无效；不提供已验收类型');
 if(typeof body.summary!=='string'||!body.summary.trim()||body.summary.trim().length>2000)throw new AresError('工作说明需要1至2000字');
 const versionId=body.artifactVersionId||null;if(versionId){const record=artifactVersion(project.root,versionId),payload=record.payload,entry=project.workbench.artifacts[payload.artifactId];if(payload.projectId!==project.id||payload.stepId!==step.id||!step.outputs.some(output=>output.id===payload.artifactId)||!entry?.versionIds?.includes(versionId))throw new AresError('关联工作版本不属于此项目步骤',403);}
 const input={stepId:step.id,memberId:member.id,kind:body.kind,summary:body.summary.trim(),artifactVersionId:versionId};return {...input,memberName:member.name,requestId:body.requestId,inputHash:hash(input),provenance:'owner-reported'};
}
function requestsFor(project){const value=project.workbench.workLogRequests||{};if(!value||typeof value!=='object'||Array.isArray(value))throw new AresError('工作登记索引损坏，请先核对',409);return value;}
function existingRequest(project,detail){const index=requestsFor(project);if(!own(index,detail.requestId))return null;const entry=index[detail.requestId],record=readProjectRecord(project.root,'events',entry.id);if(record.payload.projectId!==project.id||record.payload.type!=='work.recorded'||record.payload.detail?.requestId!==detail.requestId||record.payload.detail?.inputHash!==detail.inputHash)throw new AresError('该提交编号已登记不同内容，请先核对历史记录',409);return record;}
/** Owner-authenticated, explicitly reported work; never mutates task acceptance or files. */
export function recordProjectWork(body,actor={kind:'user',id:'owner'}){
 if(actor.kind!=='user'||actor.id!=='owner')throw new AresError('工作登记须由本机项目负责人操作',403);
 let current=readProject(body.root);if(current.kind!=='v2')throw new AresError('请先建立实际项目');const detail=payloadFor(current,body),existing=existingRequest(current,detail);if(existing)return {project:current,record:existing,idempotent:true};let recordId;
 const project=changeProject(body,p=>{const checked=payloadFor(p,body),again=existingRequest(p,checked);if(again){recordId=again.id;return;}const event=projectEvent(p.root,p,'work.recorded',checked,actor);p.workbench.workLogRequests={...requestsFor(p),[checked.requestId]:{id:event.id}};recordId=event.id;});
 return {project,record:readProjectRecord(project.root,'events',recordId),idempotent:false};
}
/** Validated immutable events, not guessed cloud editor identities or online presence. */
export function projectProgress(root,{limit=200}={}){
 const project=readProject(root);if(project.kind!=='v2')return {available:false,events:[],historyErrors:[],reason:'尚未建立项目'};if(!Number.isInteger(limit)||limit<1||limit>300)throw new AresError('活动读取范围需要1至300');
 const ids=project.workbench.eventIds||[],events=[],historyErrors=[];for(const id of ids.slice(-limit)){try{const record=readProjectRecord(project.root,'events',id);if(record.payload.projectId!==project.id)throw new AresError('活动属于其他项目');events.push(record);}catch(error){historyErrors.push({id,error:error.message});}}
 return {available:true,revision:1,events,historyErrors,totalEvents:ids.length,hasEarlier:ids.length>limit,identityPolicy:'项目登记名；负责人登记和系统记录分别标注，金山匿名编辑不冒充已识别成员'};
}
