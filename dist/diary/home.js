import {postcardMood} from './art.js';
import {demos} from './demos.js';
import {getLanguage} from './i18n.js';
import {t as shellText} from './locales/shell.js';
import {t} from './locales/views.js';
import {isGalleryVideo, visibleDayNotes} from './store.js';
import {editDayButton, noteList, galleryThumbnail, esc, formatDate, icon, localDate} from './ui.js';

let selectedBeforeLanguageChange;

export function mountHome(root, days, ctx) {
  const language = getLanguage();
  const date = localDate();
  const entry = days.find(day => day.date === date && day.primary !== false);
  const hasDraft = entry && (entry.status !== 'ready' || entry.pendingEdit);
  const personalDay = entry?.pendingEdit || entry;
  const personalMood = personalDay && postcardMood(personalDay);
  const personalPhoto = personalDay?.photos?.[0];
  const personalUrl = personalPhoto?.blob ? URL.createObjectURL(personalPhoto.blob) : personalPhoto?.src;
  const action = t(entry ? hasDraft ? 'continueEntry' : 'openToday' : 'writeDay');
  const recent = days.filter(day => day.status === 'ready' && day.primary !== false)
    .sort((a,b) => b.date.localeCompare(a.date))[0];
  const recentPhoto = recent?.photos?.[0];
  const recentUrl = recent?.id === entry?.id && recentPhoto === personalPhoto
    ? personalUrl : recentPhoto?.blob ? URL.createObjectURL(recentPhoto.blob) : recentPhoto?.src;
  const previews = new Map();
  for (const day of [entry,recent]) {
    if (day && !previews.has(day.id)) previews.set(day.id,{day,notes:visibleDayNotes(day)});
  }
  function dayPreview({day,notes}) {
    const isRecent = day.id === recent?.id;
    const photo = isRecent ? recentUrl : personalUrl;
    const cover = isRecent ? recentPhoto : personalPhoto;
    const date = esc(formatDate(day.date,{day:'numeric',month:'long',year:'numeric'}));
    const name = esc(day.title || day.titleOverride || day.text || t('dayEntry'));
    const label = esc(shellText('delete'));
    const descriptionId = 'home-day-'+day.id;
    return '<article class="home-day" data-home-day="'+esc(day.id)+'"><div class="home-memory-row">'+
      '<button type="button" class="home-memory" data-action="'+(isRecent?'recent':'today-entry')+'" data-mood="'+postcardMood(day)+'">'+
      (photo ? galleryThumbnail(photo,isGalleryVideo(cover),cover?.poster) : '<span class="home-memory-mark">'+icon('calendar',25)+'</span>')+
      '<span class="home-memory-copy" id="'+esc(descriptionId)+'"><small><time datetime="'+esc(day.date)+'">'+date+'</time>'+
      (day.status==='draft'?' · '+t('draft'):'')+'</small> <strong>'+name+'</strong></span>'+icon('chevron',16)+'</button>'+
      editDayButton(day.id,descriptionId)+
      '<button type="button" class="diary-delete" data-delete-day="'+esc(day.id)+'" aria-label="'+label+'" title="'+label+
      '" aria-describedby="'+esc(descriptionId)+'">'+icon('trash',18)+'</button></div>'+
      noteList(notes,{dayId:day.id,layout:day.id===entry?.id?'latest':'collapsed'})+'</article>';
  }
  root.innerHTML = '<div class="ab-view ab-audit diary-home">' +
    '<section class="ab-hero"><div class="ab-hero-copy"><div class="ab-meta"><span class="ab-record-mark" aria-hidden="true"></span>' +
    esc(formatDate(date,{weekday:'long',day:'numeric',month:'long'})) + '</div><h2>' +
    t(entry ? hasDraft ? 'dayDetails' : 'postcardOfDay' : 'howWasToday') +
    '</h2><p>' + t(hasDraft ? 'revisitDraft' : 'makePostcard') +
    '</p><button type="button" class="ab-action" data-today>' + icon(entry?.status === 'ready' && !hasDraft ? 'book' : 'pen',18) + esc(action) +
    '</button></div><div class="ab-art" aria-hidden="true"><div class="ab-slip-stack diary-print-stack">' +
    '<div class="ab-slip-back"></div><div class="ab-slip-mid"></div><div class="diary-print">'+
    (personalUrl && isGalleryVideo(personalPhoto) ? galleryThumbnail(personalUrl,true,personalPhoto.poster) : '<img data-cover alt="">')+'<div><i></i><span data-cover-label></span></div></div></div></div></section>' +
    '<section class="ab-player"><div class="ab-player-head"><h2>'+t('collection')+'</h2><span class="ab-count" data-count></span></div>' +
    '<div class="sample-picker"><label><span class="ab-sr">'+t('chooseExample')+'</span><select data-slide>' +
    demos.map((day,i) => '<option value="'+i+'">'+esc(day.title)+'</option>').join('') + '</select>'+icon('chevron',16)+'</label>' +
    '<div class="sample-paging"><button type="button" aria-label="'+t('previousPostcard')+'" title="'+t('previousPostcard')+'" data-prev>'+icon('chevron',17)+'</button>' +
    '<button type="button" aria-label="'+t('nextPostcard')+'" title="'+t('nextPostcard')+'" data-next>'+icon('chevron',17)+'</button></div></div>' +
    '<div class="sample-actions"><button type="button" class="sample-sound" data-play></button>' +
    '<button type="button" class="sample-link" data-example>'+t('openPostcard')+icon('chevron',15)+'</button></div></section>' +
    '<section class="ab-evidence home-personal"><header><h2>'+t('myDay')+'</h2>'+
    (days.length?'<button class="home-all-days" type="button" data-action="archive">'+t('allDays')+'</button>':'')+'</header>' +
    '<button class="add-note" type="button" data-action="moment">'+icon('pen',19)+'<span>'+t('captureMoment')+'</span>'+icon('plus',16)+'</button>' +
    Array.from(previews.values(),dayPreview).join('') +
    '</section></div>';
  let index = selectedBeforeLanguageChange ?? 0;
  selectedBeforeLanguageChange = undefined;
  let audio;
  const find = value => root.querySelector(value);
  function soundButton(active) {
    const symbol = active ? '<span class="sample-stop" aria-hidden="true"></span>' : icon('play',16);
    find('[data-play]').innerHTML = symbol + '<span>'+t(active ? 'stopMusic' : 'listen')+'</span>';
  }
  function stop() {
    if (audio) {
      audio.onended = null; audio.onerror = null;
      audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null;
    }
    soundButton(false);
  }
  function paint() {
    const day = demos[index];
    find('.ab-hero').dataset.mood = personalMood || postcardMood(day);
    const cover = find('[data-cover]');
    if (cover) cover.src = personalUrl || day.photos[0].src;
    find('[data-cover-label]').textContent = formatDate(personalUrl ? entry.date : day.date);
    find('[data-count]').textContent = t('exampleCount',{position:index + 1,total:demos.length});
    find('[data-slide]').value = index;
    find('[data-prev]').disabled = index === 0;
    find('[data-next]').disabled = index === demos.length - 1;
  }
  function select(i) { stop(); index = i; paint(); }
  find('[data-next]').onclick = () => select(Math.min(demos.length-1,index+1));
  find('[data-prev]').onclick = () => select(Math.max(0,index-1));
  find('[data-slide]').onchange = event => select(Number(event.target.value));
  find('[data-example]').onclick = () => ctx.viewDay(demos[index]);
  find('[data-play]').onclick = async () => {
    if (audio) return stop();
    const sound = audio = new Audio(demos[index].music.src);
    soundButton(true);
    sound.onended = stop;
    sound.onerror = () => {
      if (audio === sound) { stop(); ctx.toast(t('musicUnavailable')); }
    };
    try {
      await sound.play();
    } catch { if (audio === sound) { stop(); ctx.toast(t('musicUnavailable')); } }
  };
  find('[data-today]').onclick = () => entry?.status === 'ready' && !hasDraft ? ctx.viewDay(entry) : ctx.edit(entry);
  find('[data-action="moment"]').onclick = () => {stop();ctx.quickMoment();};
  for (const article of root.querySelectorAll('[data-home-day]')) {
    const {day,notes} = previews.get(article.dataset.homeDay);
    article.querySelector('.home-memory').onclick = () => day.status==='ready' ? ctx.viewDay(day) : ctx.edit(day);
    article.querySelector('[data-edit-day]').onclick = () => ctx.edit(day);
    article.onclick = async event => {
      const button = event.target.closest('[data-delete-day],[data-delete-note]');
      if (!button || button.disabled) return;
      const pending = button.hasAttribute('data-delete-day') ? ctx.deleteDayFromHome(day) : ctx.deleteNote(day,notes[Number(button.dataset.deleteNote)]);
      button.disabled = true;
      try {
        await pending;
      } finally { button.disabled = false; }
    };
  }
  const allDays = find('[data-action="archive"]');
  if (allDays) allDays.onclick = () => ctx.go('archive');
  function onVisibility(){if(document.hidden)stop();}
  document.addEventListener('visibilitychange',onVisibility);
  const dialog = document.getElementById('sheet');
  const observer = new MutationObserver(() => {if(dialog.open)stop();});
  observer.observe(dialog,{attributes:true,attributeFilter:['open']});
  soundButton(false);
  paint();
  return () => {
    if (getLanguage() !== language) selectedBeforeLanguageChange = index;
    stop(); observer.disconnect(); document.removeEventListener('visibilitychange',onVisibility);
    for (const url of new Set([personalUrl,recentUrl])) {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    }
  };
}
