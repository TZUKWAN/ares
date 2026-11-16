/* Editing geometry only. Layout never changes workflow order, dependencies,
 * progress, configuration revisions, native sessions or reference animation. */
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const round=value=>Math.round(value*100)/100;
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let markerSerial=0;

/** Fit the available width at readable text size; long flows scroll vertically.
 * Every orthogonal dependency uses the free lanes between rows and columns. */
export function workflowCanvasLayout(workflow,availableWidth){
 const steps=workflow.steps||[],width=Math.max(200,Math.floor(availableWidth)),padding=16,gapX=32,gapY=48,height=148;
 const columns=Math.max(1,Math.min(6,steps.length||1,Math.floor((width-padding*2+gapX)/(208+gapX))));
 const cardWidth=Math.min(steps.length===1?360:300,(width-padding*2-gapX*(columns-1))/columns);
 const gridWidth=columns*cardWidth+(columns-1)*gapX,left=(width-gridWidth)/2,rows=Math.ceil(steps.length/columns);
 const nodes=steps.map((step,index)=>({id:step.id,index,row:Math.floor(index/columns),column:index%columns,
  x:round(left+(index%columns)*(cardWidth+gapX)),y:padding+Math.floor(index/columns)*(height+gapY),width:round(cardWidth),height}));
 const byId=new Map(nodes.map(node=>[node.id,node])),edges=[];
 for(const step of steps)for(const parent of step.dependsOn||[]){
  const a=byId.get(parent),b=byId.get(step.id);if(!a||!b||a===b)continue;
  const lane=((edges.length%5)-2)*2,ac=a.x+a.width/2,bc=b.x+b.width/2;let points;
  if(a.row===b.row&&Math.abs(a.column-b.column)===1){const forward=a.column<b.column;
   points=[[forward?a.x+a.width+1:a.x-1,a.y+height/2],[forward?b.x-5:b.x+b.width+5,b.y+height/2]];
  }else if(a.column===b.column&&Math.abs(a.row-b.row)===1){const down=a.row<b.row;
   points=[[ac,down?a.y+height+1:a.y-1],[bc,down?b.y-5:b.y+height+5]];
  }else if(a.row===b.row){
   const rail=a.row===0?padding/2+lane:a.y-gapY/2+lane;
   points=[[ac,a.y-1],[ac,rail],[bc,rail],[bc,b.y-5]];
  }else{
   const down=a.row<b.row,first=down?a.y+height+gapY/2+lane:a.y-gapY/2+lane,last=down?b.y-gapY/2+lane:b.y+height+gapY/2+lane;
   const corridor=b.column===0?left/2+lane:b.x-gapX/2+lane;
   points=[[ac,down?a.y+height+1:a.y-1],[ac,first],[corridor,first],[corridor,last],[bc,last],[bc,down?b.y-5:b.y+height+5]];
  }
  points=points.map(([x,y])=>[round(x),round(y)]).filter((point,index,list)=>!index||point[0]!==list[index-1][0]||point[1]!==list[index-1][1]);
  points=points.filter((point,index,list)=>!index||index===list.length-1||!((list[index-1][0]===point[0]&&point[0]===list[index+1][0])||(list[index-1][1]===point[1]&&point[1]===list[index+1][1])));
  edges.push({from:parent,to:step.id,points,path:points.map(([x,y],index)=>(index?'L':'M')+x+' '+y).join(' ')});
 }
 return {width,height:Math.max(180,padding*2+rows*height+Math.max(0,rows-1)*gapY),columns,rows,nodes,edges};
}

