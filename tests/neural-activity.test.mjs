import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNeuralActivityFeed} from '../client/neural-scene.js';

test('activity adapter seeds history, observes new immutable IDs once and retains the actual payload',()=>{
 const feed=createNeuralActivityFeed(),old={id:'explicit-history-fixture'},next={id:'explicit-new-fixture',summary:'<text remains data>',stepIds:['step-a']};
 assert.deepEqual(feed.ingest('project-a',[old]),[]);assert.deepEqual(feed.read(),{seen:1,queued:0});
 assert.deepEqual(feed.ingest('project-a',[old,next]),[next]);assert.equal(feed.latest(),next);
 assert.deepEqual(feed.ingest('project-a',[old,next]),[]);assert.deepEqual(feed.read(),{seen:2,queued:1});
 feed.acknowledge();assert.equal(feed.latest(),null);assert.deepEqual(feed.ingest('project-a',[old,next]),[]);
});
test('switching project clears pending records and does not broadcast another project history',()=>{
 const feed=createNeuralActivityFeed();feed.ingest('a',[]);feed.ingest('a',[{id:'a-event'}]);
 assert.deepEqual(feed.ingest('b',[{id:'b-history'}]),[]);assert.deepEqual(feed.read(),{seen:1,queued:0});assert.equal(feed.latest(),null);
 assert.deepEqual(feed.ingest('a',[{id:'a-event'}]),[]);assert.equal(feed.read().queued,0);
});
test('activity memory and pending cues are bounded, including repeated large history windows',()=>{
 const feed=createNeuralActivityFeed({limit:3,knownLimit:8}),rows=Array.from({length:20},(_,i)=>({id:'explicit-record-'+i}));
 feed.ingest('a',[]);assert.equal(feed.ingest('a',rows).length,8);assert.deepEqual(feed.read(),{seen:8,queued:3});
 assert.equal(feed.latest(),rows.at(-1));assert.deepEqual(feed.ingest('a',rows),[]);assert.deepEqual(feed.read(),{seen:8,queued:3});
});
