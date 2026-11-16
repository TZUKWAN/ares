import {writeFileSync,existsSync} from 'node:fs';
import {withLockRecoveryGuard} from '../../host/lock-recovery.js';
const [target,ready,release]=process.argv.slice(2),sleep=new Int32Array(new SharedArrayBuffer(4));
withLockRecoveryGuard(target,()=>{writeFileSync(ready,String(process.pid));const deadline=Date.now()+10000;while(!existsSync(release)&&Date.now()<deadline)Atomics.wait(sleep,0,0,20);});
