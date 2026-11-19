const base='/api/social';
export function signInUrl(){
  return '/signin-with-chatgpt?return_to='+encodeURIComponent(location.pathname+location.search+location.hash);
}
export async function api(path,{method='GET',body,signal,headers:extra={}}={}){
  const headers=new Headers(extra);
  let data=body;
  if(method!=='GET' && method!=='HEAD')headers.set('X-NoLimit','diary');
  if(body instanceof Blob) {
    headers.set('Content-Type',body.type || 'application/octet-stream');
  } else if(body!==undefined) {
    headers.set('Content-Type','application/json');
    data=JSON.stringify(body);
  }
  const response=await fetch(base+path,{method,headers,body:data,signal,credentials:'same-origin',cache:'no-store'});
  const result=await response.json().catch(()=>null);
  if(!response.ok || result===null){
    const code=result?.error || 'service_unavailable';
    throw Object.assign(new Error(code),{code,status:response.ok?503:response.status});
  }
  return result;
}
// Keep publication ownership separate from the diary and its portable ZIP format.
let connecting;
function openLinks(){
  if(!connecting)connecting=new Promise((resolve,reject)=>{
    const req=indexedDB.open('nolimit-social-links',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('links',{keyPath:'localId'});
    req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();connecting=null;};resolve(db);};
    req.onerror=()=>reject(req.error);
  }).catch(error=>{connecting=null;throw error;});
  return connecting;
}
async function linkTransaction(localId,update){
  const db=await openLinks();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('links',update?'readwrite':'readonly'), store=tx.objectStore('links');
    const req=store.get(localId);
    let result;
    req.onsuccess=()=>{
      result=req.result || null;
      if(update){result=update(result);if(result)store.put(result);else store.delete(localId);}
    };
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(tx.error || new Error('storage_unavailable'));
  });
}
export const publicationLink=id=>linkTransaction(id);
export const claimPublication=(localId,ownerId)=>linkTransaction(localId,old=>old || {localId,ownerId,id:crypto.randomUUID(),mode:'private',confirmed:false});
export const rememberPublication=(localId,id,mode)=>linkTransaction(localId,old=>old?.id===id?{...old,confirmed:true,mode}:old);
export const forgetPublication=(localId,id)=>linkTransaction(localId,old=>old?.id===id?null:old);