export function workflowCanvasMarkup(workflow,selected,{button}={}){
 const selectedId=typeof selected==='string'?selected:selected?.id,edges=workflow.steps.reduce((sum,node)=>sum+(node.dependsOn?.length||0),0),marker='ares-flow-arrow-'+(++markerSerial);
 const control=(action,label,attrs='')=>button?button(action,label,'','quiet',attrs):`<button type="button" data-action="${action}" ${attrs}>${escape(label)}</button>`;
 return `<section class="ares-step-list ares-flow-map" data-workflow-canvas="${escape(workflow.id)}" data-flow-mode="auto" aria-label="工作流步骤"><header class="ares-flow-map-head"><div><strong>流程画布</strong><small>${workflow.steps.length} 个步骤 · ${edges} 条依赖</small></div><div class="workflow-canvas-controls">${control('flow-zoom','−','aria-label="缩小流程画布" data-direction="-1"')}<span data-flow-scale aria-live="polite">自动适应</span>${control('flow-zoom','＋','aria-label="放大流程画布" data-direction="1"')}${control('flow-reset','自动适应','aria-label="自动适应流程画布" title="跟随画布宽度排版；长流程上下滚动"')}</div></header><div class="ares-flow-viewport" tabindex="0" aria-label="流程节点画布，空白拖动平移，节点拖动排序；加减号缩放，0自动适应"><div class="ares-flow-space"><div class="ares-flow-plane"><svg class="ares-flow-wires" aria-label="实际步骤依赖"><defs><marker id="${marker}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth"><polygon points="0,0 6,3 0,6" class="workflow-canvas-arrow"/></marker></defs><g data-flow-edges data-flow-marker="${marker}"></g></svg>${workflow.steps.map((node,index)=>`<button type="button" class="ares-step ${node.id===selectedId?'active':''}" data-action="step" data-id="${escape(node.id)}" draggable="true" aria-label="第${index+1}步 ${escape(node.title)}" title="${escape(node.title)}" ${node.id===selectedId?'aria-current="step"':''}><span class="ares-step-number">${String(index+1).padStart(2,'0')}</span><span class="ares-step-copy"><span class="ares-step-title" data-step-title="${escape(node.id)}">${escape(node.title)}</span><span class="ares-step-caption">${node.execution==='human'?'团队实际作业':node.skills.length+' 项技能'} · ${node.outputs.length} 项产物</span></span><span class="ares-flow-node-foot"><span>${node.id===selectedId?'正在编辑':'点选编辑'}</span><i>${node.dependsOn.length?'依赖 '+node.dependsOn.length:'起点'}</i></span></button>`).join('')}</div></div></div><footer><span>拖动排序 · Alt + ↑↓ 排序<br>自动排版，长流程上下滚动</span>${control('step-add','＋ 添加步骤')}</footer></section>`;
}

/** One observer per rendered editor. Resizing edits existing geometry only,
 * preserving focus, dragging, native composer DOM and the user's zoom mode. */
