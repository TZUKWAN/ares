import {builtInSkills} from './host/catalog.js?v=2.3.0-directory1';
import {createNativeCatalog} from './host/native.js?v=2.3.0-directory1';
import {createRoutes} from './host/routes.js?v=2.3.0-directory1';
import {createAssistant} from './host/assistant.js?v=2.3.0-directory1';
import {startHealthRequest} from './host/health-request.js?v=2.3.0-directory1';
import {createNodeExecution} from './host/node-execution.js?v=2.3.0-directory1';
export const name='ares';
export function apply(ctx){
 ctx.inject(['skills'],scope=>{for(const skill of builtInSkills()){
  const content=skill.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'');
  const off=scope.skills.register({name:skill.id,description:skill.description,whenToUse:skill.id==='ares'?'用户表达参赛、备赛、竞赛材料需求或输入 /Ares 时。':'仅当ARES当前步骤绑定并需要本能力时。',invocation:{modelInvocable:skill.id==='ares',userInvocable:skill.id==='ares'},provider:'ares',source:'plugin:ares',content,path:skill.root+'/SKILL.md',resourceBase:{kind:'directory',path:skill.root}});
  scope.effect(()=>off,'ares: skill '+skill.id);
 }});
 let native;const editor=createAssistant(ctx,{forEditor:()=>native.forEditor(),inspectEditorTools:(agent,schemas)=>native.inspectEditorTools(agent,schemas),refreshEditor:agent=>native.refreshEditor(agent),commitConfiguration:(...args)=>native.commitConfiguration(...args)});
 ctx.provide('aresEditor',editor);
 native=createNativeCatalog(ctx);const nodeExecution=createNodeExecution(ctx,native);ctx.provide('aresNodeExecution',nodeExecution);const api=createRoutes(ctx,native,editor);
 const healthRequest=startHealthRequest(editor,{onError:()=>console.warn('[ares] 后台体检请求未完成，未绕过原生检查')});
 ctx.inject(['agentPresets'],scope=>{native.forEditor().catch(error=>console.warn('[ares] 原生配置编辑模式尚未就绪：'+error.message));});
 ctx.inject(['webServer'],scope=>{for(const route of api.routes){const off=scope.webServer.register(route);if(typeof off==='function')scope.effect(()=>off,'ares: '+route.path);}});
 ctx.effect(()=>()=>{healthRequest.dispose();nodeExecution.dispose();api.dispose();return native.dispose();},'ares: workbench lifetime');
}
