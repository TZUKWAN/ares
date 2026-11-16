/** DSH owns the Agent loop, models, messages, streaming and cancellation. */
export {EDITOR_PRESET_ID,editorDefinition,editorPrompt} from './editor-definition.js';
export const name='ares-editor-tools';
export const inject=['tools','aresEditor'];
export function apply(ctx){
 // Preset registrations are ancestors of live Agents. A mask here would also
 // hide these ARES tools and all host-global/MCP tools from those descendants.
 const editor=()=>{const value=typeof ctx.get==='function'?ctx.get('aresEditor'):ctx.aresEditor;if(!value)throw new Error('ARES当前配置服务尚未就绪');return value;};
 const output={schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]};
 const read=ctx.tools.register({name:'ares_config_read',description:'读取本ARES编辑会话的真实配置草稿。context取revision和当前目标；operations取配置操作；workflow/step按ID读取；skills检索少量候选；skill按正文或固定资源片段读取。无需项目或工作区。',parameters:{type:'object',additionalProperties:false,required:['kind'],properties:{kind:{type:'string',enum:['context','operations','workflow','step','library','skills','skill','resources']},id:{type:'string'},workflowId:{type:'string'},stepId:{type:'string'},query:{type:'string'},source:{type:'string'},path:{type:'string'},offset:{type:'integer'},limit:{type:'integer'}}},output,isConcurrencySafe:()=>true,async execute(args,exec){exec.signal?.throwIfAborted();return JSON.stringify(await editor().read(exec.agent,args,exec.signal));}});
 const edit=ctx.tools.register({name:'ares_config_edit',description:'修改ARES流程或技能的可审阅提案。先read context取得最新revision；edits经过真实配置校验，不直接保存。人工草稿冲突时重新读取并明确replaceProposal。',parameters:{type:'object',additionalProperties:false,required:['expectedRevision','edits'],properties:{expectedRevision:{type:'integer'},workflowId:{type:'string'},edits:{type:'array',items:{type:'object',additionalProperties:true}},replaceProposal:{type:'boolean'}}},output,isConcurrencySafe:()=>false,async execute(args,exec){exec.signal?.throwIfAborted();return JSON.stringify(await editor().propose(exec.agent,args,exec.signal));}});
 ctx.effect(()=>()=>{edit();read();},'ares: native configuration tools');
}
