import {writeFileSync,statSync} from 'node:fs';

/** Screenshot budget is separate from control/operation deadlines on CI GPUs. */
export async function capture(page,path,options={}){
 const started=performance.now(),metadata={viewport:page.viewportSize(),timeoutMs:30000};
 try{
  const bytes=await page.screenshot({path,timeout:30000,animations:'disabled',...options});
  writeFileSync(path+'.capture.json',JSON.stringify({...metadata,status:'captured',elapsedMs:performance.now()-started,bytes:statSync(path).size},null,2)+'\n');
  return bytes;
 }catch(error){
  writeFileSync(path+'.capture.json',JSON.stringify({...metadata,status:'failed',elapsedMs:performance.now()-started,error:error.message.slice(0,1200)},null,2)+'\n');
  throw error;
 }
}
