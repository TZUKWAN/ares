import {parentPort,workerData} from 'node:worker_threads';
import {generateSurveyPretest} from './survey-pretest.js';
import {AresError} from './storage.js';

try{const {csv,report}=generateSurveyPretest(workerData);parentPort.postMessage({ok:true,csv,report});}
catch(error){parentPort.postMessage({ok:false,error:error instanceof AresError?error.message:'问卷计算失败，请检查参数和资源限制'});}
finally{parentPort.close();}
