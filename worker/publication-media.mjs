import { fail, json } from './http.mjs';
import { readable } from './publication-data.mjs';

const DAY=86400000;
const types={
  'image/jpeg':'image/jpeg','image/jpg':'image/jpeg','image/png':'image/png','image/webp':'image/webp',
  'image/gif':'image/gif','image/avif':'image/avif','image/heic':'image/heic','image/heif':'image/heif',
  'image/heic-sequence':'image/heic','image/heif-sequence':'image/heif',
  'audio/mpeg':'audio/mpeg','audio/mp3':'audio/mpeg','audio/aac':'audio/aac',
  'audio/mp4':'audio/mp4','audio/m4a':'audio/mp4','audio/x-m4a':'audio/mp4',
  'audio/wav':'audio/wav','audio/x-wav':'audio/wav','audio/wave':'audio/wav','audio/vnd.wave':'audio/wav',
  'audio/ogg':'audio/ogg','audio/webm':'audio/webm','audio/flac':'audio/flac','audio/x-flac':'audio/flac'
};

function matches(bytes,type) {
  const at=(i,s)=>Array.from(s).every((c,n)=>bytes[i+n]===c.charCodeAt(0));
  const starts=(...values)=>values.every((b,i)=>b===bytes[i]);
  switch(type) {
    case 'image/jpeg': return starts(255,216,255);
    case 'image/png': return starts(137,80,78,71,13,10,26,10);
    case 'image/webp': return at(0,'RIFF') && at(8,'WEBP');
    case 'image/gif': return at(0,'GIF87a') || at(0,'GIF89a');
    case 'audio/wav': return (at(0,'RIFF') || at(0,'RF64')) && at(8,'WAVE');
    case 'audio/ogg': return at(0,'OggS');
    case 'audio/flac': return at(0,'fLaC');
    case 'audio/webm': return starts(26,69,223,163);
    case 'audio/aac': return at(0,'ADIF') || (bytes[0]===255 && (bytes[1]&246)===240) || at(0,'ID3');
    case 'audio/mpeg': return at(0,'ID3') || (bytes[0]===255 && (bytes[1]&224)===224);
    default: {
      if (!at(4,'ftyp')) return false;
      const brands=type==='image/avif' ? ['avif','avis'] : type.startsWith('image/') ?
        ['heic','heix','hevc','hevx','mif1','msf1'] : ['M4A ','M4B ','isom','iso2','mp41','mp42','qt  '];
      // Major brand at byte 8, minor version at 12, then compatible brands.
      const boxSize=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0);
      return brands.some(brand=>at(8,brand) ||
        Array.from({length:Math.max(0,Math.floor((Math.min(boxSize,bytes.length)-16)/4))},(_,n)=>16+4*n).some(i=>at(i,brand)));
    }
  }
}

