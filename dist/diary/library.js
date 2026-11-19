import {demos} from './demos.js';
import {esc, formatDate, icon} from './ui.js';

function terms(value) {
  return String(value || '').toLocaleLowerCase('ru').replaceAll('ё','е').trim();
}
function label(day) {
  return day.title || day.titleOverride || day.text?.trim().split(/\s+/).slice(0,7).join(' ') ||
    day.moments?.[0]?.text || 'Запись дня';
}
export function mountLibrary(root, records, examples, ctx) {
  const days = (examples ? [...demos] : [...records]).sort((a,b) => examples ? 0 : b.date.localeCompare(a.date));
  const thumbnails = new Map();
  let filtered;
  const variants = new Map();
  for (const day of days) {
    const group = variants.get(day.date) || [];
    group.push(day); variants.set(day.date,group);
  }
  function open(day){ if (day.status === 'ready') ctx.viewDay(day); else ctx.edit(day); }
  function showVersions(date) {
    const group = variants.get(date);
    ctx.sheet('Версии дня', '<div class="grid-list">' + group.map(day =>
      '<button type="button" data-version="' + esc(day.id) + '">' + icon(day.primary !== false?'check':'layers') +
      '<span>' + esc(label(day)) + '<small class="list-detail">' + (day.primary!==false?'Основная версия':'Отдельная копия') +
      '</small></span></button>').join('') + '</div>', body => {
        body.querySelectorAll('[data-version]').forEach(button => { button.onclick = () => open(group.find(day=>day.id===button.dataset.version)); });
    });
  }
  root.innerHTML = (examples ? '' :
    '<div class="library-tools"><label class="search-box">' + icon('search',19) +
    '<span class="ab-sr">Поиск в архиве</span><input type="search" placeholder="Название, дата или слово из записи" data-search></label>' +
    '<label class="month-select"><span class="ab-sr">Выбрать месяц</span><select data-month><option value="">Все месяцы</option>' +
    [...new Set(days.map(day=>day.date.slice(0,7)))].map(m => '<option value="' + esc(m) + '">' +
    esc(formatDate(m+'-01',{month:'long',year:'numeric'})) + '</option>').join('') + '</select></label></div>') +
    '<div class="library-grid" data-grid></div>';
  const grid = root.querySelector('[data-grid]');
  const search = root.querySelector('[data-search]'), month = root.querySelector('[data-month]');
  function photo(day) {
    if (thumbnails.has(day.id)) return thumbnails.get(day.id);
    const first = day.photos?.[0];
    const url = first?.blob ? URL.createObjectURL(first.blob) : first?.src || '';
    thumbnails.set(day.id,url); return url;
  }
  function paint() {
    const query = terms(search?.value);
    filtered = days.filter(day => {
      if (month?.value && !day.date.startsWith(month.value)) return false;
      if (!query) return day.primary !== false || examples;
      return terms([day.title,day.date,formatDate(day.date),day.text,day.caption,day.music?.name,
        ...((day.moments||[]).map(moment=>moment.text))].join(' ')).includes(query);
    });
    if (!filtered.length) {
      const empty = !days.length;
      grid.innerHTML = '<section class="panel empty-state"><div class="empty-icon">' + icon(empty?'archive':'search',27) +
        '</div><h2>' + (empty?'Здесь будут твои дни':'Ничего не найдено') +
        '</h2><p>'+(empty?'Сохрани первую открытку или добавь одну короткую заметку.':'Попробуй другое слово или выбери все месяцы.') +
        '</p><button class="primary" data-empty>' + (empty?'Записать день':'Сбросить поиск') + '</button></section>';
      grid.querySelector('[data-empty]').onclick = () => { if(empty) ctx.edit(); else {search.value='';month.value='';paint();search.focus();} };
      return;
    }
    grid.innerHTML = filtered.map(day => {
      const image = photo(day);
      const copies = variants.get(day.date).length;
      return '<article class="library-item panel"><button class="library-open" data-id="' + esc(day.id) + '">' +
        (image ? '<img class="library-photo" loading="lazy" src="' + esc(image) + '" alt="">' : '<span class="library-photo empty-cover">'+icon('pen',30)+'</span>') +
        '<span class="library-copy"><small>' + esc(formatDate(day.date)) +
        (day.status !== 'ready' ? ' · Черновик' : '') + '</small><strong>' + esc(label(day)) +
        '</strong><span>'+esc(day.music?.name || 'Продолжить запись')+'</span></span><i>'+icon('chevron',17)+'</i></button>'+
        (!examples && copies>1?'<button class="versions-link" data-versions="'+esc(day.date)+'">Версии дня · '+copies+'</button>':'') + '</article>';
    }).join('');
  }
  grid.onclick = event => {
    const button = event.target.closest('[data-id],[data-versions]');
    if(!button)return;
    if(button.dataset.versions)showVersions(button.dataset.versions);
    else open(filtered.find(day=>day.id===button.dataset.id));
  };
  search?.addEventListener('input',paint); month?.addEventListener('change',paint);
  paint();
  return () => {for(const url of thumbnails.values())if(url.startsWith('blob:'))URL.revokeObjectURL(url);};
}
