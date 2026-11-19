import {presentRecipe,storyLanguage} from './art.js';
import {formatDate} from './i18n.js';
import {musicLink} from './music-link.js';
import {mountProvider} from './provider-player.js';
import {playerText as t} from './locales/player.js';

const env=window;
const localMedia=/^(?:\.\/)?diary\/media\/[\w.-]+$/;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
function webAddress(value) {
  try {
    const url=new URL(value);
    return url.protocol==='https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function mountPlayer(root,day,ctx,viewState={}) {
  const {esc,icon}=ctx, recipe=presentRecipe(day), photos=day.photos || [], music=day.music || {};
  const lang=storyLanguage(day), date=formatDate(day.date), demo=day.id?.startsWith('demo-');
  const own=new AbortController(), opts={signal:own.signal}, urls=new Map();
  const audioLink=music.kind==='link' ? musicLink(music.url) : null;
  const song=audioLink?.url || (music.kind==='link' ? webAddress(music.url) : '');
  const embedded=['youtube','spotify'].includes(audioLink?.provider);
  const html=(key,values)=>esc(t(key,values));
  function urlFor(media) {
    if (!media) return '';
    if (media.blob instanceof Blob) {
      if (!urls.has(media.blob)) urls.set(media.blob,URL.createObjectURL(media.blob));
      return urls.get(media.blob);
    }
    return localMedia.test(media.src || '') ? media.src : '';
  }
  const audioSrc=music.kind==='file' ? urlFor(music) : '';
  const audio=audioSrc ? new Audio() : null;
  const bundled=localMedia.test(audioSrc);
  let muted=Boolean(viewState?.muted), destroyed=false, playing=false, wanted=false, finished=false;
  let position=clamp(Number.isInteger(viewState?.position)?viewState.position:0,0,Math.max(0,photos.length-1));
  const startAt=audioLink?.start || 0;
  let resumeTime=Number.isFinite(viewState?.time) ? viewState.time : startAt;
  let pendingSeek=audio && resumeTime>0 ? resumeTime : null;
  let provider=null, duration=0, timer=0, playRequest=0, fallbackClock=0, fallbackOffset=0;
  let trigger=null, scrollStyle='', utterance=null, closingHistory=false;
  const speech=env.speechSynthesis;
  speech?.getVoices();
  const sourceName=music.name || t('dayMusic');
  const story=String(day.text || recipe.caption || '').trim();
  // The first sentence often supplied the title. Offer the next detail on the page;
  // the reading view always keeps the complete entry.
  const firstSentence=story.match(/^(.+?)[.!?…]+(?:\s+|$)/u);
  const summary=firstSentence?.[1]===recipe.title && story.length>firstSentence[0].length
    ? story.slice(firstSentence[0].length) : story;
  const action=(id,symbol,label)=>'<button class="ab-row" type="button" data-card="'+id+'"><span class="ab-source-icon">'+icon(symbol,21)+'</span><span class="ab-row-name"><b>'+esc(label)+'</b></span><span class="card-row-next">'+icon('chevron',15)+'</span></button>';
  const control=(id,symbol,label,cls='')=>'<button type="button" class="viewer-control '+cls+'" data-card="'+id+'" aria-label="'+html(label)+'">'+icon(symbol,20)+'</button>';
  root.innerHTML='<div class="ab-view ab-audit diary-card">'+
    '<section class="ab-hero" data-card="hero"><div class="ab-hero-copy">'+
    '<div class="ab-meta"><span class="ab-record-mark" aria-hidden="true"></span><span>'+esc(date)+' · '+esc(recipe.moodLabel)+'</span></div>'+
    '<h2 lang="'+lang+'">'+esc(recipe.title)+'</h2><p class="card-caption" lang="'+lang+'">'+esc(recipe.caption)+'</p>'+
    '<button class="ab-action" type="button" data-card="hero-play" aria-haspopup="dialog">'+icon('play',17)+html('animate')+'</button></div>'+
    '<div class="ab-art card-art"><button class="card-print" type="button" data-card="zoom" aria-label="'+html('zoom')+'" aria-haspopup="dialog">'+
    '<i class="card-back" aria-hidden="true"></i><i class="card-middle" aria-hidden="true"></i><span class="card-print-paper">'+
    '<span class="card-print-clip"><img data-card="photo" alt=""></span><span class="card-paper-foot"><span>'+esc(date)+'</span><span data-card="paper-count"></span></span></span></button></div></section>'+
    '<section class="card-story" data-card="story"><h2>'+html('story')+'</h2><p lang="'+lang+'">'+esc(summary.slice(0,380))+(summary.length>380?'…':'')+'</p>'+
    '<button type="button" data-card="read">'+html('read')+icon('chevron',15)+'</button></section>'+
    '<section class="ab-evidence"><h2>'+html('folder')+'</h2>'+
    (demo ? action('copy','folder',t('copy')) : action('edit','document',t('edit'))+action('options','more',t('options')))+
    (demo ? action('credits','info',t('credits')) : '')+'</section>'+
    '<dialog class="card-viewer" data-card="viewer" aria-labelledby="card-viewer-title"><div class="viewer-content">'+
    '<header class="viewer-header"><div><small>'+esc(date)+'</small><h2 id="card-viewer-title" lang="'+lang+'">'+esc(recipe.title)+'</h2></div>'+
    control('close','close','close')+'</header><div class="viewer-grid'+(embedded?' has-provider':'')+'">'+
    '<figure class="viewer-figure"><div class="viewer-photo-well"><img data-card="viewer-photo" alt=""></div>'+
    '<figcaption lang="'+lang+'">'+esc(recipe.caption)+'</figcaption></figure>'+
    '<div class="viewer-details"><div class="viewer-music"><span class="viewer-music-glyph">'+icon('music',22)+'</span><div><small>'+html('dayMusic')+'</small><strong>'+esc(sourceName)+'</strong></div></div>'+
    '<div class="viewer-controls"><div class="viewer-transport">'+control('prev','prev','previous')+control('play','play','play','viewer-play')+control('next','next','next')+'</div>'+
    '<span class="viewer-count" data-card="counter"></span><button type="button" class="viewer-control viewer-mute" data-card="mute"></button></div>'+
    '<label class="ab-scrub" data-card="scrub"><span class="ab-sr">'+html('chooseFrame')+'</span><input aria-label="'+html('chooseFrame')+'" type="range" data-card="seek" min="1" max="'+Math.max(1,photos.length)+'" step="1"></label>'+
    '<div class="viewer-provider" data-card="provider"'+(embedded?'':' hidden')+'></div>'+
    '<p class="viewer-status" role="status" data-card="status"></p>'+
    (song?'<a class="viewer-source" data-card="source" href="'+esc(song)+'" target="_blank" rel="noopener noreferrer">'+html('openSong')+' ↗</a>':'')+
    '</div></div></div></dialog></div>';
  const el=key=>root.querySelector('[data-card="'+key+'"]'), frame=root.querySelector('.diary-card'), viewer=el('viewer');
  frame.style.setProperty('--day-paper',recipe.color);
  frame.style.setProperty('--day-tilt',recipe.tilt+'deg');
  frame.style.setProperty('--day-duration',recipe.interval+'ms');
  frame.dataset.motion=recipe.motion;
  el('hero').dataset.mood=recipe.mood;
  frame.classList.toggle('is-still',Boolean(ctx.reducedMotion));
  for (const id of ['prev','next','scrub']) el(id).hidden=photos.length<2;
  el('mute').hidden=!audio && audioLink?.provider!=='youtube';
  function notice(text='') {if(!destroyed)el('status').textContent=text;}
  function buttons() {
    if(destroyed)return;
    const active=playing || wanted;
    el('play').innerHTML=icon(active?'pause':'play',18);
    el('play').setAttribute('aria-label',t(active?'pause':'play'));
    el('play').setAttribute('aria-pressed',String(active));
    el('mute').innerHTML=icon('sound',18);
    el('mute').setAttribute('aria-label',t(muted?'unmute':'mute'));
    el('mute').setAttribute('aria-pressed',String(muted));
    frame.classList.toggle('is-playing',playing);
  }
  function paint() {
    const p=photos[position], src=urlFor(p);
    for (const id of ['photo','viewer-photo']) {
      const img=el(id);
      if(src && img.getAttribute('src')!==src) img.src=src;
      img.alt=p?.name || t('numberedPhoto',{index:position+1});img.hidden=!src;
      img.style.objectPosition=clamp(p?.x ?? 50,0,100)+'% '+clamp(p?.y ?? 50,0,100)+'%';
    }
    el('counter').textContent=photos.length?t('count',{index:position+1,count:photos.length}):t('noPhoto');
    el('paper-count').textContent=String(position+1).padStart(2,'0')+' / '+String(Math.max(1,photos.length)).padStart(2,'0');
    const seek=el('seek');
    seek.value=position+1;seek.setAttribute('aria-valuetext',t('frameCount',{index:position+1,count:photos.length}));
    seek.style.setProperty('--ab-fill',100*position/Math.max(1,photos.length-1)+'%');
    el('prev').disabled=position===0;el('next').disabled=position>=photos.length-1;
  }
  function stopSpeech() {
    if(utterance){utterance=null;speech?.cancel();}
  }
  function frameSeconds() {
    const count=Math.max(1,photos.length), span=duration-startAt;
    if(span>0 && embedded) {
      const rounds=Math.max(1,Math.round(span/(count*6)));
      return span/(rounds*count);
    }
    return duration>0 ? Math.min(recipe.interval/1000,duration/count) : recipe.interval/1000;
  }
  function mediaTime() {
    if(audio) return Number.isFinite(audio.currentTime)?audio.currentTime:0;
    if(provider) return provider.getCurrentTime() || 0;
    return fallbackOffset+(playing?(performance.now()-fallbackClock)/1000:0);
  }
  function stopClock() {
    clearInterval(timer);timer=0;
    if(playing && !provider && !audio) fallbackOffset=mediaTime();
    playing=false;
  }
  function finish() {
    stopClock();wanted=false;finished=true;buttons();notice(t('finished'));
  }
  function tick() {
    if(!playing || !photos.length)return;
    const at=Math.max(0,mediaTime()-startAt);
    const idx=Math.floor(at/Math.max(.05,frameSeconds()));
    if(!provider && !audio && idx>=photos.length){finish();return;}
    const target=embedded ? idx%photos.length : Math.min(idx,photos.length-1);
    if(target!==position){position=target;paint();}
  }
  function begin() {
    if(destroyed || !viewer.open)return;
    if(!playing){playing=true;fallbackClock=performance.now();timer=setInterval(tick,180);}
    wanted=true;finished=false;buttons();
  }
  function applySeek() {
    if(pendingSeek===null || !audio || !Number.isFinite(audio.duration))return;
    audio.currentTime=clamp(pendingSeek,0,Math.max(0,audio.duration-.05));
    pendingSeek=null;
  }
  function locate(index) {
    if(!photos.length)return;
    position=clamp(index,0,photos.length-1);
    const seconds=frameSeconds();
    const round=embedded ? Math.floor(Math.max(0,mediaTime()-startAt)/(seconds*photos.length)) : 0;
    const target=startAt+(position+round*photos.length)*seconds;
    if(audio) {pendingSeek=target;applySeek();}
    if(provider) provider.seek(target);
    if(!audio && !provider){fallbackOffset=target;fallbackClock=performance.now();}
    finished=false;paint();
  }
  function pause() {
    wanted=false;playRequest++;stopClock();
    audio?.pause();provider?.pause();buttons();
  }
  function playAudio() {
    const id=++playRequest;
    if(!audio.getAttribute('src'))audio.src=audioSrc;
    audio.play().catch(()=>{
      if(destroyed || id!==playRequest || !viewer.open)return;
      stopClock();wanted=false;buttons();notice(t('audioUnavailable'));
    });
  }
  function play() {
    if(!viewer.open)return;
    if(finished){position=0;fallbackOffset=0;pendingSeek=audio?0:null;resumeTime=startAt;paint();applySeek();provider?.seek(startAt);}
    finished=false;wanted=true;stopSpeech();notice();
    if(audio) {if(audio.readyState<2)notice(t('loadingMusic'));playAudio();}
    else if(provider) {notice(t('loadingMusic'));provider.play();}
    else {begin();if(song)notice(t('externalSong'));}
    buttons();
  }
  function openViewer(fromHistory=false) {
    if(destroyed || viewer.open || closingHistory)return;
    trigger=document.activeElement;scrollStyle=document.body.style.overflow;
    viewer.showModal();document.body.style.overflow='hidden';
    el('close').focus({preventScroll:true});
    if(!fromHistory) {
      if(history.state?.cardViewer!==day.id)history.pushState({cardViewer:day.id},'',location.href);
      play();
    }
  }
  function closeViewer(useHistory=true) {
    if(!viewer.open)return;
    pause();viewer.close();document.body.style.overflow=scrollStyle;
    if(trigger?.isConnected)trigger.focus({preventScroll:true});
    if(useHistory && history.state?.cardViewer===day.id){
      closingHistory=true;history.back();
    }
  }
  el('hero-play').onclick=()=>openViewer();el('zoom').onclick=()=>openViewer();
  el('close').onclick=()=>closeViewer();
  el('play').onclick=()=>{if(playing || wanted)pause();else play();};
  el('next').onclick=()=>locate(position+1);el('prev').onclick=()=>locate(position-1);
  el('seek').oninput=e=>locate(Number(e.target.value)-1);
  el('mute').onclick=()=>{muted=!muted;if(audio)audio.muted=muted;provider?.setMuted(muted);buttons();};
  viewer.addEventListener('cancel',event=>{event.preventDefault();closeViewer();},opts);
  viewer.addEventListener('click',event=>{if(event.target===viewer)closeViewer();},opts);
  viewer.addEventListener('keydown',event=>{
    if(event.target.matches('input,iframe') || event.altKey || event.ctrlKey || event.metaKey)return;
    if(event.key==='ArrowLeft' || event.key==='ArrowRight'){
      event.preventDefault();locate(position+(event.key==='ArrowLeft'?-1:1));
    }
  },opts);
  env.addEventListener('popstate',()=>{
    closingHistory=false;
    if(history.state?.cardViewer===day.id)openViewer(true);
    else closeViewer(false);
  },opts);
  let touch;
  const photoWell=viewer.querySelector('.viewer-photo-well');
  photoWell.addEventListener('touchstart',e=>{const p=e.changedTouches[0];touch=[p.clientX,p.clientY];},{passive:true});
  photoWell.addEventListener('touchend',e=>{
    if(!touch)return;
    const p=e.changedTouches[0],dx=p.clientX-touch[0],dy=p.clientY-touch[1];touch=null;
    if(Math.abs(dx)>45 && Math.abs(dy)<Math.abs(dx)*.7)locate(position+(dx<0?1:-1));
  },{passive:true});
  el('viewer-photo').onload=event=>{
    const image=event.currentTarget;
    if(image.naturalHeight)photoWell.style.setProperty('--photo-ratio',String(image.naturalWidth/image.naturalHeight));
  };
  el('viewer-photo').onerror=()=>notice(t('imageUnavailable'));
  function show(title,markup,bind){pause();ctx.sheet(title,markup,bind);}
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
  document.getElementById('sheet')?.addEventListener('close',stopSpeech,opts);
  env.addEventListener('pagehide',()=>{pause();stopSpeech();},opts);
  function providerState(state) {
    if(destroyed)return;
    if(state==='playing') {
      if(!viewer.open || document.hidden){provider?.pause();return;}
      begin();notice();
    }else if(state==='buffering'){
      if(viewer.open){stopClock();wanted=true;buttons();notice(t('loadingMusic'));}
    }else if(state==='paused' || state==='ended'){
      if(state==='ended'){finish();return;}
      stopClock();wanted=false;buttons();notice();
    }else if(state==='ready' && resumeTime>startAt){
      provider?.seek(resumeTime);resumeTime=0;
    }
  }
  if(embedded){
    provider=mountProvider(el('provider'),audioLink,{
      title:sourceName,
      onState:providerState,
      onDuration(seconds){
        if(Number.isFinite(seconds) && seconds>0){
          duration=seconds;frame.style.setProperty('--day-duration',frameSeconds()+'s');
        }
      },
      onError(reason){
        if(destroyed)return;
        stopClock();wanted=false;buttons();
        notice(t(reason==='blocked'?'providerBlocked':reason==='restricted'?'providerRestricted':'providerUnavailable'));
      }
    });
    if(muted && audioLink.provider==='youtube')provider.setMuted(true);
  }
  if(audio){
    audio.preload='metadata';audio.muted=muted;audio.volume=.83;
    audio.addEventListener('loadedmetadata',()=>{duration=audio.duration;applySeek();},opts);
    audio.addEventListener('playing',()=>{if(viewer.open && wanted){begin();notice();}else audio.pause();},opts);
    audio.addEventListener('waiting',()=>{if(wanted){stopClock();buttons();notice(t('loadingMusic'));}},opts);
    audio.addEventListener('error',()=>{
      if(viewer.open){stopClock();wanted=false;buttons();notice(t('audioUnavailable'));}
    },opts);
    audio.addEventListener('ended',()=>{position=Math.max(0,photos.length-1);paint();finish();},opts);
    if(bundled){
      // Whole-file static hosts can report an empty seek range until the MP3 is a blob.
      fetch(audioSrc,{signal:own.signal}).then(response=>response.ok?response.blob():null).then(blob=>{
        if(destroyed || !blob)return;
        const time=pendingSeek ?? audio.currentTime;
        pendingSeek=time;audio.src=urlFor({blob});
        if(viewer.open && wanted)playAudio();
      }).catch(()=>{});
    }else audio.src=audioSrc;
  }
  paint();buttons();
  const cleanup=()=>{
    if(viewer.open)closeViewer(false);
    pause();destroyed=true;own.abort();stopSpeech();provider?.destroy();
    if(audio){audio.removeAttribute('src');audio.load();}
    urls.forEach(url=>URL.revokeObjectURL(url));
  };
  cleanup.getViewState=()=>({
    position,muted,time:pendingSeek ?? (provider ? Math.max(startAt,mediaTime()) : mediaTime())
  });
  return cleanup;
}
