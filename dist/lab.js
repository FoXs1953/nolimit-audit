(() => {
  'use strict';
  const ui = window.A;
  const policies = {
    reconcile: 'Алгоритм сверки', random: 'Случайный исследователь',
    mark_all: 'Пометить всё', oracle: 'Эталонная политика'
  };
  const tables = {invoices:'Счета', payments:'Платежи', ledger:'Проводки', fx:'Курсы валют'};
  const tools = {list_records:'Запрос списка записей',get_record:'Чтение записи',get_document:'Чтение документа',calculator:'Арифметический расчёт',submit:'Отправка выводов'};
  const remembered = {split:'train', key:'train-03', policy:'reconcile', cursor:0};
  const number = (value,digits=0) => Number(value).toLocaleString('ru-RU',{minimumFractionDigits:digits,maximumFractionDigits:digits});
  const esc = (s) => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = (name, size=18) => ui.icon(name,size);
  const pathFor = (key,policy) => 'data/runs/'+encodeURIComponent(key)+'/'+encodeURIComponent(policy)+'.jsonl';
  function describeAction(action) {
    switch(action.tool) {
      case 'list_records': return (tables[action.table]||action.table)+' · до '+action.limit+' строк'+(action.cursor?' · следующая страница':'');
      case 'get_record': return (tables[action.table]||action.table)+' · '+action.id;
      case 'get_document': return action.doc_id;
      case 'calculator': return action.expression;
      case 'submit': return 'Выводов в ответе: '+action.findings.findings.length;
      default: return action.tool || 'Неизвестное действие';
    }
  }
  function describeObservation(frame) {
    const {observation:o, action:a} = frame;
    if(o.error) return typeof o.error==='string' ? o.error : JSON.stringify(o.error);
    if(frame.truncated) return 'Лимит эпизода исчерпан.';
    if(a.tool==='submit')return 'Оценщик получил итоговый ответ.';
    const r=o.result;
    if(!r)return 'Пустой результат.';
    if(Array.isArray(r.records))return 'Получено строк: '+r.records.length+'. '+(r.next_cursor?'Доступна следующая страница.':'Это последняя страница.');
    if(a.tool==='calculator')return 'Результат вычисления: '+r.value;
    return 'Получена запись '+(r.doc_id||r.row_id||r.invoice_id||r.payment_id||'')+'.';
  }
  function metric(label,value){return '<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>';}
  function jsonSheet(frame) {
    ui.sheet('Шаг '+frame.step+' · JSON','<div class="lab-json"><p>Полная строка записанной траектории.</p><pre tabindex="0">'+esc(JSON.stringify(frame,null,2))+'</pre></div>');
  }
  function download(label,url,filename,detail) {
    return '<a class="lab-file" href="'+esc(url)+'"'+(filename?' download="'+esc(filename)+'"':' target="_blank" rel="noopener noreferrer"')+'>'+
      '<span class="lab-file-icon">'+icon('document',20)+'</span><span><strong>'+esc(label)+'</strong><small>'+esc(detail)+'</small></span></a>';
  }

  ui.views.lab = function(root) {
    const {catalog,validation}=ui.release;
    let selected, frames=[], request, generation=0, preview='action';
    root.innerHTML='<div class="lab-view">'+
      '<section class="lab-config panel"><div class="lab-config-title"><h2>Выбор прогона</h2>'+
      '<div class="lab-switch" role="group" aria-label="Набор эпизодов"><span aria-hidden="true"></span>'+
      '<button type="button" data-split="train">Train</button><button type="button" data-split="dev">Dev</button></div></div>'+
      '<div class="lab-selectors"><label>Эпизод<select data-episode></select></label><label>Политика<select data-policy>'+
      Object.entries(policies).map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+
      '</select></label></div><p class="lab-context" data-context></p></section>'+
      '<div class="lab-main"><section class="lab-result"><div class="lab-section-title">'+icon('gauge')+'<h2>Результат прогона</h2></div>'+
      '<span class="lab-result-label">Терминальная награда</span><strong class="lab-number" data-reward></strong>'+
      '<dl class="lab-metrics" data-metrics></dl><button type="button" class="lab-darkbutton" data-compare>Сравнить политики</button></section>'+
      '<section class="lab-player panel" aria-label="Просмотр траектории"><div class="lab-player-head"><h2>Траектория</h2>'+
      '<span data-position></span></div><div data-frame aria-live="polite"></div><div class="lab-controls" data-controls hidden>'+
      '<label class="lab-range"><span class="lab-sr">Номер шага</span><input type="range" min="1" step="1" data-seek></label>'+
      '<div class="lab-transport"><div><button type="button" data-prev aria-label="Предыдущий шаг">'+icon('prev')+'</button>'+
      '<button type="button" data-next aria-label="Следующий шаг">'+icon('next')+'</button></div>'+
      '<button type="button" data-json>Весь шаг · JSON</button></div></div></section></div>'+
      '<section class="lab-files panel"><h2>Повторить проверку</h2><p data-validation></p><div class="lab-command"><code>python3.11 verify.py</code></div>'+
      '<div class="lab-downloads"><span data-trace-link></span>'+
      download('Открытые эпизоды','downloads/open-episodes.zip','open-episodes.zip','10 train и 10 dev · архив ZIP')+
      download('Результаты проверки','downloads/benchmark.json','benchmark.json','Четыре политики · JSON')+
      download('Исходный код','https://github.com/FoXs1953/nolimit-audit','','GitHub · README и контейнер')+
      '</div></section></div>';
    const find = s=>root.querySelector(s);
    const episodeSelect=find('[data-episode]'), policySelect=find('[data-policy]'), frameBox=find('[data-frame]'), controls=find('[data-controls]');
    function refreshCatalog() {
      const subset=catalog.filter(c=>c.split===remembered.split);
      selected=subset.find(c=>c.key===remembered.key)||subset[0];
      remembered.key=selected.key;
      episodeSelect.innerHTML=subset.map(c=>'<option value="'+esc(c.key)+'">'+esc(c.key+' · '+c.manifest.company)+'</option>').join('');
      episodeSelect.value=selected.key;
      policySelect.value=remembered.policy;
      find('.lab-switch').style.setProperty('--index',remembered.split==='dev'?1:0);
      root.querySelectorAll('[data-split]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.split===remembered.split)));
    }
    function refreshSummary(){
      const m=selected.manifest, r=selected.policies[remembered.policy];
      const period=new Intl.DateTimeFormat('ru-RU',{timeZone:m.timezone,month:'long',year:'numeric'}).format(new Date(m.period_start));
      find('[data-context]').textContent=[period,m.base_currency,'Проводок: '+m.record_count,'Документов: '+m.document_count].join(' · ');
      find('[data-reward]').textContent=number(r.reward,3);
      find('[data-metrics]').innerHTML=[
        ['Точность P',number(r.precision,3)],['Полнота R',number(r.recall,3)],['F1',number(r.f1,3)],
        ['Верные · TP',r.tp],['Лишние · FP',r.fp],['Пропуски · FN',r.fn],
        ['Шаги',r.steps],['Исследование',r.inspection_steps],['Время',number(1000*r.elapsed_seconds,1)+' мс']
      ].map(([label,value])=>metric(label,value)).join('');
      find('[data-validation]').textContent='Проверено на открытом контрольном наборе: '+validation.episodes+' эпизодов, парных проверок '+validation.pairs+
        ', точных повторов '+validation.replays+'. Модульных тестов: '+validation.unit_tests+'.';
      find('[data-trace-link]').innerHTML=download('Выбранная траектория',pathFor(selected.key,remembered.policy),
        selected.key+'-'+remembered.policy+'.jsonl',selected.key+' · '+policies[remembered.policy]+' · JSONL');
    }
    function showFrame(){
      const f=frames[remembered.cursor];
      find('[data-position]').textContent=f.step+' из '+frames.length;
      const observation=preview==='observation';
      frameBox.innerHTML='<div class="lab-frame-switch" role="group" aria-label="Часть шага">'+
        ['action','observation'].map((mode,index)=>'<button type="button" data-preview="'+mode+'" aria-pressed="'+(mode===preview)+'">'+['Действие','Наблюдение'][index]+'</button>').join('')+'</div>'+
        '<h3>'+esc(observation?'Ответ среды':(tools[f.action.tool]||f.action.tool))+'</h3><p>'+esc(observation?describeObservation(f):describeAction(f.action))+'</p>'+
        '<small>'+esc(f.truncated?'Эпизод прерван':f.terminated?'Эпизод завершён':'Доступно шагов: '+f.observation.remaining_steps)+'</small>';
      const range=find('[data-seek]');range.max=frames.length;range.value=remembered.cursor+1;range.disabled=frames.length===1;
      range.setAttribute('aria-valuetext',f.step+' из '+frames.length);
      find('[data-prev]').disabled=remembered.cursor===0;find('[data-next]').disabled=remembered.cursor===frames.length-1;controls.hidden=false;
    }
    function takeStep(index){remembered.cursor=Math.max(0,Math.min(frames.length-1,index));showFrame();}
    async function loadTrace(reset=true){
      if(request)request.abort();const active=++generation;request=new AbortController();
      if(reset)remembered.cursor=0;
      frames=[];controls.hidden=true;find('[data-position]').textContent='';frameBox.innerHTML='<p class="lab-status" role="status">Загружаем шаги…</p>';
      refreshSummary();
      try {
        const response=await fetch(pathFor(selected.key,remembered.policy),{signal:request.signal});
        if(!response.ok)throw new Error('Unavailable trace');
        const rows=(await response.text()).trim().split(/\r?\n/).map(line=>JSON.parse(line));
        if(active!==generation)return;
        if(!rows.length||rows.some((f,i)=>f.episode_id!==selected.manifest.episode_id||f.step!==i+1||!f.action||!f.observation))throw new Error('Invalid trace');
        frames=rows;takeStep(remembered.cursor);
      }catch(error){
        if(active!==generation||error.name==='AbortError')return;
        frameBox.innerHTML='<p class="lab-status" role="alert">Не удалось загрузить шаги этого прогона.</p><button class="secondary" type="button" data-retry>Повторить загрузку</button>';
      }
    }
    function compare(){
      const rows=Object.entries(policies).map(([key,label])=>{
        const r=selected.policies[key];
        return '<div><h3>'+esc(label)+'</h3><p>F1 '+number(r.f1,3)+' · награда '+number(r.reward,3)+'</p>'+
          '<small>TP '+r.tp+' · FP '+r.fp+' · FN '+r.fn+' · шагов '+r.steps+'</small></div>';
      }).join('');
      ui.sheet('Политики на одном эпизоде','<div class="lab-compare"><p>'+esc(selected.key+' · '+selected.manifest.company)+'</p>'+rows+'</div>');
    }
    root.addEventListener('click', event=>{
      const b=event.target.closest('button');if(!b)return;
      if(b.dataset.split && b.dataset.split!==remembered.split){
        const nextSplit=b.dataset.split;remembered.key=nextSplit+remembered.key.slice(remembered.split.length);remembered.split=nextSplit;
        refreshCatalog();loadTrace();
      }else if(b.dataset.preview && frames.length){
        preview=b.dataset.preview;showFrame();find('[data-preview="'+preview+'"]').focus({preventScroll:true});
      }else if(b.hasAttribute('data-prev'))takeStep(remembered.cursor-1);
      else if(b.hasAttribute('data-next'))takeStep(remembered.cursor+1);
      else if(b.hasAttribute('data-json')&&frames.length)jsonSheet(frames[remembered.cursor]);
      else if(b.hasAttribute('data-retry'))loadTrace();
      else if(b.hasAttribute('data-compare'))compare();
    });
    episodeSelect.addEventListener('change',()=>{remembered.key=episodeSelect.value;selected=catalog.find(c=>c.key===remembered.key);loadTrace();});
    policySelect.addEventListener('change',()=>{remembered.policy=policySelect.value;loadTrace();});
    find('[data-seek]').addEventListener('input',event=>takeStep(Number(event.target.value)-1));
    refreshCatalog();loadTrace(false);
    return ()=>{generation++;if(request)request.abort();};
  };
})();
