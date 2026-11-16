import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflowCanvasLayout,workflowCanvasMarkup} from '../client/workflow-canvas.js';

function workflow(count){return {id:'layout-software-fixture',steps:Array.from({length:count},(_,i)=>({id:'step-'+i,title:'步骤'+i,skills:['ares-intake'],outputs:[],dependsOn:Array.from({length:i},(_,j)=>'step-'+j)}))};}
function crosses(a,b,node){
 const left=node.x+.01,right=node.x+node.width-.01,top=node.y+.01,bottom=node.y+node.height-.01;
 if(a[0]===b[0])return a[0]>left&&a[0]<right&&Math.max(a[1],b[1])>top&&Math.min(a[1],b[1])<bottom;
 if(a[1]===b[1])return a[1]>top&&a[1]<bottom&&Math.max(a[0],b[0])>left&&Math.min(a[0],b[0])<right;
 throw Error('A dependency segment is not orthogonal');
}

test('1/8/40 readable layouts adapt to measured width and never route dependencies through a card',()=>{
 for(const count of [1,8,40])for(const width of [220,360,506,560,800,1200]){
  const source=workflow(count),before=JSON.stringify(source),layout=workflowCanvasLayout(source,width);
  assert.equal(JSON.stringify(source),before);assert.equal(layout.width,width);assert.equal(layout.nodes.length,count);
  for(const node of layout.nodes){assert.ok(node.x>=0&&node.x+node.width<=width+.1);assert.ok(node.width>=168&&node.height>=140);}
  for(const edge of layout.edges)for(let i=1;i<edge.points.length;i++)for(const node of layout.nodes){
   assert.equal(crosses(edge.points[i-1],edge.points[i],node),false,JSON.stringify({count,width,edge,node}));
  }
 }
 assert.ok(workflowCanvasLayout(workflow(40),1200).columns>workflowCanvasLayout(workflow(40),506).columns);
 assert.equal(workflowCanvasLayout(workflow(40),360).columns,1);
});

test('canvas markup keeps actual editing identifiers and escapes all user labels without publishing anything',()=>{
 const source=workflow(1);source.steps[0].title='<img src=x onerror=alert(1)>';const html=workflowCanvasMarkup(source,'step-0');
 assert.match(html,/data-workflow-canvas="layout-software-fixture"/);assert.match(html,/data-id="step-0"/);assert.match(html,/draggable="true"/);
 assert.match(html,/data-action="flow-reset"/);assert.match(html,/aria-current="step"/);assert.equal(html.includes('<img'),false);assert.ok(html.includes('&lt;img'));
});
