/** Explicit API fixtures; actual runtime results are recorded separately. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {nativeToolPresentation} from '../host/native-tool-presentation.js';
const rows=[{name:'read'},{name:'write'},{name:'authorized_mcp'}];
test('current DSH inspects the actual selected executor and its admitted definitions',()=>{
 const agent={},tools={definitions:scope=>{assert.equal(scope,agent);return rows;},selectExecutor:scope=>{assert.equal(scope,agent);return {describe:defs=>{assert.equal(defs,rows);return {schemas:defs.map(x=>({...x}))};}};}};
 assert.deepEqual(nativeToolPresentation(tools,agent),{presentation:'native',schemas:rows});
 tools.selectExecutor=()=>({describe:()=>({schemas:[{name:'run_code'}]})});assert.equal(nativeToolPresentation(tools,agent).presentation,'ptc');
});
test('legacy native and PTC wire APIs remain inspected rather than guessed',()=>{for(const mode of ['native','ptc']){const wire=mode==='ptc'?[{name:'run_code'}]:rows;assert.deepEqual(nativeToolPresentation({wireSchemas:()=>({schemas:wire}),modeFor:()=>mode},{}),{schemas:wire,presentation:mode});}});
test('missing, partial, duplicate and unknown executor descriptions fail closed',()=>{
 for(const schemas of [undefined,[],[{name:'read'}],[{name:'read'},{name:'read'},{name:'write'}],[{name:'unregistered'}]])assert.throws(()=>nativeToolPresentation({definitions:()=>rows,selectExecutor:()=>({describe:()=>({schemas})})},{}),/未就绪|不受支持/);
 assert.throws(()=>nativeToolPresentation({schemas:()=>rows},{}),/未就绪/);
 assert.throws(()=>nativeToolPresentation({definitions:()=>rows,selectExecutor:()=>{throw Error('unloaded actual executor fixture');}},{}),/unloaded/);
});

test('step inspection uses the exact provider-owned admission rather than an obsolete assembly tools property',()=>{const agent={},admission={fixture:'explicit-admission'},admitted=[{name:'read'}],tools={definitions:(scope,step)=>{assert.equal(scope,agent);assert.equal(step,admission);return admitted;},selectExecutor:()=>({describe:definitions=>({schemas:definitions})})};assert.deepEqual(nativeToolPresentation(tools,agent,admission).schemas,admitted);});

test('a host conditional step omission does not hide a missing capability in the full parity gate',async()=>{const {editorToolStatus}=await import('../host/editor-definition.js');const registered=[{name:'read'},{name:'exit_plan_mode'},{name:'ares_config_read'},{name:'ares_config_edit'}],step=registered.filter(row=>row.name!=='exit_plan_mode'),options={presentation:'native',standardPresentation:'native',expectedWire:step,wireSchemas:step};assert.equal(editorToolStatus(registered,registered,registered,[],options).ready,true);const incomplete=registered.filter(row=>row.name!=='read');assert.equal(editorToolStatus(incomplete,registered,incomplete,[],options).ready,false);assert.equal(editorToolStatus(registered,registered,registered,[],{...options,wireSchemas:step.filter(row=>row.name!=='read')}).ready,false);});
