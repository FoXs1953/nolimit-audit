// Device-local diary. Writes commit as one transaction, including all date/version changes.
import { zipSync, unzipSync, strToU8, strFromU8 } from './vendor/fflate-0.8.2.js';
import { translator } from './i18n.js';
import { messages } from './locales/store.js';

const t = translator(messages);

const DB_NAME = 'nolimit-arttech-diary';
const STORE = 'days';
const MIB = 1024 * 1024;
const MAX_ARCHIVE = 240 * MIB;
const MAX_DAYS = 1500;
const MAX_FILES = 12000;
const MAX_JSON = 2 * MIB;
const MAX_IMAGE = 12 * MIB;
const MAX_VIDEO = 50 * MIB;
const MAX_AUDIO = 25 * MIB;
// The saved gallery and its pending edit each include their photo soundtracks.
// Leave room in one ZIP for two day tracks as well.
export const MAX_GALLERY_BYTES = 90 * MIB;
const blobHashes = new WeakMap();
const blobBytes = new WeakMap();
const demoFiles = new Map();
const storageKeys = new Set(['revision','updatedAt','primary','_contentHash','_originId','_noteSeed','_removedNotes']);
const imageTypes = new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif','image/heic-sequence','image/heif-sequence','image/avif','image/gif']);
const videoTypes = new Set(['video/mp4','video/webm','video/quicktime']);
const audioTypes = new Set(['audio/mpeg','audio/mp3','audio/aac','audio/mp4','audio/x-m4a','audio/m4a','audio/wav','audio/wave','audio/x-wav','audio/vnd.wave','audio/ogg','audio/webm','audio/flac','audio/x-flac']);
const DEMO_PATH = /^(?:\.\/|\/)?diary\/media\/[a-z\d][\w.-]{0,100}\.(?:jpe?g|png|webp|avif|mp4|m4v|webm|mov|wav|mp3|m4a|ogg)$/i;
const bad = message => new Error(message);
let connecting;

function connection() {
  if (connecting) return connecting;
  const opening = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(bad(t('storageUnavailable'))); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const days = db.createObjectStore(STORE, {keyPath:'id'});
      days.createIndex('date', 'date');
    };
    req.onblocked = () => { reject(bad(t('otherTabs'))); };
    req.onerror = () => reject(bad(t('openError')));
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); connecting = undefined; };
      db.onclose = () => { connecting = undefined; };
      resolve(db);
    };
  });
  connecting = opening;
  opening.catch(() => { if (connecting === opening) connecting = undefined; });
  return opening;
}
async function read(method, ...args) {
  const db = await connection();
  return new Promise((resolve,reject) => {
    const req = db.transaction(STORE).objectStore(STORE)[method](...args);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(bad(t('openError')));
  });
}

