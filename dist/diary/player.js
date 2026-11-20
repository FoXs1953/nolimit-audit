import {shareText} from './locales/sharing.js';
import {presentRecipe,storyLanguage} from './art.js';
import {formatDate} from './i18n.js';
import {musicLink} from './music-link.js';
import {isGalleryVideo,visibleDayNotes} from './store.js';
import {galleryPoster,noteList} from './ui.js';
import {mountProvider} from './provider-player.js';
import {playerText as t} from './locales/player.js';

const env=window;
const networkMedia=/^\/api\/social\/media\/[a-f\d-]+\/[a-f\d-]+$/i;
const localMedia=/^(?:\.\/)?diary\/media\/[\w.-]+$/;
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
function webAddress(value) {
  try {
    const url=new URL(value);
    return url.protocol==='https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function storyByPhoto(photos,story) {
  const words=story.match(/\S+\s*/gu) || [];
  const count=photos.filter(photo=>!photo.caption?.trim()).length;
  let slot=0;
  return photos.map(photo=>{
    if(photo.caption?.trim())return photo.caption.trim();
    const start=Math.floor(slot++*words.length/count);
    const end=Math.floor(slot*words.length/count);
    return words.slice(start,Math.max(start+1,end)).join('').trim();
  });
}

export function mountPlayer(root,day,ctx,viewState={}) {
  const {esc,icon}=ctx, recipe=presentRecipe(day), photos=day.photos || [], music=day.music || {};
  const lang=storyLanguage(day), date=formatDate(day.date);
  const hasVideos=photos.some(isGalleryVideo);
  const timedTracks=photos.some(photo=>photo.music?.kind==='file');
  const readOnly=ctx.readOnly===true;
  const own=new AbortController(), opts={signal:own.signal}, urls=new Map();
  const audioLink=music.kind==='link' ? musicLink(music.url) : null;
  const song=audioLink?.url || (music.kind==='link' ? webAddress(music.url) : '');
  const embedded=['youtube','spotify'].includes(audioLink?.provider);
  const film=audioLink?.provider==='youtube';
  const html=(key,values)=>esc(t(key,values));
  function urlFor(media) {
    if (!media) return '';
    if (media.blob instanceof Blob) {
      if (!urls.has(media.blob)) urls.set(media.blob,URL.createObjectURL(media.blob));
      return urls.get(media.blob);
    }
    return (localMedia.test(media.src || '') || (readOnly && networkMedia.test(media.src || ''))) ? media.src : '';
  }
  let dayAudioSrc=music.kind==='file' ? urlFor(music) : '';
  const audio=dayAudioSrc || timedTracks ? new Audio() : null;
  const bundled=localMedia.test(dayAudioSrc);
  let muted=Boolean(viewState?.muted), destroyed=false, playing=false, wanted=false, finished=Boolean(timedTracks && viewState?.finished);
  let position=clamp(Number.isInteger(viewState?.position)?viewState.position:0,0,Math.max(0,photos.length-1));
  const startAt=audioLink?.start || 0;
  let resumeTime=Number.isFinite(viewState?.time) ? viewState.time : startAt;
  let dayAudioTime=Number.isFinite(viewState?.dayAudioTime) ? viewState.dayAudioTime : startAt;
  let pendingSeek=audio && (timedTracks ? dayAudioTime>0 : resumeTime>0) ? (timedTracks ? dayAudioTime : resumeTime) : null;
  let providerPlaying=false;
  let provider=null, duration=0, timer=0, playRequest=0, fallbackClock=0;
  let fallbackOffset=timedTracks && Number.isFinite(viewState?.time) ? viewState.time : 0;
  let audioActivated=false;
  let trigger=null, scrollStyle='', utterance=null, closingHistory=false, expanded=false;
  const speech=env.speechSynthesis;
  const reducedMotion=env.matchMedia('(prefers-reduced-motion: reduce)');
  speech?.getVoices();
  const dayNotes=visibleDayNotes(day);
  const notesSection=noteList(dayNotes);
  const editableNotes=readOnly ? notesSection : noteList(dayNotes,{dayId:day.id});
  const sourceName=music.name || t('dayMusic');
  const story=String(day.text || recipe.caption || '').trim();
  const textByPhoto=storyByPhoto(photos,story);
  const photoTrack=()=>photos[position]?.music;
  const sceneAudioSrc=()=>photoTrack() ? urlFor(photoTrack()) : dayAudioSrc;
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
    '<span class="card-print-clip"><img data-card="photo" alt="">'+
    (hasVideos?'<span class="clip-mark" data-card="clip-mark" hidden>'+icon('play',16)+'</span>':'')+'</span><span class="card-paper-foot"><span>'+esc(date)+'</span><span data-card="paper-count"></span></span></span></button></div></section>'+
    (film?'':'<section class="card-story" data-card="story"><h2>'+html('story')+'</h2><p lang="'+lang+'">'+esc(summary.slice(0,380))+(summary.length>380?'…':'')+'</p>'+
    '<button type="button" data-card="read">'+html('read')+icon('chevron',15)+'</button></section>')+
    '<dialog class="card-viewer'+(film?' card-film':'')+'" data-card="viewer" '+(film?'open data-inline role="region" aria-labelledby="card-film-title"':'aria-labelledby="card-viewer-title"')+'><div class="viewer-content">'+
    (film?'<header class="film-heading"><h2 id="card-film-title">'+html('daySong')+'</h2></header>':'')+
    '<header class="viewer-header"><div><small>'+esc(date)+'</small><h2 id="card-viewer-title" lang="'+lang+'">'+esc(recipe.title)+'</h2></div>'+
    (readOnly?'':'<button type="button" class="day-edit" data-card="viewer-edit">'+icon('pen',17)+html('edit')+'</button>')+
    control('close','close','close')+'</header><div class="viewer-grid'+(embedded?' has-provider':'')+'">'+
    '<div class="viewer-figure"><div class="viewer-photo-well"><img data-card="viewer-photo" alt="">'+
    (hasVideos?'<video data-card="viewer-video" controls playsinline preload="none" hidden></video>':'')+'</div></div>'+
    '<div class="viewer-details">'+
    (film?'<div class="viewer-provider" data-card="provider"></div>':'')+
    '<div class="viewer-music" data-card="music"><span class="viewer-music-glyph">'+icon(film?'play':'music',20)+'</span><div><small data-card="track-scope"></small><strong data-card="track-name"></strong></div></div>'+
    (film?'':'<div class="viewer-provider" data-card="provider"'+(embedded?'':' hidden')+'></div>')+
    '<p class="viewer-status" role="status" data-card="status"></p>'+
    (song?'<a class="viewer-source" data-card="source" href="'+esc(song)+'" target="_blank" rel="noopener noreferrer">'+html(film?'openVideo':'openSong')+' ↗</a>':'')+
    '</div><div class="viewer-controls"><div class="viewer-transport">'+control('prev','prev',hasVideos?'previousFrame':'previous')+control('play','play','play','viewer-play')+control('next','next',hasVideos?'nextFrame':'next')+'</div>'+
    '<span class="viewer-count" data-card="counter"></span><button type="button" class="viewer-control viewer-mute" data-card="mute"></button></div>'+
    '<label class="ab-scrub" data-card="scrub"><span class="ab-sr">'+html('chooseFrame')+'</span><input aria-label="'+html('chooseFrame')+'" type="range" data-card="seek" min="1" max="'+Math.max(1,photos.length)+'" step="1"></label>'+
    '<div class="viewer-caption" data-card="story-window" role="region" tabindex="0" aria-label="'+html('story')+'"><p data-card="story-scroll" lang="'+lang+'"></p></div>'+
    '</div>'+notesSection+'</div></dialog>'+
    '<section class="ab-evidence"'+(readOnly && !film?' hidden':'')+'><h2>'+html('folder')+'</h2>'+
    (film?action('read','document',t('read')):'')+
    (readOnly?'':action('edit','document',t('edit'))+action('share','people',shareText('access'))+action('options','more',t('options')))+
    '</section>'+editableNotes+'</div>';
  const el=key=>root.querySelector('[data-card="'+key+'"]'), frame=root.querySelector('.diary-card'), viewer=el('viewer');
  const clip=el('viewer-video');
  for(const button of frame.querySelectorAll('[data-delete-note]')){
    button.onclick=async()=>{
      if(button.disabled)return;
      button.disabled=true;
      try {await ctx.deleteNote(day,dayNotes[Number(button.dataset.deleteNote)]);}
      finally {button.disabled=false;}
    };
  }
  frame.style.setProperty('--day-paper',recipe.color);
  frame.style.setProperty('--day-tilt',recipe.tilt+'deg');
  frame.style.setProperty('--day-duration',recipe.interval+'ms');
  frame.dataset.motion=recipe.motion;
  el('hero').dataset.mood=recipe.mood;
  frame.classList.toggle('is-still',Boolean(ctx.reducedMotion));
  for (const id of ['prev','next','scrub']) el(id).hidden=photos.length<2;
  el('play').hidden=film && !timedTracks;
  el('mute').hidden=!audio;
  el('counter').hidden=photos.length<2;
  if(film && !timedTracks && photos.length<2) viewer.querySelector('.viewer-controls').hidden=true;
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
    const p=photos[position], src=urlFor(p), video=isGalleryVideo(p);
    if (clip) {
      el('clip-mark').hidden=clip.hidden=!video || !src;
      if (video && src && expanded) {
        if (clip.getAttribute('src')!==src) {
          clip.pause();
          clip.preload='metadata';
          clip.poster=galleryPoster(p);
          clip.src=src;
        }
        clip.setAttribute('aria-label',p.name || t('dayVideo'));
      } else if (clip.hasAttribute('src')) {
        clip.pause();
        clip.removeAttribute('src');clip.load();
      }
    }
    for (const id of ['photo','viewer-photo']) {
      const img=el(id);
      const still=video ? (id==='photo' ? galleryPoster(p) : '') : src;
      if(still && img.getAttribute('src')!==still) img.src=still;
      img.alt=p?.name || (video ? t('dayVideo') : t('numberedPhoto',{index:position+1}));
      img.hidden=!still;
      img.style.objectPosition=clamp(p?.x ?? 50,0,100)+'% '+clamp(p?.y ?? 50,0,100)+'%';
    }
    el('counter').textContent=photos.length?t('count',{index:position+1,count:photos.length}):t('noPhoto');
    el('paper-count').textContent=String(position+1).padStart(2,'0')+' / '+String(Math.max(1,photos.length)).padStart(2,'0');
    const seek=el('seek');
    seek.value=position+1;seek.setAttribute('aria-valuetext',t('frameCount',{index:position+1,count:photos.length}));
    seek.style.setProperty('--ab-fill',100*position/Math.max(1,photos.length-1)+'%');
    el('prev').disabled=position===0;el('next').disabled=position>=photos.length-1;
    const track=expanded ? photoTrack() : null;
    el('track-name').textContent=track ? track.name || t('photoMusic') : day.music ? sourceName : '';
    el('track-scope').textContent=track?.name ? t('photoMusic') : !track && !film && music.name ? t('dayMusic') : '';
    el('music').hidden=!track && !day.music;
    el('provider').hidden=!embedded || Boolean(track);
    if(song)el('source').hidden=Boolean(track);
    if(timedTracks)el('mute').hidden=!sceneAudioSrc() && audioLink?.provider!=='youtube';
    const storyText=textByPhoto[position] || (!photos.length ? story : '');
    el('story-scroll').textContent=storyText;
    const storyWindow=el('story-window');
    storyWindow.hidden=!storyText;
    storyWindow.scrollTop=0;
    const photo=el('viewer-photo');
    photo.style.setProperty('--viewer-frame-duration',frameSeconds()+'s');
    for(const animation of photo.getAnimations())animation.currentTime=0;
  }
  function stopSpeech() {
    if(utterance){utterance=null;speech?.cancel();}
  }
  function frameSeconds() {
    const count=Math.max(1,photos.length), span=duration-startAt;
    if(timedTracks)return recipe.interval/1000;
    if(span>0 && embedded) {
      const rounds=Math.max(1,Math.round(span/(count*6)));
      return span/(rounds*count);
    }
    return duration>0 ? Math.min(recipe.interval/1000,duration/count) : recipe.interval/1000;
  }
  function mediaTime() {
    if(audio) return Number.isFinite(audio.currentTime)?audio.currentTime:0;
    if(provider) return provider.getCurrentTime() || 0;
    return fallbackTime();
  }
  function fallbackTime() {
    return fallbackOffset+(playing?(performance.now()-fallbackClock)/1000:0);
  }
  function stopClock() {
    clearInterval(timer);timer=0;
    if(playing && (timedTracks || (!provider && !audio))) fallbackOffset=fallbackTime();
    playing=false;
  }
  function finish() {
    if(timedTracks)pauseSoundtrack();else stopClock();
    wanted=false;finished=true;buttons();notice(t('finished'));
  }
  function scrollStory(progress) {
    if(ctx.reducedMotion || reducedMotion.matches)return;
    const scroller=el('story-window');
    const distance=scroller.scrollHeight-scroller.clientHeight;
    if(distance>0)scroller.scrollTop=distance*clamp((progress-.18)/.68,0,1);
  }
  function tick() {
    if(!playing || !photos.length)return;
    const seconds=Math.max(.05,frameSeconds());
    if(timedTracks){
      const progress=fallbackTime()/seconds;
      scrollStory(progress);
      if(progress>=1){
        if(position===photos.length-1)finish();else changeScene(position+1);
      }
      return;
    }
    const at=Math.max(0,mediaTime()-startAt);
    const idx=Math.floor(at/seconds);
    if(!provider && !audio && idx>=photos.length){finish();return;}
    const target=embedded ? idx%photos.length : Math.min(idx,photos.length-1);
    if(target!==position){position=target;paint();}
    scrollStory(embedded ? (at/seconds)%1 : at/seconds-position);
  }
  function begin() {
    if(destroyed || !expanded)return;
    if(!playing){playing=true;fallbackClock=performance.now();timer=setInterval(tick,90);}
    wanted=true;finished=false;buttons();
  }
  function applySeek() {
    if(pendingSeek===null || !audio || !Number.isFinite(audio.duration) || audio.duration<=0)return;
    const target=timedTracks ? pendingSeek%audio.duration : pendingSeek;
    audio.currentTime=clamp(target,0,Math.max(0,audio.duration-.05));
    pendingSeek=null;
  }
  function locate(index) {
    if(!photos.length)return;
    if(timedTracks){changeScene(clamp(index,0,photos.length-1),true);return;}
    position=clamp(index,0,photos.length-1);
    const seconds=frameSeconds();
    const round=embedded ? Math.floor(Math.max(0,mediaTime()-startAt)/(seconds*photos.length)) : 0;
    const target=startAt+(position+round*photos.length)*seconds;
    if(audio) {pendingSeek=target;applySeek();}
    if(provider) provider.seek(target);
    if(!audio && !provider){fallbackOffset=target;fallbackClock=performance.now();}
    finished=false;paint();
  }
  function pauseSoundtrack() {
    wanted=false;providerPlaying=false;playRequest++;stopClock();
    audio?.pause();provider?.pause({keepAvailable:film && !destroyed});buttons();
  }
  function pause() {
    clip?.pause();
    pauseSoundtrack();
  }
  if(clip) {
    clip.addEventListener('play',()=>{
      if(!expanded || document.hidden){clip.pause();return;}
      pauseSoundtrack();stopSpeech();notice();
    },opts);
    clip.addEventListener('loadedmetadata',()=>{
      if(!clip.hidden && clip.videoHeight) photoWell.style.setProperty('--photo-ratio',String(clip.videoWidth/clip.videoHeight));
    },opts);
    clip.addEventListener('error',()=>{if(!clip.hidden)notice(t('videoUnavailable'));},opts);
  }
  function playAudio() {
    const id=++playRequest;
    const src=sceneAudioSrc();
    if(audio.getAttribute('src')!==src)audio.src=src;
    audioActivated=true;audio.muted=muted;
    applySeek();
    audio.play().then(()=>{
      if(timedTracks && id===playRequest && expanded && wanted && !audio.paused){begin();notice();}
    }).catch(()=>{
      if(destroyed || id!==playRequest || !expanded || !wanted)return;
      audioUnavailable();
    });
  }
  function audioUnavailable() {
    if(timedTracks && wanted)begin();
    else {stopClock();wanted=false;buttons();}
    notice(t('audioUnavailable'));
  }
  function activateLaterTrack() {
    if(audioActivated || sceneAudioSrc())return;
    const track=photos.find(photo=>photo.music?.kind==='file').music;
    const src=urlFor(track);
    if(!src)return;
    // WebKit ties audio permission to the element and the play gesture.
    // Start it silently here if the current scene has a provider or no audio.
    const id=++playRequest;
    audio.src=src;audio.muted=true;audioActivated=true;
    audio.play().catch(()=>{}).finally(()=>{
      if(id!==playRequest || destroyed)return;
      audio.pause();audio.muted=muted;
    });
  }
  function startScene() {
    const track=photoTrack(), src=sceneAudioSrc();
    if(track && provider){providerPlaying=false;provider.pause({keepAvailable:true});}
    if(src){
      if(audio.getAttribute('src')!==src || pendingSeek!==null) {
        pendingSeek=track ? fallbackOffset : dayAudioTime;
      }
      if(audio.readyState<2 || audio.getAttribute('src')!==src)notice(t('loadingMusic'));
      playAudio();
    }else{
      pendingSeek=null;
      begin();
      if(!track && provider && !providerPlaying)provider.play();
      else if(!track && song && !provider)notice(t('externalSong'));
    }
  }
  function changeScene(index,manual=false) {
    if(index===position && !finished)return;
    const lastTrack=photoTrack();
    const active=wanted;
    if(!lastTrack){
      if(dayAudioSrc && audio.getAttribute('src')===dayAudioSrc)dayAudioTime=pendingSeek ?? audio.currentTime;
      else if(provider)dayAudioTime=Math.max(startAt,provider.getCurrentTime());
    }
    stopClock();fallbackOffset=0;
    position=index;finished=false;notice();paint();
    if(manual){
      const previousDayFrames=photos.slice(0,index).filter(photo=>!photo.music).length;
      dayAudioTime=startAt+previousDayFrames*frameSeconds();
    }
    const track=photoTrack();
    if(manual || lastTrack || track){
      playRequest++;audio.pause();
      const src=sceneAudioSrc();
      pendingSeek=src ? (track ? 0 : dayAudioTime) : null;
      if(!track && (manual || lastTrack) && provider && dayAudioTime!==provider.getCurrentTime())provider.seek(dayAudioTime);
      if(!src && audio.hasAttribute('src')){audio.removeAttribute('src');audio.load();}
    }
    if(active)startScene();else buttons();
  }
  function play() {
    if(!expanded)return;
    clip?.pause();
    if(finished){position=0;fallbackOffset=0;dayAudioTime=startAt;pendingSeek=audio?0:null;resumeTime=startAt;paint();provider?.seek(startAt);}
    finished=false;wanted=true;stopSpeech();notice();
    if(timedTracks){activateLaterTrack();startScene();}
    else if(audio) {applySeek();if(audio.readyState<2)notice(t('loadingMusic'));playAudio();}
    else if(providerPlaying) begin();
    else if(provider) {notice(t('loadingMusic'));provider.play();}
    else {begin();if(song)notice(t('externalSong'));}
    buttons();
  }
  function openViewer(fromHistory=false) {
    if(destroyed || expanded || closingHistory)return;
    trigger=document.activeElement;scrollStyle=document.body.style.overflow;
    if(film){
      viewer.close();
      viewer.removeAttribute('data-inline');
      viewer.removeAttribute('role');
      viewer.setAttribute('aria-labelledby','card-viewer-title');
    }
    expanded=true;
    paint();
    viewer.showModal();document.body.style.overflow='hidden';
    el('close').focus({preventScroll:true});
    if(!fromHistory) {
      if(history.state?.cardViewer!==day.id)history.pushState({...history.state,cardViewer:day.id},'',location.href);
      if(!isGalleryVideo(photos[position]))play();
    }
  }
  function closeViewer(useHistory=true) {
    if(!expanded)return;
    expanded=false;
    pause();viewer.close();paint();
    if(film){
      viewer.setAttribute('role','region');
      viewer.setAttribute('aria-labelledby','card-film-title');
      viewer.setAttribute('data-inline','');
      viewer.open=true;
    }
    document.body.style.overflow=scrollStyle;
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
    if(!expanded || event.target.matches('input,iframe,video') || event.altKey || event.ctrlKey || event.metaKey)return;
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
  photoWell.addEventListener('touchstart',e=>{if(e.target.closest('video'))return;const p=e.changedTouches[0];touch=[p.clientX,p.clientY];},{passive:true});
  photoWell.addEventListener('touchend',e=>{
    if(!touch)return;
    const p=e.changedTouches[0],dx=p.clientX-touch[0],dy=p.clientY-touch[1];touch=null;
    if(Math.abs(dx)>45 && Math.abs(dy)<Math.abs(dx)*.7)locate(position+(dx<0?1:-1));
  },{passive:true});
  el('viewer-photo').onload=event=>{
    const image=event.currentTarget;
    if(!image.hidden && image.naturalHeight)photoWell.style.setProperty('--photo-ratio',String(image.naturalWidth/image.naturalHeight));
  };
  el('viewer-photo').onerror=()=>notice(t('imageUnavailable'));
  function show(title,markup,bind){pause();ctx.sheet(title,markup,bind);}
  el('read').addEventListener('click',()=>{
    const notes=dayNotes.map(item=>'<li>'+esc(item.text)+'</li>').join('');
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
  if (!readOnly) {
    el('share').onclick=()=>{pause();ctx.shareDay(day);};
    const editDay=()=>{pause();ctx.edit(day);};
    el('edit').addEventListener('click',editDay);
    el('viewer-edit').addEventListener('click',editDay);
    el('options').addEventListener('click',()=>{pause();ctx.dayActions(day);});
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();stopSpeech();}},opts);
  document.getElementById('sheet')?.addEventListener('close',stopSpeech,opts);
  env.addEventListener('pagehide',()=>{pause();stopSpeech();},opts);
  function providerState(state) {
    if(destroyed)return;
    if(timedTracks && expanded && photoTrack()){
      if(state==='playing')provider?.pause({keepAvailable:true});
      return;
    }
    const wasProviderPlaying=providerPlaying;
    providerPlaying=state==='playing';
    if(timedTracks && expanded){
      if(state==='playing' && document.hidden)provider?.pause({keepAvailable:true});
      else if(state==='playing'){clip?.pause();begin();notice();}
      else if(state==='paused' && wasProviderPlaying && wanted)pauseSoundtrack();
      return;
    }
    if(state==='playing') {
      if((!expanded && !film) || document.hidden){provider?.pause();return;}
      clip?.pause();
      if(expanded)begin();
      notice();
    }else if(state==='buffering'){
      if(expanded){stopClock();wanted=true;buttons();notice(t('loadingMusic'));}
    }else if(state==='paused' || state==='ended'){
      if(state==='ended'){finish();return;}
      stopClock();wanted=false;buttons();notice();
    }else if(state==='ready' && !timedTracks && resumeTime>startAt){
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
        if(destroyed || (timedTracks && expanded && photoTrack()))return;
        if(!timedTracks){stopClock();wanted=false;buttons();}
        notice(t(reason==='blocked'?'providerBlocked':reason==='restricted'?'providerRestricted':'providerUnavailable'));
      }
    });
    if(timedTracks && dayAudioTime>startAt)provider.seek(dayAudioTime);
    if(muted && audioLink.provider==='youtube')provider.setMuted(true);
  }
  if(audio){
    audio.preload='metadata';audio.muted=muted;audio.volume=.83;audio.loop=timedTracks;
    audio.addEventListener('loadedmetadata',()=>{duration=audio.duration;applySeek();},opts);
    audio.addEventListener('playing',()=>{
      if(expanded && wanted && audio.getAttribute('src')===sceneAudioSrc()){begin();notice();}
      else audio.pause();
    },opts);
    audio.addEventListener('waiting',()=>{
      if(wanted && audio.getAttribute('src')===sceneAudioSrc()){stopClock();buttons();notice(t('loadingMusic'));}
    },opts);
    audio.addEventListener('error',()=>{
      if(expanded && wanted && audio.getAttribute('src')===sceneAudioSrc())audioUnavailable();
    },opts);
    audio.addEventListener('ended',()=>{if(!timedTracks){position=Math.max(0,photos.length-1);paint();finish();}},opts);
    if(bundled){
      // Whole-file static hosts can report an empty seek range until the MP3 is a blob.
      fetch(dayAudioSrc,{signal:own.signal}).then(response=>response.ok?response.blob():null).then(blob=>{
        if(destroyed || !blob)return;
        dayAudioSrc=urlFor({blob});
        if(timedTracks && photoTrack())return;
        pendingSeek=pendingSeek ?? audio.currentTime;
        audio.src=dayAudioSrc;
        if(expanded && wanted)playAudio();
      }).catch(()=>{});
    }else if(dayAudioSrc)audio.src=dayAudioSrc;
  }
  paint();buttons();
  const cleanup=()=>{
    if(expanded)closeViewer(false);
    destroyed=true;pause();own.abort();stopSpeech();provider?.destroy();
    if(audio){audio.removeAttribute('src');audio.load();}
    urls.forEach(url=>URL.revokeObjectURL(url));
  };
  cleanup.getViewState=()=>timedTracks ? {
    position,muted,finished,time:fallbackTime(),
    dayAudioTime:photoTrack() ? dayAudioTime : provider?.getCurrentTime() ?? pendingSeek ?? audio.currentTime
  } : {position,muted,time:pendingSeek ?? (provider ? Math.max(startAt,mediaTime()) : mediaTime())};
  return cleanup;
}
