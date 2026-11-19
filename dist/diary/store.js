// Device-local diary. Writes commit as one transaction, including all date/version changes.
import { zipSync, unzipSync, strToU8, strFromU8 } from './vendor/fflate-0.8.2.js';

const DB_NAME = 'nolimit-arttech-diary';
const STORE = 'days';
const MIB = 1024 * 1024;
const MAX_ARCHIVE = 240 * MIB;
const MAX_DAYS = 1500;
const MAX_FILES = 12000;
const MAX_JSON = 2 * MIB;
const MAX_IMAGE = 12 * MIB;
const MAX_AUDIO = 25 * MIB;
const blobHashes = new WeakMap();
const blobBytes = new WeakMap();
const demoFiles = new Map();
const storageKeys = new Set(['revision','updatedAt','primary','_contentHash','_originId']);
const imageTypes = new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif','image/heic-sequence','image/heif-sequence','image/avif','image/gif']);
const audioTypes = new Set(['audio/mpeg','audio/mp3','audio/aac','audio/mp4','audio/x-m4a','audio/m4a','audio/wav','audio/wave','audio/x-wav','audio/vnd.wave','audio/ogg','audio/webm','audio/flac','audio/x-flac']);
const DEMO_PATH = /^(?:\.\/|\/)?diary\/media\/[a-z\d][\w.-]{0,100}\.(?:jpe?g|png|webp|avif|wav|mp3|m4a|ogg)$/i;
const bad = message => new Error(message);
let connecting;

function connection() {
  if (connecting) return connecting;
  const opening = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(bad('Хранилище браузера недоступно. Откройте дневник в обычной вкладке.')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const days = db.createObjectStore(STORE, {keyPath:'id'});
      days.createIndex('date', 'date');
    };
    req.onblocked = () => { reject(bad('Закройте другие вкладки дневника и попробуйте ещё раз.')); };
    req.onerror = () => reject(req.error || bad('Не удалось открыть дневник.'));
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
    req.onerror = () => reject(req.error);
  });
}

