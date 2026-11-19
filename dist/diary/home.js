import {demos} from './demos.js';
import {dayRow, esc, formatDate, icon, localDate} from './ui.js';

export function mountHome(root, days, ctx) {
  const date = localDate();
  const entry = days.find(day => day.date === date && day.primary !== false);
  const hasDraft = entry && (entry.status !== 'ready' || entry.pendingEdit);
  const action = entry ? hasDraft ? 'Продолжить запись' : 'Открыть мой день' : 'Записать день';
  const recent = days.filter(day => day.status === 'ready' && day.primary !== false)
    .sort((a,b) => b.date.localeCompare(a.date))[0];
  root.innerHTML = '<div class="ab-view ab-audit diary-home">' +
    '<section class="ab-hero"><div class="ab-hero-copy"><div class="ab-meta"><span class="ab-record-mark" aria-hidden="true"></span>' +
    esc(formatDate(date,{weekday:'long',day:'numeric',month:'long'})) + '</div><h2>' +
    (entry ? hasDraft ? 'Твой день в деталях' : 'Открытка дня' : 'Каким был твой день?') +
    '</h2><p>' + (hasDraft ? 'Вернись к своим заметкам, фотографиям и песне дня.' :
    'Собери историю, фотографии и песню в живую открытку.') +
    '</p><button type="button" class="ab-action" data-today>' + icon(entry?.status === 'ready' && !hasDraft ? 'book' : 'pen',18) + esc(action) +
    '</button></div><div class="ab-art" aria-hidden="true"><div class="ab-slip-stack diary-print-stack">' +
    '<div class="ab-slip-back"></div><div class="ab-slip-mid"></div><div class="diary-print"><img data-cover alt=""><div><i></i><span data-cover-label></span></div></div></div></div></section>' +
    '<section class="ab-player"><div class="ab-player-head"><h2>Открытки из коллекции</h2><span class="ab-count" data-count></span></div>' +
    '<button type="button" class="sample-title" data-open></button><label class="ab-scrub"><span class="ab-sr">Выбрать пример дня</span>' +
    '<input type="range" min="1" max="' + demos.length + '" value="1" data-slide></label>' +
    '<div class="ab-player-actions"><div class="ab-transport"><button aria-label="Предыдущая открытка" data-prev>' + icon('prev',20) + '</button>' +
    '<button class="ab-play" aria-label="Послушать музыку" data-play>' + icon('play',18) + '</button>' +
    '<button aria-label="Следующая открытка" data-next>' + icon('next',20) + '</button></div>' +
    '<button type="button" class="sample-link" data-example>Открыть открытку</button></div></section>' +
    '<section class="ab-evidence"><h2>Мой день</h2>' +
    dayRow({title:'Поймать момент',note:'Записать деталь, пока помнишь',action:'moment',symbol:'pen'}) +
    dayRow({title:recent ? recent.title : 'Мой архив',note:recent ? 'Последняя сохранённая открытка' : 'Сохранённые дни и черновики',action:recent ? 'recent' : 'archive',symbol:'archive'}) +
    '</section></div>';
  let index = 0;
  let audio;
  const find = value => root.querySelector(value);
  function stop() {
    if (audio) {
      audio.onended = null; audio.onerror = null;
      audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null;
    }
    find('[data-play]').innerHTML = icon('play',18);
    find('[data-play]').setAttribute('aria-label','Послушать музыку');
  }
  function paint() {
    const day = demos[index];
    find('[data-cover]').src = day.photos[0].src;
    find('[data-cover-label]').textContent = formatDate(day.date);
    find('[data-open]').textContent = day.title;
    find('[data-count]').textContent = (index + 1) + ' из ' + demos.length;
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
    try {
      await sound.play();
      if (audio !== sound) return;
      find('[data-play]').innerHTML = icon('pause',18);
      find('[data-play]').setAttribute('aria-label','Пауза');
    } catch { if (audio === sound) { stop(); ctx.toast('Музыка не загрузилась. Попробуй ещё раз.'); } }
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
  return () => { stop(); observer.disconnect(); document.removeEventListener('visibilitychange',onVisibility); };
}
