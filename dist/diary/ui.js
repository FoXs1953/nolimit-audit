import {t} from './locales/shell.js';
import {getLocale} from './i18n.js';
export {formatDate} from './i18n.js';

const symbols = {
    people:'<circle cx="9" cy="8" r="3"/><path d="M2.5 20v-2a6.5 6.5 0 0 1 13 0v2M16 5.4a3 3 0 0 1 0 5.2M18 14a5 5 0 0 1 3.5 4.8V20"/>',
    pen:'<path d="m4 16 11-11 4 4L8 20l-5 1 1-5Zm9-9 4 4"/><path d="M13 21h8"/>',
    camera:'<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="3"/>',
    music:'<path d="M9 18V6l11-2v12M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
    archive:'<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v11h14V9m-9 4h4"/>',
    settings:'<path d="M4 6h6m4 0h6M4 12h10m4 0h2M4 18h2m4 0h10"/><circle cx="12" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    photo:'<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.4"/><path d="m4 17 5-5 3 3 4-6 4 5"/>',
    plus:'<path d="M12 4v16M4 12h16"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    sound:'<path d="M3 9h4l5-4v14l-5-4H3zm13-1a6 6 0 010 8m3-11a10 10 0 010 14"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
    trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14m-8 4v6m4-6v6"/>',book:'<path d="M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3zM12 6v15"/>',

    audit:'<path d="M7 4v16M11 6h9M11 12h7M11 18h9"/><circle cx="7" cy="6" r="1.5"/><circle cx="7" cy="12" r="1.5"/><circle cx="7" cy="18" r="1.5"/>',
    compare:'<path d="M5 7h14M16 4l3 3-3 3M19 17H5m3-3-3 3 3 3"/>',
    folder:'<path d="M3 8V6a2 2 0 012-2h5l2 3h7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8Z"/><path d="M3 9h18"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="4"/><path d="M7 3v5m10-5v5M3.5 11h17M8 15h3"/>',
    layers:'<path d="m3 8 9-5 9 5-9 5-9-5Zm0 4 9 5 9-5m-18 5 9 5 9-5"/>',
    gauge:'<path d="M4.4 18a9 9 0 1115.2 0H4.4Z"/><path d="m12 14 4-5M6 12l1 .5m10.5 0 1-.5"/><circle cx="12" cy="14" r="1"/>',
    document:'<path d="M6 3h8l4 4v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1Zm7 0v5h5M8 12h7m-7 4h6"/>',
    receipt:'<path d="M5 3l2 1.5L9 3l3 1.5L15 3l2 1.5L19 3v18l-2-1.5-2 1.5-3-1.5L9 21l-2-1.5L5 21V3Zm3 5h8m-8 4h8m-8 4h5"/>',
    ledger:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 3v18m0-12h11m-11 5h11"/>',
    wallet:'<path d="M4 8V6a2 2 0 012-2h11v4m-12 0h14a1 1 0 011 1v10H5a2 2 0 01-2-2v-7a2 2 0 012-2Zm15 4h-5v4h5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check:'<path d="m5 12 4 4L19 6"/>',chevron:'<path d="m9 5 7 7-7 7"/>',
    play:'<path fill="currentColor" stroke="none" d="M6.6 4.2a1 1 0 011.5-.86l12 7.8a1 1 0 010 1.7l-12 7.8a1 1 0 01-1.5-.84Z"/>',
    pause:'<path stroke-width="4" d="M8 5v14m8-14v14"/>',
    prev:'<path d="M5 5v14m13-14L8 12l10 7Z"/>',next:'<path d="M19 5v14M6 5l10 7-10 7Z"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.5"/>',
    calculator:'<rect x="5" y="2.5" width="14" height="19" rx="3"/><path d="M8 7h8m-8 5h1m4 0h1m-6 5h1m4 0h1"/>',
    restart:'<path d="M4 10a8 8 0 117 10M4 5v5h5"/>',
    building:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 8h1m4 0h1m-6 4h1m4 0h1m-5 8v-4h4v4"/>',
    more:'<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    close:'<path d="m6 6 12 12m0-12L6 18"/>'
  };
  export function icon(name,size=20) {
    return '<svg aria-hidden="true" focusable="false" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+(symbols[name] || symbols.document)+'</svg>';
  }

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[c]);

export function localDate() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

export function editDayButton(id, descriptionId) {
  return '<button type="button" class="day-edit" data-edit-day="'+esc(id)+'" aria-describedby="'+esc(descriptionId)+'">'+
    icon('pen',16)+'<span>'+esc(t('edit'))+'</span></button>';
}

