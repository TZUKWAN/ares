/** Shared, data-only workflow editing model; safe to serve to the browser. */
export const workflowPrompts={system:'围绕本流程目标安排当前任务，依据真实资料和当前状态工作；缺口如实记录，不虚构来源、能力或成果。',execute:'同一个助手按依赖逐步推进；按需读取当前技能，使用实际工具执行，失败先修复再检查。',review:'核对目标、原始依据、实际产物与当前哈希；人工节点由团队真实确认，结构检查不代替内容复核。'};
const clone=value=>JSON.parse(JSON.stringify(value));
export function normalizeWorkflow(workflow,index=0){const invalid=workflow.prompts!==undefined&&(!workflow.prompts||typeof workflow.prompts!=='object'||Array.isArray(workflow.prompts));return {...workflow,order:index,parameters:workflow.parameters===undefined?{}:workflow.parameters,prompts:invalid?workflow.prompts:{...workflowPrompts,...(workflow.controller&&!workflow.prompts?.system?{system:workflow.controller}:{}),...workflow.prompts}};}
export function createWorkflowDraft(configuration,options,templates=[]){
 let base;
 if(options.copyFromId){base=configuration.workflows.find(item=>item.id===options.copyFromId);if(!base)throw Object.assign(new Error('复制来源不存在'),{status:400});}
 else if(options.templateId){base=templates.find(item=>item.id===options.templateId);if(!base)throw Object.assign(new Error('基础模板不存在'),{status:400});}
 else base={pipeline:options.pipeline||'L1',version:1,verification:'configuration-only',ruleStatus:'needs-current-edition-verification',parameters:{language:'zh-CN',purpose:'preparation'},steps:[{id:'brief',title:'明确任务与资料',objective:'根据实际目标、规则和现有资料确定任务范围，记录未知项与需要补充的原始材料。',skills:['ares-intake'],inputs:['competition','facts'],outputs:[{id:'brief-note',title:'任务与资料清单',kind:'file',format:'md',path:'任务与资料清单.md',requirement:'required'}],dependsOn:[],execution:'agent',prompts:{role:'当前流程的任务定义与资料核对助手。',execute:'读取真实任务要求和现有资料，形成任务与资料清单；未知信息明确标注待补，不假造调查或比赛规则。',review:'检查任务范围、来源及缺口是否可追溯，不能把清单当作最终参赛作品。'},parameters:{}}]};
 return normalizeWorkflow({...clone(base),...(options.workflow?clone(options.workflow):{}),id:options.id||options.workflow?.id,title:options.title||options.workflow?.title||base.title||'自定义流程',description:options.description||options.workflow?.description||base.description||'根据实际竞赛目标继续编排的基础流程。',pipeline:options.pipeline||options.workflow?.pipeline||base.pipeline},configuration.workflows.length);
}
