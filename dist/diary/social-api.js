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
      if(update) {
        const old=result;
        result=update(old);
        if(result!==old) {
          if(result) store.put(result);
          else store.delete(localId);
        }
      }
    };
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(tx.error || new Error('storage_unavailable'));
  });
}
export const publicationLink=id=>linkTransaction(id);
export const claimPublication=(localId,ownerId)=>linkTransaction(localId,old=>old || {localId,ownerId,id:crypto.randomUUID(),mode:'private',confirmed:false});
export const rememberPublication=(localId,id,mode,accessVersion)=>linkTransaction(localId,old=>{
  if (old?.id!==id || accessVersion<(old.accessVersion || 0)) return old;
  return {...old,confirmed:true,mode,accessVersion:accessVersion ?? old.accessVersion,localRevision:(old.localRevision || 0)+1};
});
export const forgetPublication=(localId,id)=>linkTransaction(localId,old=>old?.id===id?null:old);

export async function archivePublicationLinks(localIds) {
  const db=await openLinks();
  const links=await new Promise((resolve,reject)=>{
    const req=db.transaction('links').objectStore('links').getAll();
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  return new Map(links.filter(link=>localIds.has(link.localId)).map(link=>[link.localId,link]));
}

export async function syncArchivePublications(links,signal) {
  const verified=new Set();
  if (!links.size || signal.aborted) return verified;
  const {user}=await api('/session',{signal});
  const owned=[...links.values()].filter(link=>link.ownerId===user?.id);
  if (!owned.length || signal.aborted) return verified;
  const {days}=await api('/mine',{signal,headers:{'X-NoLimit-Account':user.id}});
  const byId=new Map(days.map(day=>[day.id,day]));
  await Promise.all(owned.map(async snapshot=>{
    const day=byId.get(snapshot.id);
    await linkTransaction(snapshot.localId,current=>{
      if (signal.aborted || current?.id!==snapshot.id || current.ownerId!==user.id ||
          current.localRevision!==snapshot.localRevision) return current;
      // A missing unconfirmed upload can still be in flight on another tab.
      if (!day) {
        if (current.confirmed) {verified.add(current.localId);return null;}
        return current;
      }
      if (day.accessVersion<(current.accessVersion || 0)) return current;
      verified.add(current.localId);
      return current.confirmed && current.mode===day.mode && current.accessVersion===day.accessVersion ? current :
        {...current,confirmed:true,mode:day.mode,accessVersion:day.accessVersion};
    });
  }));
  return verified;
}
