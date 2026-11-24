/** Registration/method fixtures only; genuine vendor reviews are verified separately. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {captureNativeAutoLifecycle,methodOwner,knownLoadedMethod} from '../scripts/dsh_auto_runtime.mjs';
test('borrowing native registration preserves its callback and lifecycle without changing the live Auto registry',async()=>{
 let reviewed=0,closed=0,permissionReads=0;const exec={fixture:true};
 const classifyRisk=async(value,next)=>{assert.equal(value,exec);reviewed++;return next();};
 const actual={permissionPresets:{current(){permissionReads++;return 'auto';},registerAuto(){assert.fail('Capture must not register Auto twice');}},on(){assert.fail('Capture must not install listeners');},effect(){assert.fail('Capture must not install effects');}};
 const native={apply(ctx){const permissions=ctx.permissionPresets;ctx.effect(function*(){yield ctx.on('tools/pre-execute',async(value,next)=>{assert.equal(permissions.current(),'auto');return classifyRisk(value,next);},{prepend:true});yield permissions.registerAuto(()=>{});yield async()=>{closed++;};});}};
 const captured=captureNativeAutoLifecycle(native,actual);assert.equal(reviewed,0);assert.equal(closed,0);assert.equal(permissionReads,0);
 const result={kind:'deny',reason:'explicit fixture downstream'};assert.strictEqual(await captured.review(exec,()=>result),result);assert.equal(reviewed,1);assert.equal(permissionReads,1);await captured.close();assert.equal(closed,1);
});
test('unsupported or still-bypassed vendor layouts fail before live registration',()=>{
 const ctx={permissionPresets:{registerAuto(){assert.fail('No mutation');}},effect(){assert.fail('No mutation');}};
 for(const native of [{apply(){}},{apply(ctx){ctx.effect(()=>{});}},{apply(ctx){ctx.effect(function*(){yield ()=>{};});}},{apply(ctx){ctx.effect(function*(){yield ctx.on('tools/pre-execute',async()=>{return 'official auto-review soft intercept disabled';},{prepend:true});yield ctx.permissionPresets.registerAuto(()=>{});yield ()=>{};});}}])assert.throws(()=>captureNativeAutoLifecycle(native,ctx),/Unsupported|not a generator|still bypassed/);
});
test('native method lookup follows actual prototypes and refuses accessors or absent methods',()=>{
 class Base{decide(){return 'fixture';}}class Derived extends Base{}const found=methodOwner(new Derived(),'decide');assert.equal(found.target,Base.prototype);assert.strictEqual(found.descriptor.value,Base.prototype.decide);
 assert.throws(()=>methodOwner({},'decide'),/Missing/);assert.throws(()=>methodOwner({get decide(){throw Error('Getter must not run');}},'decide'),/accessor/);
});
test('runtime replacement refuses extra in-memory edits even when the bypass marker remains',()=>{
 const native='async serviceAsk(exec, ask) {\n const approval = this.ctx.get("approval");\n return approval;\n}',patched=native.replace('const approval = this.ctx.get("approval");','const approval = this.ctx.get("approval"); if (true) return {decision:{kind:"allow"}}; // [dsh-purge] no approval service fixture bypass');
 assert.equal(knownLoadedMethod(patched,native,'serviceAsk'),true);assert.equal(knownLoadedMethod(patched.replace('return approval;','return customPolicy(approval);'),native,'serviceAsk'),false);assert.equal(knownLoadedMethod(native,native,'serviceAsk'),true);assert.equal(knownLoadedMethod('unknown','native','decide'),false);
});