export async function listDays() {
  const rows = await read('getAll');
  return rows.map(decodeDay).sort((a,b) => b.date.localeCompare(a.date) || Number(b.primary) - Number(a.primary) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
export async function getDay(id) { return decodeDay(await read('get',id)); }

async function write(fn, commit = true, date) {
  const db = await connection();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE, commit ? 'readwrite' : 'readonly');
    const store = tx.objectStore(STORE);
    const req = date ? store.index('date').getAll(date) : store.getAll();
    let result, err;
    req.onsuccess = () => {
      try { result = fn(new Map(req.result.map(row => [row.id,row])), store); }
      catch (e) { err=e; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => {
      const e = err || tx.error;
      reject(e?.name === 'QuotaExceededError' ? bad(t('lowStorage')) : err || bad(t('saveError')));
    };
  });
}

function validateDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms = Date.parse(date+'T12:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10) === date;
}
function validId(id) {
  return typeof id === 'string' && /^[a-z\d][\w.:-]{0,149}$/i.test(id);
}
function validUrl(value) {
  try {
    const url = new URL(value);
    return typeof value === 'string' && value.length <= 4096 && url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}
function safeTree(value, depth=0, budget={n:0}) {
  if (++budget.n > 55000 || depth > 14) throw bad(t('complexData'));
  if (value == null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value === 'string' && value.length <= 160000) return;
  if (value instanceof Blob) return;
  if (Array.isArray(value) && value.length <= 4000) { for (const item of value) safeTree(item,depth+1,budget); return; }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length <= 250) {
    for (const [key,item] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key) || key.length > 120) throw bad(t('invalidField'));
      safeTree(item,depth+1,budget);
    }
    return;
  }
  throw bad(t('invalidContents'));
}
function baseMime(raw) {
  return String(raw || '').toLowerCase().split(';')[0].trim();
}
export function isGalleryVideo(asset) {
  const mime = baseMime(asset?.blob?.type || asset?.mediaType);
  if (mime && mime !== 'application/octet-stream') return mime.startsWith('video/');
  if (asset?.kind) return asset.kind === 'video';
  return /\.(?:mp4|m4v|webm|mov)$/i.test(asset?.archiveFile || asset?.src || asset?.name || '');
}
function galleryKind(asset) { return isGalleryVideo(asset) ? 'video' : 'photo'; }
function mediaLimit(kind) {
  return kind === 'video' ? MAX_VIDEO : kind === 'photo' ? MAX_IMAGE : MAX_AUDIO;
}
function mediaType(raw, name, kind) {
  let mime = baseMime(raw);
  if (mime === 'video/x-m4v' || mime === 'video/m4v') mime = 'video/mp4';
  if (!mime || mime === 'application/octet-stream') mime = ({
    jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', png:'image/png', heic:'image/heic',heif:'image/heif',avif:'image/avif',gif:'image/gif',
    mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:kind==='audio'?'audio/webm':'video/webm',
    wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',flac:'audio/flac'
  })[String(name).split('.').pop().toLowerCase()];
  const allowed = kind === 'video' ? videoTypes : kind === 'photo' ? imageTypes : audioTypes;
  if (!allowed.has(mime)) throw bad(t(kind === 'video' ? 'videoFormat' : kind === 'photo' ? 'imageFormat' : 'audioFormat'));
  return mime;
}
function checkAsset(asset, kind) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw bad(t('mediaMissing'));
  if (typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length>1000) throw bad(t('mediaName'));
  if (kind !== 'audio' && asset.kind != null && asset.kind !== kind) throw bad(t('invalidContents'));
  if (asset.blob instanceof Blob) {
    if (!asset.blob.size || asset.blob.size > mediaLimit(kind)) throw bad(t('mediaSize'));
    mediaType(asset.blob.type,asset.name || asset.src,kind);
  } else if (!DEMO_PATH.test(asset.src || '')) { throw bad(t('localFileMissing')); }
  if (asset.src != null && !DEMO_PATH.test(asset.src)) throw bad(t('mediaUrl'));
}
function checkRecord(row, partial=false) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw bad(t('invalidEntry'));
  if ((!partial || row.date != null) && !validateDate(row.date)) throw bad(t('invalidDate'));
  if (!partial && !validId(row.id)) throw bad(t('invalidId'));
  if ((!partial || row.status != null) && !['draft','ready'].includes(row.status)) throw bad(t('unknownStatus'));
  for (const key of ['text','title','caption','titleOverride','captionOverride','linkDraft']) {
    if (row[key] != null && typeof row[key] !== 'string') throw bad(t('textField'));
  }
  if (row.photos != null) {
    if (!Array.isArray(row.photos) || row.photos.length > 6) throw bad(t('photoLimit'));
    for (const item of row.photos) {
      const kind=galleryKind(item);
      checkAsset(item,kind);
      if (item.caption != null && (typeof item.caption!=='string' || item.caption.length>220)) throw bad(t('textField'));
      if (item.music != null) {
        if (kind!=='photo' || item.music.kind!=='file') throw bad(t('invalidContents'));
        checkAsset(item.music,'audio');
      }
    }
  }
  if (row.music != null) {
    if (row.music.kind === 'file') checkAsset(row.music,'audio');
    else if (row.music.kind !== 'link' || !validUrl(row.music.url)) throw bad(t('musicUrl'));
  }
  if (row.status === 'ready' && (!row.text?.trim() || !row.photos?.length || (!row.music && !row.photos.some(photo=>photo.music)))) {
    throw bad(t('requiredContent'));
  }
  if (row.moments != null && (!Array.isArray(row.moments) || row.moments.some(m => !m || typeof m.text !== 'string'))) throw bad(t('invalidMoments'));
  if (row.pendingEdit != null) {
    if (partial) throw bad(t('nestedVersions'));
    checkRecord(row.pendingEdit,true);
  }
}
async function normalizeRecord(input) {
  const row = structuredClone(input);
  delete row._removedNotes;
  if (row.pendingEdit) clearNoteMetadata(row.pendingEdit);
  // Blob content is immutable. Keep its object identity so frequent text autosaves can
  // reuse the digest of a large attachment, without sharing mutable record fields.
  function retainBlobs(copy,source) {
    copy.photos?.forEach((photo,index)=>{
      const original=source.photos[index];
      if (original?.blob instanceof Blob) photo.blob=original.blob;
      if (original?.music?.blob instanceof Blob) photo.music.blob=original.music.blob;
    });
    if (source.music?.blob instanceof Blob && copy.music) copy.music.blob=source.music.blob;
    if (copy.pendingEdit && source.pendingEdit) retainBlobs(copy.pendingEdit,source.pendingEdit);
  }
  retainBlobs(row,input);
  row.id ||= crypto.randomUUID();
  row.status ||= 'draft';
  row.text ??= '';
  row.photos ??= [];
  row.moments ??= [];
  row.music ??= null;
  safeTree(row);
  checkRecord(row);
  for (const gallery of [row.photos,row.pendingEdit?.photos]) {
    if (gallery && await galleryBytes(gallery) > MAX_GALLERY_BYTES) throw bad(t('gallerySize'));
  }
  return row;
}
function digest(bytes) {
  return crypto.subtle.digest('SHA-256',bytes).then(buf=>Array.from(new Uint8Array(buf),n=>n.toString(16).padStart(2,'0')).join(''));
}
function getBlobHash(blob) {
  let hash=blobHashes.get(blob);
  if (!hash) { hash=bytesOf(blob).then(digest); blobHashes.set(blob,hash); }
  return hash;
}
function bytesOf(blob) {
  let bytes=blobBytes.get(blob);
  if (!bytes) { bytes=blob.arrayBuffer(); blobBytes.set(blob,bytes); }
  return bytes;
}
export async function localAsset(asset, kind) {
  if (kind === 'photo') kind=galleryKind(asset);
  if (asset.blob instanceof Blob) {
    const blob=asset.blob, type=mediaType(blob.type,asset.name,kind);
    return blob.type === type ? blob : blob.slice(0,blob.size,type);
  }
  if (!DEMO_PATH.test(asset.src || '')) throw bad(t('unavailableFile'));
  const src=asset.src.replace(/^(?:\.\/|\/)/,'');
  const key=kind+':'+src;
  let promise = demoFiles.get(key);
  if (!promise) {
    promise = (async () => {
      const url=new URL(src,document.baseURI);
      const response=await fetch(url).catch(()=>null);
      if (!response?.ok) throw bad(t('sourceFile'));
      const blob=await response.blob();
      const type=mediaType(blob.type,src,kind);
      if (!blob.size || blob.size > mediaLimit(kind)) throw bad(t('mediaUnavailable'));
      return blob.type === type ? blob : blob.slice(0,blob.size,type);
    })();
    demoFiles.set(key,promise);
    promise.catch(()=>demoFiles.delete(key));
  }
  return promise;
}
export async function galleryBytes(photos) {
  const sizeOf=async (asset,kind)=>asset.blob instanceof Blob ? asset.blob.size : (await localAsset(asset,kind)).size;
  const sizes=await Promise.all(photos.flatMap(photo=>[
    sizeOf(photo,galleryKind(photo)),
    ...(photo.music?.kind==='file' ? [sizeOf(photo.music,'audio')] : [])
  ]));
  return sizes.reduce((total,size)=>total+size,0);
}
async function mapMedia(row, transform) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw bad(t('invalidEntry'));
  if (row.photos != null && (!Array.isArray(row.photos) || row.photos.length>6)) throw bad(t('photoLimit'));
  const out={...row};
  if (out.photos) out.photos=await Promise.all(out.photos.map(async asset=>{
    const item=await transform(asset,galleryKind(asset));
    return asset.music?.kind==='file' ? {...item,music:await transform(asset.music,'audio')} : item;
  }));
  if (out.music?.kind === 'file') out.music=await transform(out.music,'audio');
  if (out.pendingEdit) out.pendingEdit=await mapMedia(out.pendingEdit,transform);
  return out;
}
// WebKit's private storage sessions may reject Blob/File in IndexedDB even when
// normal writes work. Store immutable bytes and MIME together, restore Blob at
// the API boundary. Existing entries with native Blob values remain readable.
function encodeDay(row) {
  return mapMedia(row,async (asset,kind)=>{
    if (!(asset.blob instanceof Blob)) return asset;
    const {blob,...meta}=asset;
    return {...meta,_bytes:await bytesOf(blob),_fileType:mediaType(blob.type,asset.name,kind)};
  });
}
function decodeDay(row) {
  if (!row) return row;
  function decode(asset) {
    if (!(asset?._bytes instanceof ArrayBuffer)) return asset;
    const {_bytes,_fileType,...meta}=asset;
    const blob=new Blob([_bytes],{type:_fileType});
    return {...meta,blob};
  }
  const day={...row};
  delete day._removedNotes;
  if (day.photos) day.photos=day.photos.map(asset=>{
    const photo=decode(asset);
    return photo.music?.kind==='file' ? {...photo,music:decode(photo.music)} : photo;
  });
  if (day.music?.kind==='file') day.music=decode(day.music);
  if (day.pendingEdit) day.pendingEdit=decodeDay(day.pendingEdit);
  return day;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));
}
async function contentHash(row) {
  const change=await mapMedia(row, async (asset,kind)=>{
    const {src,blob,...rest}=asset;
    const bytes=await localAsset(asset,kind);
    if (kind==='video') rest.mediaType=bytes.type;
    return {...rest, mediaHash:await getBlobHash(bytes)};
  });
  for (const key of storageKeys) delete change[key];
  delete change.id;
  return digest(strToU8(JSON.stringify(canonical(change))));
}
function nextPrimary(date, rows, store) {
  const remaining=Array.from(rows.values()).filter(item=>item.date===date);
  if (!remaining.length || remaining.some(item=>item.primary)) return;
  const next=remaining.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.id.localeCompare(b.id))[0];
  next.primary=true;
  store.put(next);
}
function momentKey(moment) {
  return moment.id || JSON.stringify([moment.time || '',moment.text]);
}
function mergeMoments(...lists) {
  const unique=new Map();
  for (const list of lists) {
    for (const moment of list || []) {
      const key=momentKey(moment);
      if (!unique.has(key)) unique.set(key,moment);
    }
  }
  return [...unique.values()].sort((a,b)=>(Date.parse(a.time) || 0)-(Date.parse(b.time) || 0));
}
// Earlier versions saved notes added to a completed postcard only in its pending edit.
export function visibleDayNotes(day) {
  return mergeMoments(day?.moments,day?.pendingEdit?.moments);
}
function attachMoments(day,moments) {
  day.moments=moments;
  if (day.pendingEdit) day.pendingEdit={...day.pendingEdit,moments};
}
function clearNoteMetadata(day) {
  delete day._noteSeed;
  delete day._removedNotes;
}
function noteHash(note) { return digest(strToU8(momentKey(note))); }
function sameVersion(a,b) {
  const left=a?._removedNotes || [], right=b?._removedNotes || [];
  return a?.id===b?.id && a?.revision===b?.revision && a?._contentHash===b?._contentHash &&
    a?._noteSeed===b?._noteSeed && left.length===right.length && left.every((hash,i)=>hash===right[i]);
}
// Old quick-note drafts have no seed marker. Recognize the simple, untouched
// draft the old capture form created. Editor autosaves also carry musicMode.
function legacySeed(day) {
  if (day?.status!=='draft' || !day.revision || Object.hasOwn(day,'_noteSeed') || day.musicMode ||
      day.title || day.caption || day.photos?.length || day.music || !day.text) return;
  return visibleDayNotes(day).find(note=>note.text===day.text);
}
export async function saveDay(input) {
  const submitted=await normalizeRecord(input);
  const incoming=visibleDayNotes(submitted);
  let hashes;
  const oldSeed=legacySeed(submitted);
  const submittedSeed=submitted._noteSeed || (oldSeed && await noteHash(oldSeed));
  for (;;) {
    const current=await read('get',submitted.id);
    const day={...submitted};
    const removed=new Set(current?._removedNotes);
    if (removed.size && !hashes) {
      hashes=new Map(await Promise.all(incoming.map(async note=>[momentKey(note),await noteHash(note)])));
    }
    const retained=removed.size ? incoming.filter(note=>!removed.has(hashes.get(momentKey(note)))) : incoming;
    attachMoments(day,mergeMoments(retained,visibleDayNotes(current)));
    // An editor may autosave its original snapshot several times after a note
    // was removed. Only replace text that still matches its automatic seed.
    const seed=submittedSeed || (!Object.hasOwn(submitted,'_noteSeed') && current?._noteSeed);
    if (day.status==='draft' && seed && removed.has(seed) &&
        incoming.some(note=>hashes.get(momentKey(note))===seed && note.text===day.text)) {
      day.text=current?.status==='draft' ? current.text : '';
    }
    const prior=current || submitted;
    const priorLegacy=legacySeed(prior);
    day._noteSeed=day.status==='draft' && day.text===prior.text
      ? prior._noteSeed || (priorLegacy && await noteHash(priorLegacy)) || null : null;
    safeTree(day);
    const [checksum,row]=await Promise.all([contentHash(day),encodeDay(day)]);
    const result=await write((rows,store)=>{
      const latest=rows.get(row.id);
      if (!sameVersion(latest,current)) return;
      const conflict=latest && (latest.revision || 0) !== (row.revision || 0);
      if (conflict && latest._contentHash===checksum) return latest;
      if (conflict) row.id=crypto.randomUUID();
      const sameDate=Array.from(rows.values()).filter(other=>other.id!==row.id && other.date===row.date);
      row.primary=!conflict && (latest?.date===row.date ? latest.primary : !sameDate.some(other=>other.primary));
      if (!sameDate.length) row.primary=true;
      row.revision=(conflict ? 0 : latest?.revision || 0)+1;
      row.updatedAt=new Date().toISOString();
      row._contentHash=checksum;
      if (latest?._removedNotes?.length) row._removedNotes=latest._removedNotes;
      store.put(row);
      rows.set(row.id,row);
      if (latest && !conflict && latest.date!==row.date && latest.primary) nextPrimary(latest.date,rows,store);
      return row;
    });
    if (result) return decodeDay(result);
  }
}
export async function appendDayMoment(blank,moment) {
  const seed=await normalizeRecord(blank);
  if (!validId(moment?.id) || typeof moment.text!=='string' || !moment.text.trim() ||
      moment.text.length>1200 || !Number.isFinite(Date.parse(moment.time))) throw bad(t('invalidMoments'));
  const key=await noteHash(moment);
  const primary=rows=>Array.from(rows.values()).find(day=>day.date===seed.date && day.primary!==false);
  for (;;) {
    const current=await write(rows=>primary(rows),false,seed.date);
    const day=current ? decodeDay(current) : {...seed};
    const notes=visibleDayNotes(day);
    if(current?._removedNotes?.includes(key) || notes.some(note=>note.id===moment.id)) return day;
    if (!Object.hasOwn(day,'_noteSeed')) {
      const previous=legacySeed(day);
      day._noteSeed=previous ? await noteHash(previous) : null;
    }
    attachMoments(day,mergeMoments(notes,[moment]));
    if(day.status==='draft' && !day.text?.trim()) {
      day.text=moment.text;
      day._noteSeed=key;
    }
    safeTree(day);checkRecord(day);
    const [hash,row]=await Promise.all([contentHash(day),encodeDay(day)]);
    const saved=await write((rows,store)=>{
      const latest=primary(rows);
      if (!sameVersion(latest,current)) return null;
      // A note is additive. An open editor keeps its valid revision and saveDay
      // merges the note with its next content change.
      row.primary=true;row.revision=current?.revision || 1;
      if (latest?._removedNotes?.length) row._removedNotes=latest._removedNotes;
      row.updatedAt=new Date().toISOString();row._contentHash=hash;
      store.put(row);
      return row;
    },true,seed.date);
    if(saved) return decodeDay(saved);
  }
}
async function changeDayNote(id,note,restore) {
  const key=momentKey(note), hash=await noteHash(note);
  for (;;) {
    const current=await read('get',id);
    if (!current) return restore ? false : null;
    const day=decodeDay(current);
    const notes=visibleDayNotes(day);
    const existing=notes.find(item=>momentKey(item)===key);
    if (restore && existing) return true;
    if (!restore && !existing) return null;
    const oldSeed=legacySeed(day);
    if (oldSeed) day._noteSeed=await noteHash(oldSeed);
    attachMoments(day,restore ? mergeMoments(notes,[note]) : notes.filter(item=>momentKey(item)!==key));
    if (day.status==='draft' && day._noteSeed===hash) {
      if (!restore && day.text===existing.text) day.text='';
      if (restore && day.text==='') day.text=note.text;
    }
    safeTree(day);checkRecord(day);
    const [checksum,row]=await Promise.all([contentHash(day),encodeDay(day)]);
    const saved=await write((rows,store)=>{
      const latest=rows.get(id);
      if (!sameVersion(latest,current)) return false;
      // Keep only opaque identities locally so old editor saves cannot restore
      // removed notes. Undo merges a single note and forgets its tombstone.
      const removed=new Set(latest._removedNotes);
      if (restore) removed.delete(hash); else removed.add(hash);
      if (removed.size) row._removedNotes=[...removed];
      row.primary=latest.primary;
      row._contentHash=checksum;
      row.updatedAt=new Date().toISOString();
      store.put(row);
      return true;
    },true,current.date);
    if (saved) return restore ? true : existing;
  }
}
export function removeDayNote(id,note) { return changeDayNote(id,note,false); }
export function restoreDayNote(id,note) { return changeDayNote(id,note,true); }
export async function removeDay(id) {
  return decodeDay(await write((rows,store)=>{
    const removed=rows.get(id);
    if (removed) {
      store.delete(id); rows.delete(id);
      if (removed.primary) nextPrimary(removed.date,rows,store);
    }
    return removed;
  }));
}
export async function makePrimary(id) {
  return decodeDay(await write((rows,store)=>{
    const current=rows.get(id);
    if (!current) throw bad(t('alreadyDeleted'));
    for (const record of rows.values()) if (record.date===current.date && record.primary !== (record.id===id)) {
      record.primary=record.id===id;
      store.put(record);
    }
    return current;
  }));
}

