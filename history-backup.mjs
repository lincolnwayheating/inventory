export const STORAGE_KEY='hvac_transaction_queue';
const PURPOSE='legacy-history-preservation-only';
const keys=['schemaVersion','purpose','exportId','capturedAt','source','rawQueue','rawSha256'];
function sameKeys(v,want){return !!v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join('|')===want.slice().sort().join('|');}
function uuid(v){return typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);}
function validTime(v){return typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
function sourceValid(source){return sameKeys(source,['origin','pathname','storageKey'])&&source.origin==='https://lincolnwayheating.github.io'&&source.pathname==='/inventory/pending-history.html'&&source.storageKey===STORAGE_KEY;}
export async function rawDigest(raw,crypto){
 // JSON encoding distinguishes missing storage (null) from the literal string "null".
 const bytes=new TextEncoder().encode(JSON.stringify(raw));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function summarizeRaw(raw){
 if(raw===null)return {state:'missing',count:0};
 let value;try{value=JSON.parse(raw);}catch{return {state:'malformed',count:null};}
 if(!Array.isArray(value))return {state:'unrecognized',count:null};
 return {state:'queue',count:value.length};
}
export async function captureHistoryBackup({storage,crypto,source,now=()=>new Date()}){
 if(!sourceValid(source))throw Error('Wrong recovery page origin');
 const raw=storage.getItem(STORAGE_KEY); // Do not convert a read failure to an empty queue.
 if(raw!==null&&typeof raw!=='string')throw Error('Invalid storage result');
 const exportId=crypto.randomUUID(),capturedAt=now().toISOString();
 if(!uuid(exportId)||!validTime(capturedAt))throw Error('Cannot identify backup');
 const backup={schemaVersion:1,purpose:PURPOSE,exportId,capturedAt,source:{...source},rawQueue:raw,rawSha256:await rawDigest(raw,crypto)};
 return {backup,summary:summarizeRaw(raw)};
}
export async function verifyHistoryBackup(value,crypto){
 if(!sameKeys(value,keys)||value.schemaVersion!==1||value.purpose!==PURPOSE||!uuid(value.exportId)||!validTime(value.capturedAt)||!sourceValid(value.source)||(value.rawQueue!==null&&typeof value.rawQueue!=='string')||typeof value.rawSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.rawSha256))throw Error('Invalid history backup');
 if(await rawDigest(value.rawQueue,crypto)!==value.rawSha256)throw Error('History backup changed');
 // Archive validation only: no movement or transaction request is produced.
 return {exportId:value.exportId,summary:summarizeRaw(value.rawQueue),rawQueue:value.rawQueue};
}
