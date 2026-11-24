/** Windows directory identities ignore case; POSIX identities preserve it. */
import {resolve} from 'node:path';
import {realpathSync} from 'node:fs';
const caseKey=value=>process.platform==='win32'?value.toLowerCase():value;
export const resolvedPathKey=value=>caseKey(resolve(value));
export const realPathKey=value=>caseKey(realpathSync(value));
export const samePath=(left,right)=>typeof left==='string'&&typeof right==='string'&&resolvedPathKey(left)===resolvedPathKey(right);
