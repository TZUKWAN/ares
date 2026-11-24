export function wave(seconds=2) {
  const count=16000*seconds,bytes=Buffer.alloc(44+2*count);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(2*count,40);
  for(let i=0;i<count;i++)bytes.writeInt16LE(Math.floor(Math.sin(i/16000*880*Math.PI)*9000),44+2*i);
  return bytes;
}
