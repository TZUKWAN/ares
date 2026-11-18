/** Packaging output boundary; checks every existing ancestor, including junctions. */
import {lstatSync,mkdirSync,writeFileSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import {resolve,parse,relative,sep,join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

export function assertPackageDestination(value,{file=false}={}){
 const path=resolve(value),root=parse(path).root,parts=relative(root,path).split(sep).filter(Boolean);
 let current=root;
 for(let index=-1;index<parts.length;index++){
  if(index>=0)current=join(current,parts[index]);
  const stat=lstatSync(current,{throwIfNoEntry:false});if(!stat)continue;
  if(stat.isSymbolicLink())throw new Error('Refusing package destination symlink/junction: '+current);
  const final=index===parts.length-1;
  if(!final||!file){if(!stat.isDirectory())throw new Error('Package destination ancestor is not a directory: '+current);}
  else if(!stat.isFile()||stat.nlink>1)throw new Error('Refusing linked or non-regular package destination: '+current);
 }
 return path;
}

export function writePackageFile(value,bytes){
 const path=assertPackageDestination(value,{file:true});mkdirSync(dirname(path),{recursive:true});assertPackageDestination(path,{file:true});
 const temporary=path+'.tmp-'+randomUUID();
 try{writeFileSync(temporary,bytes,{flag:'wx'});assertPackageDestination(path,{file:true});renameSync(temporary,path);}
 finally{if(existsSync(temporary))unlinkSync(temporary);}
}
