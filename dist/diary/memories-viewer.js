import {presentRecipe,storyLanguage} from './art.js';
import {formatDate} from './i18n.js';
import {memoryText as t} from './locales/memories.js';
import {musicLink} from './music-link.js';
import {mountProvider} from './provider-player.js';
import {isGalleryVideo} from './store.js';
import {esc,galleryPoster,icon,noteList} from './ui.js';

const SLIDE_DURATION = 6500;
const LOCAL_COVER = /^(?:\.\/|\/)?diary\/media\/[\w.-]+$/;

export function openMemoryViewer(dialog,{entries,periodLabel,track,index=0},{close,openDay}) {
  const lifetime = new AbortController();
  const options = {signal:lifetime.signal};
  const end = entries.length-1;
  const hasNavigation = end > 0;
  let position = Math.max(0,Math.min(Number.isInteger(index) ? index : 0,end));
  let slideshow = false, slideTimer, providerTimer, provider;
  let providerReady = false;
  let coverUrl, cover, audioUrl, disposed = false;
  const scrollStyle = document.body.style.overflow;
  const trackName = track?.name || t('linkTrack');
  const link = track?.kind === 'link' ? musicLink(track.url) : null;
  const embedded = ['youtube','spotify'].includes(link?.provider);
  const localAudio = track?.kind === 'file' && track.blob instanceof Blob;
  const control = (key,label,symbol) =>
    '<button type="button" class="icon-button" data-memory-viewer="'+key+'" aria-label="'+esc(t(label))+
    '" title="'+esc(t(label))+'">'+icon(symbol,20)+'</button>';
  const soundtrack = localAudio || link ?
    '<section class="memory-viewer-soundtrack" aria-label="'+esc(t('music'))+'">'+
    '<div class="memory-soundtrack-title">'+icon('music',19)+'<strong>'+esc(trackName)+'</strong></div>'+
    (localAudio ? '<audio controls preload="none" data-memory-viewer="audio" aria-label="'+esc(trackName)+'"></audio>' :
      '<div class="memory-soundtrack-actions">'+
      (embedded ? '<button type="button" class="secondary" data-memory-viewer="load-player">'+esc(t('loadPlayer'))+'</button>' : '')+
      '<a href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer" data-memory-viewer="source">'+esc(t('openSong'))+'</a></div>'+
      (embedded ? '<div class="memory-provider" data-memory-viewer="provider"></div>' : ''))+
    '<p class="memory-viewer-status" role="status" data-memory-viewer="music-status"></p></section>' : '';
  dialog.innerHTML =
    '<div class="memory-viewer-content"><header class="memory-viewer-header">'+
    '<h2 id="memory-viewer-title">'+esc(periodLabel)+'</h2>'+control('close','close','close')+'</header>'+
    '<article class="memory-viewer-day" data-memory-viewer="day"></article>'+
    '<div class="memory-viewer-actions">'+(hasNavigation ?
      '<div class="memory-viewer-nav">'+control('prev','previousDay','prev')+
      '<span role="status" data-memory-viewer="progress"></span>'+control('next','nextDay','next')+'</div>'+
      '<button type="button" class="secondary" data-memory-viewer="slideshow"></button>' : '')+
    '<button type="button" class="secondary" data-memory-viewer="open-day">'+esc(t('original'))+'</button></div>'+
    soundtrack+'</div>';
  const el = key => dialog.querySelector('[data-memory-viewer="'+key+'"]');
  const dayView = el('day');
  const audio = el('audio');
  const playerButton = el('load-player');
  const providerSlot = el('provider');
  const musicStatus = el('music-status');

  function releaseCover() {
    if (cover instanceof HTMLVideoElement) {
      cover.onplay = null;
      cover.pause();
      cover.removeAttribute('src');
      cover.load();
    }
    if (cover) cover.onerror = null;
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    cover = null;
    coverUrl = null;
  }
  function pauseClip() {
    if (cover instanceof HTMLVideoElement) cover.pause();
  }
  function refreshTransport() {
    if (!hasNavigation) return;
    el('prev').disabled = position === 0;
    el('next').disabled = position === end;
    el('progress').textContent = t('progress',{index:position+1,total:entries.length});
    const label = slideshow ? 'stopShow' : position === end ? 'replay' : 'startShow';
    el('slideshow').innerHTML = icon(slideshow ? 'pause' : 'play',16)+esc(t(label));
  }
  function stopSlideshow(pauseMusic = true) {
    clearTimeout(slideTimer);
    if (audio) audio.loop = false;
    if (slideshow && pauseMusic) {
      audio?.pause();
      if (providerReady) provider.pause();
    }
    slideshow = false;
    refreshTransport();
  }
  function renderDay() {
    releaseCover();
    const day = entries[position];
    const recipe = day.status === 'ready' ? presentRecipe(day) : null;
    const asset = recipe ? day.photos?.[0] : null;
    const language = storyLanguage(day);
    const date = formatDate(day.date,{day:'numeric',month:'long',year:'numeric'});
    const story = String(day.text || recipe?.caption || '').trim();
    const excerpt = story.length > 480 ? story.slice(0,480).trimEnd()+'…' : story;
    dayView.innerHTML =
      (asset ? '<div class="memory-viewer-cover"><p class="memory-viewer-status" role="status" hidden></p></div>' : '')+
      '<div class="memory-viewer-story"><time datetime="'+esc(day.date)+'">'+esc(date)+'</time>'+
      (recipe ? '<h3 lang="'+esc(language)+'">'+esc(recipe.title)+'</h3>' : '')+
      (excerpt ? '<p lang="'+esc(language)+'">'+esc(excerpt)+'</p>' : '')+
      (day.moments?.length ? '<div class="memory-viewer-notes">'+noteList(day.moments)+'</div>' : '')+
      '</div>';
    for (const note of dayView.querySelectorAll('.memory-viewer-notes li p')) note.lang = language;
    if (asset) {
      const well = dayView.querySelector('.memory-viewer-cover');
      const error = well.querySelector('p');
      well.style.setProperty('--memory-cover-paper',recipe.color);
      const failed = () => {
        if (cover) cover.hidden = true;
        error.hidden = false;
        error.textContent = t('mediaError');
      };
      if (asset.blob instanceof Blob) coverUrl = URL.createObjectURL(asset.blob);
      const source = coverUrl || (LOCAL_COVER.test(asset.src || '') ? asset.src : '');
      if (source) {
        if (isGalleryVideo(asset)) {
          cover = document.createElement('video');
          cover.controls = true;
          cover.playsInline = true;
          cover.preload = 'none';
          cover.poster = galleryPoster(asset);
          cover.setAttribute('aria-label',asset.name || recipe.title);
          cover.onplay = () => {
            if (document.hidden || !dialog.open) { pauseClip(); return; }
            stopSlideshow();
            audio?.pause();
            if (providerReady) provider.pause();
            else if (provider) resetProvider();
          };
        } else {
          cover = document.createElement('img');
          cover.alt = asset.name || recipe.title;
          const crop = value => Math.min(100,Math.max(0,Number.isFinite(value) ? value : 50))+'%';
          cover.style.objectPosition = crop(asset.x)+' '+crop(asset.y);
        }
        cover.onerror = failed;
        cover.src = source;
        well.prepend(cover);
      } else failed();
    }
    refreshTransport();
  }
  function advance(direction) {
    const next = position+direction;
    if (next < 0 || next > end) return;
    stopSlideshow(false);
    position = next;
    renderDay();
  }
  function scheduleSlide() {
    slideTimer = setTimeout(()=>{
      if (document.hidden || !dialog.open || position === end) { stopSlideshow(); return; }
      position++;
      renderDay();
      scheduleSlide();
    },SLIDE_DURATION);
  }
  function toggleSlideshow() {
    if (slideshow) { stopSlideshow(); return; }
    pauseClip();
    if (position === end) {
      position = 0;
      if (audio?.readyState) audio.currentTime = 0;
      if (providerReady) provider.seek(link.start || 0);
      renderDay();
    }
    slideshow = true;
    if (audio) audio.loop = true;
    audio?.play().catch(error=>{
      if (slideshow && error.name!=='AbortError') musicStatus.textContent = t('audioError');
    });
    refreshTransport();
    scheduleSlide();
  }
  function resetProvider(message='') {
    clearTimeout(providerTimer);
    provider?.destroy();
    provider = null;
    providerReady = false;
    if (playerButton) {
      playerButton.hidden = false;
      playerButton.disabled = !navigator.onLine;
    }
    if (link) musicStatus.textContent = message || (navigator.onLine ? '' : t('onlineMusic'));
  }
  function loadProvider() {
    if (!navigator.onLine || provider) return;
    const shouldFocus = document.activeElement === playerButton;
    playerButton.disabled = true;
    musicStatus.textContent = t('loadingPlayer');
    providerTimer = setTimeout(()=>resetProvider(t('audioError')),20000);
    try {
      provider = mountProvider(providerSlot,link,{
        title:trackName,
        onState(state) {
          if (state === 'ready') {
            providerReady = true;
            clearTimeout(providerTimer);
            musicStatus.textContent = '';
            playerButton.hidden = true;
            if (shouldFocus && [playerButton,document.body].includes(document.activeElement)) {
              providerSlot.querySelector('iframe')?.focus({preventScroll:true});
            }
          }
          if (state === 'playing') {
            if (document.hidden || !dialog.open) resetProvider();
            else pauseClip();
          }
        },
        onError() { resetProvider(t('audioError')); }
      });
    } catch {
      resetProvider(t('audioError'));
    }
  }
  function suspend() {
    stopSlideshow();
    audio?.pause();
    pauseClip();
    if (provider) resetProvider();
  }
  function requestClose() {
    suspend();
    close();
  }

  if (audio) {
    audioUrl = URL.createObjectURL(track.blob);
    audio.src = audioUrl;
    audio.addEventListener('play',()=>{
      if (document.hidden || !dialog.open) audio.pause();
      else pauseClip();
    },options);
    audio.addEventListener('error',()=>{ musicStatus.textContent = t('audioError'); },options);
  }
  if (link) {
    resetProvider();
    playerButton?.addEventListener('click',loadProvider,options);
    el('source').addEventListener('click',suspend,options);
    window.addEventListener('online',()=>{ if (!provider) resetProvider(); },options);
    window.addEventListener('offline',()=>resetProvider(),options);
  }
  el('close').addEventListener('click',requestClose,options);
  el('open-day').addEventListener('click',()=>{ suspend(); openDay(entries[position]); },options);
  if (hasNavigation) {
    el('prev').addEventListener('click',()=>advance(-1),options);
    el('next').addEventListener('click',()=>advance(1),options);
    el('slideshow').addEventListener('click',toggleSlideshow,options);
    dialog.addEventListener('keydown',event=>{
      if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('audio,video,iframe')) return;
      if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      advance(event.key === 'ArrowLeft' ? -1 : 1);
    },options);
  }
  dialog.addEventListener('cancel',event=>{ event.preventDefault(); requestClose(); },options);
  dialog.addEventListener('click',event=>{ if (event.target === dialog) requestClose(); },options);
  document.addEventListener('visibilitychange',()=>{ if (document.hidden) suspend(); },options);
  window.addEventListener('pagehide',suspend,options);
  renderDay();
  dialog.showModal();
  dialog.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  el('close').focus({preventScroll:true});

  function cleanup() {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    clearTimeout(slideTimer);
    clearTimeout(providerTimer);
    provider?.destroy();
    releaseCover();
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(audioUrl);
    }
    if (dialog.open) dialog.close();
    dialog.replaceChildren();
    document.body.style.overflow = scrollStyle;
  }
  cleanup.getIndex = () => position;
  return cleanup;
}
