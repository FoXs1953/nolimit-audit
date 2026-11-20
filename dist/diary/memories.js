import {presentRecipe} from './art.js';
import {musicFromFile} from './editor.js';
import {memoryText as t} from './locales/memories.js';
import {automaticMemoryTrack,isMemoryDate,loadMemoryPreferences,memoryEntries,memoryPeriod,memoryTrackFromDay,saveMemoryPreferences,shiftMemoryAnchor} from './memories-data.js';
import {openMemoryViewer} from './memories-viewer.js';
import {musicLink} from './music-link.js';
import {isGalleryVideo} from './store.js';
import {esc,formatDate,galleryThumbnail,icon,localDate} from './ui.js';

const modes = ['week','month','custom'];
const dateStyle = {day:'numeric',month:'short',year:'numeric'};
const pageSize = 12;
let lastView;

function rangeLabel({start,end}) {
  const first = formatDate(start,dateStyle);
  return start===end ? first : first+' – '+formatDate(end,dateStyle);
}

function validRange(start,end) {
  return isMemoryDate(start) && isMemoryDate(end) && start<=end;
}

export function mountMemories(root,records,ctx,viewState) {
  const life = new AbortController();
  const opts = {signal:life.signal};
  const thumbs = new Map();
  const allEntries = memoryEntries(records,{start:'0001-01-01',end:'9999-12-31'});
  const today = localDate();
  const week = memoryPeriod('week',today);
  const latest = allEntries.at(-1)?.date;
  const defaultAnchor = allEntries.some(({date})=>date>=week.start && date<=week.end) ? today : latest || today;
  let preferences, period, entries, track, selectedSource, mode;
  let viewer, trigger, closePending = false, fileRequest = 0, storageFailed = false;
  const html = (key,values)=>esc(t(key,values));

  root.classList.add('memories');
  root.innerHTML = '<section class="panel memory-period" aria-label="'+html('period')+'">'+
    '<div class="memory-period-modes" role="group" aria-label="'+html('period')+'">'+
    modes.map(value=>'<button class="secondary" type="button" data-memory-mode="'+value+'" aria-pressed="false">'+html(value)+'</button>').join('')+'</div>'+
    '<div class="memory-period-nav"><button class="icon-button" type="button" data-period-step="-1" aria-label="'+html('previousPeriod')+'">'+icon('chevron')+'</button>'+
    '<p data-memory-range aria-live="polite"></p><button class="icon-button" type="button" data-period-step="1" aria-label="'+html('nextPeriod')+'">'+icon('chevron')+'</button></div>'+
    '<form class="memory-dates" novalidate hidden><label>'+html('start')+'<input type="date" name="first" required></label>'+
    '<label>'+html('end')+'<input type="date" name="last" required></label><button class="primary" type="submit">'+html('show')+'</button>'+
    '<p class="memory-error" role="alert" hidden></p></form></section>'+
    '<p class="memory-error" data-memory-storage role="status" hidden></p>'+
    '<section class="panel memory-soundtrack" hidden><label for="memory-source">'+html('music')+'</label>'+
    '<select id="memory-source"></select><div data-memory-input></div><p data-memory-track aria-live="polite"></p></section>'+
    '<div data-memory-result></div>'+
    '<dialog class="memory-viewer" aria-labelledby="memory-viewer-title"></dialog>';
  const find = selector=>root.querySelector(selector);
  const periodPanel = find('.memory-period');
  const periodNav = find('.memory-period-nav');
  const rangeOutput = find('[data-memory-range]');
  const dateForm = find('.memory-dates');
  const first = dateForm.elements.namedItem('first'), last = dateForm.elements.namedItem('last');
  const dateError = find('.memory-dates .memory-error');
  const storageNotice = find('[data-memory-storage]');
  const soundtrack = find('.memory-soundtrack');
  const sourceSelect = find('#memory-source');
  const sourceInput = find('[data-memory-input]');
  const trackLabel = find('[data-memory-track]');
  const result = find('[data-memory-result]');
  const dialog = find('.memory-viewer');
  periodPanel.inert = true;

  function storageError() {
    storageFailed = true;
    if (!life.signal.aborted) {
      storageNotice.textContent = t('storageError');
      storageNotice.hidden = false;
    }
  }
  function remember() {
    lastView = preferences;
    saveMemoryPreferences(preferences).then(()=>{
      if (lastView!==preferences || life.signal.aborted) return;
      storageFailed = false;
      storageNotice.hidden = true;
    },storageError);
  }
  function clearDateError() {
    dateError.hidden = true;
    first.removeAttribute('aria-invalid');
    last.removeAttribute('aria-invalid');
  }
  function paintPeriod() {
    for (const button of root.querySelectorAll('[data-memory-mode]')) {
      button.setAttribute('aria-pressed',String(button.dataset.memoryMode===mode));
    }
    rangeOutput.textContent = rangeLabel(period);
    periodNav.classList.toggle('custom',mode==='custom');
    dateForm.hidden = mode!=='custom';
    first.value = period.start;
    last.value = period.end;
    clearDateError();
    for (const button of periodNav.querySelectorAll('button')) {
      button.hidden = mode==='custom';
      button.disabled = shiftMemoryAnchor(mode,preferences.anchor,Number(button.dataset.periodStep))===preferences.anchor;
    }
  }
  function trackName(music) {
    return music.name || musicLink(music.url)?.provider || t('linkTrack');
  }
  function currentTrack() {
    const {choice,dayId,link,file} = preferences;
    if (choice==='none') return null;
    if (choice==='file') return file ? {kind:'file',...file} : null;
    if (choice==='link') return link ? {kind:'link',url:link,name:t('linkTrack')} : null;
    if (choice==='day') {
      const day = entries.find(day=>day.id===dayId);
      return day ? memoryTrackFromDay(day) : null;
    }
    return automaticMemoryTrack(entries);
  }
  function paintTrackLabel() {
    track = currentTrack();
    trackLabel.textContent = track ? trackName(track) : t(preferences.choice==='none'?'silent':'noTrack');
  }
  function applySource(choice,details={}) {
    preferences = {...preferences,choice,dayId:null,link:null,file:null,...details};
    paintTrackLabel();
    remember();
  }
  function paintTrackInput() {
    fileRequest++;
    if (selectedSource==='link') {
      sourceInput.innerHTML = '<form class="memory-track-form" novalidate><label>'+html('link')+
        '<input type="url" name="url" maxlength="4096" inputmode="url" placeholder="https://" required></label>'+
        '<button class="secondary" type="submit">'+html('saveLink')+'</button><p class="memory-error" role="alert" hidden></p></form>';
      const form = sourceInput.querySelector('form');
      const input = form.elements.namedItem('url'), notice = form.querySelector('[role="alert"]');
      input.value = preferences.link || '';
      input.oninput = ()=>{
        notice.hidden = true;
        input.removeAttribute('aria-invalid');
      };
      form.onsubmit = event=>{
        event.preventDefault();
        const link = musicLink(input.value);
        if (!link) {
          notice.textContent = t('badLink');
          notice.hidden = false;
          input.setAttribute('aria-invalid','true');
          input.focus();
          return;
        }
        input.value = link.url;
        applySource('link',{link:link.url});
      };
    } else if (selectedSource==='file') {
      sourceInput.innerHTML = '<button class="secondary" type="button">'+icon('upload',17)+html('chooseFile')+'</button>'+
        '<input type="file" accept="audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/x-wav,.mp3,.m4a,.aac,.wav" hidden>'+
        '<p role="status" class="memory-file-status" hidden></p>';
      const button = sourceInput.querySelector('button'), input = sourceInput.querySelector('input');
      const notice = sourceInput.querySelector('[role="status"]');
      button.onclick = ()=>input.click();
      input.onchange = async ()=>{
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        const request = ++fileRequest;
        notice.textContent = t('fileBusy');
        notice.hidden = false;
        notice.classList.remove('memory-error');
        button.disabled = true;
        try {
          const {name,blob} = await musicFromFile(file);
          if (request!==fileRequest) return;
          applySource('file',{file:{name:name || file.name,blob}});
          notice.hidden = true;
        } catch (error) {
          if (request!==fileRequest) return;
          notice.textContent = error.message;
          notice.classList.add('memory-error');
        } finally {
          if (request===fileRequest) button.disabled = false;
        }
      };
    } else sourceInput.replaceChildren();
  }
  function paintSoundtrack() {
    soundtrack.hidden = !entries.length;
    if (!entries.length) {
      sourceInput.replaceChildren();
      fileRequest++;
      return;
    }
    const options = entries.flatMap(day=>{
      const music = memoryTrackFromDay(day);
      return music ? ['<option value="day:'+esc(day.id)+'">'+esc(trackName(music)+' · '+formatDate(day.date))+'</option>'] : [];
    });
    if (preferences.choice==='day' && !currentTrack()) preferences = {...preferences,choice:'auto',dayId:null};
    const option = (value,key)=>'<option value="'+value+'">'+html(key)+'</option>';
    sourceSelect.innerHTML = option('auto','automatic')+
      (options.length?'<optgroup label="'+html('savedTracks')+'">'+options.join('')+'</optgroup>':'')+
      option('link','addLink')+option('file','addFile')+option('none','silent');
    selectedSource = preferences.choice==='day' ? 'day:'+preferences.dayId : preferences.choice;
    sourceSelect.value = selectedSource;
    paintTrackInput();
    paintTrackLabel();
  }
  sourceSelect.onchange = ()=>{
    selectedSource = sourceSelect.value;
    if (selectedSource.startsWith('day:')) applySource('day',{dayId:selectedSource.slice(4)});
    else if (selectedSource==='auto' || selectedSource==='none') applySource(selectedSource);
    paintTrackInput();
    sourceInput.querySelector('input:not([hidden]),button')?.focus();
  };

  function releaseThumbnails() {
    for (const url of thumbs.values()) URL.revokeObjectURL(url);
    thumbs.clear();
  }
  function dayCard(day,index) {
    const ready = day.status==='ready';
    const title = ready ? presentRecipe(day).title : day.moments[0].text;
    const cover = day.photos?.[0];
    const isVideo = isGalleryVideo(cover);
    if (cover?.blob instanceof Blob && !isVideo && !thumbs.has(day.id)) thumbs.set(day.id,URL.createObjectURL(cover.blob));
    const url = thumbs.get(day.id) || cover?.src;
    const thumb = isVideo || url ? galleryThumbnail(url,isVideo,cover?.poster) : '<span class="memory-no-photo">'+icon('document',27)+'</span>';
    return '<li><button class="memory-day" type="button" data-memory-day="'+index+'" aria-haspopup="dialog">'+
      '<span class="memory-day-cover">'+thumb+'</span><span class="memory-day-copy"><time datetime="'+esc(day.date)+'">'+esc(formatDate(day.date))+
      '</time><strong>'+esc(title)+'</strong></span></button></li>';
  }
  function paintMore() {
    const list = find('.memory-days');
    const index = list.children.length;
    const end = Math.min(entries.length,index+pageSize);
    list.insertAdjacentHTML('beforeend',entries.slice(index,end).map((day,offset)=>dayCard(day,index+offset)).join(''));
    find('[data-memory-more]').hidden = end>=entries.length;
    return list.children[index]?.querySelector('button');
  }
  function paintResult() {
    releaseThumbnails();
    if (!entries.length) {
      result.innerHTML = '<section class="panel empty-state"><div class="empty-icon">'+icon(latest?'calendar':'book',28)+'</div>'+
        '<h2>'+html(latest?'noEntries':'emptyJournal')+'</h2><button class="primary" type="button" data-memory-empty>'+
        html(latest?'latest':'addEntry')+'</button></section>';
      return;
    }
    result.innerHTML = '<button class="primary memory-watch" type="button" data-memory-watch aria-haspopup="dialog">'+icon('play',19)+html('watch')+'</button>'+
      '<ol class="memory-days"></ol><button class="secondary" type="button" data-memory-more>'+html('more')+'</button>';
    paintMore();
  }
  function setPeriod(nextMode,anchor,nextPeriod) {
    const changed = nextPeriod.start!==period.start || nextPeriod.end!==period.end;
    mode = nextMode;
    period = nextPeriod;
    preferences = {...preferences,mode,anchor,...period};
    if (changed) preferences = {...preferences,choice:'auto',dayId:null,link:null,file:null};
    entries = memoryEntries(records,period);
    paintPeriod();
    paintSoundtrack();
    paintResult();
    remember();
  }
  periodPanel.onclick = event=>{
    const button = event.target.closest('button');
    if (!button) return;
    const nextMode = button.dataset.memoryMode;
    if (nextMode===mode) return;
    if (nextMode==='custom') {
      mode = nextMode;
      paintPeriod();
      first.focus();
    } else if (nextMode) {
      const anchor = preferences.anchor;
      setPeriod(nextMode,anchor,memoryPeriod(nextMode,anchor));
    } else if (button.dataset.periodStep) {
      const anchor = shiftMemoryAnchor(mode,preferences.anchor,Number(button.dataset.periodStep));
      setPeriod(mode,anchor,memoryPeriod(mode,anchor));
    }
  };
  dateForm.oninput = clearDateError;
  dateForm.onsubmit = event=>{
    event.preventDefault();
    if (!validRange(first.value,last.value)) {
      dateError.textContent = t('invalidDates');
      dateError.hidden = false;
      const input = !isMemoryDate(first.value) ? first : last;
      input.setAttribute('aria-invalid','true');
      input.focus();
      return;
    }
    setPeriod('custom',last.value,{start:first.value,end:last.value});
  };

  const viewerKey = ()=>period.start+'/'+period.end;
  function removeViewer(restoreFocus = true) {
    if (!viewer) return;
    viewer();
    viewer = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus({preventScroll:true});
  }
  function closeViewer() {
    if (history.state?.memoryViewer===viewerKey()) {
      closePending = true;
      history.back();
    }
    removeViewer();
  }
  function showViewer(index,button) {
    if (!entries.length || viewer || closePending) return;
    trigger = button || find('[data-memory-watch]');
    viewer = openMemoryViewer(dialog,{entries,periodLabel:rangeLabel(period),track,index},{
      close:closeViewer,
      openDay:day=>day.status==='ready' ? ctx.viewDay(day) : ctx.edit(day)
    });
    if (button) history.pushState({...history.state,memoryViewer:viewerKey(),memoryIndex:index},'',location.href);
  }
  window.addEventListener('popstate',()=>{
    closePending = false;
    if (!period) return;
    if (history.state?.memoryViewer===viewerKey()) showViewer(history.state.memoryIndex);
    else removeViewer();
  },opts);
  result.onclick = event=>{
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-memory-empty')) {
      if (latest) {
        setPeriod('week',latest,memoryPeriod('week',latest));
        find('[data-memory-watch]')?.focus();
      } else ctx.edit();
    } else if (button.hasAttribute('data-memory-more')) paintMore()?.focus({preventScroll:true});
    else if (button.hasAttribute('data-memory-watch')) showViewer(0,button);
    else if (button.hasAttribute('data-memory-day')) showViewer(Number(button.dataset.memoryDay),button);
  };

  async function initialize() {
    let saved = viewState?.preferences || lastView;
    if (!saved) {
      try {saved = await loadMemoryPreferences();}
      catch {storageError();}
    }
    if (life.signal.aborted) return;
    const anchor = isMemoryDate(saved?.anchor) ? saved.anchor : defaultAnchor;
    mode = modes.includes(saved?.mode) ? saved.mode : 'week';
    if (mode==='custom' && !validRange(saved.start,saved.end)) mode = 'week';
    period = mode==='custom' ? {start:saved.start,end:saved.end} : memoryPeriod(mode,anchor);
    const choice = ['auto','day','link','file','none'].includes(saved?.choice) ? saved.choice : 'auto';
    preferences = {anchor,mode,...period,choice,dayId:saved?.dayId,link:saved?.link,file:saved?.file};
    entries = memoryEntries(records,period);
    paintPeriod();
    paintSoundtrack();
    paintResult();
    periodPanel.inert = false;
    if (viewState?.index!=null && history.state?.memoryViewer===viewerKey()) showViewer(viewState.index);
  }
  void initialize();
  const cleanup = ()=>{
    life.abort();
    fileRequest++;
    removeViewer(false);
    releaseThumbnails();
  };
  cleanup.getViewState = ()=>({preferences,index:viewer?.getIndex?.(),storageFailed});
  if (viewState?.storageFailed) storageError();
  return cleanup;
}
