/** Fixed OS mutex only. Never loads project code or accepts commands. */
import {workerData,parentPort} from 'node:worker_threads';
import {createServer} from 'node:net';
const state=new Int32Array(workerData.state),server=createServer(socket=>socket.destroy());
function finished(){Atomics.store(state,0,4);Atomics.notify(state,0);parentPort.close();}
server.once('error',error=>{Atomics.store(state,1,error.code==='EADDRINUSE'?1:2);Atomics.store(state,0,2);Atomics.notify(state,0);parentPort.close();});
server.listen(workerData.endpoint,()=>{
 if(Atomics.compareExchange(state,0,0,1)===0){Atomics.notify(state,0);while(Atomics.load(state,0)===1)Atomics.wait(state,0,1);}
 server.close(finished);
});
