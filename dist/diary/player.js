import { makeRecipe } from './art.js';

const env = window;
const localMedia = /^(?:\.\/)?diary\/media\/[\w.-]+$/;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
function webAddress(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function dateText(iso) {
  const date = new Date(iso + 'T12:00:00');
  return Number.isNaN(+date) ? '' : new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'long'}).format(date);
}

function getSavedRecipe(day) {
  const derived = makeRecipe(day);
  const saved = day.status === 'ready' && day.recipe?.version === 1 ? day.recipe : {};
  const base = {...derived,...saved};
  base.color = /^#[\da-f]{6}$/i.test(base.color) ? base.color : derived.color;
  base.motion = ['float','lift','pan','cut'].includes(base.motion) ? base.motion : derived.motion;
  base.tilt = clamp(Number(base.tilt) || 0, -8, 8);
  base.interval = clamp(Number(base.interval) || derived.interval, 1800, 12000);
  base.reasons = {...derived.reasons,...saved.reasons};
  return base;
}

export function mountPlayer(root, day, ctx) {
  const {esc,icon} = ctx;
  const recipe = getSavedRecipe(day), photos = day.photos || [], music = day.music || {};
  const demo = day.id?.startsWith('demo-');
  const urls = new Map(), own = new AbortController(), opts = {signal:own.signal};
  const urlFor = media => {
    if (!media) return '';
    if (media.blob instanceof Blob) {
      if (!urls.has(media.blob)) urls.set(media.blob, URL.createObjectURL(media.blob));
      return urls.get(media.blob);
    }
    return localMedia.test(media.src || '') ? media.src : '';
  };
  const el = key => root.querySelector('[data-card="'+key+'"]');
  const song = music.kind === 'link' ? webAddress(music.url) : '';
  const audioSrc = music.kind === 'file' ? urlFor(music) : '';
  const audio = audioSrc ? new Audio(audioSrc) : null;
  if (audio) { audio.preload='metadata'; audio.volume = .83; }
  const speech = env.speechSynthesis;
  speech?.getVoices();
  const artIcon = (name) => icon(name,21);
  const action = (id,symbol,label,note='') =>
    '<button class="ab-row" type="button" data-card="'+id+'"><span class="ab-source-icon">'+artIcon(symbol)+'</span><span class="ab-row-name"><b>'+esc(label)+'</b>'+
    (note?'<small>'+esc(note)+'</small>':'')+'</span><span class="card-row-next">'+icon('chevron',15)+'</span></button>';
  let position=0, playing=false, stopTimer=0, nextAt=0, remaining=recipe.interval, pendingPlay=0, utterance=null, destroyed=false;
  let finished=false, visualDone=false, audioUnavailable=false;
  root.innerHTML='<div class="ab-view ab-audit diary-card">'+
    '<section class="ab-hero" data-card="hero"><div class="ab-hero-copy">'+
    '<div class="ab-meta"><span class="ab-record-mark" aria-hidden="true"></span><span>'+esc(dateText(day.date))+' · '+esc(recipe.moodLabel)+'</span></div>'+
    '<h2>'+esc(recipe.title)+'</h2><p class="card-caption">'+esc(recipe.caption)+'</p>'+
    '<button class="ab-action" type="button" data-card="hero-play"></button></div>'+
    '<div class="ab-art card-art"><button class="card-print" type="button" data-card="zoom" aria-label="Рассмотреть открытку целиком">'+
    '<i class="card-back" aria-hidden="true"></i><i class="card-middle" aria-hidden="true"></i><span class="card-print-paper">'+
    '<span class="card-print-clip"><img data-card="photo" alt=""></span><span class="card-paper-foot"><span>'+esc(dateText(day.date))+'</span><span data-card="paper-count"></span></span></span></button></div></section>'+
    '<section class="ab-player"><div class="ab-player-head"><h2>Воспроизведение</h2><span class="ab-count" data-card="counter"></span></div>'+
    '<label class="ab-scrub" data-card="scrub"><span class="ab-sr">Выбрать кадр</span><input type="range" data-card="seek" min="1" max="'+Math.max(1,photos.length)+'" step="1" value="1"></label>'+
    '<div class="ab-player-actions"><div class="ab-transport" data-card="transport"><button type="button" data-card="prev" aria-label="Предыдущее фото">'+artIcon('prev')+'</button>'+
    '<button type="button" class="ab-play" data-card="play"></button><button type="button" data-card="next" aria-label="Следующее фото">'+artIcon('next')+'</button></div>'+
    '<button type="button" class="card-sound" data-card="mute">Звук</button></div>'+
    '<div class="card-track"><strong>'+esc(music.name || 'Музыка дня')+'</strong>'+
    (song?'<a href="'+esc(song)+'" target="_blank" rel="noopener noreferrer">Открыть песню</a>':'<span>'+esc(recipe.bpm)+' уд/мин</span>')+'</div>'+
    '<p class="card-status" role="status" data-card="status"></p></section>'+
    '<section class="ab-evidence"><h2>Папка дня</h2>'+
    action('read','document','Прочитать запись',day.moments?.length?'Сохранённые заметки и текст':'Полный текст дня')+
    action('explain','layers','Почему так выглядит',recipe.treatment)+
    (demo ? action('copy','folder','Попробовать на копии','Сохранить в свой дневник') :
      action('edit','document','Изменить день')+action('options','more','Действия с папкой'))+
    (demo ? action('credits','info','Авторы материалов'):'')+'</section></div>';
  const frame=root.querySelector('.diary-card');
  frame.style.setProperty('--day-paper',recipe.color);
  frame.style.setProperty('--day-tilt',recipe.tilt+'deg');
  frame.style.setProperty('--day-duration',recipe.interval+'ms');
  frame.dataset.motion=recipe.motion;
  frame.classList.toggle('is-still',Boolean(ctx.reducedMotion));
  el('scrub').hidden=photos.length<2;
  el('prev').hidden=el('next').hidden=photos.length<2;
  el('mute').hidden=!audio;
  function notice(text='') { if (!destroyed) el('status').textContent=text; }
  function buttons() {
    if (destroyed) return;
    const label=playing?'Пауза':'Оживить открытку';
    el('hero-play').innerHTML=icon(playing?'pause':'play',17)+'<span>'+label+'</span>';
    el('play').innerHTML=icon(playing?'pause':'play',18);
    el('play').setAttribute('aria-label',playing?'Пауза':'Воспроизвести');
    el('hero-play').setAttribute('aria-pressed',String(playing));
    el('play').setAttribute('aria-pressed',String(playing));
    if (audio) {
      el('mute').textContent=audio.muted?'Без звука':'Со звуком';
      el('mute').setAttribute('aria-label',audio.muted?'Включить звук':'Выключить звук');
      el('mute').setAttribute('aria-pressed',String(audio.muted));
    }
    frame.classList.toggle('is-playing',playing);
  }
  function paint() {
    const count = photos.length;
    const photo=photos[position];
    const uri=urlFor(photo), img=el('photo');
    if (uri) { img.src=uri; img.alt=photo.name || ('Фото '+(position+1)); img.hidden=false; }
    else { img.removeAttribute('src'); img.alt=''; img.hidden=true; }
    img.style.objectPosition=(Number.isFinite(photo?.x)?clamp(photo.x,0,100):50)+'% '+(Number.isFinite(photo?.y)?clamp(photo.y,0,100):50)+'%';
    el('counter').textContent=count?(position+1)+' из '+count:'Без фото';
    el('paper-count').textContent=String(position+1).padStart(2,'0')+' / '+String(Math.max(count,1)).padStart(2,'0');
    el('seek').value=position+1;
    el('seek').setAttribute('aria-valuetext','Кадр '+(position+1)+' из '+count);
    el('seek').style.setProperty('--ab-fill',count>1?position*100/(count-1)+'%':'0%');
    el('prev').disabled=position===0;
    el('next').disabled=position>=count-1;
  }
  function stopSpeech() {
    if (!utterance) return;
    utterance=null;
    speech?.cancel();
    if (audio) audio.volume=.83;
  }
  function pause(reset=false) {
    pendingPlay++;
    clearTimeout(stopTimer);
    if (playing) remaining=clamp(nextAt-performance.now(),50,recipe.interval);
    playing=false;
    audio?.pause();
    if (reset) remaining=recipe.interval;
    buttons();
  }
  function finishIfReady() {
    if (!playing || !visualDone || (audio && !audioUnavailable && !audio.ended)) return;
    pause(true);finished=true;notice('Открытка просмотрена');
  }
  audio?.addEventListener('ended',finishIfReady,opts);
  audio?.addEventListener('error',()=>{audioUnavailable=true;finishIfReady();},opts);
  function advance() {
    clearTimeout(stopTimer);
    if (!playing) return;
    if (visualDone) {finishIfReady();return;}
    nextAt=performance.now()+remaining;
    stopTimer=env.setTimeout(()=>{
      if (position<photos.length-1) {
        position++; remaining=recipe.interval; paint(); advance();
      } else {
        visualDone=true;finishIfReady();
      }
    },remaining);
  }
  function locate(index) {
    if (!photos.length) return;
    finished=false;visualDone=false;position=clamp(index,0,photos.length-1);
    remaining=recipe.interval;
    if (audio && Number.isFinite(audio.duration)) audio.currentTime=Math.min(audio.duration-.05,position*recipe.interval/1000);
    notice(); paint(); advance();
  }
  function toggle() {
    if (playing) {pause();return;}
    // Restart the reel when a previous playthrough ended on its last frame.
    if (finished) locate(0);
    notice(); stopSpeech(); playing=true; buttons(); advance();
    if (audio) {
      if (audio.ended || audio.currentTime>=audio.duration-.08) audio.currentTime=0;
      const request=++pendingPlay;
      audioUnavailable=false;
      audio.play().catch(()=>{
        if (destroyed || request!==pendingPlay) return;
        audioUnavailable=true;finishIfReady();
        notice('Звук не удалось запустить. Фотографии можно листать вручную.');
      });
    } else if (song) notice('Музыка откроется по кнопке «Открыть песню».');
  }
  function show(title,html,bind) {
    pause();
    ctx.sheet(title, html,bind);
  }
  el('hero-play').addEventListener('click',toggle);
  el('play').addEventListener('click',toggle);
  el('prev').addEventListener('click',()=>locate(position-1));
  el('next').addEventListener('click',()=>locate(position+1));
  el('seek').addEventListener('input',e=>locate(Number(e.target.value)-1));
  el('mute').addEventListener('click',()=>{if(audio){audio.muted=!audio.muted;buttons();}});
  el('photo').addEventListener('error',()=>{el('photo').hidden=true;notice('Фото не открылось. Остальная запись доступна.');});
  el('zoom').addEventListener('click',()=>{
    const p=photos[position],src=urlFor(p);
    const alt=esc(p?.name || 'Фотография дня');
    const img=src?'<img class="card-full-photo" src="'+esc(src)+'" alt="'+alt+'">':'';
    show('Открытка дня','<figure class="card-full-print" style="--day-paper:'+recipe.color+'">'+img+
      '<figcaption><small>'+esc(dateText(day.date))+'</small><strong>'+esc(recipe.title)+'</strong><p>'+esc(recipe.caption)+'</p></figcaption></figure>');
  });
  let touch=null, swiped=false;
  const zoom=el('zoom');
  zoom.addEventListener('touchstart',e=>{const t=e.changedTouches[0];touch=[t.clientX,t.clientY];},{passive:true});
  zoom.addEventListener('touchend',e=>{
    const t=e.changedTouches[0]; if(!touch) return;
    const dx=t.clientX-touch[0],dy=t.clientY-touch[1];touch=null;
    if(photos.length>1 && Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy)*1.3) {
      locate(position+(dx>0?-1:1)); swiped=true; env.setTimeout(()=>{swiped=false;},400);
    }
  },{passive:true});
  zoom.addEventListener('click',e=>{if(swiped){e.stopImmediatePropagation();swiped=false;}},true);
  el('explain').addEventListener('click',()=>show('Почему так выглядит','<div class="card-notes">'+
    [['Текст',recipe.reasons.text],['Фото',recipe.reasons.photo],['Музыка',recipe.reasons.music]].map(([a,b])=>'<section><h3>'+a+'</h3><p>'+esc(b)+'</p></section>').join('')+'</div>'));
  el('read').addEventListener('click',()=>{
    const notes=(day.moments || []).map(item=>'<li>'+esc(item.text)+'</li>').join('');
    const localVoice = speech?.getVoices().find(v=>v.localService && /^ru(?:[-_]|$)/i.test(v.lang));
    show('Запись за '+dateText(day.date),'<div class="card-notes"><p class="card-original">'+esc(day.text)+'</p>'+
      (notes?'<section><h3>Моменты дня</h3><ul>'+notes+'</ul></section>':'')+
      (localVoice?'<button type="button" class="secondary" data-speak>Послушать запись</button>':'')+'</div>',body=>{
      const b=body?.querySelector('[data-speak]');
      if (!b) return;
      b.onclick=()=>{
        if (utterance) {stopSpeech();b.textContent='Послушать запись';return;}
        const u=new SpeechSynthesisUtterance(day.text);
        u.voice=localVoice;u.lang=localVoice.lang;u.rate=recipe.mood==='restless'?1.04:.91;
        u.onend=u.onerror=()=>{if(utterance===u){utterance=null;b.textContent='Послушать запись';}};
        utterance=u;b.textContent='Остановить чтение';speech.speak(u);
      };
    });
  });
  if (demo) {
    const copyButton=el('copy');
    copyButton.addEventListener('click',async()=>{
      if(copyButton.disabled) return;
      pause();copyButton.disabled=true;
      try { await ctx.copyDemo(day); }
      catch { notice('Копию не удалось сохранить. Проверь свободное место и попробуй снова.'); }
      finally { if(!destroyed) copyButton.disabled=false; }
    });
    el('credits').addEventListener('click',()=>show('Авторы материалов','<div class="card-notes"><p>Вымышленная запись. Музыка написана для этого дневника.</p>'+
      photos.map(p=>'<section><h3>'+esc(p.name)+'</h3><p>'+esc(p.credit || '')+'</p>'+
        (webAddress(p.source)?'<a href="'+esc(webAddress(p.source))+'" target="_blank" rel="noopener noreferrer">Источник фотографии</a>':'')+'</section>').join('')+'</div>'));
  } else {
    el('edit').addEventListener('click',()=>{pause();ctx.edit(day);});
    el('options').addEventListener('click',()=>{pause();ctx.dayActions(day);});
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();stopSpeech();}},opts);
  document.querySelector('dialog')?.addEventListener('close',stopSpeech,opts);
  env.addEventListener('pagehide',()=>{pause();stopSpeech();},opts);
  paint();buttons();
  return ()=>{
    pause();destroyed=true;own.abort();stopSpeech();
    if(audio){audio.removeAttribute('src');audio.load();}
    urls.forEach(url=>URL.revokeObjectURL(url));
  };
}