export function noteList(notes, {dayId, layout='full'}={}) {
  if (!notes.length) return '';
  const formatter=new Intl.DateTimeFormat(getLocale(),{hour:'2-digit',minute:'2-digit'});
  const owner=dayId ? ' data-notes-day="'+esc(dayId)+'"' : '';
  const deleteLabel=dayId ? esc(t('deleteNote')) : '';
  const rows=notes.map((note,index)=>{
    const stamp=note.time ? new Date(note.time) : null;
    const time=stamp && Number.isFinite(stamp.valueOf()) ?
      '<time datetime="'+stamp.toISOString()+'">'+esc(formatter.format(stamp))+'</time>' : '';
    const id='note-'+esc(dayId)+'-'+index;
    const remove=dayId ? '<button type="button" class="diary-delete" data-delete-note="'+index+'" aria-label="'+deleteLabel+
      '" title="'+deleteLabel+'" aria-describedby="'+id+'">'+icon('trash',17)+'</button>' : '';
    return '<li>'+time+'<p'+(dayId?' id="'+id+'"':'')+'>'+esc(note.text)+'</p>'+remove+'</li>';
  });
  const latest=layout==='latest' ? rows.pop() : '';
  if (layout==='full') return '<section class="day-notes"'+owner+'><h3>'+t('savedNotes')+'</h3><ul>'+rows.join('')+'</ul></section>';
  const more=rows.length ? '<details class="note-disclosure"'+owner+'><summary>'+esc(t('showAllNotes',{count:notes.length}))+
    '</summary><ul>'+rows.reverse().join('')+'</ul></details>' : '';
  if (!latest) return '<div class="day-notes home-note-group"'+owner+'>'+more+'</div>';
  return '<section class="day-notes home-note-group latest-note"'+owner+'><h3>'+t('latestNote')+'</h3><ul>'+latest+'</ul>'+more+'</section>';
}

export function dayRow({title, note, symbol, action, trailing='', image=''}) {
  const art = image ? '<img alt="" src="' + esc(image) + '">' : icon(symbol);
  return '<button type="button" class="ab-row" data-action="' + esc(action) + '">' +
    '<span class="ab-source-icon">' + art + '</span><span class="ab-row-name"><b>' +
    esc(title) + '</b><small>' + esc(note) + '</small></span><span class="ab-row-amount">' +
    esc(trailing) + '</span><span class="ab-row-next">' + icon('chevron', 15) + '</span></button>';
}

let toastTimer;
let updateNotice;
export function refreshNotice() {
  if (updateNotice) updateNotice();
  else document.getElementById('notice').hidden = true;
}
export function toast(message, action) {
  const notice = document.getElementById('notice');
  clearTimeout(toastTimer);
  const label = value => typeof value === 'function' ? value() : value;
  const text = document.createTextNode(label(message));
  notice.replaceChildren(text);
  updateNotice = null;
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label(action.label);
    updateNotice = () => { text.data = label(message); button.textContent = label(action.label); };
    button.onclick = async () => {
      button.disabled = true;
      try { await action.run(); } catch (error) { toast(error.message || t('actionError')); }
    };
    notice.append(button);
  }
  notice.hidden = false;
  toastTimer = setTimeout(() => { notice.hidden = true; }, action ? 12000 : 3500);
}

const dialog = document.getElementById('sheet');
let trigger;
let activePanel;
let closeTimer;
let panelCounter = 0;
const panels = new Map();
export function forgetPanels() { panels.clear(); }
export function sheet(title, html, onMount) {
  const key = ++panelCounter;
  if (!dialog.open) trigger = document.activeElement;
  if (history.state?.panel && dialog.open) panels.delete(history.state.panel);
  panels.set(key, {title, html, onMount});
  if (panels.size > 16) panels.delete(panels.keys().next().value);
  const state = {...history.state,panel:key};
  if (dialog.open) history.replaceState(state, '', location.href);
  else history.pushState(state, '', location.href);
  showPanel(key);
}
export function showPanel(key) {
  const panel = panels.get(key);
  if (!panel) return false;
  clearTimeout(closeTimer);
  activePanel = key;
  dialog.classList.remove('closing');
  const body = document.getElementById('sheet-body');
  document.getElementById('sheet-title').textContent = panel.title;
  body.innerHTML = panel.html;
  if (!dialog.open) dialog.showModal();
  document.body.style.overflow = 'hidden';
  dialog.querySelector('.sheet-box').scrollTop = 0;
  document.getElementById('sheet-close').focus({preventScroll:true});
  if (panel.onMount) panel.onMount(body);
  return true;
}
export function hidePanel(immediate = false) {
  if (!dialog.open) return;
  clearTimeout(closeTimer);
  activePanel = null;
  const finish = () => {
    dialog.close();
    dialog.classList.remove('closing');
    document.body.style.overflow = '';
    document.getElementById('sheet-body').replaceChildren();
    if (trigger?.isConnected) trigger.focus({preventScroll:true});
  };
  if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
  else { dialog.classList.add('closing'); closeTimer = setTimeout(finish, 150); }
}
let closing = false;
export function closeSheet() {
  if (!dialog.open || closing) return;
  if (history.state?.panel) {
    closing = true;
    history.back();
  } else hidePanel();
}
export function syncPanel() {
  closing = false;
  if (history.state?.panel && showPanel(history.state.panel)) return;
  if (activePanel || dialog.open) hidePanel();
}
document.getElementById('sheet-close').onclick = closeSheet;
dialog.addEventListener('cancel', event => {event.preventDefault(); closeSheet();});
dialog.addEventListener('click', event => { if (event.target === dialog) closeSheet(); });
let startY;
const box = dialog.querySelector('.sheet-box');
box.addEventListener('pointerdown', event => {
  if (!matchMedia('(max-width:760px)').matches || event.target.closest('button') || !event.target.closest('.grab,.sheet-head')) return;
  startY = event.clientY;
  box.setPointerCapture(event.pointerId);
});
box.addEventListener('pointermove', event => {
  if (startY !== undefined && !matchMedia('(prefers-reduced-motion: reduce)').matches) box.style.translate = '0 ' + Math.max(0,event.clientY-startY) + 'px';
});
for (const name of ['pointerup','pointercancel']) box.addEventListener(name, event => {
  if (startY === undefined) return;
  if (name === 'pointerup' && event.clientY - startY > 55) closeSheet();
  startY = undefined;
  box.style.translate = '';
});
