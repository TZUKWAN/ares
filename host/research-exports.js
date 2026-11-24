import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AresError} from './storage.js';
import {researchProject,researchVersion,stageResearchOutput} from './project-research.js';
import {surveyMarkdown,csvText} from './research-surveys.js';
import {guideMarkdown,interviewMarkdown,interviewSrt} from './research-interviews.js';

const docxScript=fileURLToPath(new URL('../scripts/cloud_text_docx.py',import.meta.url));
function word(markdown) {
  const result=spawnSync('python',[docxScript],{
    input:JSON.stringify({text:markdown}),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:20*1024*1024,
    env:{...process.env,PYTHONIOENCODING:'utf-8'}
  });
  if (result.status!==0) throw new AresError('Word 导出需要可用的 Python 与 python-docx',503);
  try { return Buffer.from(JSON.parse(result.stdout).content_base64,'base64'); }
  catch { throw new AresError('无法读取生成的 Word 文档',500); }
}
export function researchExport(body) {
  const version=researchVersion(researchProject(body.root),body.id,body.versionId);
  const {kind,title,status,provenance}=version.version.payload;
  const extension=body.format||'json';
  let bytes,contentType;
  if (provenance==='synthetic'&&['docx','srt'].includes(extension))
    throw new AresError('模拟资料请选择保留来源标识的 JSON、Markdown 或 CSV');
  if (extension==='json') {
    const data=kind==='survey'&&status!=='proposal'?version.data:{kind,title,status,provenance,versionId:version.version.id,data:version.data};
    bytes=Buffer.from(JSON.stringify(data,null,2)+'\n');contentType='application/json';
  } else if (['md','docx'].includes(extension)) {
    const text=kind==='survey'?surveyMarkdown(version.data):kind==='guide'?guideMarkdown(version.data):kind==='interview'?interviewMarkdown(version.data):version.data.markdown;
    if (!text) throw new AresError('当前记录没有文字导出格式');
    const marked=(provenance==='synthetic'?'ARES_SYNTHETIC_DATA\n\n':status==='proposal'?'# 研究建议 · 待研究人员采用\n\n':'')+text;
    bytes=extension==='docx'?word(marked):Buffer.from(marked);
    contentType=extension==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'text/markdown; charset=utf-8';
  } else if (extension==='csv'&&kind==='responses') {
    const keys=version.data.summary.columns.map(row=>row.name);
    bytes=Buffer.from('\uFEFF'+csvText([keys,...version.data.rows.map(row=>keys.map(key=>row[key]))]));
    contentType='text/csv; charset=utf-8';
  } else if (extension==='csv'&&Array.isArray(version.data.matrix)) {
    bytes=Buffer.from('\uFEFF'+(provenance==='synthetic'?'ARES_SYNTHETIC_DATA\r\n':'')+csvText(version.data.matrix));contentType='text/csv; charset=utf-8';
  } else if (extension==='srt'&&kind==='interview') {
    bytes=Buffer.from(interviewSrt(version.data));contentType='text/plain; charset=utf-8';
  } else throw new AresError('当前记录不支持此导出格式');
  const safeTitle=title.replace(/[\\/:*?"<>|\p{Cc}]/gu,'_').slice(0,100);
  return {bytes,contentType,filename:safeTitle+'.'+extension,extension};
}
export function researchWorkDraft(body) {
  return stageResearchOutput(body,researchExport(body));
}
