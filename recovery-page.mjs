import {captureHistoryBackup,STORAGE_KEY} from './history-backup.mjs';
const capture=document.getElementById('capture'),status=document.getElementById('status'),save=document.getElementById('save'),details=document.getElementById('details');
let downloadUrl=null;
function release(){if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null;}save.hidden=true;save.removeAttribute('href');details.hidden=true;}
capture.addEventListener('click',async()=>{
 capture.disabled=true;release();status.textContent='Checking history saved in this browser…';
 try{
  const {backup,summary}=await captureHistoryBackup({storage:window.localStorage,crypto:window.crypto,source:{origin:location.origin,pathname:location.pathname,storageKey:STORAGE_KEY}});
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});downloadUrl=URL.createObjectURL(blob);save.href=downloadUrl;save.download=`happy-hippo-history-${backup.exportId}.json`;save.hidden=false;details.hidden=false;
  status.textContent=summary.state==='missing'?'No pending history was found in this browser. You can save this check for your records.':summary.state==='queue'?`${summary.count} pending history ${summary.count===1?'entry':'entries'} found. Your backup is ready to save.`:'The saved history could not be read as a normal queue. The backup preserves it unchanged for the owner to review.';
 }catch{status.textContent='Could not read this browser’s saved history. Nothing was changed. Open this recovery page from the old inventory app and try again.';}
 finally{capture.disabled=false;}
});
window.addEventListener('pagehide',release);
