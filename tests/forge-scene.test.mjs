/** Pure state-boundary fixtures, not model work or competition evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forgeModel,workshopScene} from '../client/workshop-scene.js';
const project={name:'Software state fixture',workflow:{steps:[{id:'input',title:'资料',skills:['a','b'],outputs:[{id:'brief'}]},{id:'work',title:'制作',skills:['b','c'],outputs:[]},{id:'finish',title:'验收',skills:[],outputs:[]}]},tasks:{input:{status:'done'},work:{status:'pending'},finish:{status:'running'}},progress:{done:1},nextTask:'work',facts:{materials:[{id:'one'},{id:'two'}]},workbench:{team:[{id:'owner'}]}};
test('FORGE counts derive from actual supplied project state, not manual running labels or a simulated agent roster',()=>{
 const board={artifacts:[{id:'brief',currentVersionId:'actual-version-fixture'},{id:'later',currentVersionId:null}],nodeExecution:{runs:[{stepId:'work',status:'running'},{stepId:'finish',status:'failed'}]}};const before=JSON.stringify([project,board]),model=forgeModel(project,board);assert.equal(model.activeCount,1);assert.equal(model.steps.find(step=>step.id==='finish').executing,false);assert.equal(model.selected.id,'work');assert.equal(model.done,1);assert.equal(model.total,3);assert.equal(model.materials,2);assert.equal(model.skills,3);assert.equal(model.saved,1);assert.equal(model.team,1);assert.equal(JSON.stringify([project,board]),before);
});
test('unknown version metadata is not displayed as a measured zero; explicit node selection remains exact',()=>{
 const model=forgeModel(project,{selectedStepId:'finish',nodeExecution:{runs:[]}});assert.equal(model.selected.id,'finish');assert.equal(model.saved,null);assert.equal(model.activeCount,0);const html=workshopScene(project);assert.doesNotMatch(html,/工作版本<\/span><strong>0/);assert.match(html,/作品直播/);assert.doesNotMatch(html,/Math\.random|TOKEN\/S|模拟负载|code_smith|JOB-0427/);
});
test('untrusted project and node titles remain escaped text in the scene',()=>{
 const p=structuredClone(project);p.name='<script>ownedFixture()</script>';p.workflow.steps[0].title='<img src=x onerror=ownedFixture()>';const html=workshopScene(p,{selectedStepId:'input'});assert.doesNotMatch(html,/<script>|<img /);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img /);
});
