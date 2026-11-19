import {visibleDayNotes} from './store.js';
import {postcardMood} from './art.js';
import {demos} from './demos.js';
import {getLanguage, getLocale} from './i18n.js';
import {t} from './locales/views.js';
import {editDayButton, esc, formatDate, icon} from './ui.js';

let filtersBeforeLanguageChange;

function terms(value) {
  return String(value || '').normalize('NFC').toLocaleLowerCase(getLocale()).replaceAll('ё','е').trim();
}
function label(day) {
  return day.title || day.titleOverride || day.text?.trim().split(/\s+/).slice(0,7).join(' ') ||
    day.moments?.[0]?.text || t('dayEntry');
}
export function mountLibrary(root, records, examples, ctx) {
  const language = getLanguage();
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
    ctx.sheet(t('versions'), '<div class="grid-list">' + group.map(day =>
      '<button type="button" data-version="' + esc(day.id) + '">' + icon(day.primary !== false?'check':'layers') +
      '<span>' + esc(label(day)) + '<small class="list-detail">' + t(day.primary!==false?'primaryVersion':'separateCopy') +
      '</small></span></button>').join('') + '</div>', body => {
        body.querySelectorAll('[data-version]').forEach(button => { button.onclick = () => open(group.find(day=>day.id===button.dataset.version)); });
    });
  }
  root.innerHTML = (examples || !days.length ? '' :
    '<div class="library-tools"><label class="search-box">' + icon('search',19) +
    '<span class="ab-sr">'+t('searchArchive')+'</span><input type="search" placeholder="'+t('searchHint')+'" data-search></label>' +
    '<label class="month-select"><span class="ab-sr">'+t('chooseMonth')+'</span><select data-month><option value="">'+t('allMonths')+'</option>' +
    [...new Set(days.map(day=>day.date.slice(0,7)))].map(m => '<option value="' + esc(m) + '">' +
    esc(formatDate(m+'-01',{month:'long',year:'numeric'})) + '</option>').join('') + '</select></label></div>') +
    '<div class="'+(examples ? 'library-grid' : 'personal-gallery')+'" data-grid></div>';
  const grid = root.querySelector('[data-grid]');
  const search = root.querySelector('[data-search]'), month = root.querySelector('[data-month]');
  if (search && filtersBeforeLanguageChange) {
    search.value = filtersBeforeLanguageChange.query;
    month.value = filtersBeforeLanguageChange.month;
  }
  filtersBeforeLanguageChange = undefined;
  function photo(day) {
    if (thumbnails.has(day.id)) return thumbnails.get(day.id);
    const first = day.photos?.[0];
    const url = first?.blob ? URL.createObjectURL(first.blob) : first?.src || '';
    thumbnails.set(day.id,url); return url;
  }
  function personalCard(day) {
    const image = photo(day);
    const pigment = day.photos?.[0]?.color;
    const coverStyle = typeof pigment === 'string' && /^#[a-f\d]{6}$/i.test(pigment)
      ? ' style="--cover-pigment:'+pigment+'"' : '';
    const descriptionId='gallery-day-'+day.id;
    const draft = day.status !== 'ready';
    const note = visibleDayNotes(day).at(-1);
    const copies = variants.get(day.date).length;
    const dateLabel = esc(formatDate(day.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'}));
    return '<article class="personal-card" data-mood="'+postcardMood(day)+'"'+coverStyle+'>'+
      '<button type="button" class="personal-open" data-id="'+esc(day.id)+'">'+
      '<span class="day-cover'+(image?'':' paper-cover')+'">'+
      (image?'<img src="'+esc(image)+'" loading="lazy" alt="">':'')+
      '<time datetime="'+esc(day.date)+'" aria-label="'+dateLabel+'"><b>'+esc(formatDate(day.date,{day:'numeric'}))+'</b>'+
      '<span>'+esc(formatDate(day.date,{weekday:'long'}))+'</span></time>'+
      (draft?'<span class="day-draft">'+icon('pen',13)+t('draft')+'</span>':'')+'</span>'+
      '<span class="day-card-footer"><span class="day-card-copy"><strong id="'+esc(descriptionId)+'">'+esc(label(day))+'</strong>'+
      (note && note.text!==label(day)?'<span class="day-note-excerpt">'+icon('pen',14)+'<span class="ab-sr">'+t('noteLabel')+' </span>'+esc(note.text)+'</span>':'')+
      (day.music?.name?'<span class="day-track">'+icon('music',15)+esc(day.music.name)+'</span>':'')+
      '</span><span class="day-open-icon">'+icon('chevron',16)+'</span></span></button>'+
      '<div class="day-card-actions">'+editDayButton(day.id,descriptionId)+
        (draft?'<button type="button" class="versions-link" data-draft="'+esc(day.id)+'">'+t('draftActions')+'</button>':'')+
        (copies>1?'<button type="button" class="versions-link" data-versions="'+esc(day.date)+'">'+t('versions')+' · '+copies+'</button>':'')+'</div></article>';
  }
  function personalMonths(entries) {
    const months = new Map();
    for(const day of entries) {
      const month = day.date.slice(0,7);
      if(!months.has(month)) months.set(month,[]);
      months.get(month).push(personalCard(day));
    }
    return [...months].map(([month,cards])=>'<section class="day-month" aria-labelledby="month-'+esc(month)+'">'+
      '<h2 id="month-'+esc(month)+'">'+esc(formatDate(month+'-01',{month:'long',year:'numeric'}))+'</h2>'+
      '<div class="day-month-grid">'+cards.join('')+'</div></section>').join('');
  }
  function paint() {
    const query = terms(search?.value);
    filtered = [];
    for (const [date, group] of variants) {
      if (month?.value && !date.startsWith(month.value)) continue;
      const matches = query ? group.filter(day =>
        terms([label(day),day.titleOverride,date,formatDate(date),day.text,day.caption,day.music?.name,
          ...visibleDayNotes(day).map(moment=>moment.text)].join(' ')).includes(query)) : group;
      const day = matches.find(version => version.primary !== false) || matches[0];
      if (day) filtered.push(day);
    }
    if (!filtered.length) {
      const empty = !days.length;
      grid.innerHTML = '<section class="panel empty-state"><div class="empty-icon">' + icon(empty?'book':'search',27) +
        '</div><h2>' + t(empty?'emptyArchive':'noResults') +
        '</h2><p>'+t(empty?'firstDay':'trySearch') +
        '</p><button class="primary" data-empty>' + t(empty?'writeDay':'resetSearch') + '</button></section>';
      grid.querySelector('[data-empty]').onclick = () => { if(empty) ctx.edit(); else {search.value='';month.value='';paint();search.focus();} };
      return;
    }
    if(!examples) { grid.innerHTML=personalMonths(filtered);return; }
    grid.innerHTML = filtered.map(day => {
      const image = photo(day);
      return '<article class="library-item panel" data-mood="' + postcardMood(day) + '"><button class="library-open" data-id="' + esc(day.id) + '">' +
        (image ? '<img class="library-photo" loading="lazy" src="' + esc(image) + '" alt="">' : '<span class="library-photo empty-cover">'+icon('pen',30)+'</span>') +
        '<span class="library-copy"><small>' + esc(formatDate(day.date)) +
        (day.status !== 'ready' ? ' · '+t('draft') : '') + '</small><strong>' + esc(label(day)) +
        '</strong><span>'+esc(day.music?.name || t('continueEntry'))+'</span></span><i>'+icon('chevron',17)+'</i></button></article>';
    }).join('');
  }
  grid.onclick = event => {
    const button = event.target.closest('[data-id],[data-versions],[data-draft],[data-edit-day]');
    if(!button)return;
    if(button.dataset.editDay)ctx.edit(filtered.find(day=>day.id===button.dataset.editDay));
    else if(button.dataset.versions)showVersions(button.dataset.versions);
    else if(button.dataset.draft)ctx.dayActions(filtered.find(day=>day.id===button.dataset.draft));
    else open(filtered.find(day=>day.id===button.dataset.id));
  };
  search?.addEventListener('input',paint); month?.addEventListener('change',paint);
  paint();
  return () => {
    if (search && getLanguage() !== language) filtersBeforeLanguageChange = {query:search.value,month:month.value};
    for(const url of thumbnails.values())if(url.startsWith('blob:'))URL.revokeObjectURL(url);
  };
}
