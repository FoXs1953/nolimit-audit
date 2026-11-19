import {icon,esc,sheet,showPanel,hidePanel,syncPanel,closeSheet,localDate,formatDate,toast} from './ui.js';
import {getDay,listDays,makePrimary,removeDay,saveDay} from './store.js';
import {mountEditor} from './editor.js';
import {mountPlayer} from './player.js';
import {demos} from './demos.js';
import {mountHome} from './home.js';
import {mountLibrary} from './library.js';
import {downloadDays,mountSettings} from './settings.js';

const screens = {
  today:['Мой дневник','Сегодня','book','Истории, фотографии и музыка твоих дней.'],
  archive:['Мой архив','Архив','archive','Открытки и незаконченные записи на этом устройстве.'],
  examples:['Примеры дней','Примеры','layers','Пять историй с разным светом, движением и музыкой.'],
  settings:['Настройки','Настройки','settings','Отображение и хранение дневника.']
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
const ctx = {icon,esc,sheet,closeSheet,toast,go,viewDay,edit,copyDemo,quickMoment,dayActions,about,setMotion,get reducedMotion(){return reduced();}};
function downloadError(error){toast(error?.message || 'Не удалось выполнить действие. Попробуй ещё раз.');}
function about(){
  sheet('О дневнике','<p><strong>NoLimit · Дневник</strong> превращает слова, свет фотографии и характер музыки в открытку. Нажми «Записать день», добавь три материала и сохрани результат в своём архиве.</p>'+
    '<p>Личные записи остаются в этом браузере. В «Настройках» можно скачать копию. Примеры используют вымышленные записи, разрешённые фотографии и оригинальную музыку.</p>'+
    '<div class="grid-list"><button data-examples>'+icon('layers')+'Открыть примеры дней</button></div>'+
    '<p><a href="https://github.com/FoXs1953/nolimit-audit" target="_blank" rel="noopener noreferrer">Исходный код и инструкция</a></p>',body=>{
      body.querySelector('[data-examples]').onclick=()=>go('examples');
    });
}
function fresh(){
  return {id:crypto.randomUUID(),date:localDate(),status:'draft',text:'',title:'',caption:'',photos:[],music:null,moments:[]};
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
function viewDay(day){return go('day/'+encodeURIComponent(day.id));}
async function copyDemo(day){
  const copy=structuredClone(day);
  delete copy.demo;delete copy.revision;delete copy.primary;
  copy.id=crypto.randomUUID();copy.status='draft';
  try {const saved=await saveDay(copy);await edit(saved);toast('Открыта твоя копия примера.');}catch(error){downloadError(error);}
}
function quickMoment(){
  sheet('Поймать момент','<form class="sheet-form"><label>Что запомнилось?<textarea class="day-field" rows="3" maxlength="1200" required placeholder="Свет в окне, слова друга, песня по дороге…"></textarea></label>'+
    '<p class="sheet-help">Заметка появится в записи за '+esc(formatDate(localDate()))+'.</p>'+
    '<p role="alert" class="sheet-error" hidden></p><button class="primary" type="submit">Добавить в день</button></form>',body=>{
      const form=body.querySelector('form'),field=form.querySelector('textarea'),btn=form.querySelector('button');
      field.focus({preventScroll:true});
      form.onsubmit=async event=>{
        event.preventDefault();
        const text=field.value.trim();
        if(!text){field.setCustomValidity('Добавь хотя бы одно слово.');field.reportValidity();field.oninput=()=>field.setCustomValidity('');return;}
        btn.disabled=true;
        try{
          const record=await primaryToday() || fresh();
          if (record.status==='ready' && !record.pendingEdit) {
            record.pendingEdit = {...record,status:'draft'};
            delete record.pendingEdit.revision;
          }
          const target=record.pendingEdit || record;
          const moment={id:crypto.randomUUID(),text,time:new Date().toISOString()};
          target.moments=[...(target.moments||[]),moment];
          if(!target.text?.trim())target.text=text;
          const saved=await saveDay(record);
          drafts.set(saved.id,saved);
          await go('today',{refresh:true});
          toast('Момент добавлен в сегодняшний день.');
        }catch(error){btn.disabled=false;const msg=form.querySelector('[role=alert]');msg.hidden=false;msg.textContent=error.message;}
      };
    });
}
function dayActions(day) {
  const row=(key,name,symbol,cls='')=>'<button class="'+cls+'" data-act="'+key+'">'+icon(symbol)+name+'</button>';
  sheet('Папка дня','<p>'+esc(day.title || formatDate(day.date))+'</p><div class="grid-list">'+
    row('edit','Изменить день','pen')+row('export','Экспортировать день','download')+
    (day.primary===false?row('primary','Сделать основной','check'):'')+row('delete','Удалить день','trash','danger')+'</div>',body=>{
      body.querySelector('[data-act="edit"]').onclick=()=>edit(day);
      body.querySelector('[data-act="export"]').onclick=async event=>{
        const btn=event.currentTarget;btn.disabled=true;
        try{await downloadDays([await getDay(day.id) || day],'NoLimit-'+day.date+'.zip');toast('Копия дня готова к скачиванию.');}
        catch(e){downloadError(e);}finally{btn.disabled=false;}
      };
      const promote=body.querySelector('[data-act="primary"]');
      if(promote)promote.onclick=async()=>{try{await makePrimary(day.id);await go('archive');toast('Выбрана основная версия дня.');}catch(e){downloadError(e);}};
      body.querySelector('[data-act="delete"]').onclick=()=>confirmDelete(day);
    });
}
function confirmDelete(day){
  sheet('Удалить день?','<p>Удалить запись «'+esc(day.title||'Запись дня')+'» за '+esc(formatDate(day.date))+' с этого устройства?</p>'+
    '<div class="sheet-actions"><button class="secondary" data-no>Отмена</button><button class="primary delete-action" data-yes>Удалить день</button></div>',body=>{
      body.querySelector('[data-no]').onclick=closeSheet;
      body.querySelector('[data-yes]').onclick=async event=>{
        const btn=event.currentTarget;btn.disabled=true;
        try {
          const removed=await removeDay(day.id);
          drafts.delete(day.id);
          await go('archive',{refresh:true});
          toast('День удалён.',removed?{label:'Вернуть',run:async()=>{
            await saveDay(removed);await go('archive',{refresh:true});toast('День восстановлен.');
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
  document.title=title+' · NoLimit Дневник';find('page-title').textContent=title;
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
  const method=history.state?.panel || key===route?'replaceState':'pushState';
  hidePanel(true);history[method]({},'','#'+key);
  await render(key,true);
}
async function render(key,focus) {
  const ticket=++generation;
  if(cleanup){cleanup();cleanup=null;}
  route=key;
  const [section,encoded]=key.split('/');
  const root=document.createElement('div');root.className='view-enter';find('view').replaceChildren(root);
  nav(section==='edit'?'today':section==='day'?(encoded?.startsWith('demo-')?'examples':'archive'):section);
  if(screens[section])heading(screens[section][0],screens[section][3]);
  else heading(section==='edit'?'Записать день':'Открытка дня','');
  if(focus){window.scrollTo({top:0,behavior:'instant'});find('main').focus({preventScroll:true});}
  try {
    if(section==='day'||section==='edit'){
      const id=decodeURIComponent(encoded);
      const sample=demos.find(day=>day.id===id);
      const day=sample || await getDay(id) || drafts.get(id);
      if(ticket!==generation)return;
      if(!day){heading('Запись не найдена','Эта запись могла остаться в другом браузере или быть удалена.');root.innerHTML='<button class="primary">Открыть архив</button>';root.querySelector('button').onclick=()=>go('archive');return;}
      if(section==='edit'){
        heading(day.status==='ready'?'Изменить день':'Записать день','Текст, фото и музыка в одной открытке.');
        cleanup=mountEditor(root,day,ctx);
      }else{
        heading('Открытка дня',formatDate(day.date,{day:'numeric',month:'long',year:'numeric'}));
        cleanup=mountPlayer(root,day,ctx);
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
    root.innerHTML='<section class="panel empty-state"><h2>Не удалось открыть раздел</h2><p></p><button class="secondary">Повторить</button></section>';
    root.querySelector('p').textContent=error.message || 'Обнови страницу и попробуй ещё раз.';
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
for(const item of ['nav','dock']){
  find(item).innerHTML=Object.entries(screens).map(([key,[title,label,symbol]])=>
    '<button type="button" class="'+(item==='nav'?'nav-item':'')+'" data-route="'+key+'">'+icon(symbol,21)+'<span>'+esc(item==='nav'?title:label)+'</span></button>').join('');
  find(item).onclick=e=>{const button=e.target.closest('[data-route]');if(button)go(button.dataset.route);};
}
find('skip').onclick=e=>{e.preventDefault();find('main').focus();};
find('ctx-date').textContent=formatDate(localDate(),{month:'long',year:'numeric'});
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
