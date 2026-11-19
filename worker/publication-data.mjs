import { fail } from './http.mjs';
import { musicLink } from '../dist/diary/music-link.js';

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const person = row => ({id:row.owner_id, name:row.name, code:row.code});
export const mediaURL = (publication, asset) => '/api/social/media/' + publication + '/' + asset;

export function friends(a, b) {
  return `EXISTS (SELECT 1 FROM friendships f WHERE f.a=min(${a},${b}) AND f.b=max(${a},${b}))`;
}

// Every read, including byte-range requests, uses this predicate.
// p is the publication alias and ?1 is the trusted profile id.
export const readable = `(p.owner_id=?1 OR (
  ${friends('p.owner_id','?1')} AND (
    p.mode='all' OR (p.mode='selected' AND EXISTS (
      SELECT 1 FROM recipients r WHERE r.publication_id=p.id AND r.user_id=?1
    ))
  )
))`;

function string(value, max, required=false) {
  if (typeof value !== 'string' || value.length>max || (required && !value.trim())) fail(400,'invalid_day');
  return value;
}
const color = value => typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#85a7d2';
const energy = value => ['calm','steady','bright'].includes(value) ? value : 'steady';
const numeric = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min,Math.min(max,value)) : fallback;

export function cleanDay(input) {
  if (!input || !Array.isArray(input.photos) || input.photos.length<1 || input.photos.length>6) fail(400,'invalid_day');
  const title=string(input.title,4096,true), caption=string(input.caption ?? '',160000);
  const date=string(input.date,10,true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0,10)!==date) fail(400,'invalid_day');
  const assets=[];
  function assetId(item,kind) {
    if (!uuid.test(item?.assetId)) fail(400,'invalid_asset');
    assets.push({id:item.assetId,kind});
    return item.assetId;
  }
  const photos=input.photos.map(photo=>({
    ...(photo?.kind==='video'?{kind:'video'}:{}),
    assetId:assetId(photo,photo?.kind==='video'?'video':'photo'),x:numeric(photo.x,0,100,50),y:numeric(photo.y,0,100,50),color:color(photo.color)
  }));
  const track=input.music;
  let music;
  if (track?.kind==='file') {
    // The editor derives a file track's name from the local filename. Use the
    // player's localized generic label for published files.
    music={kind:'file',assetId:assetId(track,'audio'),energy:energy(track.energy)};
    if (Number.isFinite(track.bpm)) music.bpm=numeric(track.bpm,35,245,91);
  } else if (track?.kind==='link') {
    const link=musicLink(track.url);
    if (!link) fail(400,'invalid_music_link');
    music={kind:'link',url:link.url,name:string(track.name ?? '',1000),energy:energy(track.energy)};
  } else fail(400,'invalid_day');
  const r=input.recipe || {};
  const recipe={version:1,title,caption,color:color(r.color || photos[0].color)};
  if (['calm','bright','sad','angry','restless'].includes(r.mood)) recipe.mood=r.mood;
  if (['float','lift','pan','cut'].includes(r.motion)) recipe.motion=r.motion;
  if (['calm','steady','bright'].includes(r.energy)) recipe.energy=r.energy;
  for (const [key,min,max] of [['voiceRate',.75,1.25],['voicePitch',.8,1.2],['tilt',-8,8],['interval',1800,12000],['bpm',35,245]]) {
    if (Number.isFinite(r[key])) recipe[key]=numeric(r[key],min,max);
  }
  const day={status:'ready',title,date,text:string(input.text,160000,true),caption,recipe,photos,music};
  if (['ru','kk','en'].includes(input.contentLanguage)) day.contentLanguage=input.contentLanguage;
  return {day,assets};
}

export function audience(input) {
  if (!['private','all','selected'].includes(input.mode)) fail(400,'invalid_audience');
  if (input.mode!=='selected') return {mode:input.mode,ids:[]};
  if (!Array.isArray(input.recipientIds) || input.recipientIds.some(id=>typeof id!=='string' || !id || id.length>512))
    fail(400,'invalid_audience');
  const ids=[...new Set(input.recipientIds)].sort();
  return {mode:ids.length ? 'selected' : 'private',ids};
}

export function asPublication(row) {
  const day=JSON.parse(row.day_json);
  for (const photo of day.photos) photo.src=mediaURL(row.id,photo.assetId);
  if (day.music?.kind==='file') day.music.src=mediaURL(row.id,day.music.assetId);
  return {id:row.id,owner:person(row),day,mode:row.mode,accessVersion:row.access_version,contentVersion:row.content_version};
}

export async function digest(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function operationId(request, data) {
  const value=request.headers.get('Idempotency-Key') ?? data.operationId ?? null;
  if (value!==null && (typeof value!=='string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(value))) fail(400,'invalid_operation');
  return value;
}
