import {demos} from './demos.js';
import {getLanguage} from './i18n.js';
import {t} from './locales/views.js';
import {dayRow, esc, formatDate, icon, localDate} from './ui.js';

let selectedBeforeLanguageChange;

export function mountHome(root, days, ctx) {
  const language = getLanguage();
  const date = localDate();
  const entry = days.find(day => day.date === date && day.primary !== false);
  const hasDraft = entry && (entry.status !== 'ready' || entry.pendingEdit);
  const personalPhoto = (entry?.pendingEdit || entry)?.photos?.[0];
  const personalUrl = personalPhoto?.blob ? URL.createObjectURL(personalPhoto.blob) : personalPhoto?.src;
  const action = t(entry ? hasDraft ? 'continueEntry' : 'openToday' : 'writeDay');
  const recent = days.filter(day => day.status === 'ready' && day.primary !== false)
    .sort((a,b) => b.date.localeCompare(a.date))[0];
  root.innerHTML = '<div class="ab-view ab-audit diary-home">' +
    '<section class="ab-hero"><div class="ab-hero-copy"><div class="ab-meta"><span class="ab-record-mark" aria-hidden="true"></span>' +
    esc(formatDate(date,{weekday:'long',day:'numeric',month:'long'})) + '</div><h2>' +
    t(entry ? hasDraft ? 'dayDetails' : 'postcardOfDay' : 'howWasToday') +
    '</h2><p>' + t(hasDraft ? 'revisitDraft' : 'makePostcard') +
    '</p><button type="button" class="ab-action" data-today>' + icon(entry?.status === 'ready' && !hasDraft ? 'book' : 'pen',18) + esc(action) +
    '</button></div><div class="ab-art" aria-hidden="true"><div class="ab-slip-stack diary-print-stack">' +
    '<div class="ab-slip-back"></div><div class="ab-slip-mid"></div><div class="diary-print"><img data-cover alt=""><div><i></i><span data-cover-label></span></div></div></div></div></section>' +
    '<section class="ab-player"><div class="ab-player-head"><h2>'+t('collection')+'</h2><span class="ab-count" data-count></span></div>' +
    '<button type="button" class="sample-title" data-open></button><label class="ab-scrub"><span class="ab-sr">'+t('chooseExample')+'</span>' +
    '<input type="range" min="1" max="' + demos.length + '" value="1" data-slide></label>' +
    '<div class="ab-player-actions"><div class="ab-transport"><button aria-label="'+t('previousPostcard')+'" data-prev>' + icon('prev',20) + '</button>' +
    '<button class="ab-play" aria-label="'+t('listen')+'" data-play>' + icon('play',18) + '</button>' +
    '<button aria-label="'+t('nextPostcard')+'" data-next>' + icon('next',20) + '</button></div>' +
    '<button type="button" class="sample-link" data-example>'+t('openPostcard')+'</button></div></section>' +
    '<section class="ab-evidence"><h2>'+t('myDay')+'</h2>' +
    dayRow({title:t('captureMoment'),note:t('captureDetail'),action:'moment',symbol:'pen'}) +
    dayRow({title:recent?.title || t('myArchive'),note:t(recent ? 'latestCard' : 'daysAndDrafts'),action:recent ? 'recent' : 'archive',symbol:'archive'}) +
    '</section></div>';
  let index = selectedBeforeLanguageChange ?? 0;
  selectedBeforeLanguageChange = undefined;
  let audio;
  const find = value => root.querySelector(value);
  function stop() {
    if (audio) {
      audio.onended = null; audio.onerror = null;
      audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null;
    }
    find('[data-play]').innerHTML = icon('play',18);
    find('[data-play]').setAttribute('aria-label',t('listen'));
  }
  function paint() {
    const day = demos[index];
    find('[data-cover]').src = personalUrl || day.photos[0].src;
    find('[data-cover-label]').textContent = formatDate(personalUrl ? entry.date : day.date);
    find('[data-open]').textContent = day.title;
    find('[data-count]').textContent = t('exampleCount',{position:index + 1,total:demos.length});
    const slider = find('[data-slide]');
    slider.value = index + 1;
    slider.style.setProperty('--ab-fill', (index * 100 / Math.max(1,demos.length - 1)) + '%');
    slider.setAttribute('aria-valuetext',day.title);
    find('[data-prev]').disabled = index === 0;
    find('[data-next]').disabled = index === demos.length - 1;
  }
  function select(i) { stop(); index = i; paint(); }
  find('[data-next]').onclick = () => select(Math.min(demos.length-1,index+1));
  find('[data-prev]').onclick = () => select(Math.max(0,index-1));
  find('[data-slide]').oninput = event => select(Number(event.target.value) - 1);
  find('[data-open]').onclick = find('[data-example]').onclick = () => ctx.viewDay(demos[index]);
  find('[data-play]').onclick = async () => {
    if (audio) return stop();
    const sound = audio = new Audio(demos[index].music.src);
    sound.onended = stop;
    sound.onerror = () => {
      if (audio === sound) { stop(); ctx.toast(t('musicUnavailable')); }
    };
    try {
      await sound.play();
      if (audio !== sound) return;
      find('[data-play]').innerHTML = icon('pause',18);
      find('[data-play]').setAttribute('aria-label',t('pause'));
    } catch { if (audio === sound) { stop(); ctx.toast(t('musicUnavailable')); } }
  };
  find('[data-today]').onclick = () => entry?.status === 'ready' && !hasDraft ? ctx.viewDay(entry) : ctx.edit(entry);
  find('[data-action="moment"]').onclick = () => {stop();ctx.quickMoment();};
  const last = find('[data-action="recent"]');
  if (last) last.onclick = () => ctx.viewDay(recent);
  else find('[data-action="archive"]').onclick = () => ctx.go('archive');
  function onVisibility(){if(document.hidden)stop();}
  document.addEventListener('visibilitychange',onVisibility);
  const dialog = document.getElementById('sheet');
  const observer = new MutationObserver(() => {if(dialog.open)stop();});
  observer.observe(dialog,{attributes:true,attributeFilter:['open']});
  paint();
  return () => {
    if (getLanguage() !== language) selectedBeforeLanguageChange = index;
    stop(); observer.disconnect(); document.removeEventListener('visibilitychange',onVisibility);
    if (personalUrl?.startsWith('blob:')) URL.revokeObjectURL(personalUrl);
  };
}
