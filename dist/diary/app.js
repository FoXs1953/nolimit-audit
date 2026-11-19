import {icon,esc,sheet,hidePanel,syncPanel,closeSheet,localDate,formatDate,toast,refreshNotice,forgetPanels} from './ui.js';
import {appendDayMoment,getDay,listDays,makePrimary,removeDay,removeDayNote,restoreDayNote,saveDay} from './store.js';
import {mountEditor} from './editor.js';
import {mountPlayer} from './player.js';
import {demos,refreshDemos} from './demos.js';
import {mountHome} from './home.js';
import {mountLibrary} from './library.js';
import {downloadDays,mountSettings} from './settings.js';

import {getLanguage,setLanguage} from './i18n.js';
import {t} from './locales/shell.js';

const screens = {
  today:['today','todayShort','book','todayIntro'],
  archive:['archive','archiveShort','calendar','archiveIntro'],
  examples:['examples','examplesShort','layers','examplesIntro'],
  settings:['settings','settings','settings','settingsIntro']
};
const find = id => document.getElementById(id);
const drafts = new Map();
let route = '';
let cleanup;
let generation = 0;
let requestNumber = 0;
let motionChoice;
try { motionChoice = localStorage.getItem('nolimit:motion'); } catch {}
const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
function reduced(){return motionChoice === 'yes' || motionChoice !== 'no' && systemMotion.matches;}
function applyMotion(){document.documentElement.classList.toggle('reduce-motion',reduced());}
function setMotion(value){
  motionChoice = value ? 'yes' : 'no';applyMotion();
  try {localStorage.setItem('nolimit:motion',motionChoice);} catch {}
}
applyMotion();
systemMotion.addEventListener?.('change',applyMotion);
const ctx = {icon,esc,sheet,closeSheet,toast,go,viewDay,edit,followDraft,copyDemo,quickMoment,dayActions,deleteNote,deleteDayFromHome:day=>confirmDelete(day,'today'),about,setMotion,get reducedMotion(){return reduced();}};
function downloadError(error){toast(error?.message || t('actionError'));}
function about(){
  sheet(t('about'),'<p><strong>NoLimit · '+t('journal')+'</strong></p><p>'+t('aboutIntro')+'</p><p>'+t('privacy')+'</p>'+
    '<div class="grid-list"><button data-examples>'+icon('layers')+t('seeExamples')+'</button></div>'+
    '<p><a href="https://github.com/FoXs1953/nolimit-audit" target="_blank" rel="noopener noreferrer">'+t('source')+'</a></p>',body=>{
      body.querySelector('[data-examples]').onclick=()=>go('examples');
    });
}
function fresh(){
  return {id:crypto.randomUUID(),date:localDate(),contentLanguage:getLanguage(),status:'draft',text:'',title:'',caption:'',photos:[],music:null,moments:[]};
}
async function primaryToday(){
  const records = await listDays();
  return records.find(day=>day.date===localDate() && day.primary!==false);
}
async function edit(day){
  try {
    let entry=day || await primaryToday() || fresh();
    if(demos.some(d=>d.id===entry.id))return copyDemo(entry);
    drafts.set(entry.id,entry);
    return go('edit/'+encodeURIComponent(entry.id));
  } catch(error){downloadError(error);}
}
function followDraft(previousId,newId){
  if(route!=='edit/'+encodeURIComponent(previousId))return;
  route='edit/'+encodeURIComponent(newId);
  history.replaceState(history.state,'','#'+route);
}
function viewDay(day){return go('day/'+encodeURIComponent(day.id));}
async function copyDemo(day){
  const copy=structuredClone(day);
  delete copy.demo;delete copy.revision;delete copy.primary;
  copy.id=crypto.randomUUID();copy.status='draft';
  try {const saved=await saveDay(copy);await edit(saved);toast(t('copyReady'));}catch(error){downloadError(error);}
}
function quickMoment(){
  const blank=fresh();
  sheet(t('quick'),'<form class="sheet-form" novalidate><label>'+t('prompt')+'<textarea class="day-field" rows="3" maxlength="1200" required placeholder="'+esc(t('hint'))+'"></textarea></label>'+
    '<p class="sheet-help">'+esc(t('noteDate',{date:formatDate(blank.date)}))+'</p>'+
    '<p role="alert" class="sheet-error" hidden></p><button class="primary" type="submit">'+t('addMoment')+'</button></form>',body=>{
      const form=body.querySelector('form'),field=form.querySelector('textarea'),btn=form.querySelector('button');
      field.focus({preventScroll:true});
      let pendingNote;
      form.onsubmit=async event=>{
        event.preventDefault();
        if(btn.disabled)return;
        const text=field.value.trim();
        if(!text){field.setCustomValidity(t('word'));field.reportValidity();field.oninput=()=>field.setCustomValidity('');return;}
        btn.disabled=true;
        try{
          if (pendingNote?.text!==text) pendingNote={id:crypto.randomUUID(),text,time:new Date().toISOString()};
          const saved=await appendDayMoment(blank,pendingNote);
          drafts.set(saved.id,saved);
          await go('today',{refresh:true});
          toast(t('momentAdded'));
        }catch(error){btn.disabled=false;const msg=form.querySelector('[role=alert]');msg.hidden=false;msg.textContent=error.message;}
      };
    });
}
function dayActions(day) {
  const row=(key,name,symbol,cls='')=>'<button class="'+cls+'" data-act="'+key+'">'+icon(symbol)+name+'</button>';
  sheet(t('folder'),'<p>'+esc(day.title || formatDate(day.date))+'</p><div class="grid-list">'+
    row('edit',t('edit'),'pen')+row('export',t('export'),'download')+
    (day.primary===false?row('primary',t('primary'),'check'):'')+row('delete',t('delete'),'trash','danger')+'</div>',body=>{
      body.querySelector('[data-act="edit"]').onclick=()=>edit(day);
      body.querySelector('[data-act="export"]').onclick=async event=>{
        const btn=event.currentTarget;btn.disabled=true;
        try{await downloadDays([await getDay(day.id) || day],'NoLimit-'+day.date+'.zip');toast(t('downloaded'));}
        catch(e){downloadError(e);}finally{btn.disabled=false;}
      };
      const promote=body.querySelector('[data-act="primary"]');
      if(promote)promote.onclick=async()=>{try{await makePrimary(day.id);await go('archive');toast(t('promoted'));}catch(e){downloadError(e);}};
      body.querySelector('[data-act="delete"]').onclick=()=>confirmDelete(day);
    });
}
async function refreshAfterRemoval(dayId) {
  drafts.delete(dayId);
  if(route!=='today') {
    if(route==='archive' || route==='day/'+encodeURIComponent(dayId)) {
      const currentRoute=route,scrollY=window.scrollY;
      await render(currentRoute,false,cleanup?.getViewState?.());
      if(route===currentRoute)window.scrollTo({top:scrollY,behavior:'instant'});
    }
    return;
  }
  const before=document.querySelector('.home-personal');
  const top=before?.getBoundingClientRect().top;
  const expanded=new Set(Array.from(before?.querySelectorAll('details[open][data-notes-day]') || [],item=>item.dataset.notesDay));
  await go('today',{refresh:true,focus:false});
  const after=document.querySelector('.home-personal');
  if(!after)return;
  for(const group of after.querySelectorAll('details[data-notes-day]')) group.open=expanded.has(group.dataset.notesDay);
  if(top!==undefined)window.scrollBy({top:after.getBoundingClientRect().top-top,behavior:'instant'});
  after.querySelector('[data-action="moment"]')?.focus({preventScroll:true});
}
async function deleteNote(day,note) {
  try {
    const removed=await removeDayNote(day.id,note);
    await refreshAfterRemoval(day.id);
    if(!removed)return;
    toast(()=>t('noteRemoved'),{label:()=>t('undo'),run:async()=>{
      const restored=await restoreDayNote(day.id,removed);
      await refreshAfterRemoval(day.id);
      toast(()=>t(restored?'noteRestored':'noteDayMissing'));
    }});
  }catch(error){downloadError(error);}
}
function confirmDelete(day,returnTo='archive'){
  const refresh=()=>returnTo==='today' ? refreshAfterRemoval(day.id) : go('archive',{refresh:true});
  sheet(t('deleteTitle'),'<p>'+esc(t('confirmDelete',{title:day.title || day.titleOverride || day.text || t('entry'),date:formatDate(day.date,{day:'numeric',month:'long',year:'numeric'})}))+'</p>'+
    '<div class="sheet-actions"><button class="secondary" data-no>'+t('cancel')+'</button><button class="primary delete-action" data-yes>'+t('delete')+'</button></div>',body=>{
      body.querySelector('[data-no]').onclick=closeSheet;
      body.querySelector('[data-yes]').onclick=async event=>{
        const btn=event.currentTarget;btn.disabled=true;
        try {
          const removed=await removeDay(day.id);
          drafts.delete(day.id);
          await refresh();
          toast(()=>t('removed'),removed?{label:()=>t('undo'),run:async()=>{
            await saveDay(removed);await refresh();toast(t('restored'));
          }}:undefined);
        } catch(e){btn.disabled=false;downloadError(e);}
      };
    });
}
function parse(raw){
  const hash=String(raw || '').replace(/^#/,'');
  if(Object.hasOwn(screens,hash))return hash;
  if(/^(edit|day)\/[\w.:%-]+$/.test(hash))return hash;
  return 'today';
}
function nav(active){
  for(const b of document.querySelectorAll('[data-route]')){
    const on=b.dataset.route===active;b.classList.toggle('on',on);
    if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  }
}
function heading(title,subtitle){
  document.title=title+' · NoLimit '+t('journal');find('page-title').textContent=title;
  find('page-sub').textContent=subtitle;find('page-sub').hidden=!subtitle;
}
let leaving;
async function flushEditor(){
  if(!cleanup?.flush)return true;
  if(!leaving)leaving=Promise.resolve().then(()=>cleanup?.flush?.()).then(()=>true).catch(e=>{downloadError(e);return false;}).finally(()=>{leaving=null;});
  return leaving;
}
async function go(target,options={}){
  const key=parse(target);
  const requested=++requestNumber;
  if(!(await flushEditor()) || requested!==requestNumber)return;
  if(key===route && !options.refresh){
    if(find('sheet').open)closeSheet();
    return;
  }
  const method=history.state?.panel || history.state?.cardViewer || key===route?'replaceState':'pushState';
  hidePanel(true);history[method]({},'','#'+key);
  await render(key,options.focus!==false);
}
async function render(key,focus,viewState) {
  const ticket=++generation;
  if(cleanup){cleanup();cleanup=null;}
  route=key;
  const [section,encoded]=key.split('/');
  const root=document.createElement('div');root.className='view-enter';find('view').replaceChildren(root);
  nav(section==='edit'?'today':section==='day'?(encoded?.startsWith('demo-')?'examples':'archive'):section);
  if(screens[section])heading(t(screens[section][0]),t(screens[section][3]));
  else heading(section==='edit'?t('write'):t('postcard'),'');
  if(focus){window.scrollTo({top:0,behavior:'instant'});find('main').focus({preventScroll:true});}
  try {
    if(section==='day'||section==='edit'){
      const id=decodeURIComponent(encoded);
      const sample=demos.find(day=>day.id===id);
      const day=sample || await getDay(id) || drafts.get(id);
      if(ticket!==generation)return;
      if(!day){heading(t('missing'),t('missingHelp'));root.innerHTML='<button class="primary">'+t('openArchive')+'</button>';root.querySelector('button').onclick=()=>go('archive');return;}
      if(section==='edit'){
        heading(day.status==='ready'?t('edit'):t('write'),t('editorIntro'));
        cleanup=mountEditor(root,day,ctx,viewState);
      }else{
        heading(t('postcard'),formatDate(day.date,{day:'numeric',month:'long',year:'numeric'}));
        cleanup=mountPlayer(root,day,ctx,viewState);
      }
    }else if(section==='examples'){
      cleanup=mountLibrary(root,[],true,ctx);
    }else{
      let days;
      try {days=await listDays();}catch(error){if(section!=='today')throw error;days=[];toast(error.message);}
      if(ticket!==generation)return;
      if(section==='today')cleanup=mountHome(root,days,ctx);
      if(section==='archive')cleanup=mountLibrary(root,days,false,ctx);
      if(section==='settings')cleanup=mountSettings(root,days,ctx);
    }
  }catch(error){
    if(ticket!==generation)return;
    root.innerHTML='<section class="panel empty-state"><h2>'+t('loadError')+'</h2><p></p><button class="secondary">'+t('retry')+'</button></section>';
    root.querySelector('p').textContent=error.message || t('refresh');
    root.querySelector('button').onclick=()=>render(key,false);
  }
}
function restoreLocation(){
  const key=parse(location.hash);
  if(key===route){syncPanel();return;}
  const ticket=++requestNumber;
  flushEditor().then(ok=>{
    if(ticket!==requestNumber)return;
    if(!ok){history.pushState({},'','#'+route);return;}
    hidePanel(true);render(key,true);
  });
}
function localizeShell(){
  document.documentElement.lang=getLanguage();
  document.querySelector('meta[name="description"]').content=t('description');
  find('skip').textContent=t('skip');
  document.querySelector('.rail').setAttribute('aria-label',t('sidebar'));
  document.querySelector('.wordmark-sub').textContent=t('journal');
  document.querySelector('.phone-brand strong span').textContent=t('journal');
  document.querySelector('.rail-label').textContent=t('today');
  find('context-name').textContent=t('personal');
  find('ctx-date').textContent=formatDate(localDate(),{month:'long',year:'numeric'});
  find('about-label').textContent=t('about');
  find('about').setAttribute('aria-label',t('about'));
  find('sheet-close').setAttribute('aria-label',t('close'));
  find('language-switch').setAttribute('aria-label',t('language'));
  for(const button of find('language-switch').querySelectorAll('[data-language]')){
    button.setAttribute('aria-pressed',String(button.dataset.language===getLanguage()));
  }
  for(const item of ['nav','dock']){
    find(item).setAttribute('aria-label',t(item==='nav'?'sections':'navigation'));
    find(item).innerHTML=Object.entries(screens).map(([key,[title,label,symbol]])=>
      '<button type="button" class="'+(item==='nav'?'nav-item':'')+'" data-route="'+key+'">'+icon(symbol,21)+'<span>'+esc(t(item==='nav'?title:label))+'</span></button>').join('');
  }
}
for(const item of ['nav','dock']){
  find(item).onclick=e=>{const button=e.target.closest('[data-route]');if(button)go(button.dataset.route);};
}
find('language-switch').onclick=async event=>{
  const next=event.target.closest('[data-language]')?.dataset.language;
  if(!next)return;
  const ticket=++requestNumber;
  if(next===getLanguage() || !(await flushEditor()) || ticket!==requestNumber)return;
  const viewState=cleanup?.getViewState?.();
  setLanguage(next);
  refreshDemos();
  localizeShell();
  refreshNotice();
  forgetPanels();
  await render(route,false,viewState);
};
find('skip').onclick=e=>{e.preventDefault();find('main').focus();};
localizeShell();
document.querySelector('.boot-status').textContent=t('loading');
document.querySelector('.ctx-icon').innerHTML=icon('book',17);
document.querySelector('.about-icon').innerHTML=icon('info',17);
find('sheet-close').innerHTML=icon('close',18);
find('about').onclick=about;
window.addEventListener('popstate',restoreLocation);
window.addEventListener('hashchange',()=>{ if(parse(location.hash)!==route)restoreLocation(); });
const initial=parse(location.hash);
history.replaceState({},'','#'+initial);
render(initial,false);
if ('serviceWorker' in navigator) window.addEventListener('load', () => {
  navigator.serviceWorker.register('./diary-sw.js',{updateViaCache:'none'}).catch(()=>{});
});
