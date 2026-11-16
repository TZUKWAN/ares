/** Only the project's already registered official cloud page. No token/share/write operations. */
import {AresError} from './storage.js';import {readProject} from './projects.js?v=2.3.0-directory1';import {cloudLink} from './kdocs-client.js';
export function projectCloudView(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new AresError('云视图需要项目请求');const p=readProject(body.root);if(p.kind!=='v2')throw new AresError('请先建立项目');const c=p.workbench?.collaboration;if(c?.provider!=='kdocs'||c.status!=='connected')throw new AresError('此项目尚未关联金山目录',409);
 const doc=c.documents?.find(row=>row.id===body.fileId);if(!doc)throw new AresError('云文档未在此项目登记',403);if(body.artifactId&&!p.workflow.steps.some(step=>step.outputs.some(output=>output.id===body.artifactId)))throw new AresError('作品不属于项目',403);if(body.artifactId&&doc.artifactId&&doc.artifactId!==body.artifactId)throw new AresError('云文档与所选作品不符',403);
 const url=cloudLink(doc.link);if(!url)throw new AresError('文档尚无有效官方链接，请在原金山关联中重新核对',409);
 return {projectId:p.id,root:p.root,fileId:doc.id,artifactId:doc.artifactId||null,title:String(doc.name||'金山文档').slice(0,300),url,source:'registered-kdocs-page',linkChecked:'project-binding',note:'网页登录和保存由金山处理；不把页面加载事件当成已保存，不自动覆盖本地工作稿'};
}
