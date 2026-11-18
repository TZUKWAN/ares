import {wave} from './helpers/research-media.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {setTimeout as sleep} from 'node:timers/promises';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {researchEntry} from '../host/project-research.js';
import {researchExport} from '../host/research-exports.js';
import {importInterview,correctInterview,interviewSource,saveInterviewGuide,saveCodebook,applyCodes,analyzeInterviews,codingEvidence,proposeInterviewCodes,acceptCodingProposal} from '../host/research-interviews.js';
import {importInterviewMedia,interviewWaveform} from '../host/research-media.js';
import {createResearchJobs,getResearchJob} from '../host/research-jobs.js';
import {startTranscription} from '../host/research-asr.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-research-interview-'));
process.env.ARES_HOME=join(base,'home');
const comp=competitionCatalog().find(c=>c.id===5);
const root=join(base,'project');mkdirSync(root);linkRoot(root);
initializeProject({root,name:'访谈研究软件验收',competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'});
const current=()=>({root,expectedRevision:readProject(root).revision});
const speechInput='1\r\n00:00:00,200 --> 00:00:01,100\r\nP1：第一次进入项目能够找到工作台。\r\n\r\n2\r\n00:00:01,120 --> 00:00:01,980\r\nP2：我花了一点时间找保存动作。';
async function waitFor(root,id) {
  for(let i=0;i<180;i++){
    const state=getResearchJob(root,id);
    if(state.status!=='running')return state;
    await sleep(100);
  }
  throw new Error('Background job did not settle');
}

test('interview design, original materials, two speakers and corrections preserve separate versions',()=>{
  const guide=saveInterviewGuide({...current(),templateInput:{theme:'首次上手',method:'focus',minutes:35,question:'如何找到下一步？'}});
  const word=researchExport({root,id:guide.item.id,format:'docx'});
  assert.equal(word.bytes.subarray(0,4).toString('hex'),'504b0304');
  const blank=importInterview({...current(),title:'空白记录',format:'blank'});
  assert.deepEqual(researchEntry(root,blank.item.id).data.transcript,[]);
  const rawNotes='访谈员：今天想了解使用过程。\n参与者：我主要通过项目页找到流程。';
  const notes=importInterview({...current(),title:'现场笔记',content:rawNotes,format:'notes'});
  assert.equal(researchEntry(root,notes.item.id).data.transcript[0].start,null);
  assert.equal(interviewSource(root,notes.item.id).toString(),rawNotes);
  const imported=importInterview({...current(),title:'逐字稿 A',participant:'P1/P2',format:'srt',content:speechInput,guideId:guide.item.id});
  const initial=researchEntry(root,imported.item.id);
  assert.equal(initial.data.transcript[1].speaker,'P2');assert.equal(initial.data.transcript[1].start,1120);
  const first=initial.data.transcript[0];
  const saved=correctInterview({...current(),id:imported.item.id,baseVersion:imported.version.id,reviewed:true,
    edits:[{segmentId:first.id,speaker:'匿名-01',text:'第一次进入，能找到工作台。',key:true,uncertain:true,memo:'核对说话人'}]});
  const actual=researchEntry(root,saved.item.id);
  assert.equal(actual.data.transcript[0].original,first.original);
  assert.equal(actual.data.edits[first.id].speaker,'匿名-01');
  assert.deepEqual(researchEntry(root,saved.item.id,imported.version.id).data.edits,{});
  assert.equal(interviewSource(root,saved.item.id).toString(),speechInput);
  const srt=researchExport({root,id:saved.item.id,format:'srt'}).bytes.toString();
  assert.match(srt,/00:00:00,200.*\n匿名-01：第一次进入，能找到工作台/);
});

test('coded evidence keeps revision anchors, multiple labels and human approval, and produces a real matrix',()=>{
  const book=saveCodebook({...current(),title:'上手体验',codes:[{id:'access',name:'入口'},{id:'save',parent:'access',name:'保存行为'}]});
  const original=importInterview({...current(),title:'操作 A',participant:'P04',format:'text',content:'P04：根据流程找到项目入口。'});
  const entry=researchEntry(root,original.item.id);
  const seg=entry.data.transcript[0],evidence=codingEvidence(entry,seg.id,0,4);
  const proposed=proposeInterviewCodes({...current(),design:{itemId:entry.item.id,versionId:entry.version.id,
    bookId:book.item.id,bookVersion:book.version.id,evidence,codeIds:['access','save'],memo:'结合寻找路径研究主题'}},{kind:'agent',id:'protocol-test'});
  assert.equal(researchEntry(root,entry.item.id).data.assignments.length,0);
  assert.throws(()=>acceptCodingProposal({...current(),id:proposed.item.id}),/确认/);
  const approved=acceptCodingProposal({...current(),id:proposed.item.id,confirm:true});
  assert.equal(researchEntry(root,approved.item.id).data.assignments[0].basisVersion,entry.version.id);
  assert.throws(()=>acceptCodingProposal({...current(),id:proposed.item.id,confirm:true}),/已采用/);
  const alt=importInterview({...current(),title:'操作 B',participant:'P05',format:'text',content:'P05：保存按钮在问卷设计页。'});
  const altEntry=researchEntry(root,alt.item.id);
  applyCodes({...current(),id:alt.item.id,baseVersion:alt.version.id,bookId:book.item.id,
    assignments:[{segmentId:altEntry.data.transcript[0].id,start:0,end:4,codeIds:['save'],memo:'第二份访谈'}]});
  const synthetic=importInterview({...current(),title:'模拟材料验收',format:'text',content:'这是标记为模拟的文本',synthetic:true,confirmSynthetic:true});
  assert.equal(researchEntry(root,synthetic.item.id).data.dataKind,'synthetic');
  const report=analyzeInterviews({...current(),bookId:book.item.id,interviews:[entry.item.id,alt.item.id,synthetic.item.id]});
  const details=researchEntry(root,report.item.id).data;
  assert.equal(details.matrix.length,3);
  assert.equal(details.frequencies.find(row=>row.id==='save').count,2);
  assert.equal(details.evidence.length,2);
  assert.match(researchExport({root,id:report.item.id,format:'csv'}).bytes.toString(),/"P05"/);
  const changed=correctInterview({...current(),id:approved.item.id,baseVersion:approved.version.id,edits:[{segmentId:seg.id,text:'现在修改了证据段。'}]});
  const stale=analyzeInterviews({...current(),bookId:book.item.id,interviews:[changed.item.id]});
  assert.equal(researchEntry(root,stale.item.id).data.staleCount,1);
  assert.equal(readProject(root).progress.done,0);
});

test('media bytes are persisted, waveforms are decoded, and local jobs report failure, cancel and retry truthfully',async t=>{
  const waveBytes=wave();
  const meta={...current(),name:'software.wav',title:'离线媒体软件验收',bytes:waveBytes.length};
  await assert.rejects(importInterviewMedia(meta,Readable.from([waveBytes])),/确认/);
  const media=await importInterviewMedia({...meta,confirmLocal:true},Readable.from([waveBytes.subarray(0,311),waveBytes.subarray(311)]));
  const stored=researchEntry(root,media.item.id);
  assert.deepEqual(readFileSync(join(root,stored.data.media.path)),waveBytes);
  const waveform=await interviewWaveform({root,id:media.item.id});
  assert.equal(waveform.bins.length,200);assert.ok(waveform.bins.some(bin=>bin>.25));
  const originalModel=process.env.ARES_WHISPER_MODEL;
  delete process.env.ARES_WHISPER_MODEL;
  t.after(()=>{if(originalModel!==undefined)process.env.ARES_WHISPER_MODEL=originalModel;});
  const jobs=createResearchJobs();
  t.after(()=>jobs.dispose());
  const start={...current(),id:media.item.id,versionId:media.version.id,confirmLocal:true};
  assert.throws(()=>startTranscription(jobs,{...start,confirmLocal:false}),/确认/);
  const job1=startTranscription(jobs,start).job;
  const failed=await waitFor(root,job1.id);
  assert.equal(failed.status,'failed');assert.match(failed.message,/ARES_WHISPER_MODEL/);
  const retry=startTranscription(jobs,{...current(),retryId:job1.id,confirmLocal:true}).job;
  assert.equal(retry.priorJob,job1.id);
  jobs.cancel(root,retry.id);
  const cancelled=await waitFor(root,retry.id);
  assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.result,undefined);
});

if(process.env.ARES_ASR_QA_AUDIO)test('installed faster-whisper transcribes real WAV bytes offline and retains words and source SHA',{timeout:180000},async t=>{
  const clip=readFileSync(process.env.ARES_ASR_QA_AUDIO);
  const media=await importInterviewMedia({...current(),name:'software-speech.wav',title:'本地识别软件验收',bytes:clip.length,confirmLocal:true},Readable.from([clip]));
  const jobs=createResearchJobs();t.after(()=>jobs.dispose());
  const start=startTranscription(jobs,{...current(),id:media.item.id,versionId:media.version.id,confirmLocal:true,language:'en'}).job;
  let state;
  for(let i=0;i<360;i++){
    state=getResearchJob(root,start.id);
    if(state.status!=='running')break;
    await sleep(400);
  }
  assert.equal(state.status,'completed',JSON.stringify(state));
  const entry=researchEntry(root,state.result.itemId);
  assert.equal(entry.data.recognition.engine,'faster-whisper');
  assert.ok(entry.data.transcript.length>=1);
  assert.match(entry.data.transcript.map(row=>row.original).join(' '),/interview|questionnaire/i);
  assert.ok(entry.data.transcript.some(row=>row.words.length>0));
  assert.equal(entry.version.payload.source.versionId,media.version.id);
  assert.equal(entry.data.media.sha256,researchEntry(root,media.item.id).data.media.sha256);
  console.log(JSON.stringify({source:'local-speech-synthesizer-software-test',job:state,item:entry.item,segments:entry.data.transcript.map(row=>({start:row.start,end:row.end,words:row.words.length,original:row.original}))}));
});

if(process.env.ARES_ASR_QA_AUDIO)test('local Whisper retries a cancelled long recording from verified persisted segments',{timeout:180000},async t=>{
  const file=join(base,'software-repeat.wav');
  const generated=spawnSync(process.env.ARES_FFMPEG||'ffmpeg',['-v','error','-stream_loop','7','-i',process.env.ARES_ASR_QA_AUDIO,
    '-t','90','-ac','1','-ar','16000','-c:a','pcm_s16le',file],{encoding:'utf8',windowsHide:true});
  assert.equal(generated.status,0,generated.stderr);
  const bytes=readFileSync(file);
  const media=await importInterviewMedia({...current(),name:'software-repeat.wav',title:'恢复软件验收',bytes:bytes.length,confirmLocal:true},Readable.from([bytes]));
  const jobs=createResearchJobs();t.after(()=>jobs.dispose());
  const first=startTranscription(jobs,{...current(),id:media.item.id,versionId:media.version.id,language:'en',confirmLocal:true}).job;
  let checkpoint;
  for(let i=0;i<2200;i++){
    checkpoint=getResearchJob(root,first.id);
    if(checkpoint.status!=='running'||checkpoint.checkpointCount>0)break;
    await sleep(30);
  }
  assert.equal(checkpoint.status,'running',JSON.stringify(checkpoint));
  assert.ok(checkpoint.checkpointCount>0);
  jobs.cancel(root,first.id);
  const cancelled=await waitFor(root,first.id);
  assert.equal(cancelled.status,'cancelled');
  assert.ok(cancelled.checkpointCount>0);
  const retryManager=createResearchJobs();t.after(()=>retryManager.dispose());
  const retry=startTranscription(retryManager,{...current(),retryId:first.id,confirmLocal:true}).job;
  let done;
  for(let i=0;i<350;i++){
    done=getResearchJob(root,retry.id);
    if(done.status!=='running')break;
    await sleep(400);
  }
  assert.equal(done.status,'completed',JSON.stringify(done));
  assert.equal(done.result.resumedFrom,first.id);
  const record=researchEntry(root,done.result.itemId);
  assert.ok(record.data.transcript.length>cancelled.checkpointCount);
  assert.equal(record.data.recognition.resumedFrom,first.id);
  console.log(JSON.stringify({source:'local-tts-software-test-repeated',firstJob:first.id,firstStatus:cancelled.status,
    checkpointSegments:cancelled.checkpointCount,retryJob:retry.id,result:done.result}));
});
