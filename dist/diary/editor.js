import { galleryBytes, isGalleryVideo, MAX_GALLERY_BYTES, saveDay } from './store.js';
import { makeRecipe, moodOptions, normalizeMood } from './art.js';
import { musicLink } from './music-link.js';
import { galleryPoster, galleryThumbnail } from './ui.js';
import { formatDate, getLanguage, getLocale, translator } from './i18n.js';
import { messages } from './locales/editor.js';

const t = translator(messages);

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(date + 'T12:00:00Z');
  return !isNaN(value) && value.toISOString().slice(0, 10) === date;
}
function localDate() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
function wordCount(text) { return String(text || '').match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)?.length || 0; }
function options(obj, selected) {
  return Object.entries(obj).map(([v, label]) => '<option value="'+v+'"'+(v===selected?' selected':'')+'>'+label+'</option>').join('');
}
function cleanBase(record) {
  const result = { ...record };
  delete result.pendingEdit;
  return result;
}
function clamp(value, low, high) { return Math.min(high, Math.max(low,value)); }

const videoTypes = {mp4:'video/mp4', m4v:'video/mp4', webm:'video/webm', mov:'video/quicktime'};

function capturePoster(video) {
  try {
    const scale=Math.min(1,256/Math.max(video.videoWidth,video.videoHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
    canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    return galleryPoster({poster:canvas.toDataURL('image/jpeg',.68)});
  } catch { return ''; }
}

async function attachmentFromFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const extensionType = Object.hasOwn(videoTypes,ext) ? videoTypes[ext] : '';
  let type = file.type.toLowerCase().split(';')[0].trim();
  if (!type || type === 'application/octet-stream') type = extensionType;
  if (type === 'video/x-m4v' || type === 'video/m4v') type = 'video/mp4';
  if (!type.startsWith('video/') && !extensionType) return photoFromFile(file);
  if (!Object.values(videoTypes).includes(type)) throw Error(t('videoTypes'));
  if (!file.size || file.size > 50*1024*1024) throw Error(t('videoSize'));

  const blob = file.type === type ? file : file.slice(0,file.size,type);
  const src = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  let timer;
  try {
    const poster=await new Promise((resolve,reject)=>{
      const failed = ()=>reject(Error(t('videoDecode')));
      timer = setTimeout(failed,12000);
      video.onerror = failed;
      const frameReady = ()=>{
        if (!video.seeking && video.readyState>=video.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
          resolve(capturePoster(video));
        }
      };
      video.onloadedmetadata = ()=>{
        if (!video.videoWidth || !video.videoHeight) {failed();return;}
        clearTimeout(timer);
        // Browsers may withhold frames for a paused video on a low-data connection.
        timer=setTimeout(()=>resolve(''),1500);
        video.onerror=()=>resolve('');
        if (video.readyState>=video.HAVE_CURRENT_DATA) {frameReady();return;}
        if (Number.isFinite(video.duration) && video.duration>0) {
          try {video.currentTime=Math.min(.08,video.duration/2);} catch { /* loadeddata can still supply the first frame. */ }
        }
      };
      video.onloadeddata=video.onseeked=frameReady;
      video.src = src;
    });
    return {id:crypto.randomUUID(), kind:'video', name:file.name, blob, ...(poster ? {poster} : {})};
  } finally {
    clearTimeout(timer);
    video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null;
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(src);
  }
}

async function photoFromFile(file) {
  if (file.size > 12*1024*1024) throw Error(t('photoTooLarge'));
  if (!file.size) throw Error(t('emptyPhoto'));
  const heic = /\.(?:heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
  const genericType = !file.type || file.type === 'application/octet-stream';
  if (!heic && !(genericType ? /\.(?:jpe?g|png|webp)$/i.test(file.name) : /^image\/(?:jpe?g|png|webp)$/i.test(file.type))) {
    throw Error(t('imageTypes'));
  }
  const src = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = src;
    try { await image.decode(); } catch { throw Error(t('imageDecode')); }
    if (!image.naturalWidth || !image.naturalHeight) throw Error(t('imageMissing'));
    const canvas = document.createElement('canvas');
    canvas.width = 36; canvas.height = 36;
    const c = canvas.getContext('2d',{willReadFrequently:true});
    if (!c) throw Error(t('imageProcess'));
    c.fillStyle = '#f8f7f5'; c.fillRect(0,0,36,36); c.drawImage(image,0,0,36,36);
    const px = c.getImageData(0,0,36,36).data;
    // Quantized buckets retain a frequent hue that an arithmetic mean would wash out.
    const buckets = new Map();
    for (let i=0;i<px.length;i+=4) {
      const [r,g,b] = [px[i],px[i+1],px[i+2]];
      const key = ((r>>5)<<6) | ((g>>5)<<3) | (b>>5);
      const bin = buckets.get(key) || { n:0, r:0,g:0,b:0,weight:0 };
      bin.n++; bin.r+=r; bin.g+=g; bin.b+=b;
      bin.weight+=0.8+(Math.max(r,g,b)-Math.min(r,g,b))/255;
      buckets.set(key,bin);
    }
    const bin = [...buckets.values()].sort((a,b)=>b.weight-a.weight)[0];
    const color = '#'+[bin.r,bin.g,bin.b].map(v=>Math.round(v/bin.n).toString(16).padStart(2,'0')).join('');
    let blob = file, name = file.name;
    if (heic) {
      const scale = Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width = Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
      c.drawImage(image,0,0,canvas.width,canvas.height);
      blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.9));
      if (!blob) throw Error(t('imageHeic'));
      name = name.replace(/\.(hei[cf])$/i,'')+'.jpg';
    }
    if (!blob.type || blob.type === 'application/octet-stream') {
      const type = /\.webp$/i.test(name) ? 'image/webp' : /\.png$/i.test(name) ? 'image/png' : 'image/jpeg';
      blob = blob.slice(0,blob.size,type);
    }
    return {id:crypto.randomUUID(),name,blob,color,x:50,y:50};
  } finally { URL.revokeObjectURL(src); }
}

