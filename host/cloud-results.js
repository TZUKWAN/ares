import {AresError} from './storage.js';

/** CLI data-shape helpers; these never call a cloud service. */
export function cloudItems(result,label='列表'){
 if(!result||typeof result!=='object'||!Array.isArray(result.items)||result.items.some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw new AresError('金山'+label+'结构不符，未采用未知结果',502);
 return result.items;
}
export function cloudPageToken(value){if(value===undefined||value===null||value==='')return null;if(typeof value!=='string'||value.length>4000)throw new AresError('金山分页标记结构不符',502);return value;}
export function cloudHistoryPage(result){
 const items=cloudItems(result,'版本记录').map(v=>{if(!Number.isSafeInteger(v.version)||v.version<0)throw new AresError('金山版本记录没有有效版本号',502);return {version:v.version,id:v.id??null,size:v.size??null,mtime:v.mtime??null,comment:typeof v.comment==='string'?v.comment.slice(0,2000):'',modifiedBy:typeof v.modified_by?.name==='string'?v.modified_by.name:null};});
 return {items,nextPageToken:cloudPageToken(result.next_page_token)};
}
export function cloudCommentPresent(result,commentId,content){return cloudItems(result,'留言读回').some(row=>{const value=row.comment??row;return value&&typeof value==='object'&&String(value.id)===String(commentId)&&value.content===content;});}
export function cloudPublicationMatches(info,expected){
 if(!info||!expected||!['fileId','driveId','folderId','name'].every(key=>typeof expected[key]==='string'&&expected[key])||!Number.isSafeInteger(expected.bytes)||expected.bytes<0)return false;
 return String(info.id??info.file_id)===expected.fileId&&String(info.drive_id)===expected.driveId&&String(info.parent_id)===expected.folderId&&info.name===expected.name&&Number(info.size)===expected.bytes&&(expected.version===undefined||expected.version===null||info.version===expected.version);
}
export function cloudPublicationFiles(existing,verified,complete){
 if(!Array.isArray(existing)||!Array.isArray(verified)||typeof complete!=='boolean')throw new AresError('发布回执结构不符，未丢弃原记录',409);
 if(complete)return verified.map(row=>({...row}));
 const files=new Map(existing.map(row=>[String(row.fileId),{...row}]));for(const row of verified)files.set(String(row.fileId),{...files.get(String(row.fileId)),...row});return [...files.values()];
}
