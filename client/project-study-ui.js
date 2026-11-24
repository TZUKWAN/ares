import {createRequirementsWorkspace} from './study-requirements-ui.js';
import {createEvidenceWorkspace} from './study-evidence-ui.js';
import {createExperimentsWorkspace} from './study-experiments-ui.js';
import {createCollectionWorkspace} from './study-collection-ui.js';
import {createDefenseWorkspace} from './study-defense-ui.js';
import {createReuseWorkspace} from './study-reuse-ui.js';
import {button} from './research-ui.js';

export function createProjectStudyWorkspace(ctx) {
  const workspaces=new Map([['requirements',{label:'比赛要求',controller:createRequirementsWorkspace(ctx)}],['evidence',{label:'事实与证据',controller:createEvidenceWorkspace(ctx)}]]);
  workspaces.set('experiments',{label:'模型实验',controller:createExperimentsWorkspace(ctx)});
  workspaces.set('collection',{label:'金山回收',controller:createCollectionWorkspace(ctx)});
  workspaces.set('defense',{label:'答辩演练',controller:createDefenseWorkspace(ctx)});
  workspaces.set('reuse',{label:'跨赛改编',controller:createReuseWorkspace(ctx)});
  let selected='requirements';
  const current=()=>workspaces.get(selected).controller;
  return {
    render(){return '<nav class="study-navigation" aria-label="比赛与作品">'+[...workspaces].map(([id,entry])=>button('study-tab',entry.label,{data:{id},primary:selected===id})).join('')+'</nav>'+current().render();},
    click(action,target,event){if(action==='study-tab'){current().pause?.();selected=target.dataset.id;ctx.draw();return;}return current().click?.(action,target,event);},
    submit(...args){return current().submit?.(...args);},
    input(event){return current().input?.(event);},change(event){return current().change?.(event);},
    prepareSubmit(form){return current().prepareSubmit?.(form);},
    afterRender(){return current().afterRender?.();},pause(){return current().pause?.();},
    reset(){for(const entry of workspaces.values())entry.controller.pause?.();}
  };
}