function readDuration(file) {
  const url = URL.createObjectURL(file);
  const player = new Audio();
  return new Promise((resolve,reject)=>{
    const finish = (error, duration)=>{
      clearTimeout(timer);
      player.onloadedmetadata = player.onerror = null;
      player.removeAttribute('src'); player.load();
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(duration);
    };
    const timer = setTimeout(()=>finish(Error(t('audioOpen'))),10000);
    player.preload = 'metadata';
    player.onloadedmetadata = ()=>finish(null,player.duration);
    player.onerror = ()=>finish(Error(t('audioPlay')));
    player.src = url;
  });
}

function audioCharacter(buffer) {
  const data = buffer.getChannelData(0);
  const start = data.length > buffer.sampleRate*55 ? Math.floor(buffer.sampleRate*8) : 0;
  const end = Math.min(data.length, start + 45*buffer.sampleRate);
  const step = Math.max(32,Math.round(buffer.sampleRate*.04));
  let total=0, count=0, last=0;
  const onsets=[];
  for (let pos=start;pos<end;pos+=step) {
    let sum=0, samples=0;
    for (let i=pos;i<Math.min(pos+step,end);i+=2) { sum+=data[i]*data[i];samples++; }
    const level=Math.sqrt(sum/(samples || 1));
    onsets.push(Math.max(0, level-last)); total+=level; count++;last=level;
  }
  if (count < 35 || total/count<.003) return {energy:'steady',analyzed:false};
  const mean = onsets.reduce((n,v)=>n+v,0)/count;
  const centered = onsets.map(v=>v-mean);
  const power = centered.reduce((n,v)=>n+v*v,0);
  let bestScore=0,bestLag=0;
  for(let lag=9;lag<=27;lag++){
    let correlation=0;
    for(let i=lag;i<count;i++) correlation+=centered[i]*centered[i-lag];
    correlation/=power||1;
    if(correlation>bestScore){ bestScore=correlation;bestLag=lag; }
  }
  const bpm = bestScore > .32 ? Math.round(60/(bestLag*.04)) : undefined;
  const energy = (bpm && bpm>=125) || mean>.027 ? 'bright' : (bpm && bpm<=85) || mean<.008 ? 'calm' : 'steady';
  return {energy, ...(bpm?{bpm}:{}),analyzed:true};
}
async function musicFromFile(file) {
  if (!file.size || file.size>25*1024*1024) throw Error(t('audioSize'));
  if (!/\.(?:mp3|m4a|aac|wav)$/i.test(file.name) && !/^audio\/(?:mpeg|mp3|mp4|aac|x-m4a|x-wav|wav|wave)$/i.test(file.type)) {
    throw Error(t('audioTypes'));
  }
  const duration = await readDuration(file);
  let character = {energy:'steady',analyzed:false};
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (Offline && Number.isFinite(duration) && duration<=600) {
    try {
      const ctx=new Offline(1,1,12000);
      const buffer=await ctx.decodeAudioData(await file.arrayBuffer());
      character=audioCharacter(buffer);
    } catch { /* Native playback was validated independently. Manual energy is available. */ }
  }
  const ext = file.name.split('.').pop().toLowerCase();
  const type = ({mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',wav:'audio/wav'})[ext];
  const blob = !file.type && type ? file.slice(0,file.size,type) : file;
  return {kind:'file',name:file.name.replace(/\.[^.]+$/,''),blob,...character};
}

export function mountEditor(root, record, ctx, viewState = {}) {
  const esc = ctx.esc;
  const energyNames = { calm: t('energyCalm'), steady: t('energySteady'), bright: t('energyBright') };
  const published = record.status === 'ready' ? cleanBase(record) : null;
  const draft = Object.assign({
    date:localDate(),text:'',title:'',caption:'',moments:[],photos:[],music:null,
  },cleanBase(record),record.pendingEdit || {});
  Object.assign(draft,{id:record.id || crypto.randomUUID(),revision:record.revision,primary:record.primary,status:'draft'});
  draft.moodOverride = normalizeMood(draft.moodOverride);
  draft.photos = (draft.photos || []).map(p=>({...p,id:p.id || crypto.randomUUID()}));
  draft.moments = [...(draft.moments || [])];
  draft.music = draft.music ? {...draft.music} : null;
  draft.musicMode ||= draft.music?.kind === 'link' ? 'link' : 'file';
  draft.linkDraft ??= draft.music?.kind==='link' ? draft.music.url : '';
  draft.linkName ??= draft.music?.kind==='link' ? draft.music.name : '';
  let base = record;
  let seq=0, persisted=0, timer, selected=viewState.selected ?? draft.photos[0]?.id, busy=0, disposed=false, committing=false, saveError='';
  let writeQueue=Promise.resolve(), galleryQueue=Promise.resolve(), saveTask=null, importErrors=0;
  const tasks=new Set(), urls=new Map();
  const controller=new AbortController();
  const $=s=>root.querySelector(s);
  function assetUrl(asset) {
    if (!asset) return '';
    if (asset.blob instanceof Blob) {
      if (!urls.has(asset.blob)) urls.set(asset.blob,URL.createObjectURL(asset.blob));
      return urls.get(asset.blob);
    }
    return typeof asset.src === 'string' && /^(?:\.\/|\/)?diary\/media\/[\w./% -]+$/.test(asset.src) && !asset.src.includes('..') ? asset.src : '';
  }
  function releaseUnusedUrls() {
    const used = new Set([...draft.photos.map(p=>p.blob),draft.music?.blob]);
    for (const [blob,url] of urls) if (!used.has(blob)) {
      URL.revokeObjectURL(url);
      urls.delete(blob);
    }
  }
  const limited = (value,low,high)=>clamp(Number.isFinite(Number(value))?Number(value):50,low,high);
  function issue(text='',field=null) {
    const msg = $('[data-ed-error]');
    if (!msg) return;
    root.querySelector('[data-ed-inline-error]')?.remove();
    for (const old of root.querySelectorAll('[aria-invalid="true"]')) {old.removeAttribute('aria-invalid');old.removeAttribute('aria-describedby');}
    msg.textContent=field ? '' : text;
    if (field) {
      const note=document.createElement('p');
      note.className='ed-inline-error';note.dataset.edInlineError='';note.id='ed-field-message';
      note.setAttribute('role','alert');note.textContent=text;
      (field.closest('label') || field).after(note);
      field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby',note.id);
      field.scrollIntoView({block:'center'});field.focus({preventScroll:true});
    }
  }
  function viewStatus() {
    if (disposed) return;
    const el = $('[data-ed-status]');
    el.textContent = saveError || (busy ? t('processing') : seq>persisted ? t('saving') : seq || record.revision ? t('savedLocally') : t('newDraft'));
    el.dataset.warn = Boolean(saveError);
    const discard = $('[data-ed-discard]');
    if (discard) discard.hidden = !published || (!seq && !record.pendingEdit);
  }
  function snapshot() {
    const d={...draft, photos:draft.photos.map(p=>({...p})), moments:[...draft.moments], music:draft.music ? {...draft.music} : null};
    delete d.pendingEdit;
    return d;
  }
  function queueDraft() {
    clearTimeout(timer);
    const version=seq;
    if (version<=persisted) return writeQueue;
    const data=snapshot();
    async function write() {
      if (version<=persisted) return true;
      try {
        const identity = {id:base.id || data.id,revision:base.revision,primary:base.primary};
        const day = published ? {...published,...identity,pendingEdit:data} : {...data,...identity};
        base=await saveDay(day);
        if (!disposed && base.id!==identity.id) ctx.followDraft?.(identity.id,base.id);
        draft.id=base.id; draft.revision=base.revision; draft.primary=base.primary;
        persisted=version;saveError='';viewStatus();
        return true;
      } catch {
        saveError=t('draftSaveError');
        viewStatus();return false;
      }
    }
    writeQueue=writeQueue.then(write,write);
    return writeQueue;
  }
  function mark() {
    if (committing || disposed) return;
    seq++; saveError='';clearTimeout(timer); timer=setTimeout(queueDraft,320); viewStatus();
    paintPreview();
  }
  async function flush() {
    if (tasks.size) await Promise.allSettled([...tasks]);
    const ok= await queueDraft();
    if (ok===false && seq>persisted) throw Error(saveError);
  }
  function on(target,event,fn,capture=false) { target.addEventListener(event,fn,{signal:controller.signal,capture}); }
  function track(task, field) {
    const p=Promise.resolve(task);tasks.add(p);busy++;viewStatus();
    p.catch(e=>{importErrors++;if(!disposed) issue(e?.message || t('fileProcessError'),field);}).finally(()=>{
      tasks.delete(p);busy--;viewStatus();
    });
  }
  root.innerHTML = '<div class="ed-layout"><div class="ed-inputs">'+
    `<section class="panel ed-panel"><div class="ed-head"><h2>${t('entry')}</h2><span data-ed-status role="status"></span></div>`+
    `<label class="ed-field">${t('date')}<input type="date" data-ed-date></label>`+
    `<label class="ed-field">${t('dayText')}<textarea rows="4" data-ed-text maxlength="16000" placeholder="${t('dayPrompt')}"></textarea></label><div data-ed-moments></div></section>`+
    `<section class="panel ed-panel ed-gallery-panel"><div class="ed-head"><h2>${t('photos')}</h2><span data-ed-count></span></div>`+
    `<div data-ed-gallery></div><button type="button" class="secondary ed-add" data-ed-add-photo>${ctx.icon('plus',17)}${t('addPhoto')}</button>`+
    '<input type="file" hidden accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov" multiple data-ed-photos>'+
    `<p class="ed-help">${t('photoLimit')}</p></section>`+
    `<section class="panel ed-panel"><div class="ed-head"><h2>${t('songOfDay')}</h2></div>`+
    `<div class="ed-switch" role="group" aria-label="${t('musicSource')}"><button type="button" data-ed-mode="file">${t('audioFile')}</button><button type="button" data-ed-mode="link">${t('link')}</button></div>`+
    `<div data-ed-file-pane><div data-ed-current-file></div><button class="secondary ed-add" type="button" data-ed-add-music>${t('selectAudio')}</button>`+
    '<input type="file" hidden accept="audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/x-wav,.mp3,.m4a,.aac,.wav" data-ed-music>'+
    `<p class="ed-help">${t('audioRights')}</p></div>`+
    `<div data-ed-link-pane hidden><label class="ed-field">${t('songUrl')}<input type="text" inputmode="url" spellcheck="false" autocapitalize="none" autocomplete="off" data-ed-link placeholder="https://…"></label>`+
    `<label class="ed-field">${t('songName')}<input type="text" data-ed-link-name maxlength="120" placeholder="${t('songPrompt')}"></label>`+
    '<div data-ed-link-action></div></div></section></div>'+
    `<div class="ed-side"><section class="panel ed-panel ed-summary"><div class="ed-head"><h2>${t('postcard')}</h2></div>`+
    '<div class="ed-mini" data-ed-mini><div class="ed-mini-copy"><small data-ed-scene></small><strong data-ed-title></strong><p data-ed-caption></p></div><figure class="ed-mini-paper"><div data-ed-frame></div><figcaption data-ed-print-date></figcaption></figure></div>'+
    `<details class="ed-custom"><summary>${t('customize')}</summary><label class="ed-field">${t('folderName')}<input data-ed-title-input maxlength="95" placeholder="${t('autoWords')}"></label>`+
    `<label class="ed-field">${t('caption')}<textarea rows="2" data-ed-cap-input maxlength="220" placeholder="${t('captionPrompt')}"></textarea></label>`+
    `<button type="button" class="ed-text-button" data-ed-choose>${t('chooseText')}</button>`+
    `<label class="ed-field">${t('mood')}<select data-ed-mood>`+options({'':t('fromText'),...moodOptions()},draft.moodOverride)+'</select></label>'+
    `<label class="ed-field" data-ed-rhythm-field>${t('frameRhythm')}<select data-ed-rhythm>`+options({'':t('fromSong'),...energyNames},draft.rhythmOverride)+'</select></label></details>'+
    `<div class="ed-actions"><button type="button" class="primary" data-ed-save>${t('saveCard')}</button></div></section>`+
    `<p class="ed-error" data-ed-error role="alert"></p><button type="button" class="ed-text-button ed-discard" data-ed-discard hidden>${t('discard')}</button></div></div>`;

  const date=$('[data-ed-date]'), text=$('[data-ed-text]'), title=$('[data-ed-title-input]'), caption=$('[data-ed-cap-input]');
  date.value=viewState.date ?? draft.date; text.value=draft.text; title.value=draft.titleOverride || '';caption.value=draft.captionOverride || '';
  $('[data-ed-link]').value=draft.linkDraft || ''; $('[data-ed-link-name]').value=draft.linkName || '';
  const photoInput=$('[data-ed-photos]'), musicInput=$('[data-ed-music]');
  const stateForRecipe=()=>({...draft,music:draft.music?.kind===draft.musicMode?draft.music:null});
  function positionOf(asset) {
    return limited(asset.x??50,0,100)+'% '+limited(asset.y??50,0,100)+'%';
  }
  function still(asset) {
    if (isGalleryVideo(asset)) {
      const poster=galleryPoster(asset);
      return galleryThumbnail('',true,poster)+(poster ? '<span class="ed-video-badge" aria-hidden="true">'+ctx.icon('play',12)+'</span>' : '');
    }
    const url=assetUrl(asset);
    if (!url) return '<span data-ed-empty-frame aria-hidden="true"></span>';
    return '<img alt="" src="'+esc(url)+'" style="object-position:'+positionOf(asset)+'">';
  }
  let coverAsset;
  function pauseSelectedVideo() {
    const video=$('[data-ed-selected-video]');
    if (video && !video.paused) video.pause();
  }
  function paintPreview() {
    if (disposed) return;
    const recipe=makeRecipe(stateForRecipe());
    const pic=draft.photos[0], mini=$('[data-ed-mini]'), frame=$('[data-ed-frame]');
    if (coverAsset!==pic || !frame.firstChild) {
      frame.innerHTML=still(pic);
      if (pic) {
        frame.setAttribute('role','img');
        frame.setAttribute('aria-label',t('cover')+' · '+pic.name);
      } else {
        frame.removeAttribute('role');
        frame.removeAttribute('aria-label');
      }
      coverAsset=pic;
    } else if (pic && frame.firstElementChild?.matches('img')) {
      frame.firstElementChild.style.objectPosition=positionOf(pic);
    }
    mini.style.setProperty('--ed-wash',/^#[a-f\d]{6}$/i.test(recipe.color) ? recipe.color : '#1855c9');
    mini.dataset.mood=recipe.mood;
    mini.style.setProperty('--ed-tilt',(Number(recipe.tilt) || 0)+'deg');
    $('[data-ed-scene]').textContent=recipe.moodLabel;
    $('[data-ed-print-date]').textContent=validDate(draft.date) ? formatDate(draft.date,{day:'numeric',month:'short'}) : '';
    $('[data-ed-title]').textContent = draft.text.trim() || draft.titleOverride ? recipe.title : t('yourCard');
    $('[data-ed-caption]').textContent = draft.text.trim() || draft.captionOverride ? recipe.caption : t('addEntryPhoto');
    $('[data-ed-choose]').disabled=!draft.text.trim();
  }
  function paintPhotos() {
    const box=$('[data-ed-gallery]');
    pauseSelectedVideo();
    box.replaceChildren();
    if(!draft.photos.some(p=>p.id===selected)) selected=draft.photos[0]?.id;
    $('[data-ed-count]').textContent=draft.photos.length+' / 6';
    $('[data-ed-add-photo]').disabled=draft.photos.length>=6;
    if(!draft.photos.length) return;
    const index=draft.photos.findIndex(p=>p.id===selected), asset=draft.photos[index];
    const number=(item,i)=>t(isGalleryVideo(item)?'videoNumber':'photoNumber',{n:i+1});
    const thumbs=draft.photos.map((item,i)=>
      `<button type="button" class="ed-thumb" data-ed-select="${i}" aria-label="${number(item,i)} · ${esc(item.name)}" aria-pressed="${i===index}">${still(item)}</button>`
    ).join('');
    const controls=[
      ['cover','useAsCover','layers',index===0],
      ['left','left','chevron',index===0],
      ['right','right','chevron',index===draft.photos.length-1],
      ['remove','remove','trash',false]
    ].map(([op,label,icon,disabled])=>
      `<button type="button" data-ed-photo-op="${op}"${disabled?' disabled':''}>${ctx.icon(icon,17)}<span>${t(label)}</span></button>`
    ).join('');
    const poster=galleryPoster(asset);
    const preview=isGalleryVideo(asset)
      ? `<video class="ed-video-player" data-ed-selected-video controls playsinline preload="none"${poster?' poster="'+esc(poster)+'"':''} aria-label="${esc(asset.name)}" src="${esc(assetUrl(asset))}"></video>`
      : `<details class="ed-crop"><summary>${t('crop')}</summary><div class="ed-crop-body"><div class="ed-crop-frame">${still(asset)}</div><div>
          <label class="ed-field">${t('horizontal')}<input type="range" min="0" max="100" data-ed-crop="x" value="${limited(asset.x??50,0,100)}"></label>
          <label class="ed-field">${t('vertical')}<input type="range" min="0" max="100" data-ed-crop="y" value="${limited(asset.y??50,0,100)}"></label>
        </div></div></details>`;
    box.innerHTML=`<div class="ed-thumbs" role="group" aria-label="${t('dayPhotos')}">${thumbs}</div>
      <div class="ed-photo-line"><strong>${esc(asset.name)}</strong><span>${index===0?t('cover'):number(asset,index)}</span></div>
      <div class="ed-photo-controls" role="group" aria-label="${esc(asset.name)}">${controls}</div>${preview}`;
  }
  function paintFile() {
    const box=$('[data-ed-current-file]'), track=draft.music;
    box.querySelector('audio')?.pause();
    if (track?.kind!=='file') {box.replaceChildren();$('[data-ed-add-music]').textContent=t('selectAudio');return;}
    box.innerHTML='<div class="ed-track"><strong>'+esc(track.name)+`</strong><button type="button" class="ed-text-button" data-ed-remove-music>${t('remove')}</button></div>`+
      '<audio controls preload="metadata" src="'+esc(assetUrl(track))+`" aria-label="${t('listen')}"></audio>`+
      `<label class="ed-field">${t('songEnergy')}<select data-ed-file-energy>`+options(energyNames,track.energy)+'</select></label>'+
      '<p class="ed-help">'+(track.bpm?t('tempo',{bpm:clamp(Number(track.bpm),20,300)}):track.analyzed?t('audioAnalyzed'):t('manualEnergy'))+'</p>';
    $('[data-ed-add-music]').textContent=t('replaceAudio');
  }
  function paintLink() {
    const a=$('[data-ed-link-action]');
    const link=musicLink(draft.linkDraft);
    if (!draft.linkDraft) {a.replaceChildren(); return;}
    if(!link){a.textContent=t('invalidService');return;}
    a.innerHTML='<a rel="noopener noreferrer" target="_blank" href="'+esc(link.url)+`">${t('openService')}</a>`;
  }
  function syncLink() {
    const link=musicLink(draft.linkDraft);
    if (link) {
      const previous=draft.music?.kind==='link' && musicLink(draft.music.url)?.url===link.url ? draft.music : {};
      const service=link.provider==='youtube' ? 'YouTube' : new URL(link.url).hostname;
      draft.music={...previous,kind:'link',name:draft.linkName.trim() || service,url:link.url};
    } else if(draft.music?.kind==='link') draft.music=null;
    paintLink();mark();
  }
  function showMode() {
    for(const btn of root.querySelectorAll('[data-ed-mode]')) btn.setAttribute('aria-pressed',String(btn.dataset.edMode===draft.musicMode));
    $('[data-ed-link-pane]').hidden=draft.musicMode!=='link';
    $('[data-ed-file-pane]').hidden=draft.musicMode!=='file';
    $('[data-ed-rhythm-field]').hidden=draft.musicMode==='link';
    if(draft.musicMode==='link') $('[data-ed-current-file] audio')?.pause();
    paintFile();paintLink();
  }
  function paintMoments() {
    const box=$('[data-ed-moments]');
    if (!draft.moments.length) return;
    box.innerHTML=`<div class="ed-moments"><h3>${t('moments')}</h3>`+draft.moments.map((m,i)=>{
      const d=new Date(m.time);
      const time=isNaN(d)?'':d.toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'});
      return '<div><span>'+esc(time)+'</span><p>'+esc(m.text)+'</p><button type="button" data-ed-use="'+i+`">${t('insertMoment')}</button></div>`;
    }).join('')+'</div>';
  }
  function validate() {
    issue('');
    if (!validDate(date.value)) {issue(t('needDate'),date);return false;}
    if (!draft.text.trim()) {issue(t('needText'),text);return false;}
    if (!draft.photos.length) {issue(t('needPhoto'),$('[data-ed-add-photo]'));return false;}
    if (!draft.music || draft.music.kind!==draft.musicMode || (draft.musicMode==='link' && !musicLink(draft.linkDraft))) {
      issue(draft.musicMode==='link' ? t('needLink') : t('needSong'),draft.musicMode==='link'?$('[data-ed-link]'):$('[data-ed-add-music]'));return false;
    }
    if(draft.titleOverride?.trim() && (wordCount(draft.titleOverride)<3 || wordCount(draft.titleOverride)>7)) {
      $('.ed-custom').open=true;issue(t('titleLength'),title);return false;
    }
    return true;
  }
  async function finish() {
    if (saveTask || committing || disposed) return;
    const button=$('[data-ed-save]');
    const fields=$('.ed-layout');
    const priorErrors=importErrors;
    button.disabled=true;
    fields.inert=true;
    try {
      saveTask=(async()=>{
        // File imports may still be resolving when Save is tapped.
        await flush();
        fields.inert=false;
        if (disposed) return null;
        if (importErrors!==priorErrors) {
          root.querySelector('[aria-invalid="true"]')?.focus();
          return null;
        }
        if (!validate()) return null;
        fields.inert=true;
        committing=true;
        const recipe=makeRecipe(stateForRecipe());
        const completed={...snapshot(),id:base.id,revision:base.revision,primary:base.primary,status:'ready',title:recipe.title,caption:recipe.caption,recipe};
        const saved=await saveDay(completed);
        base=saved;persisted=seq;saveError='';
        return saved;
      })();
      const saved=await saveTask;
      if (saved && !disposed) {
        ctx.toast?.(t('daySaved'));
        ctx.viewDay(saved);
      }
    } catch {
      if (!disposed) issue(t('daySaveError'));
    } finally {
      saveTask=null;committing=false;fields.inert=false;button.disabled=false;
    }
  }

  on(date,'input',()=>{if(validDate(date.value)){draft.date=date.value;mark();}});
  on(text,'input',()=>{
    if (!draft.text.trim() && text.value.trim()) draft.contentLanguage=getLanguage();
    draft.text=text.value;mark();
  });
  on(title,'input',()=>{draft.titleOverride=title.value;mark();});
  on(caption,'input',()=>{draft.captionOverride=caption.value;mark();});
  on($('[data-ed-mood]'),'change',e=>{draft.moodOverride=e.target.value;mark();});
  on($('[data-ed-rhythm]'),'change',e=>{draft.rhythmOverride=e.target.value;mark();});
  on($('[data-ed-add-photo]'),'click',()=>photoInput.click());
  on(photoInput,'change',()=>{
    const files=[...photoInput.files]; photoInput.value='';
    if(!files.length)return;
    const addFiles=async()=>{
      if(disposed)return;
      issue('');const errors=[];
      for(const file of files) {
        if(disposed)return;
        if(draft.photos.length>=6) {errors.push(t('maxPhotos'));break;}
        try {
          const p=await attachmentFromFile(file);
          if(await galleryBytes([...draft.photos,p]) > MAX_GALLERY_BYTES) throw Error(t('galleryTooLarge'));
          if(disposed)return;
          draft.photos.push(p);selected=p.id;paintPhotos();mark();
        } catch(e){errors.push(file.name+' — '+e.message);}
      }
      if(errors.length && !disposed) {importErrors++;issue(errors.join(' '),$('[data-ed-add-photo]'));}
    };
    galleryQueue=galleryQueue.then(addFiles,addFiles);
    track(galleryQueue,$('[data-ed-add-photo]'));
  });
  on($('[data-ed-gallery]'),'click',e=>{
    const sel=e.target.closest('[data-ed-select]'), op=e.target.closest('[data-ed-photo-op]');
    if(sel) {
      const id=draft.photos[Number(sel.dataset.edSelect)]?.id;
      if(selected!==id) {selected=id;paintPhotos();$('[data-ed-select][aria-pressed="true"]')?.focus({preventScroll:true});}
      return;
    }
    if(!op||op.disabled)return;
    const i=draft.photos.findIndex(p=>p.id===selected);if(i<0)return;
    const [p]=draft.photos.splice(i,1), value=op.dataset.edPhotoOp;
    if(value!=='remove') draft.photos.splice(value==='cover'?0:value==='left'?i-1:i+1,0,p);
    selected=value==='remove'?draft.photos[Math.min(i,draft.photos.length-1)]?.id:p.id;
    paintPhotos();mark();releaseUnusedUrls();
    ($('[data-ed-select][aria-pressed="true"]') || $('[data-ed-add-photo]')).focus({preventScroll:true});
  });
  on($('[data-ed-gallery]'),'input',e=>{
    if(!e.target.matches('[data-ed-crop]'))return;
    const p=draft.photos.find(p=>p.id===selected); if(!p)return;
    p[e.target.dataset.edCrop]=limited(e.target.value,0,100);
    for (const img of root.querySelectorAll('.ed-thumb[aria-pressed="true"] img,.ed-crop-frame img')) img.style.objectPosition=positionOf(p);
    mark();
  });
  let audioToken=0;
  on($('[data-ed-add-music]'),'click',()=>musicInput.click());
  on(musicInput,'change',()=>{
    const file=musicInput.files[0]; musicInput.value='';if(!file)return;
    const token=++audioToken;
    track((async()=>{
      issue('');const track=await musicFromFile(file);
      if(disposed || token!==audioToken)return;
      draft.music=track;draft.musicMode='file';showMode();mark();
    })(),$('[data-ed-add-music]'));
  });
  on($('[data-ed-current-file]'),'click',e=>{if(e.target.closest('[data-ed-remove-music]')){audioToken++;draft.music=null;paintFile();mark();}});
  on($('[data-ed-current-file]'),'change',e=>{if(e.target.matches('[data-ed-file-energy]')&&draft.music){draft.music.energy=e.target.value;delete draft.music.bpm;draft.music.analyzed=false;paintFile();mark();}});
  for(const btn of root.querySelectorAll('[data-ed-mode]')) on(btn,'click',()=>{
    if(btn.dataset.edMode===draft.musicMode) return;
    audioToken++;draft.musicMode=btn.dataset.edMode;showMode();
    if(draft.musicMode==='link' && musicLink(draft.linkDraft)) syncLink();
    else mark();
  });
  on($('[data-ed-link]'),'input',e=>{draft.linkDraft=e.target.value;syncLink();});
  on($('[data-ed-link-name]'),'input',e=>{draft.linkName=e.target.value;syncLink();});
  on($('[data-ed-moments]'),'click',e=>{
    const btn=e.target.closest('[data-ed-use]');if(!btn)return;
    const v=draft.moments[Number(btn.dataset.edUse)]?.text;
    if(v && !draft.text.includes(v)){draft.text=[draft.text.trim(),v].filter(Boolean).join('\n');text.value=draft.text;mark();}
    text.focus();
  });
  on($('[data-ed-choose]'),'click',()=>{
    const phrases = draft.text.split(/(?<=[.!?…])\s+|\n+/u).map(s=>s.trim()).filter(Boolean).slice(0,30);
    if (!phrases.length) return;
    ctx.sheet(t('choosePhrase'),'<div class="grid-list">'+phrases.map((v,i)=>'<button type="button" data-ed-phrase="'+i+'">'+esc(v.slice(0,220))+'</button>').join('')+'</div>',panel=>{
      panel.addEventListener('click',e=>{
        const b=e.target.closest('[data-ed-phrase]');if(!b || disposed)return;
        draft.captionOverride=phrases[Number(b.dataset.edPhrase)].slice(0,220);caption.value=draft.captionOverride;mark();ctx.closeSheet?.();
      });
    });
  });
  on($('[data-ed-discard]'),'click',()=>{
    if(!published)return;
    ctx.sheet(t('confirmDiscard'), `<p>${t('discardDetail')}</p><div class="ed-actions"><button type="button" class="secondary" data-keep>${t('keepEditing')}</button><button type="button" class="primary" data-discard>${t('restoreCard')}</button></div>`,panel=>{
      panel.querySelector('[data-keep]').onclick=()=>ctx.closeSheet?.();
      const confirm=panel.querySelector('[data-discard]');
      confirm.onclick=async()=>{
        if(committing || disposed)return;
        committing=true;confirm.disabled=true;
        try {
          if(tasks.size)await Promise.allSettled([...tasks]);
          clearTimeout(timer);await writeQueue;
          const restored={...published,id:base.id,revision:base.revision,primary:base.primary};
          base=await saveDay(restored);persisted=seq;saveError='';
          ctx.toast?.(t('cardRestored'));ctx.viewDay(base);
        } catch{ctx.toast?.(t('restoreError'));}
        finally{committing=false;confirm.disabled=false;}
      };
    });
  });
  on($('[data-ed-save]'),'click',finish);
  on(root,'play',e=>{
    if(e.target.matches('audio, video[controls]')) {
      for (const other of root.querySelectorAll('audio,video[controls]')) if(other!==e.target && !other.paused) other.pause();
    }
  },true);
  on(document,'visibilitychange',()=>{if(document.hidden){queueDraft();$('[data-ed-current-file] audio')?.pause();pauseSelectedVideo();}});
  on(window,'pagehide',queueDraft);
  paintMoments();paintPhotos();showMode();paintPreview();viewStatus();
  function cleanup() {
    if(disposed)return;
    if(seq>persisted) queueDraft();
    disposed=true;controller.abort();clearTimeout(timer);
    $('[data-ed-current-file] audio')?.pause();
    pauseSelectedVideo();
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }
  if(viewState.customOpen) $('.ed-custom').open=true;
  if(viewState.cropOpen && $('.ed-crop')) $('.ed-crop').open=true;
  cleanup.getViewState=()=>({
    selected,date:date.value,
    customOpen:$('.ed-custom').open,cropOpen:$('.ed-crop')?.open
  });
  cleanup.flush=async()=>{
    if (saveTask) await saveTask;
    await flush();
  };
  return cleanup;
}
