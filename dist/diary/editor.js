import { saveDay } from './store.js';
import { makeRecipe } from './art.js';

const energyNames = { calm: 'Спокойная', steady: 'Ровная', bright: 'Энергичная' };
const moodNames = { quiet: 'Тихое', bright: 'Радостное', restless: 'Напряжённое', tender: 'Тёплое' };
const platforms = [
  'spotify.com', 'apple.com', 'soundcloud.com', 'deezer.com', 'deezer.page.link',
  'youtube.com', 'youtu.be', 'tidal.com', 'bandcamp.com', 'music.yandex.ru',
  'music.yandex.kz', 'music.yandex.com', 'music.yandex.by', 'music.yandex.uz',
  'music.amazon.com', 'music.amazon.co.uk', 'qobuz.com', 'music.vk.com',
];
function musicURL(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase();
    if (host === 'apple.com' || (host.endsWith('.apple.com') && host !== 'music.apple.com')) return null;
    return platforms.some(p => host === p || host.endsWith('.' + p)) ? u : null;
  } catch { return null; }
}
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

async function photoFromFile(file) {
  if (file.size > 12*1024*1024) throw Error('Фото больше 12 МБ. Выберите снимок меньшего размера.');
  if (!file.size) throw Error('Файл пуст. Выберите другой снимок.');
  const heic = /\.(?:heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
  if (!heic && !(file.type ? /^image\/(?:jpe?g|png|webp)$/i.test(file.type) : /\.(?:jpe?g|png|webp)$/i.test(file.name))) {
    throw Error('Выберите JPEG, PNG или WebP. HEIC можно добавить, если его открывает браузер.');
  }
  const src = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = src;
    try { await image.decode(); } catch { throw Error('Не удалось прочитать фото. Попробуйте сохранить его в JPEG.'); }
    if (!image.naturalWidth || !image.naturalHeight) throw Error('У фотографии отсутствует изображение.');
    const canvas = document.createElement('canvas');
    canvas.width = 36; canvas.height = 36;
    const c = canvas.getContext('2d',{willReadFrequently:true});
    if (!c) throw Error('Не удалось обработать фото. Попробуйте другой браузер.');
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
      if (!blob) throw Error('Браузер не смог преобразовать HEIC. Выберите JPEG.');
      name = name.replace(/\.(hei[cf])$/i,'')+'.jpg';
    }
    if (!blob.type) {
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
    const timer = setTimeout(()=>finish(Error('Не удалось открыть звук. Выберите другой файл.')),10000);
    player.preload = 'metadata';
    player.onloadedmetadata = ()=>finish(null,player.duration);
    player.onerror = ()=>finish(Error('Браузер не воспроизводит этот файл. Попробуйте MP3, AAC или WAV.'));
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
  if (!file.size || file.size>25*1024*1024) throw Error('Нужен непустой аудиофайл размером до 25 МБ.');
  if (!/\.(?:mp3|m4a|aac|wav)$/i.test(file.name) && !/^audio\/(?:mpeg|mp3|mp4|aac|x-m4a|x-wav|wav|wave)$/i.test(file.type)) {
    throw Error('Выберите MP3, AAC, M4A или WAV.');
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

export function mountEditor(root, record, ctx) {
  const esc = ctx.esc;
  const published = record.status === 'ready' ? cleanBase(record) : null;
  const draft = Object.assign({
    date:localDate(),text:'',title:'',caption:'',moments:[],photos:[],music:null,
  },cleanBase(record),record.pendingEdit || {});
  Object.assign(draft,{id:record.id || crypto.randomUUID(),revision:record.revision,primary:record.primary,status:'draft'});
  draft.photos = (draft.photos || []).map(p=>({...p}));
  draft.moments = [...(draft.moments || [])];
  draft.music = draft.music ? {...draft.music} : null;
  draft.musicMode ||= draft.music?.kind === 'link' ? 'link' : 'file';
  draft.linkDraft ??= draft.music?.kind==='link' ? draft.music.url : '';
  draft.linkName ??= draft.music?.kind==='link' ? draft.music.name : '';
  draft.linkEnergy ||= draft.music?.kind==='link' ? draft.music.energy : 'steady';
  let base = record;
  let seq=0, persisted=0, timer, selected=draft.photos[0]?.id, busy=0, disposed=false, committing=false, saveError='', previewOpen=false;
  let writeQueue=Promise.resolve(), previewIndex=0, previewTimer, previewAudio, previewPlaying=false;
  let previewRun=0;
  const tasks=new Set(), urls=new Map();
  const controller=new AbortController();
  const $=s=>root.querySelector(s);
  function assetUrl(asset) {
    if (!asset) return '';
    if (asset.blob instanceof Blob) {
      if (!urls.has(asset.blob)) urls.set(asset.blob,URL.createObjectURL(asset.blob));
      return urls.get(asset.blob);
    }
    return typeof asset.src === 'string' && /^(?:\.\/)?diary\/media\/[\w./% -]+$/.test(asset.src) && !asset.src.includes('..') ? asset.src : '';
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
    el.textContent = saveError || (busy ? 'Обработка файла…' : seq>persisted ? 'Сохранение…' : seq || record.revision ? 'Сохранено на устройстве' : 'Новый черновик');
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
        draft.id=base.id; draft.revision=base.revision; draft.primary=base.primary;
        persisted=version;saveError='';viewStatus();
        return true;
      } catch {
        saveError='Черновик не сохранён. Проверьте свободное место.';
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
  function on(target,event,fn) { target.addEventListener(event,fn,{signal:controller.signal}); }
  function track(task, field) {
    const p=Promise.resolve(task);tasks.add(p);busy++;viewStatus();
    p.catch(e=>{if(!disposed) issue(e?.message || 'Не удалось обработать файл. Попробуйте ещё раз.',field);}).finally(()=>{
      tasks.delete(p);busy--;viewStatus();
    });
  }
  root.innerHTML = '<div class="ed-layout"><div class="ed-inputs">'+
    '<section class="panel ed-panel"><div class="ed-head"><h2>Запись о дне</h2><span data-ed-status role="status"></span></div>'+
    '<label class="ed-field">Дата<input type="date" data-ed-date></label>'+
    '<label class="ed-field">Текст дня<textarea rows="4" data-ed-text maxlength="16000" placeholder="Что сегодня хочется запомнить?"></textarea></label><div data-ed-moments></div></section>'+
    '<section class="panel ed-panel"><div class="ed-head"><h2>Фотографии</h2><span data-ed-count></span></div>'+
    '<div data-ed-gallery></div><button type="button" class="secondary ed-add" data-ed-add-photo>Добавить фото</button>'+
    '<input type="file" hidden accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple data-ed-photos>'+
    '<p class="ed-help">До шести фотографий, каждая до 12 МБ.</p></section>'+
    '<section class="panel ed-panel"><div class="ed-head"><h2>Песня дня</h2></div>'+
    '<div class="ed-switch" role="group" aria-label="Источник музыки"><button type="button" data-ed-mode="file">Аудиофайл</button><button type="button" data-ed-mode="link">Ссылка</button></div>'+
    '<div data-ed-file-pane><div data-ed-current-file></div><button class="secondary ed-add" type="button" data-ed-add-music>Выбрать аудиофайл</button>'+
    '<input type="file" hidden accept="audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/x-wav,.mp3,.m4a,.aac,.wav" data-ed-music>'+
    '<p class="ed-help">Своё или разрешённое аудио, до 25 МБ.</p></div>'+
    '<div data-ed-link-pane hidden><label class="ed-field">Ссылка на песню<input type="url" inputmode="url" autocapitalize="none" autocomplete="off" data-ed-link placeholder="https://…"></label>'+
    '<label class="ed-field">Название песни<input type="text" data-ed-link-name maxlength="120" placeholder="Название или исполнитель"></label>'+
    '<label class="ed-field">Характер песни<select data-ed-energy>'+options(energyNames,draft.linkEnergy)+'</select></label><div data-ed-link-action></div></div></section></div>'+
    '<div class="ed-side"><section class="panel ed-panel ed-summary"><div class="ed-head"><h2>Открытка дня</h2></div>'+
    '<div class="ed-mini" data-ed-mini><div class="ed-mini-copy"><small data-ed-scene></small><strong data-ed-title></strong><p data-ed-caption></p></div><figure class="ed-mini-paper"><img data-ed-image hidden alt=""><span data-ed-empty-frame aria-hidden="true"></span><figcaption data-ed-print-date></figcaption></figure></div>'+
    '<details class="ed-custom"><summary>Настроить оформление</summary><label class="ed-field">Название папки<input data-ed-title-input maxlength="95" placeholder="Автоматически · 3–7 слов"></label>'+
    '<label class="ed-field">Подпись открытки<textarea rows="2" data-ed-cap-input maxlength="220" placeholder="Фраза из записи"></textarea></label>'+
    '<button type="button" class="ed-text-button" data-ed-choose>Выбрать фразу из текста</button>'+
    '<label class="ed-field">Настроение<select data-ed-mood>'+options({'':'Из текста',...moodNames},draft.moodOverride)+'</select></label>'+
    '<label class="ed-field">Ритм кадров<select data-ed-rhythm>'+options({'':'Из песни',...energyNames},draft.rhythmOverride)+'</select></label></details>'+
    '<div class="ed-actions"><button type="button" class="secondary" data-ed-why>Почему так?</button><button type="button" class="primary" data-ed-preview>Собрать открытку</button></div>'+
    '<div data-ed-review hidden><div class="ed-reel"><button type="button" class="secondary" data-ed-reel-play>Оживить</button><button type="button" class="ed-text-button" data-ed-reel-prev aria-label="Предыдущее фото">Назад</button><span data-ed-reel-count></span><button type="button" class="ed-text-button" data-ed-reel-next aria-label="Следующее фото">Дальше</button></div><p class="ed-help" data-ed-reel-status aria-live="polite"></p><div data-ed-reel-link></div><div class="ed-actions"><button class="secondary" type="button" data-ed-return>К редактированию</button><button type="button" class="primary" data-ed-save>Сохранить день</button></div></div></section>'+
    '<p class="ed-error" data-ed-error role="alert"></p><div class="ed-leave"><button type="button" class="ed-text-button" data-ed-later>Продолжить позже</button><button type="button" class="ed-text-button" data-ed-discard hidden>Отменить правки</button></div></div></div>';

  const date=$('[data-ed-date]'), text=$('[data-ed-text]'), title=$('[data-ed-title-input]'), caption=$('[data-ed-cap-input]');
  date.value=draft.date; text.value=draft.text; title.value=draft.titleOverride || '';caption.value=draft.captionOverride || '';
  $('[data-ed-link]').value=draft.linkDraft || ''; $('[data-ed-link-name]').value=draft.linkName || '';
  const photoInput=$('[data-ed-photos]'), musicInput=$('[data-ed-music]');
  const stateForRecipe=()=>({...draft,music:draft.music?.kind===draft.musicMode?draft.music:null});
  function stopReel() {
    previewRun++;
    clearTimeout(previewTimer);
    if(previewAudio){previewAudio.pause();previewAudio.removeAttribute('src');previewAudio.load();previewAudio=null;}
    previewPlaying=false;
    if(disposed)return;
    const play=$('[data-ed-reel-play]');
    if(play)play.textContent='Оживить';
    $('[data-ed-mini]')?.classList.remove('ed-playing');
  }
  function setFrame() {
    const pics=draft.photos;
    if (!pics.length || disposed)return;
    const p=pics[previewIndex],img=$('[data-ed-image]');
    img.src=assetUrl(p);img.alt=p.name;
    img.style.objectPosition=limited(p.x??50,0,100)+'% '+limited(p.y??50,0,100)+'%';
    const prev=$('[data-ed-reel-prev]'),next=$('[data-ed-reel-next]');
    prev.hidden=next.hidden=pics.length===1;
    prev.disabled=previewIndex===0;next.disabled=previewIndex>=pics.length-1;
    $('[data-ed-reel-count]').textContent=(previewIndex+1)+' / '+pics.length;
  }
  function advanceReel() {
    const recipe=makeRecipe(stateForRecipe());
    previewTimer=setTimeout(()=>{
      if(!previewPlaying || disposed)return;
      if(previewIndex+1<draft.photos.length){previewIndex++;setFrame();advanceReel();}
      else if(!previewAudio)stopReel();
    },recipe.interval);
  }
  function playReel() {
    if(previewPlaying){stopReel();return;}
    if(previewIndex===draft.photos.length-1)previewIndex=0;
    setFrame();previewPlaying=true;
    const run=++previewRun, track=draft.music;
    const status=$('[data-ed-reel-status]');
    status.textContent='';
    $('[data-ed-reel-play]').textContent='Пауза';
    if(!ctx.reducedMotion)$('[data-ed-mini]').classList.add('ed-playing');
    $('[data-ed-current-file] audio')?.pause();
    if(track?.kind==='file'){
      previewAudio=new Audio(assetUrl(track));previewAudio.volume=.8;
      previewAudio.onended=()=>{if(run===previewRun)stopReel();};
      previewAudio.play().catch(()=>{if(run===previewRun){stopReel();status.textContent='Звук не открылся. Можно листать кадры вручную.';}});
    }
    advanceReel();
  }
  function paintPreview() {
    if (disposed) return;
    if(previewOpen)stopReel();
    const recipe=makeRecipe(stateForRecipe());
    const pic=draft.photos[0], mini=$('[data-ed-mini]'), img=$('[data-ed-image]');
    const src=assetUrl(pic);
    if (src && img.getAttribute('src')!==src) img.src=src;
    if (!src) img.removeAttribute('src');
    img.hidden=!src;img.alt=pic?.name || '';
    img.style.objectPosition=limited(pic?.x??50,0,100)+'% '+limited(pic?.y??50,0,100)+'%';
    mini.style.setProperty('--ed-wash',/^#[a-f\d]{6}$/i.test(recipe.color) ? recipe.color : '#1855c9');
    mini.style.setProperty('--ed-tilt',(Number(recipe.tilt) || 0)+'deg');
    $('[data-ed-scene]').textContent=recipe.moodLabel;
    $('[data-ed-print-date]').textContent=validDate(draft.date) ? new Date(draft.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'}) : '';
    $('[data-ed-title]').textContent = draft.text.trim() || draft.titleOverride ? recipe.title : 'Ваша открытка';
    $('[data-ed-caption]').textContent = draft.text.trim() || draft.captionOverride ? recipe.caption : 'Добавьте запись и фотографию';
    $('[data-ed-choose]').disabled=!draft.text.trim();
    if(previewOpen){
      previewOpen=false;
      $('[data-ed-review]').hidden=true;
      $('[data-ed-preview]').hidden=false;
    }
  }
  function paintPhotos() {
    const box=$('[data-ed-gallery]');box.replaceChildren();
    if(!draft.photos.some(p=>p.id===selected)) selected=draft.photos[0]?.id;
    $('[data-ed-count]').textContent=draft.photos.length+' / 6';
    $('[data-ed-add-photo]').disabled=draft.photos.length>=6;
    if(!draft.photos.length) return;
    const index=draft.photos.findIndex(p=>p.id===selected), photo=draft.photos[index];
    const thumbs = draft.photos.map((p,i)=>'<button type="button" class="ed-thumb" data-ed-select="'+i+'" aria-label="Фото '+(i+1)+': '+esc(p.name)+'" aria-pressed="'+(p.id===selected)+'"><img src="'+esc(assetUrl(p))+'" alt="" style="object-position:'+limited(p.x??50,0,100)+'% '+limited(p.y??50,0,100)+'%"></button>').join('');
    box.innerHTML='<div class="ed-thumbs" aria-label="Фотографии дня">'+thumbs+'</div><div class="ed-photo-line"><strong>'+esc(photo.name)+'</strong><span>'+(index===0?'Обложка':'Фото '+(index+1))+'</span></div>'+
      '<div class="ed-photo-controls"><button type="button" data-ed-photo-op="cover" '+(!index?'disabled':'')+'>На обложку</button><button type="button" data-ed-photo-op="left" '+(!index?'disabled':'')+'>Левее</button><button type="button" data-ed-photo-op="right" '+(index===draft.photos.length-1?'disabled':'')+'>Правее</button><button type="button" data-ed-photo-op="remove">Убрать</button></div>'+
      '<details class="ed-crop"><summary>Кадрирование</summary><label class="ed-field">По горизонтали<input type="range" min="0" max="100" data-ed-crop="x" value="'+limited(photo.x??50,0,100)+'"></label>'+
      '<label class="ed-field">По вертикали<input type="range" min="0" max="100" data-ed-crop="y" value="'+limited(photo.y??50,0,100)+'"></label></details>';
  }
  function paintFile() {
    const box=$('[data-ed-current-file]'), track=draft.music;
    box.querySelector('audio')?.pause();
    if (track?.kind!=='file') {box.replaceChildren();$('[data-ed-add-music]').textContent='Выбрать аудиофайл';return;}
    box.innerHTML='<div class="ed-track"><strong>'+esc(track.name)+'</strong><button type="button" class="ed-text-button" data-ed-remove-music>Убрать</button></div>'+
      '<audio controls preload="metadata" src="'+esc(assetUrl(track))+'" aria-label="Послушать песню"></audio>'+
      '<label class="ed-field">Характер песни<select data-ed-file-energy>'+options(energyNames,track.energy)+'</select></label>'+
      '<p class="ed-help">'+(track.bpm?'Темп · '+clamp(Number(track.bpm),20,300)+' уд/мин':track.analyzed?'Характер определён по звуку.':'Характер можно выбрать вручную.')+'</p>';
    $('[data-ed-add-music]').textContent='Заменить аудиофайл';
  }
  function paintLink() {
    const a=$('[data-ed-link-action]');
    const u=musicURL(draft.linkDraft);
    if (!draft.linkDraft) {a.replaceChildren(); return;}
    if(!u){a.textContent='Нужна HTTPS-ссылка на музыкальный сервис, например Spotify, Apple Music или YouTube.';return;}
    a.innerHTML='<a rel="noopener noreferrer" target="_blank" href="'+esc(u.href)+'">Открыть песню в сервисе</a>';
  }
  function syncLink() {
    const u=musicURL(draft.linkDraft);
    if(u) draft.music={kind:'link',name:draft.linkName.trim() || u.host,url:u.href,energy:draft.linkEnergy};
    else if(draft.music?.kind==='link') draft.music=null;
    paintLink();mark();
  }
  function showMode() {
    for(const btn of root.querySelectorAll('[data-ed-mode]')) btn.setAttribute('aria-pressed',String(btn.dataset.edMode===draft.musicMode));
    $('[data-ed-link-pane]').hidden=draft.musicMode!=='link';
    $('[data-ed-file-pane]').hidden=draft.musicMode!=='file';
    if(draft.musicMode==='link') $('[data-ed-current-file] audio')?.pause();
    paintFile();paintLink();
  }
  function paintMoments() {
    const box=$('[data-ed-moments]');
    if (!draft.moments.length) return;
    box.innerHTML='<div class="ed-moments"><h3>Моменты дня</h3>'+draft.moments.map((m,i)=>{
      const d=new Date(m.time);
      const time=isNaN(d)?'':d.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
      return '<div><span>'+esc(time)+'</span><p>'+esc(m.text)+'</p><button type="button" data-ed-use="'+i+'">В текст</button></div>';
    }).join('')+'</div>';
  }
  function validate() {
    issue('');
    if (!validDate(date.value)) {issue('Выберите дату дня.',date);return false;}
    if (!draft.text.trim()) {issue('Напишите хотя бы одну фразу о дне.',text);return false;}
    if (!draft.photos.length) {issue('Добавьте хотя бы одну фотографию.',$('[data-ed-add-photo]'));return false;}
    if (!draft.music || draft.music.kind!==draft.musicMode || (draft.musicMode==='link' && !musicURL(draft.linkDraft))) {
      issue(draft.musicMode==='link' ? 'Добавьте HTTPS-ссылку на песню.' : 'Выберите аудиофайл или добавьте ссылку на песню.',draft.musicMode==='link'?$('[data-ed-link]'):$('[data-ed-add-music]'));return false;
    }
    if(draft.titleOverride?.trim() && (wordCount(draft.titleOverride)<3 || wordCount(draft.titleOverride)>7)) {
      $('.ed-custom').open=true;issue('В названии папки должно быть от 3 до 7 слов.',title);return false;
    }
    return true;
  }
  function explain() {
    const { reasons }=makeRecipe(stateForRecipe());
    const labels={text:'Текст',photo:'Фотография',music:'Музыка'};
    ctx.sheet('Почему открытка выглядит так', '<dl class="ed-reasons">'+Object.entries(labels).map(([key,label])=>'<div><dt>'+label+'</dt><dd>'+esc(reasons?.[key] || 'Добавьте материал, чтобы посмотреть его влияние.')+'</dd></div>').join('')+'</dl>');
  }
  async function finish() {
    if (committing) return;
    if (busy) {issue('Дождитесь окончания обработки файла.');return;}
    if (!validate()) return;
    committing=true;
    const button=$('[data-ed-save]');button.disabled=true;
    try {
      await flush();
      const recipe=makeRecipe(stateForRecipe());
      const completed={...snapshot(),id:base.id || draft.id,revision:base.revision,primary:base.primary,status:'ready',title:recipe.title,caption:recipe.caption,recipe};
      delete completed.pendingEdit;
      base=await saveDay(completed);
      persisted=seq;saveError='';viewStatus();
      stopReel();ctx.toast?.('День сохранён');
      ctx.viewDay(base);
    } catch {
      issue('Не удалось сохранить день. Проверьте место на устройстве и попробуйте ещё раз.');
    } finally {committing=false;button.disabled=false;}
  }

  on(date,'input',()=>{if(validDate(date.value)){draft.date=date.value;mark();}});
  on(text,'input',()=>{draft.text=text.value;mark();});
  on(title,'input',()=>{draft.titleOverride=title.value.trim();mark();});
  on(caption,'input',()=>{draft.captionOverride=caption.value.trim();mark();});
  on($('[data-ed-mood]'),'change',e=>{draft.moodOverride=e.target.value;mark();});
  on($('[data-ed-rhythm]'),'change',e=>{draft.rhythmOverride=e.target.value;mark();});
  on($('[data-ed-add-photo]'),'click',()=>photoInput.click());
  on(photoInput,'change',()=>{
    const files=[...photoInput.files]; photoInput.value='';
    if(!files.length)return;
    track((async()=>{
      issue('');const errors=[];
      for(const file of files) {
        if(disposed)return;
        if(draft.photos.length>=6) {errors.push('Можно добавить до шести фото.');break;}
        try {
          const p=await photoFromFile(file);
          if(disposed)return;
          if(draft.photos.length>=6){errors.push('Можно добавить до шести фото.');break;}
          draft.photos.push(p);selected=p.id;paintPhotos();mark();
        } catch(e){errors.push(e.message);}
      }
      if(errors.length) issue(errors.join(' '),$('[data-ed-add-photo]'));
    })(),$('[data-ed-add-photo]'));
  });
  on($('[data-ed-gallery]'),'click',e=>{
    const sel=e.target.closest('[data-ed-select]'), op=e.target.closest('[data-ed-photo-op]');
    if(sel) {selected=draft.photos[Number(sel.dataset.edSelect)]?.id;paintPhotos();$('[data-ed-select][aria-pressed="true"]')?.focus({preventScroll:true});return;}
    if(!op||op.disabled)return;
    const i=draft.photos.findIndex(p=>p.id===selected);if(i<0)return;
    const [p]=draft.photos.splice(i,1), value=op.dataset.edPhotoOp;
    if(value!=='remove') draft.photos.splice(value==='cover'?0:value==='left'?i-1:i+1,0,p);
    selected=value==='remove'?draft.photos[Math.min(i,draft.photos.length-1)]?.id:p.id;
    paintPhotos();mark();
    ($('[data-ed-select][aria-pressed="true"]') || $('[data-ed-add-photo]')).focus({preventScroll:true});
  });
  on($('[data-ed-gallery]'),'input',e=>{
    if(!e.target.matches('[data-ed-crop]'))return;
    const p=draft.photos.find(p=>p.id===selected); if(!p)return;
    p[e.target.dataset.edCrop]=limited(e.target.value,0,100);
    const img=$('.ed-thumb[aria-pressed="true"] img');
    if(img)img.style.objectPosition=(p.x??50)+'% '+(p.y??50)+'%';
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
    if(draft.musicMode==='link' && musicURL(draft.linkDraft)) syncLink();
    else mark();
  });
  on($('[data-ed-link]'),'input',e=>{draft.linkDraft=e.target.value.trim();syncLink();});
  on($('[data-ed-link-name]'),'input',e=>{draft.linkName=e.target.value;syncLink();});
  on($('[data-ed-energy]'),'change',e=>{draft.linkEnergy=e.target.value;syncLink();});
  on($('[data-ed-moments]'),'click',e=>{
    const btn=e.target.closest('[data-ed-use]');if(!btn)return;
    const v=draft.moments[Number(btn.dataset.edUse)]?.text;
    if(v && !draft.text.includes(v)){draft.text=[draft.text.trim(),v].filter(Boolean).join('\n');text.value=draft.text;mark();}
    text.focus();
  });
  on($('[data-ed-choose]'),'click',()=>{
    const phrases = draft.text.split(/(?<=[.!?…])\s+|\n+/u).map(s=>s.trim()).filter(Boolean).slice(0,30);
    if (!phrases.length) return;
    ctx.sheet('Выбрать фразу','<div class="grid-list">'+phrases.map((v,i)=>'<button type="button" data-ed-phrase="'+i+'">'+esc(v.slice(0,220))+'</button>').join('')+'</div>',panel=>{
      panel.addEventListener('click',e=>{
        const b=e.target.closest('[data-ed-phrase]');if(!b || disposed)return;
        draft.captionOverride=phrases[Number(b.dataset.edPhrase)].slice(0,220);caption.value=draft.captionOverride;mark();ctx.closeSheet?.();
      });
    });
  });
  on($('[data-ed-reel-play]'),'click',playReel);
  on($('[data-ed-reel-prev]'),'click',()=>{stopReel();previewIndex=Math.max(0,previewIndex-1);setFrame();});
  on($('[data-ed-reel-next]'),'click',()=>{stopReel();previewIndex=Math.min(draft.photos.length-1,previewIndex+1);setFrame();});
  on($('[data-ed-why]'),'click',explain);
  on($('[data-ed-later]'),'click',async()=>{
    try {await flush();if(!disposed)ctx.go('archive');} catch(e){issue(e.message);}
  });
  on($('[data-ed-discard]'),'click',()=>{
    if(!published)return;
    ctx.sheet('Отменить правки?', '<p>Будет восстановлена последняя сохранённая открытка. Изменения в черновике этого дня удалятся.</p><div class="ed-actions"><button type="button" class="secondary" data-keep>Продолжить редактирование</button><button type="button" class="primary" data-discard>Вернуть открытку</button></div>',panel=>{
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
          ctx.toast?.('Сохранённая открытка восстановлена');ctx.viewDay(base);
        } catch{ctx.toast?.('Не удалось восстановить открытку. Попробуйте ещё раз.');}
        finally{committing=false;confirm.disabled=false;}
      };
    });
  });
  on($('[data-ed-preview]'),'click',()=>{
    if(busy){issue('Дождитесь окончания обработки файла.');return;}
    if(!validate()) return;
    previewOpen=true;previewIndex=0;setFrame();$('[data-ed-review]').hidden=false;$('[data-ed-preview]').hidden=true;
    $('[data-ed-reel-status]').textContent='';
    const u=draft.music?.kind==='link' && musicURL(draft.music.url);
    $('[data-ed-reel-link]').innerHTML=u?'<a target="_blank" rel="noopener noreferrer" href="'+esc(u.href)+'">Открыть песню в сервисе</a>':'';
    $('[data-ed-reel-play]').focus({preventScroll:true});
    $('[data-ed-mini]').scrollIntoView({block:'nearest'});
  });
  on($('[data-ed-return]'),'click',()=>{paintPreview();text.focus();});
  on($('[data-ed-save]'),'click',finish);
  on(document,'visibilitychange',()=>{if(document.hidden){queueDraft();stopReel();$('[data-ed-current-file] audio')?.pause();}});
  on(window,'pagehide',queueDraft);
  paintMoments();paintPhotos();showMode();paintPreview();viewStatus();
  function cleanup() {
    if(disposed)return;
    if(seq>persisted) queueDraft();
    stopReel();disposed=true;controller.abort();clearTimeout(timer);
    $('[data-ed-current-file] audio')?.pause();
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }
  cleanup.flush=flush;
  return cleanup;
}