export async function listDays() {
  const rows = await read('getAll');
  return rows.map(decodeDay).sort((a,b) => b.date.localeCompare(a.date) || Number(b.primary) - Number(a.primary) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
export async function getDay(id) { return decodeDay(await read('get',id)); }

async function write(fn, commit = true) {
  const db = await connection();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE, commit ? 'readwrite' : 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    let result, err;
    req.onsuccess = () => {
      try { result = fn(new Map(req.result.map(row => [row.id,row])), store); }
      catch (e) { err=e; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => {
      const e = err || tx.error;
      reject(e?.name === 'QuotaExceededError' ? bad('На устройстве мало места. Скачайте копию сохранённых дней или выберите меньший файл.') : e || bad('Не удалось сохранить изменения.'));
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
  if (++budget.n > 55000 || depth > 14) throw bad('Слишком сложные данные дня.');
  if (value == null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value === 'string' && value.length <= 160000) return;
  if (value instanceof Blob) return;
  if (Array.isArray(value) && value.length <= 4000) { for (const item of value) safeTree(item,depth+1,budget); return; }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length <= 250) {
    for (const [key,item] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key) || key.length > 120) throw bad('Некорректное поле дневника.');
      safeTree(item,depth+1,budget);
    }
    return;
  }
  throw bad('Некорректное содержимое дневника.');
}
function mediaType(raw, name, kind) {
  let mime = String(raw || '').toLowerCase().split(';')[0].trim();
  if (!mime || mime === 'application/octet-stream') mime = ({
    jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', png:'image/png', heic:'image/heic',heif:'image/heif',avif:'image/avif',gif:'image/gif',
    wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',flac:'audio/flac',webm:'audio/webm'
  })[String(name).split('.').pop().toLowerCase()];
  const allowed = kind === 'photo' ? imageTypes : audioTypes;
  if (!allowed.has(mime)) throw bad(kind === 'photo' ? 'Неподдерживаемый формат фотографии.' : 'Неподдерживаемый формат аудио.');
  return mime;
}
function checkAsset(asset, kind) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw bad('Медиафайл не найден.');
  if (typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length>1000) throw bad('Некорректное название медиафайла.');
  if (asset.blob instanceof Blob) {
    if (!asset.blob.size || asset.blob.size > (kind === 'photo' ? MAX_IMAGE : MAX_AUDIO)) throw bad('Медиафайл пуст или слишком велик.');
    mediaType(asset.blob.type,asset.name || asset.src,kind);
  } else if (!DEMO_PATH.test(asset.src || '')) { throw bad('Отсутствует локальный медиафайл.'); }
  if (asset.src != null && !DEMO_PATH.test(asset.src)) throw bad('Некорректный адрес медиафайла.');
}
function checkRecord(row, partial=false) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw bad('Некорректная запись дня.');
  if ((!partial || row.date != null) && !validateDate(row.date)) throw bad('Некорректная дата дня.');
  if (!partial && !validId(row.id)) throw bad('Некорректный идентификатор дня.');
  if ((!partial || row.status != null) && !['draft','ready'].includes(row.status)) throw bad('Неизвестный статус дня.');
  for (const key of ['text','title','caption','titleOverride','captionOverride','linkDraft']) {
    if (row[key] != null && typeof row[key] !== 'string') throw bad('Некорректное текстовое поле.');
  }
  if (row.photos != null) {
    if (!Array.isArray(row.photos) || row.photos.length > 6) throw bad('В одном дне может быть до шести фотографий.');
    for (const photo of row.photos) checkAsset(photo,'photo');
  }
  if (row.music != null) {
    if (row.music.kind === 'file') checkAsset(row.music,'audio');
    else if (row.music.kind !== 'link' || !validUrl(row.music.url)) throw bad('Для песни нужна корректная HTTPS-ссылка.');
  }
  if (row.status === 'ready' && (!row.text?.trim() || !row.photos?.length || !row.music)) {
    throw bad('В готовом дне должны быть запись, фотография и песня.');
  }
  if (row.moments != null && (!Array.isArray(row.moments) || row.moments.some(m => !m || typeof m.text !== 'string'))) throw bad('Некорректные заметки дня.');
  if (row.pendingEdit != null) {
    if (partial) throw bad('Некорректная вложенность версий.');
    checkRecord(row.pendingEdit,true);
  }
}
function normalizeRecord(input) {
  const row = structuredClone(input);
  // Blob content is immutable. Keep its object identity so frequent text autosaves can
  // reuse the digest of a large attachment, without sharing mutable record fields.
  function retainBlobs(copy,source) {
    copy.photos?.forEach((photo,index)=>{ if (source.photos[index]?.blob instanceof Blob) photo.blob=source.photos[index].blob; });
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
async function localAsset(asset, kind) {
  if (asset.blob instanceof Blob) return asset.blob;
  if (!DEMO_PATH.test(asset.src || '')) throw bad('Один из файлов недоступен.');
  const src=asset.src.replace(/^(?:\.\/|\/)/,'');
  let promise = demoFiles.get(src);
  if (!promise) {
    promise = (async () => {
      const url=new URL(src,document.baseURI);
      const response=await fetch(url);
      if (!response.ok) throw bad('Не удалось загрузить исходный файл. Откройте пример при подключённой сети.');
      const blob=await response.blob();
      const type=mediaType(blob.type,src,kind);
      if (!blob.size || blob.size > (kind==='photo' ? MAX_IMAGE : MAX_AUDIO)) throw bad('Медиафайл недоступен.');
      return blob.type === type ? blob : blob.slice(0,blob.size,type);
    })();
    demoFiles.set(src,promise);
    promise.catch(()=>demoFiles.delete(src));
  }
  return promise;
}
async function mapMedia(row, transform) {
  const out={...row};
  if (out.photos) out.photos=await Promise.all(out.photos.map(photo=>transform(photo,'photo')));
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
  if (day.photos) day.photos=day.photos.map(decode);
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
export async function saveDay(input) {
  const normalized=normalizeRecord(input);
  const [checksum,row]=await Promise.all([contentHash(normalized),encodeDay(normalized)]);
  const saved=await write((rows,store)=>{
    const current=rows.get(row.id);
    const conflict=current && (current.revision || 0) !== (row.revision || 0);
    if (conflict && current._contentHash===checksum) return current;
    if (conflict) row.id=crypto.randomUUID();
    const sameDate=Array.from(rows.values()).filter(other=>other.id!==row.id && other.date===row.date);
    row.primary=!conflict && (current?.date===row.date ? current.primary : !sameDate.some(other=>other.primary));
    if (!sameDate.length) row.primary=true;
    row.revision=(conflict ? 0 : current?.revision || 0)+1;
    row.updatedAt=new Date().toISOString();
    row._contentHash=checksum;
    store.put(row);
    rows.set(row.id,row);
    if (current && !conflict && current.date!==row.date && current.primary) nextPrimary(current.date,rows,store);
    return row;
  });
  return decodeDay(saved);
}
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
    if (!current) throw bad('Запись уже удалена.');
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
  if (mime.includes('wav') || mime.includes('wave')) return 'wav';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return 'mp3';
  return mime.split('/').pop().replace(/^x-/,'');
}
function folderName(record,index) {
  const short=String(record.title || (record.status==='draft'?'Черновик':'День')).normalize('NFC').replace(/[^\p{L}\p{N} -]+/gu,'').trim().slice(0,44) || 'День';
  return 'days/'+record.date+'-'+String(index+1).padStart(4,'0')+'-'+short;
}
export async function exportZip(records) {
  if (!Array.isArray(records) || records.length>MAX_DAYS) throw bad('Для одной копии доступно до 1500 дней. Экспортируйте дни отдельно.');
  const files=Object.create(null), days=[];
  let total=0, entries=0;
  function append(path,bytes) {
    total+=bytes.byteLength;
    if (++entries>MAX_FILES || total+entries*256>MAX_ARCHIVE) throw bad('Копия слишком велика. Экспортируйте нужные дни отдельно.');
    files[path]=bytes;
  }
  for (const [index,input] of records.entries()) {
    const record=normalizeRecord(input);
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
        append(folder+'/'+name,new Uint8Array(await bytes.arrayBuffer()));
      }
      const {src,blob,...meta}=asset;
      return {...meta, archiveFile:name, mediaType:type};
    });
    delete out._contentHash;
    const json=strToU8(JSON.stringify(out));
    if (json.length>MAX_JSON) throw bad('Текст одного дня слишком велик для экспорта.');
    const path=folder+'/day.json';
    append(path,json);
    days.push({id:record.id,date:record.date,title:record.title || '',path});
  }
  append('manifest.json',strToU8(JSON.stringify({format:'nolimit-diary',version:1,days})));
  // Photos and music already have their own compression. Stored files are quick to reopen on a phone.
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
  const error=()=>bad('Архив повреждён или имеет неподдерживаемый формат.');
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
    if (index.has(name) || (name.endsWith('.json') ? size>MAX_JSON : size>MAX_AUDIO) || (total+=size)>MAX_ARCHIVE) throw error();
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
  catch { throw bad('Текст в резервной копии повреждён.'); }
}
export async function inspectZip(file) {
  if (!(file instanceof Blob) || !file.size || file.size>MAX_ARCHIVE) throw bad('Выберите ZIP-копию дневника размером до 240 МБ.');
  const buffer=new Uint8Array(await file.arrayBuffer());
  let files, index;
  try {
    index=indexZip(buffer);
    files=unzipSync(buffer);
    for (const [path,entry] of index) {
      const bytes=files[path];
      if (!bytes || bytes.length!==entry.size || crc32(bytes)!==entry.crc) throw bad('Повреждены файлы резервной копии.');
    }
  } catch (e) { throw bad('Не удалось открыть ZIP-копию дневника. Проверьте, что выбран исходный файл экспорта.'); }
  const manifest=parseJson(files['manifest.json']);
  if (!manifest || manifest.format!=='nolimit-diary' || manifest.version!==1 || !Array.isArray(manifest.days) || manifest.days.length>MAX_DAYS) throw bad('Для восстановления нужна резервная копия NoLimit Дневник версии 1.');
  const records=[], ids=new Set(), seenPaths=new Set(['manifest.json']);
  for (const item of manifest.days) {
    if (!item || !validId(item.id) || ids.has(item.id) || !validateDate(item.date) || typeof item.path!=='string' ||
      !item.path.startsWith('days/'+item.date+'-') || !item.path.endsWith('/day.json') || !Object.hasOwn(files,item.path) || seenPaths.has(item.path)) throw bad('Некорректный список дней в копии.');
    seenPaths.add(item.path); ids.add(item.id);
    const raw=parseJson(files[item.path]);
    safeTree(raw);
    if (raw.id!==item.id || raw.date!==item.date) throw bad('Запись не соответствует списку дней.');
    const folder=item.path.slice(0,-'day.json'.length);
    const assets=new Map();
    const record=await mapMedia(raw,async (asset,kind)=>{
      if (!asset || typeof asset.archiveFile!=='string' || !/^media\/[\da-z.-]+$/.test(asset.archiveFile) || asset.src || asset.blob) throw bad('В копии отсутствует вложение дня.');
      const full=folder+asset.archiveFile;
      const bytes=files[full];
      if (!bytes || !bytes.length || bytes.length>(kind==='photo' ? MAX_IMAGE : MAX_AUDIO)) throw bad('Не удалось восстановить вложение из копии.');
      seenPaths.add(full);
      const mime=mediaType(asset.mediaType,full,kind);
      const key=full+':'+mime;
      if (!assets.has(key)) assets.set(key,new Blob([bytes],{type:mime}));
      const {mediaType:rawType,archiveFile,...meta}=asset;
      return {...meta,blob:assets.get(key)};
    });
    delete record._contentHash;
    if (record._originId && !validId(record._originId)) delete record._originId;
    const row=normalizeRecord(record);
    row._contentHash=await contentHash(row);
    records.push(row);
  }
  if (seenPaths.size!==index.size) throw bad('В резервной копии найдены лишние файлы.');
  return records;
}
async function merge(records, commit) {
  if (!Array.isArray(records) || records.length>MAX_DAYS) throw bad('Слишком много записей.');
  const validated=[];
  for (const input of records) {
    const row=normalizeRecord(input);
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
