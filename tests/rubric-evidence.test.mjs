import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assessRubric,projectRubricEvidence,rubricFieldValues} from '../host/rubric-evidence.js';
import {linkRoot,initializeProject,recordRules,readProject,verifyProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {configureRuleChecklist,confirmRuleItem,projectRuleChecklist} from '../host/rule-checklist.js';
const sha=value=>createHash('sha256').update(value).digest('hex');

test('all 132 archives inventory every historical field without certifying inferred official weights',()=>{
 let fields=0,sources=0;
 for(let id=1;id<=132;id++){
  const rubric=JSON.parse(readFileSync(new URL('../data/rubrics/'+String(id).padStart(3,'0')+'.json',import.meta.url),'utf8'));
  const result=assessRubric(rubric,{competitionId:id,edition:'2026',track:'NOT-VERIFIED',group:'NOT-VERIFIED'});
  assert.equal(result.fieldCount,rubricFieldValues(rubric).size);
  assert.equal(result.status,'unverified');assert.equal(result.scoreEligible,false);assert.equal(result.officialScore,null);
  assert.ok(result.fields.every(row=>!row.official&&row.officialWeight===null));
  assert.notEqual(rubric.confidence,'high');fields+=result.fieldCount;sources+=rubric.sources.length;
 }
 console.log(JSON.stringify({archives:132,fields,sources,meaning:'Inventory and explicit uncertainty, not official clause certification'}));
});

function explicitClauseFixture(){
 const rubric={competition_id:5,competition_name:'EXPLICIT SOFTWARE CLAUSE FIXTURE',last_updated:'2026-11-18',judging_dimensions:[{dimension:'fixture',weight:'100%'}],sources:[{url:'https://example.invalid/software-clause'}]};
 const scope={competitionId:5,edition:'SOFTWARE-QA',tracks:['fixture-track'],groups:['fixture-group']},bytes=Buffer.from('EXPLICIT SOFTWARE CLAUSE: 100%. Never a real competition rule.');
 rubric.provenance={schemaVersion:1,ruleVersion:rubric.last_updated,scope,sourceChecks:[{id:'source-1',urlSha256:sha(rubric.sources[0].url),state:'verified',locatorKind:'document'}],fields:Object.fromEntries([...rubricFieldValues(rubric)].map(([path,{value}])=>[path,{sha256:sha(value),category:'unverified',state:'unverified',sourceIds:[]}]))};
 const field=rubric.provenance.fields['/judging_dimensions/0/weight'];Object.assign(field,{category:'official-rule',state:'verified',sourceIds:['source-1'],officialWeight:100,evidence:{sourceId:'source-1',locator:'Fixture clause 1',reviewer:'software-test-only',snapshotPath:'data/rule-sources/fixture.txt',snapshotSha256:sha(bytes),quote:'EXPLICIT SOFTWARE CLAUSE: 100%.',verifiedAt:'2026-11-18'}});
 return {rubric,bytes,scope:{competitionId:5,edition:'SOFTWARE-QA',track:'fixture-track',group:'fixture-group'},readSnapshot:()=>bytes};
}

test('official use requires matching edition, track, group, exact current text, source URL and pinned clause bytes',()=>{
 const fixture=explicitClauseFixture(),inspect=(scope=fixture.scope)=>assessRubric(fixture.rubric,scope,{readSnapshot:fixture.readSnapshot});
 assert.equal(inspect().scoreEligible,true);
 fixture.rubric.last_updated='2026-11-19';assert.equal(inspect().scoreEligible,false);fixture.rubric.last_updated='2026-11-18';
 for(const change of [{edition:'OTHER'},{track:'OTHER'},{group:'OTHER'},{group:''},{competitionId:6}])assert.equal(inspect({...fixture.scope,...change}).scoreEligible,false);
 fixture.rubric.judging_dimensions[0].weight='99%';assert.equal(inspect().scoreEligible,false);
 fixture.rubric.judging_dimensions[0].weight='100%';fixture.rubric.sources[0].url='https://example.invalid/changed';assert.equal(inspect().scoreEligible,false);
 fixture.rubric.sources[0].url='https://example.invalid/software-clause';fixture.readSnapshot=()=>Buffer.from('changed source bytes');assert.equal(inspect().scoreEligible,false);
 const original=explicitClauseFixture();original.rubric.provenance.sourceChecks[0].locatorKind='homepage';assert.equal(assessRubric(original.rubric,original.scope,{readSnapshot:original.readSnapshot}).scoreEligible,false);
 assert.equal(assessRubric({competition_id:5},fixture.scope).status,'invalid');
});

test('actual project check exposes archive uncertainty, and moving group invalidates original rule confirmation',()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-rubric-scope-'));process.env.ARES_HOME=join(base,'home');
 const root=join(base,'project');mkdirSync(root);linkRoot(root);const competition=competitionCatalog().find(row=>row.id===5);
 let project=initializeProject({root,name:'Explicit software rule scope fixture',competitionId:5,track:competition.tracks[0].track,group:'fixture-A',workflowId:'modeling'});
 writeFileSync(join(root,'scope.txt'),'EXPLICIT SOFTWARE SCOPE. Never a real competition rule.');
 project=recordRules({root,expectedRevision:project.revision,edition:'SOFTWARE-QA',sourceUrl:'https://example.invalid/software',snapshotPath:'scope.txt',quote:'EXPLICIT SOFTWARE SCOPE'},'user');
 project=configureRuleChecklist({root,expectedRevision:project.revision,items:[{id:'actual',label:'Explicit required fixture clause',kind:'mandatory'}]});
 project=confirmRuleItem({root,expectedRevision:project.revision,ruleId:'actual',confirmChecked:true,evidencePath:'scope.txt',summary:'Explicit software review, not competition verification'});
 assert.equal(projectRuleChecklist(root).items[0].state,'confirmed');assert.equal(verifyProject(root).ruleEvidence.scoreEligible,false);
 const file=join(root,'.ares/project.json'),raw=JSON.parse(readFileSync(file));raw.competition.group='fixture-B';writeFileSync(file,JSON.stringify(raw));
 assert.equal(readProject(root).competition.ruleStatus,'stale');assert.equal(projectRuleChecklist(root).items[0].state,'stale');assert.equal(verifyProject(root).checksPassed,false);
 assert.equal(projectRubricEvidence({competition:{id:1000001}}).status,'not-catalogued');
});
