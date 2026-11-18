/** Refused owner operations must fail before any local or external work. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enableCloudEditLink,grantCloudPermission} from '../host/collaboration-permissions.js';
import {configureRuleChecklist,confirmRuleItem} from '../host/rule-checklist.js';
import {adoptCloudCandidate} from '../host/cloud-candidates.js';
import {prepareExtensionApproval} from '../host/extension-authority.js';
import {buildExtension,toggleExtension,bindExtensionStep,repairExtensionManifest,settleInterruptedExtension} from '../host/project-extensions.js';

test('a named team member cannot perform owner-only sharing or rule confirmation',async()=>{
 const member={kind:'user',id:'team-member'};let calls=0;
 const body={root:'not-an-authorized-project',confirmLinkEdit:true,confirmGrant:true,confirmChecked:true,items:[{label:'Actual requirement'}]};
 await assert.rejects(enableCloudEditLink(body,member,{call:async()=>{calls++;throw new Error('must not dispatch');}}),{status:403});
 await assert.rejects(grantCloudPermission(body,member),{status:403});
 assert.throws(()=>configureRuleChecklist(body,member),{status:403});
 assert.throws(()=>confirmRuleItem(body,member),{status:403});assert.equal(calls,0);
});
test('adoption and extension administration require the owner before resolving any project',()=>{
 const member={kind:'user',id:'team-member'},body={root:'not-an-authorized-project',confirmStopped:true};
 for(const operation of [adoptCloudCandidate,buildExtension,toggleExtension,bindExtensionStep,repairExtensionManifest,settleInterruptedExtension])assert.throws(()=>operation(body,member),{status:403},operation.name);
 assert.throws(()=>prepareExtensionApproval(body.root,{}, {},member),{status:403});
});