function extension(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime.startsWith('image/')) return mime.slice(6).split('-')[0];
  if (mime.startsWith('video/')) return mime === 'video/quicktime' ? 'mov' : mime.slice(6);
  if (mime.includes('wav') || mime.includes('wave')) return 'wav';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return 'mp3';
  return mime.split('/').pop().replace(/^x-/,'');
}
function folderName(record,index) {
  const short=String(record.title || (record.status==='draft'?t('draft'):t('day'))).normalize('NFC').replace(/[^\p{L}\p{N} -]+/gu,'').trim().slice(0,44) || t('day');
  return 'days/'+record.date+'-'+String(index+1).padStart(4,'0')+'-'+short;
}
export async function exportZip(records) {
  if (!Array.isArray(records) || records.length>MAX_DAYS) throw bad(t('backupDays'));
  const files=Object.create(null), days=[];
  let total=0, entries=0;
  function append(path,bytes) {
    total+=bytes.byteLength;
    if (++entries>MAX_FILES || total+entries*256>MAX_ARCHIVE) throw bad(t('backupSize'));
    files[path]=bytes;
  }
  for (const [index,input] of records.entries()) {
    const record=await normalizeRecord(input);
    const folder=folderName(record,index);
    const media=new Map();
    let number=0;
    const out=await mapMedia(record,async (asset,kind)=>{
      const bytes=await localAsset(asset,kind);
      const hash=await getBlobHash(bytes);
      const type=mediaType(bytes.type,asset.name || asset.src,kind);
      const key=type+':'+hash;
      let name=media.get(key);
      if (!name) {
        name='media/'+String(++number).padStart(2,'0')+'-'+kind+'.'+extension(type);
        media.set(key,name);
        append(folder+'/'+name,new Uint8Array(await bytesOf(bytes)));
      }
      const {src,blob,...meta}=asset;
      return {...meta, archiveFile:name, mediaType:type};
    });
    clearNoteMetadata(out);
    delete out._contentHash;
    const json=strToU8(JSON.stringify(out));
    if (json.length>MAX_JSON) throw bad(t('textSize'));
    const path=folder+'/day.json';
    append(path,json);
    days.push({id:record.id,date:record.date,title:record.title || '',path});
  }
  append('manifest.json',strToU8(JSON.stringify({format:'nolimit-diary',version:1,days})));
  // The media already have their own compression. Stored files are quick to reopen on a phone.
  return new Blob([zipSync(files,{level:0})],{type:'application/zip'});
}

