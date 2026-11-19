import {presentRecipe,storyLanguage} from './art.js';
import {formatDate} from './i18n.js';
import {playerText as t} from './locales/player.js';

const env = window;
const localMedia = /^(?:\.\/)?diary\/media\/[\w.-]+$/;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
function webAddress(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function mountPlayer(root, day, ctx, viewState={}) {
  const {esc,icon} = ctx;
  const recipe = presentRecipe(day), photos = day.photos || [], music = day.music || {};
  const lang=storyLanguage(day);
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
  const html=(key,values)=>esc(t(key,values));
  const song = music.kind === 'link' ? webAddress(music.url) : '';
  const audioSrc = music.kind === 'file' ? urlFor(music) : '';
  const audio = audioSrc ? new Audio(audioSrc) : null;
  if (audio) {
    audio.preload='metadata';
    audio.volume=.83;
    audio.muted=Boolean(viewState?.muted);
  }
  const speech = env.speechSynthesis;
  speech?.getVoices();
  const artIcon = (name) => icon(name,21);
  const action = (id,symbol,label,note='') =>
    '<button class="ab-row" type="button" data-card="'+id+'"><span class="ab-source-icon">'+artIcon(symbol)+'</span><span class="ab-row-name"><b>'+esc(label)+'</b>'+
    (note?'<small>'+esc(note)+'</small>':'')+'</span><span class="card-row-next">'+icon('chevron',15)+'</span></button>';
  let position=clamp(Number.isInteger(viewState?.position)?viewState.position:0,0,Math.max(0,photos.length-1));
  let remaining=Number.isFinite(viewState?.remaining)?clamp(viewState.remaining,50,recipe.interval):recipe.interval;
  let resumeTime=Number.isFinite(viewState?.time)?viewState.time:0;
  let playing=false, stopTimer=0, nextAt=0, pendingPlay=0, utterance=null, destroyed=false;
  audio?.addEventListener('loadedmetadata',()=>{
    if (resumeTime>0 && Number.isFinite(audio.duration)) audio.currentTime=clamp(resumeTime,0,Math.max(0,audio.duration-.05));
    resumeTime=0;
  },opts);
  let finished=false, visualDone=false, audioUnavailable=false;
  root.innerHTML='<div class="ab-view ab-audit diary-card">'+
    '<section class="ab-hero" data-card="hero"><div class="ab-hero-copy">'+
    '<div class="ab-meta"><span class="ab-record-mark" aria-hidden="true"></span><span>'+esc(formatDate(day.date))+' · '+esc(recipe.moodLabel)+'</span></div>'+
    '<h2 lang="'+lang+'">'+esc(recipe.title)+'</h2><p class="card-caption" lang="'+lang+'">'+esc(recipe.caption)+'</p>'+
    '<button class="ab-action" type="button" data-card="hero-play"></button></div>'+
    '<div class="ab-art card-art"><button class="card-print" type="button" data-card="zoom" aria-label="'+html('zoom')+'">'+
    '<i class="card-back" aria-hidden="true"></i><i class="card-middle" aria-hidden="true"></i><span class="card-print-paper">'+
    '<span class="card-print-clip"><img data-card="photo" alt=""></span><span class="card-paper-foot"><span>'+esc(formatDate(day.date))+'</span><span data-card="paper-count"></span></span></span></button></div></section>'+
    '<section class="ab-player"><div class="ab-player-head"><h2>'+html('playback')+'</h2><span class="ab-count" data-card="counter"></span></div>'+
    '<label class="ab-scrub" data-card="scrub"><span class="ab-sr">'+html('chooseFrame')+'</span><input type="range" data-card="seek" min="1" max="'+Math.max(1,photos.length)+'" step="1" value="1"></label>'+
    '<div class="ab-player-actions"><div class="ab-transport" data-card="transport"><button type="button" data-card="prev" aria-label="'+html('previous')+'">'+artIcon('prev')+'</button>'+
    '<button type="button" class="ab-play" data-card="play"></button><button type="button" data-card="next" aria-label="'+html('next')+'">'+artIcon('next')+'</button></div>'+
    '<button type="button" class="card-sound" data-card="mute">'+html('sound')+'</button></div>'+
    '<div class="card-track"><strong>'+esc(music.name || t('dayMusic'))+'</strong>'+
    (song?'<a href="'+esc(song)+'" target="_blank" rel="noopener noreferrer">'+html('openSong')+'</a>':'<span>'+html('bpm',{bpm:recipe.bpm})+'</span>')+'</div>'+
    '<p class="card-status" role="status" data-card="status"></p></section>'+
    '<section class="ab-evidence"><h2>'+html('folder')+'</h2>'+
    action('read','document',t('read'),day.moments?.length?t('notesAndText'):t('dayText'))+
    action('explain','layers',t('explain'),recipe.treatment)+
    (demo ? action('copy','folder',t('copy'),t('keep')) :
      action('edit','document',t('edit'))+action('options','more',t('options')))+
    (demo ? action('credits','info',t('credits')):'')+'</section></div>';
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
    const label=playing?t('pause'):t('animate');
    el('hero-play').innerHTML=icon(playing?'pause':'play',17)+'<span>'+esc(label)+'</span>';
    el('play').innerHTML=icon(playing?'pause':'play',18);
    el('play').setAttribute('aria-label',playing?t('pause'):t('play'));
    el('hero-play').setAttribute('aria-pressed',String(playing));
    el('play').setAttribute('aria-pressed',String(playing));
    if (audio) {
      el('mute').textContent=audio.muted?t('muted'):t('unmuted');
      el('mute').setAttribute('aria-label',audio.muted?t('unmute'):t('mute'));
      el('mute').setAttribute('aria-pressed',String(audio.muted));
    }
    frame.classList.toggle('is-playing',playing);
  }
  function paint() {
    const count = photos.length;
    const photo=photos[position];
    const uri=urlFor(photo), img=el('photo');
    if (uri) { img.src=uri; img.alt=photo.name || t('numberedPhoto',{index:position+1}); img.hidden=false; }
    else { img.removeAttribute('src'); img.alt=''; img.hidden=true; }
    img.style.objectPosition=(Number.isFinite(photo?.x)?clamp(photo.x,0,100):50)+'% '+(Number.isFinite(photo?.y)?clamp(photo.y,0,100):50)+'%';
    el('counter').textContent=count?t('count',{index:position+1,count}):t('noPhoto');
    el('paper-count').textContent=String(position+1).padStart(2,'0')+' / '+String(Math.max(count,1)).padStart(2,'0');
    el('seek').value=position+1;
    el('seek').setAttribute('aria-valuetext',t('frameCount',{index:position+1,count}));
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
    pause(true);finished=true;notice(t('finished'));
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
    remaining=recipe.interval;resumeTime=0;
    if (audio && Number.isFinite(audio.duration)) audio.currentTime=Math.max(0,Math.min(audio.duration-.05,position*recipe.interval/1000));
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
        notice(t('audioUnavailable'));
      });
    } else if (song) notice(t('externalSong'));
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
  el('photo').addEventListener('error',()=>{el('photo').hidden=true;notice(t('imageUnavailable'));});
  el('zoom').addEventListener('click',()=>{
    const p=photos[position],src=urlFor(p);
    const alt=esc(p?.name || t('dayPhoto'));
    const img=src?'<img class="card-full-photo" src="'+esc(src)+'" alt="'+alt+'">':'';
    show(t('dayPostcard'),'<figure class="card-full-print" style="--day-paper:'+recipe.color+'">'+img+
      '<figcaption><small>'+esc(formatDate(day.date))+'</small><strong>'+esc(recipe.title)+'</strong><p>'+esc(recipe.caption)+'</p></figcaption></figure>');
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
  el('explain').addEventListener('click',()=>show(t('explain'),'<div class="card-notes">'+
    [[t('text'),recipe.reasons.text],[t('photo'),recipe.reasons.photo],[t('music'),recipe.reasons.music]].map(([a,b])=>'<section><h3>'+esc(a)+'</h3><p>'+esc(b)+'</p></section>').join('')+'</div>'));
  el('read').addEventListener('click',()=>{
    const notes=(day.moments || []).map(item=>'<li>'+esc(item.text)+'</li>').join('');
    const localVoice=()=>speech?.getVoices().find(v=>v.localService && v.lang.toLowerCase().split(/[-_]/)[0]===lang);
    show(t('datedEntry',{date:formatDate(day.date)}),'<div class="card-notes"><p class="card-original" lang="'+lang+'">'+esc(day.text)+'</p>'+
      (notes?'<section><h3>'+html('moments')+'</h3><ul>'+notes+'</ul></section>':'')+
      (speech && env.SpeechSynthesisUtterance?'<button type="button" class="secondary" data-speak hidden>'+html('listen')+'</button>':'')+'</div>',body=>{
      const b=body?.querySelector('[data-speak]');
      if (!b) return;
      const refresh=()=>{b.hidden=!localVoice();};
      const dialog=b.closest('dialog');
      const removeListener=()=>speech.removeEventListener('voiceschanged',refresh);
      refresh();
      speech.addEventListener('voiceschanged',refresh,opts);
      dialog?.addEventListener('close',removeListener,{once:true,signal:own.signal});
      b.onclick=()=>{
        if (utterance) {stopSpeech();b.textContent=t('listen');return;}
        const voice=localVoice();
        if(!voice) {refresh();return;}
        const u=new SpeechSynthesisUtterance(day.text);
        u.voice=voice;u.lang=voice.lang;u.rate=recipe.voiceRate;u.pitch=recipe.voicePitch;
        u.onend=u.onerror=()=>{if(utterance===u){utterance=null;b.textContent=t('listen');}};
        utterance=u;b.textContent=t('stopReading');speech.speak(u);
      };
    });
  });
  if (demo) {
    const copyButton=el('copy');
    copyButton.addEventListener('click',async()=>{
      if(copyButton.disabled) return;
      pause();copyButton.disabled=true;
      try { await ctx.copyDemo(day); }
      catch { notice(t('copyFailed')); }
      finally { if(!destroyed) copyButton.disabled=false; }
    });
    el('credits').addEventListener('click',()=>show(t('credits'),'<div class="card-notes"><p>'+html('fictional')+'</p>'+
      '<section><h3>'+html('music')+'</h3><p>'+esc(music.name)+' · '+esc(music.credit)+'</p></section>'+
      photos.map(p=>'<section><h3>'+esc(p.name)+'</h3><p>'+esc(p.credit || '')+'</p>'+
        (webAddress(p.source)?'<a href="'+esc(webAddress(p.source))+'" target="_blank" rel="noopener noreferrer">'+html('photoSource')+'</a>':'')+'</section>').join('')+'</div>'));
  } else {
    el('edit').addEventListener('click',()=>{pause();ctx.edit(day);});
    el('options').addEventListener('click',()=>{pause();ctx.dayActions(day);});
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();stopSpeech();}},opts);
  document.querySelector('dialog')?.addEventListener('close',stopSpeech,opts);
  env.addEventListener('pagehide',()=>{pause();stopSpeech();},opts);
  paint();buttons();
  const cleanup=()=>{
    pause();destroyed=true;own.abort();stopSpeech();
    if(audio){audio.removeAttribute('src');audio.load();}
    urls.forEach(url=>URL.revokeObjectURL(url));
  };
  cleanup.getViewState=()=>({
    position,muted:audio?.muted || false,time:resumeTime || audio?.currentTime || 0,
    remaining:playing?clamp(nextAt-performance.now(),50,recipe.interval):remaining
  });
  return cleanup;
}
