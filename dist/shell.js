(() => {
  'use strict';
  const symbols = {
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
  function icon(name,size=20) {
    return '<svg aria-hidden="true" focusable="false" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+(symbols[name] || symbols.document)+'</svg>';
  }
  const screens = {
    audit:['Ход аудита','Что агент проверил на каждом шаге.','audit','Аудит'],
    balance:['Акт сверки','Поступления и распределение по счёту INV-017.','compare','Сверка'],
    dossier:['Досье','Первичные документы и проводки компании «Маяк».','folder','Досье'],
    period:['Граница месяца','Платёж на стыке двух отчётных периодов.','calendar'],
    pair:['Парный прогон','Один открытый эпизод в двух представлениях.','layers'],
    reward:['Цена ошибки','Как повторный вывод меняет награду.','gauge'],
    lab:['Прогоны среды','Открытые эпизоды, действия политик и результаты проверки.','calculator']
  };
  const release=window.AuditRelease;
  const number = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
  function money(minor){return number.format(minor/100);}
  const sources=Object.fromEntries(Object.entries(release.demo.sources).map(([id,raw])=>{
    const isInvoice='total_minor' in raw, isLedger='row_id' in raw;
    const stamp=raw.issued_at||raw.timestamp;
    const fields=isInvoice?[['Компания',release.demo.manifest.company],['Валюта',raw.currency]]:isLedger?[['Платёж',raw.payment_id],['Отнесено на счёт',raw.invoice_id]]:[['Назначение',raw.invoice_refs.join(', ')]];
    return [id,{kind:isInvoice?'Счёт':isLedger?'Проводка распределения':'Платёж',amount:money(raw.total_minor??raw.amount_minor??raw.credit_minor),date:new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:release.demo.manifest.timezone}).format(new Date(stamp)),fields,raw}];
  }));
  const A = window.A = {views:{},icon,go,doc, sheet,money,release, closeSheet:requestClose};
  let current = '', cleanup, sheetTrigger, timer;
  const $ = id => document.getElementById(id);
  const dialog = $('sheet');
  function doc(id) {
    const d=sources[id]; if(!d) return;
    const rows=[['Дата',d.date],...d.fields].map(([label,value]) => {
      // A source link is only presented if the viewer has access at this step.
      const allowed=Object.hasOwn(sources,value) && (current!=='audit' || typeof A.auditCanRead!=='function'||A.auditCanRead(value));
      return '<div'+(allowed?' class="linkrow"':'')+'><dt>'+label+'</dt><dd>'+(allowed?'<button type="button" data-source="'+value+'">'+value+'</button>':value)+'</dd></div>';
    }).join('');
    const canCompare = ['PAY-042','L-102'].includes(id) && (current!=='audit' || (A.auditCanRead('L-102') && A.auditCanRead('PAY-042')));
    const compare = canCompare ? '<button type="button" class="secondary compare-source" data-compare-sources>'+icon('compare',18)+'Сопоставить с '+(id==='PAY-042'?'проводкой':'платежом')+'</button>' : '';
    sheet(d.kind,'<div class="source-id">'+id+'</div><div class="source-sum">'+d.amount+' ₸</div><dl class="source-fields">'+rows+'</dl>'+compare);
  }
  function sheet(title,html) {
    if (!dialog.open) sheetTrigger=document.activeElement;
    window.dispatchEvent(new Event('nolimit:sheetopen'));
    const entry={route:current,panel:{title,html}};
    if(dialog.open)history.replaceState(entry,'',location.href);else history.pushState(entry,'',location.href);
    showPanel(entry.panel);
  }
  function showPanel(panel) {
    clearTimeout(timer);delete dialog.dataset.dismissing;dialog.classList.remove('closing');
    $('sheet-title').textContent=panel.title;$('sheet-body').innerHTML=panel.html;
    if (!dialog.open) {dialog.showModal();document.body.style.overflow='hidden';}
    dialog.querySelector('.sheet-box').scrollTop=0;$('sheet-close').focus({preventScroll:true});
  }
  function hidePanel(immediate=false,restoreFocus=true) {
    if(!dialog.open) return;
    clearTimeout(timer);
    const done=()=>{delete dialog.dataset.dismissing;dialog.close();dialog.classList.remove('closing');document.body.style.overflow='';if(restoreFocus&&sheetTrigger?.isConnected)sheetTrigger.focus({preventScroll:true});sheetTrigger=null;};
    if(immediate||matchMedia('(prefers-reduced-motion: reduce)').matches){done();return;}
    dialog.classList.add('closing');timer=setTimeout(done,150);
  }
  function requestClose(){if(!dialog.open||dialog.dataset.dismissing==='1'||dialog.classList.contains('closing'))return;dialog.dataset.dismissing='1';if(history.state?.panel)history.back();else hidePanel();}
  function getRoute(){const slug=location.hash.slice(1);return Object.hasOwn(screens,slug)?slug:'audit';}
  function go(key){
    if(!Object.hasOwn(screens,key))return;
    if(key===current){if(dialog.open)requestClose();return;}
    const state={route:key};if(dialog.open){hidePanel(true,false);history.replaceState(state,'','#'+key);}else history.pushState(state,'','#'+key);
    render(key,true);
  }
  function menu(){
    sheet('Экраны демо','<div class="grid-list">'+Object.entries(screens).map(([key,s])=>'<button type="button" class="'+(current===key?'on':'')+'" data-screen="'+key+'">'+icon(s[2],22)+s[0]+(current===key?icon('check',18):'')+'</button>').join('')+'</div>');
  }
  function navigation(){
    for(const button of $('nav').querySelectorAll('button')){
      if(button.dataset.screen===current)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    }
    for(const button of $('dock').querySelectorAll('button')){
      const selected=button.dataset.screen===current||button.id==='more'&&!['audit','balance','dossier'].includes(current);
      button.classList.toggle('on',selected);
      if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    }
  }
  function render(key,resetScroll){
    if(cleanup)cleanup();cleanup=null;current=key;
    const [title,subtitle]=screens[key];document.title=title+' · NoLimit Audit';$('page-title').textContent=title;$('page-sub').textContent=subtitle;
    const node=document.createElement('div');node.className='view-enter';$('view').replaceChildren(node);
    cleanup=A.views[key](node);navigation();
    if(resetScroll){window.scrollTo({top:0,behavior:'instant'});$('main').focus({preventScroll:true});}
  }
  function bindSheetGesture() {
    const box=dialog.querySelector('.sheet-box');
    let startY=null;
    box.addEventListener('pointerdown',event=>{
      if(!matchMedia('(max-width:760px)').matches||event.target.closest('button')||!event.target.closest('.grab,.sheet-head'))return;
      startY=event.clientY;box.setPointerCapture(event.pointerId);
    });
    box.addEventListener('pointermove',event=>{
      if(startY===null||matchMedia('(prefers-reduced-motion:reduce)').matches)return;
      box.style.translate='0 '+Math.max(0,event.clientY-startY)+'px';
    });
    function endDrag(event){
      if(startY===null)return;
      const dismiss=event.type==='pointerup'&&event.clientY-startY>55;
      startY=null;
      if(dismiss)requestClose();
      else box.animate([{translate:box.style.translate||'0 0'},{translate:'0 0'}],{duration:matchMedia('(prefers-reduced-motion:reduce)').matches?0:155,easing:'ease-out'});
      box.style.translate='';
    }
    box.addEventListener('pointerup',endDrag);box.addEventListener('pointercancel',endDrag);
  }
  function setup() {
    $('nav').innerHTML=Object.entries(screens).map(([key,s])=>'<button type="button" class="nav-item" data-screen="'+key+'">'+icon(s[2],21)+'<span>'+s[0]+'</span></button>').join('');
    $('dock').innerHTML=Object.entries(screens).slice(0,3).map(([key,s])=>'<button type="button" data-screen="'+key+'">'+icon(s[2],19)+'<span>'+s[3]+'</span></button>').join('')+'<button type="button" id="more" aria-haspopup="dialog">'+icon('more',19)+'Ещё</button>';
    document.querySelector('.ctx-icon').innerHTML=icon('building',19);document.querySelector('.about-icon').innerHTML=icon('info',18);$('sheet-close').innerHTML=icon('close',18);
    document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.screen)go(button.dataset.screen);else if(button.dataset.source)doc(button.dataset.source);});
    document.querySelector('.skip').addEventListener('click', event => {event.preventDefault();$('main').focus();});
    bindSheetGesture();
    $('sheet-body').addEventListener('click',event=>{
      if(!event.target.closest('[data-compare-sources]'))return;
      const receipt=sources['PAY-042'].raw, ledger=sources['L-102'].raw;
      sheet('Платёж и проводка','<div class="source-id">'+ledger.invoice_id+'</div><div class="source-sum">'+money(receipt.amount_minor-ledger.credit_minor)+' ₸</div><p>Эта часть платежа осталась нераспределённой.</p><dl class="source-fields"><div><dt>'+receipt.payment_id+' · поступило</dt><dd>'+money(receipt.amount_minor)+' ₸</dd></div><div><dt>'+ledger.row_id+' · отнесено</dt><dd>'+money(ledger.credit_minor)+' ₸</dd></div></dl>');
    });
    $('more').addEventListener('click',menu);
    $('about').addEventListener('click',()=>sheet('О среде','<p><strong>NoLimit Audit</strong> — воспроизводимая RL-среда для финансового аудита. На сайте доступны наблюдения и итоги записанных запусков Python-среды.</p><p>Компания «Маяк» и все записи синтетические. Проверку можно повторить локально без сети.</p><div class="grid-list"><button data-screen="lab">Открыть прогоны и материалы</button></div>'));
    $('sheet-close').addEventListener('click',requestClose);dialog.addEventListener('cancel',event=>{event.preventDefault();requestClose();});
    dialog.addEventListener('click',event=>{if(event.target===dialog)requestClose();});
    window.addEventListener('popstate',()=>{const key=getRoute();if(key!==current){hidePanel(true,false);render(key,true);}if(history.state?.panel)showPanel(history.state.panel);else hidePanel();});
    const key=getRoute();history.replaceState({route:key},'','#'+key);render(key,false);
  }
  window.addEventListener('DOMContentLoaded',setup,{once:true});
})();
