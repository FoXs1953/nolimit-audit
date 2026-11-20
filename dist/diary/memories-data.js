import {musicLink} from './music-link.js';
import {visibleDayNotes} from './store.js';

const FIRST_DATE = '0001-01-01';
const LAST_DATE = '9999-12-31';
const firstTime = Date.parse(FIRST_DATE);
const lastTime = Date.parse(LAST_DATE);

export function isMemoryDate(value) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value;
}

function isoDate(date) {
  return new Date(Math.min(lastTime,Math.max(firstTime,date.getTime()))).toISOString().slice(0,10);
}

export function memoryPeriod(mode, anchor) {
  if (!isMemoryDate(anchor) || !['week','month'].includes(mode)) return null;
  const start = new Date(anchor);
  const end = new Date(anchor);
  if (mode === 'week') {
    const sinceMonday = (start.getUTCDay()+6)%7;
    start.setUTCDate(start.getUTCDate()-sinceMonday);
    end.setUTCDate(end.getUTCDate()+6-sinceMonday);
  } else {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth()+1,0);
  }
  return {start:isoDate(start),end:isoDate(end)};
}

export function shiftMemoryAnchor(mode, anchor, direction) {
  const period = memoryPeriod(mode,anchor);
  if (!period || ![-1,1].includes(direction)) return anchor;
  if ((direction === -1 && period.start === FIRST_DATE) || (direction === 1 && period.end === LAST_DATE)) return anchor;
  const next = new Date(period.start);
  if (mode === 'week') next.setUTCDate(next.getUTCDate()+direction*7);
  else next.setUTCMonth(next.getUTCMonth()+direction);
  return isoDate(next);
}

function entryPriority(day) {
  return 2*Number(day.primary !== false)+Number(day.status === 'ready');
}

export function memoryEntries(records, {start,end} = {}) {
  if (!isMemoryDate(start) || !isMemoryDate(end) || start > end) return [];
  const sections = new Map();
  const ordered = records.filter(day=>day && day.date >= start && day.date <= end && isMemoryDate(day.date))
    .sort((a,b)=>a.date.localeCompare(b.date) || entryPriority(b)-entryPriority(a) ||
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.id.localeCompare(b.id));
  for (const day of ordered) {
    if (sections.has(day.date)) continue;
    const moments = visibleDayNotes(day).filter(note=>note.text.trim());
    if (day.status === 'ready') {
      const {pendingEdit,...saved} = day;
      sections.set(day.date,{...saved,moments});
    } else if (day.status === 'draft' && moments.length) {
      const {id,date,status,contentLanguage} = day;
      sections.set(date,{id,date,status,contentLanguage,moments});
    }
  }
  return [...sections.values()];
}

function trackPriority(track) {
  if (track?.kind === 'file' && track.blob instanceof Blob && track.blob.size && !track.src) return 3;
  if (track?.kind !== 'link') return 0;
  const link = musicLink(track.url);
  if (!link) return 0;
  return link.provider === 'external' ? 1 : 2;
}

export function memoryTrackFromDay(day) {
  if (day.status !== 'ready' || /^demo-(leaves|launch|coffee|cat|moon)$/.test(day.id)) return null;
  return trackPriority(day.music) ? day.music : null;
}

export function automaticMemoryTrack(entries) {
  let best = null;
  let priority = 1;
  // Prefer the newest local track, then the newest track with an embedded player.
  // Links that only open in another service remain available for manual selection.
  for (const day of entries) {
    const track = memoryTrackFromDay(day);
    const rank = trackPriority(track);
    if (rank > 1 && rank >= priority) {
      best = track;
      priority = rank;
    }
  }
  return best;
}

const DB_NAME = 'nolimit-diary-memories';
const STORE = 'preferences';
const KEY = 'last-view';
const fileBytes = new WeakMap();
let queuedSave = Promise.resolve();

function openPreferences() {
  return new Promise((resolve,reject)=>{
    const request = indexedDB.open(DB_NAME,1);
    let blocked = false;
    request.onupgradeneeded = ()=>request.result.createObjectStore(STORE);
    request.onblocked = ()=>{
      blocked = true;
      reject(new Error('Memories storage is blocked'));
    };
    request.onerror = ()=>reject(request.error);
    request.onsuccess = ()=>{
      const db = request.result;
      if (blocked) db.close();
      else resolve(db);
    };
  });
}

async function accessPreferences(mode, action) {
  const db = await openPreferences();
  try {
    return await new Promise((resolve,reject)=>{
      const transaction = db.transaction(STORE,mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = ()=>resolve(request.result);
      transaction.onabort = ()=>reject(transaction.error || new Error('Memories storage transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function loadMemoryPreferences() {
  await queuedSave.catch(()=>{});
  const saved = await accessPreferences('readonly',store=>store.get(KEY));
  if (!saved) return null;
  const {file,...preferences} = saved;
  // Store bytes for WebKit sessions that cannot persist native Blob objects.
  const track = file?.bytes instanceof ArrayBuffer
    ? {name:file.name,blob:new Blob([file.bytes],{type:file.type})}
    : null;
  if (track) fileBytes.set(track.blob,Promise.resolve(file.bytes));
  return {...preferences,file:track};
}

export function saveMemoryPreferences(value) {
  const {file,...preferences} = value;
  const write = queuedSave.catch(()=>{}).then(async ()=>{
    let track = null;
    if (file?.blob instanceof Blob) {
      const {name,blob} = file;
      let bytes = fileBytes.get(blob);
      if (!bytes) {
        bytes = blob.arrayBuffer();
        fileBytes.set(blob,bytes);
        bytes.catch(()=>fileBytes.delete(blob));
      }
      track = {name,type:blob.type,bytes:await bytes};
    }
    await accessPreferences('readwrite',store=>store.put({...preferences,file:track},KEY));
  });
  queuedSave = write;
  return write;
}
