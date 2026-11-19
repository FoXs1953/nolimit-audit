const base='/api/social';
const nameKey='nolimit:friends:name';

// A read/write IndexedDB transaction gives simultaneous tabs the same random identity.
let deviceDatabase,deviceKey;
function deviceStore(){
  if(!deviceDatabase)deviceDatabase=new Promise((resolve,reject)=>{
    const request=indexedDB.open('nolimit-friends-device',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('device');
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();deviceDatabase=null;deviceKey=null;};resolve(db);};
    request.onerror=()=>reject(request.error);
  }).catch(error=>{deviceDatabase=null;throw error;});
  return deviceDatabase;
}
async function browserKey(create=false){
  if(deviceKey)return deviceKey;
  try {
    const db=await deviceStore();
    const key=await new Promise((resolve,reject)=>{
      const tx=db.transaction('device',create?'readwrite':'readonly'),store=tx.objectStore('device');
      const request=store.get('key');
      let value;
      request.onsuccess=()=>{
        value=request.result;
        if(!value && create){
          value=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
          store.add(value,'key');
        }
      };
      tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error);
    });
    if(key)deviceKey=key;
    return key;
  }catch{return null;} // Browsers with unavailable IndexedDB can still use the session cookie.
}
export function getCachedProfileName(){
  try{return localStorage.getItem(nameKey) || '';}catch{return '';}
}
export async function saveProfileName(name,options={}){
  const headers=new Headers(options.headers);
  if(!headers.has('X-NoLimit-Account')){
    await browserKey(true);
    headers.set('X-NoLimit-Setup','1');
  }
  const saved=await api('/profile',{...options,method:'POST',headers,body:{name}});
  const current=await api('/session',{signal:options.signal});
  if(current.user && current.user.id!==saved.user.id)throw Object.assign(new Error('account_changed'),{code:'account_changed'});
  if(current.user?.id!==saved.user.id)throw Object.assign(new Error('profile_unconfirmed'),{code:'profile_unconfirmed'});
  try{localStorage.setItem(nameKey,current.user.name);}catch{}
  return current;
}
export async function api(path,{method='GET',body,signal,headers:extra={}}={}){
  const headers=new Headers(extra);
  const key=await browserKey();
  if(key)headers.set('X-NoLimit-Device',key);
  let data=body;
  if(method!=='GET' && method!=='HEAD')headers.set('X-NoLimit','diary');
  if(body instanceof Blob) {
    headers.set('Content-Type',body.type || 'application/octet-stream');
  } else if(body!==undefined) {
    headers.set('Content-Type','application/json');
    data=JSON.stringify(body);
  }
  const response=await fetch(base+path,{method,headers,body:data,signal,credentials:'same-origin',cache:'no-store',redirect:'error'});
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
