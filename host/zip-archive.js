/** Deterministic ZIP STORE archive, UTF-8 names, CRC32 and bounded real bytes. */
import {AresError} from './storage.js';
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xEDB88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let crc=0xFFFFFFFF;for(const value of bytes)crc=table[(crc^value)&255]^(crc>>>8);return (crc^0xFFFFFFFF)>>>0;};
export function createZip(entries,{maxBytes=64*1024*1024}={}){
 if(!Array.isArray(entries)||!entries.length||entries.length>1001)throw new AresError('归档文件数量无效');const local=[],central=[],seen=new Set();let offset=0;
 for(const entry of entries){const name=entry.name;if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.split('/').some(v=>!v||v==='.'||v==='..')||seen.has(name.toLowerCase())||!Buffer.isBuffer(entry.bytes))throw new AresError('归档路径、大小或文件冲突');seen.add(name.toLowerCase());const encoded=Buffer.from(name),bytes=entry.bytes,crc=crc32(bytes);if(encoded.length>4096||offset+encoded.length+bytes.length+30>maxBytes)throw new AresError('项目归档超过64MiB限制，请选择较小阶段');
 const header=Buffer.alloc(30);header.writeUInt32LE(0x04034B50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(encoded.length,26);local.push(header,encoded,bytes);
 const row=Buffer.alloc(46);row.writeUInt32LE(0x02014B50);row.writeUInt16LE(20,4);row.writeUInt16LE(20,6);row.writeUInt16LE(0x0800,8);row.writeUInt16LE(33,14);row.writeUInt32LE(crc,16);row.writeUInt32LE(bytes.length,20);row.writeUInt32LE(bytes.length,24);row.writeUInt16LE(encoded.length,28);row.writeUInt32LE(offset,42);central.push(row,encoded);offset+=30+encoded.length+bytes.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054B50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);const archive=Buffer.concat([...local,directory,end]);if(archive.length>maxBytes)throw new AresError('完整归档超过大小限制');return archive;
}