async function readFile(request,mime,limit) {
  const length=request.headers.get('content-length');
  if (length!==null && (!/^\d+$/.test(length) || Number(length)>limit)) fail(413,'media_too_large');
  if (!request.body) fail(400,'empty_media');
  const reader=request.body.getReader(), chunks=[];
  let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>limit) { await reader.cancel(); fail(413,'media_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) fail(400,'empty_media');
  const blob=new Blob(chunks,{type:mime});
  if (!matches(new Uint8Array(await blob.slice(0,96).arrayBuffer()),mime)) fail(415,'invalid_media');
  return blob;
}

async function cleanupObjects(env) {
  const now=Date.now(), db=env.DB;
  const [,abandoned,garbage]=await db.batch([
    db.prepare("UPDATE publication_media SET state='garbage' WHERE id IN (SELECT id FROM publication_media WHERE state='staged' AND created_at<? LIMIT 16)").bind(now-DAY),
    db.prepare('SELECT object_key FROM pending_media_objects WHERE expires_at<=? LIMIT 16').bind(now),
    db.prepare("SELECT object_key FROM publication_media WHERE state='garbage' LIMIT 16")
  ]);
  const keys=[...abandoned.results,...garbage.results].map(row=>row.object_key);
  if (!keys.length) return;
  await env.BUCKET.delete(keys);
  await db.batch([
    db.prepare("DELETE FROM publication_media WHERE state='garbage' AND object_key IN (SELECT value FROM json_each(?))").bind(JSON.stringify(keys)),
    db.prepare('DELETE FROM pending_media_objects WHERE object_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys))
  ]);
}

// A transient storage error keeps the garbage marked for the next sweep.
export async function collectPublicationMedia(env) {
  try { await cleanupObjects(env); } catch (error) { console.warn('Media cleanup deferred',error?.name); }
}

export async function upload(request,env,user,id) {
  if (!env.BUCKET) fail(503,'storage_unavailable');
  const db=env.DB, get=()=>db.prepare('SELECT owner_id,state FROM publication_media WHERE id=?').bind(id).first();
  const existing=await get();
  if (existing) {
    if (existing.owner_id!==user || existing.state==='garbage') fail(409,'upload_conflict');
    return json({id});
  }
  const mime=types[request.headers.get('content-type')?.toLowerCase().split(';')[0].trim()];
  if (typeof mime!=='string') fail(415,'invalid_media');
  const kind=mime.startsWith('image/')?'photo':'audio';
  const file=await readFile(request,mime,(kind==='photo'?12:25)*1024*1024);
  const now=Date.now(), key='media/'+crypto.randomUUID();
  await db.prepare('INSERT INTO pending_media_objects(object_key,expires_at) VALUES(?,?)').bind(key,now+DAY).run();
  await env.BUCKET.put(key,file,{httpMetadata:{contentType:mime}});
  // Every attempt writes a different immutable key. Only one claim can win,
  // so a retry cannot overwrite bytes already attached to a publication.
  const [claim]=await db.batch([
    db.prepare(`INSERT INTO publication_media(id,owner_id,object_key,kind,mime,size,state,created_at)
      SELECT ?,?,?,?,?,?,'staged',? WHERE EXISTS(SELECT 1 FROM pending_media_objects WHERE object_key=? AND expires_at>?)
      ON CONFLICT(id) DO NOTHING`).bind(id,user,key,kind,mime,file.size,now,key,Date.now()),
    db.prepare('DELETE FROM pending_media_objects WHERE object_key=? AND EXISTS (SELECT 1 FROM publication_media WHERE object_key=?)').bind(key,key),
    db.prepare('UPDATE pending_media_objects SET expires_at=0 WHERE object_key=?').bind(key)
  ]);
  await collectPublicationMedia(env);
  if (!claim.meta.changes) {
    const winner=await get();
    if (!winner || winner.owner_id!==user || winner.state==='garbage') fail(409,'upload_conflict');
  }
  return json({id});
}

function parseRange(raw,size) {
  if (!raw) return null;
  const match=/^bytes=(\d*)-(\d*)$/i.exec(raw.trim());
  if (!match || (!match[1] && !match[2])) return false;
  const a=match[1] ? Number(match[1]) : null, b=match[2] ? Number(match[2]) : null;
  if ((a!==null && !Number.isSafeInteger(a)) || (b!==null && !Number.isSafeInteger(b))) return false;
  const offset=a ?? Math.max(0,size-b);
  const end=a===null || b===null ? size-1 : Math.min(b,size-1);
  return offset<=end && offset<size ? {offset,length:end-offset+1} : false;
}

export async function readMedia(request,env,user,publication,id) {
  const media=await env.DB.prepare(`SELECT m.mime,m.size,m.object_key FROM publication_media m
    JOIN publications p ON m.publication_id=p.id WHERE p.id=?2 AND m.id=?3 AND m.state='active' AND ${readable}`)
    .bind(user,publication,id).first();
  if (!media) fail(404,'unavailable');
  const headers=new Headers({'Content-Type':media.mime,'Accept-Ranges':'bytes','Cache-Control':'private, no-store',
    'Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin',
    'Content-Security-Policy':"default-src 'none'; sandbox"});
  const range=parseRange(request.headers.get('Range'),media.size);
  if (range===false) {
    headers.set('Content-Range','bytes */'+media.size);
    return new Response(null,{status:416,headers});
  }
  headers.set('Content-Length',String(range?.length ?? media.size));
  if (range) headers.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${media.size}`);
  const response={status:range ? 206 : 200,headers};
  if (request.method==='HEAD') return new Response(null,response);
  if (!env.BUCKET) fail(503,'storage_unavailable');
  const object=await env.BUCKET.get(media.object_key,range ? {range} : undefined);
  if (!object) fail(404,'unavailable');
  return new Response(object.body,response);
}