export function createWorkflowCanvas(element,{workflow,selectedId,view={mode:'auto',zoom:1}}){
 const viewport=element.querySelector('.ares-flow-viewport'),space=element.querySelector('.ares-flow-space'),plane=element.querySelector('.ares-flow-plane'),svg=element.querySelector('.ares-flow-wires'),edgeGroup=element.querySelector('[data-flow-edges]'),studio=element.closest('.ares-studio');
 const nodes=new Map([...plane.querySelectorAll('.ares-step')].map(node=>[node.dataset.id,node])),media=matchMedia('(prefers-reduced-motion: reduce)');
 let disposed=false,frame=0,layout=null,scale=1,geometryKey='',lastWidth=0,lastHeight=0;
 view.mode=view.mode==='manual'?'manual':'auto';view.zoom=clamp(Number(view.zoom)||1,.9,1.6);
 const selectedChanged=view.selectedId!==selectedId;view.selectedId=selectedId;
 function reveal(id){
  const node=nodes.get(id);if(!node?.isConnected)return;const r=node.getBoundingClientRect(),v=viewport.getBoundingClientRect(),margin=10;
  if(r.left<v.left+margin)viewport.scrollLeft-=v.left+margin-r.left;else if(r.right>v.left+viewport.clientWidth-margin)viewport.scrollLeft+=r.right-(v.left+viewport.clientWidth-margin);
  if(r.top<v.top+margin)viewport.scrollTop-=v.top+margin-r.top;else if(r.bottom>v.top+viewport.clientHeight-margin)viewport.scrollTop+=r.bottom-(v.top+viewport.clientHeight-margin);
 }
 function refresh(anchor){
  if(disposed||!element.isConnected)return;
  if(studio){const next=studio.clientWidth<1000?'stacked':'split';if(studio.dataset.flowLayout!==next)studio.dataset.flowLayout=next;}
  const width=viewport.clientWidth,height=viewport.clientHeight;if(width<20||height<20)return;
  const next=workflowCanvasLayout(workflow,width);scale=view.mode==='auto'?1:view.zoom;
  const key=JSON.stringify([next.width,next.columns,next.height,scale,height]);
  if(key===geometryKey&&!anchor)return;geometryKey=key;layout=next;lastWidth=width;lastHeight=height;
  const header=element.querySelector('header').offsetHeight,footer=element.querySelector('footer').offsetHeight;
  element.style.setProperty('--flow-ideal-height',Math.max(300,Math.min(600,next.height+header+footer))+'px');
  const sw=Math.max(width,next.width*scale),sh=Math.max(height,next.height*scale),offsetX=Math.max(0,(sw-next.width*scale)/2),offsetY=Math.max(0,(sh-next.height*scale)/2);
  space.style.width=round(sw)+'px';space.style.height=round(sh)+'px';
  Object.assign(plane.style,{width:next.width+'px',height:next.height+'px',left:round(offsetX)+'px',top:round(offsetY)+'px',transform:`scale(${scale})`});
  svg.setAttribute('width',String(next.width));svg.setAttribute('height',String(next.height));svg.setAttribute('viewBox',`0 0 ${next.width} ${next.height}`);
  for(const item of next.nodes){const node=nodes.get(item.id);if(node)Object.assign(node.style,{left:item.x+'px',top:item.y+'px',width:item.width+'px',height:item.height+'px'});}
  const fragment=document.createDocumentFragment();
  for(const edge of next.edges){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.dataset.from=edge.from;path.dataset.to=edge.to;path.setAttribute('d',edge.path);path.setAttribute('marker-end','url(#'+edgeGroup.dataset.flowMarker+')');if(edge.from===selectedId||edge.to===selectedId)path.classList.add('is-selected');fragment.append(path);}
  edgeGroup.replaceChildren(fragment);
  element.dataset.flowMode=view.mode;element.dataset.flowZoom=String(scale);element.dataset.flowColumns=String(next.columns);element.dataset.flowRows=String(next.rows);element.dataset.flowReady='true';
  element.querySelector('[data-flow-scale]').textContent=(view.mode==='auto'?'自动 · ':'手动 · ')+Math.round(scale*100)+'%';
  element.querySelector('[data-action=flow-reset]').setAttribute('aria-pressed',String(view.mode==='auto'));
  for(const button of element.querySelectorAll('[data-action=flow-zoom]'))if(!button.hasAttribute('data-ares-busy-locked'))button.disabled=Number(button.dataset.direction)<0?scale<=.9:scale>=1.6;
  element.dataset.flowMotion=media.matches||element.closest('[data-ares-motion=off]')?'reduced':'normal';
  if(anchor){viewport.scrollLeft=offsetX+anchor.x*scale-width/2;viewport.scrollTop=offsetY+anchor.y*scale-height/2;}
  const focused=document.activeElement?.closest('.ares-step');if(focused&&element.contains(focused))reveal(focused.dataset.id);
 }
 function queue(){if(!disposed&&!frame)frame=requestAnimationFrame(()=>{frame=0;refresh();});}
 function zoomBy(direction){
  if(!layout)refresh();if(!layout)return;
  const left=Number.parseFloat(plane.style.left)||0,top=Number.parseFloat(plane.style.top)||0;
  const anchor={x:(viewport.scrollLeft+viewport.clientWidth/2-left)/scale,y:(viewport.scrollTop+viewport.clientHeight/2-top)/scale};
  view.mode='manual';view.zoom=clamp(Math.round((scale+Number(direction)*.1)*10)/10,.9,1.6);geometryKey='';refresh(anchor);
 }
 function fit(){view.mode='auto';view.zoom=1;geometryKey='';refresh();viewport.scrollLeft=0;reveal(selectedId);}
 function keydown(event){if(event.altKey||event.ctrlKey||event.metaKey||event.target.closest('input,textarea,select,[contenteditable=true]'))return;if(['+','=','-','0'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='0')fit();else zoomBy(event.key==='-'?-1:1);}}
 function focus(event){const node=event.target.closest('.ares-step');if(node?.matches(':focus-visible'))reveal(node.dataset.id);}
 const observer=new ResizeObserver(queue);observer.observe(viewport);if(studio)observer.observe(studio);
 element.addEventListener('keydown',keydown);element.addEventListener('focusin',focus);media.addEventListener('change',queue);
 refresh();if(selectedChanged)reveal(selectedId);document.fonts?.ready.then(queue);
 return {zoomBy,fit,reveal,inspect:()=>({mode:view.mode,zoom:scale,width:lastWidth,height:lastHeight,layout}),dispose(){disposed=true;observer.disconnect();cancelAnimationFrame(frame);element.removeEventListener('keydown',keydown);element.removeEventListener('focusin',focus);media.removeEventListener('change',queue);}};
}