const crcTable=Uint32Array.from({length:256},(_,n)=>{
  let c=n;
  for (let i=0;i<8;i++) c=(c & 1) ? 0xedb88320^(c>>>1) : c>>>1;
  return c>>>0;
});
function crc32(bytes) {
  let c=0xffffffff;
  for (let i=0;i<bytes.length;i++) c=(c>>>8)^crcTable[(c^bytes[i])&255];
  return (c^0xffffffff)>>>0;
}
function indexZip(bytes) {
  const error=()=>bad(t('invalidArchive'));
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const end=bytes.length-22;
  // The app creates single-volume, ordinary ZIP files with no archive comment or encryption.
  if (end<0 || view.getUint32(end,true)!==0x06054b50 || view.getUint16(end+4,true) || view.getUint16(end+6,true)) throw error();
  const count=view.getUint16(end+10,true);
  let offset=view.getUint32(end+16,true);
  if (!count || count>MAX_FILES || view.getUint16(end+8,true)!==count || offset+view.getUint32(end+12,true)!==end) throw error();
  const centralStart=offset;
  const index=new Map();
  let total=0;
  for (let i=0;i<count;i++) {
    if (offset+46>end || view.getUint32(offset,true)!==0x02014b50) throw error();
    const flags=view.getUint16(offset+8,true), method=view.getUint16(offset+10,true);
    const packed=view.getUint32(offset+20,true), size=view.getUint32(offset+24,true);
    const nameSize=view.getUint16(offset+28,true), extra=view.getUint16(offset+30,true), comment=view.getUint16(offset+32,true);
    const local=view.getUint32(offset+42,true);
    const nameEnd=offset+46+nameSize;
    const next=nameEnd+extra+comment;
    if (flags & 1 || ![0,8].includes(method) || !nameSize || nameSize>600 || next>end || local+30>centralStart || view.getUint32(local,true)!==0x04034b50) throw error();
    const name=strFromU8(bytes.subarray(offset+46,nameEnd));
    if (name!=='manifest.json' && !/^days\/[\p{L}\p{N} -]+\/(?:day\.json|media\/[\da-z.-]+)$/u.test(name)) throw error();
    if (index.has(name) || (name.endsWith('.json') ? size>MAX_JSON : size>MAX_VIDEO) || (total+=size)>MAX_ARCHIVE) throw error();
    const localNameSize=view.getUint16(local+26,true), localExtra=view.getUint16(local+28,true);
    const dataStart=local+30+localNameSize+localExtra;
    if (localNameSize!==nameSize || strFromU8(bytes.subarray(local+30,local+30+localNameSize))!==name || dataStart+packed>centralStart ||
        (method===0 && size!==packed)) throw error();
    index.set(name,{size,crc:view.getUint32(offset+16,true)});
    offset=next;
  }
  if (offset!==end || !index.has('manifest.json')) throw error();
  return index;
}
function parseJson(bytes) {
  try { return JSON.parse(strFromU8(bytes)); }
  catch { throw bad(t('backupText')); }
}
export async function inspectZip(file) {
  if (!(file instanceof Blob) || !file.size || file.size>MAX_ARCHIVE) throw bad(t('chooseZip'));
  const buffer=new Uint8Array(await file.arrayBuffer());
  let files, index;
  try {
    index=indexZip(buffer);
    files=unzipSync(buffer);
    for (const [path,entry] of index) {
      const bytes=files[path];
      if (!bytes || bytes.length!==entry.size || crc32(bytes)!==entry.crc) throw bad(t('damagedFiles'));
    }
  } catch (e) { throw bad(t('openZip')); }
  const manifest=parseJson(files['manifest.json']);
  if (!manifest || manifest.format!=='nolimit-diary' || manifest.version!==1 || !Array.isArray(manifest.days) || manifest.days.length>MAX_DAYS) throw bad(t('backupVersion'));
  const records=[], ids=new Set(), seenPaths=new Set(['manifest.json']);
  for (const item of manifest.days) {
    if (!item || !validId(item.id) || ids.has(item.id) || !validateDate(item.date) || typeof item.path!=='string' ||
      !item.path.startsWith('days/'+item.date+'-') || !item.path.endsWith('/day.json') || !Object.hasOwn(files,item.path) || seenPaths.has(item.path)) throw bad(t('invalidDays'));
    seenPaths.add(item.path); ids.add(item.id);
    const raw=parseJson(files[item.path]);
    safeTree(raw);
    if (raw?.id!==item.id || raw?.date!==item.date) throw bad(t('entryMismatch'));
    const folder=item.path.slice(0,-'day.json'.length);
    const assets=new Map();
    const record=await mapMedia(raw,async (asset,kind)=>{
      if (!asset || typeof asset.archiveFile!=='string' || !/^media\/[\da-z.-]+$/.test(asset.archiveFile) || asset.src || asset.blob) throw bad(t('attachmentMissing'));
      const full=folder+asset.archiveFile;
      const bytes=files[full];
      if (!bytes || !bytes.length || bytes.length>mediaLimit(kind)) throw bad(t('attachmentRestore'));
      seenPaths.add(full);
      const mime=mediaType(asset.mediaType,full,kind);
      const key=full+':'+mime;
      if (!assets.has(key)) assets.set(key,new Blob([bytes],{type:mime}));
      const {mediaType:rawType,archiveFile,...meta}=asset;
      return {...meta,blob:assets.get(key)};
    });
    clearNoteMetadata(record);
    delete record._contentHash;
    if (record._originId && !validId(record._originId)) delete record._originId;
    const row=await normalizeRecord(record);
    row._contentHash=await contentHash(row);
    records.push(row);
  }
  if (seenPaths.size!==index.size) throw bad(t('unexpectedFiles'));
  return records;
}
async function merge(records, commit) {
  if (!Array.isArray(records) || records.length>MAX_DAYS) throw bad(t('tooManyEntries'));
  const validated=[];
  for (const input of records) {
    const row=await normalizeRecord(input);
    clearNoteMetadata(row);
    row._contentHash=await contentHash(row);
    validated.push(await encodeDay(row));
  }
  // On a new device honour the author's primary version independently of manifest order.
  validated.sort((a,b)=>Number(Boolean(b.primary))-Number(Boolean(a.primary)));
  return write((rows,store)=>{
    const result={added:0,skipped:0,conflicts:0};
    for (const row of validated) {
      const originalId=row.id;
      const existing=rows.get(row.id);
      const duplicate=Array.from(rows.values()).some(r=>(r.id===originalId || r._originId===originalId) && r._contentHash===row._contentHash);
      if (duplicate) { result.skipped++; continue; }
      const hasDate=Array.from(rows.values()).some(r=>r.date===row.date && r.primary);
      if (existing) { row.id=crypto.randomUUID(); row._originId=originalId; }
      if (existing || hasDate) result.conflicts++;
      row.primary=!hasDate;
      row.revision=1;
      row.updatedAt=typeof row.updatedAt==='string' && Number.isFinite(Date.parse(row.updatedAt)) ? row.updatedAt : new Date().toISOString();
      rows.set(row.id,row);
      if (commit) store.add(row);
      result.added++;
    }
    return result;
  },commit);
}
export function assessImport(records) { return merge(records,false); }
export function importDays(records) { return merge(records,true); }
