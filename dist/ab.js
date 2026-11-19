(() => {
  'use strict';

  const ui = window.A;
  const release=ui.release.demo;
  const money=ui.money;
  const raw=release.sources;
  const trace=release.trajectory;
  const invoice=raw['INV-017'];
  const first=raw['PAY-041'], second=raw['PAY-042'], left=raw['L-101'], right=raw['L-102'];
  const paid=first.amount_minor+second.amount_minor;
  const posted=left.credit_minor+right.credit_minor;
  const delta=paid-posted;
  const descriptions=[
    ['Список счетов','Поиск счёта','Агент находит счёт компании «Маяк».','Открыть список'],
    ['Документ','Проверка счёта','Агент сверяет сумму по исходному документу.','Открыть счёт'],
    ['Список проводок','Записи в книге','Агент читает проводки по компании.','Открыть записи'],
    ['Список платежей','Поиск платежей','Два платежа ссылаются на один счёт.','Открыть список'],
    ['Документ','Первый платёж','Агент открывает первый из двух платежей.','Открыть платёж'],
    ['Документ','Второй платёж','Агент проверяет, какая сумма поступила по счёту INV-017.','Открыть платёж'],
    ['Проводка','Запись в книге','Агент проверяет распределение второго платежа.','Открыть проводку'],
    ['Арифметика','Проверка разницы','Из суммы платежей агент вычитает сумму распределения.','Посмотреть расчёт'],
    ['Отправка','Вывод отправлен','Оценщик сопоставил отправленный вывод с расхождением.','Открыть итог']
  ];
  const steps=trace.map((row,i)=>{
    const [type,title,note,label]=descriptions[i], result=row.observation.result, action=row.action;
    const doc=action.doc_id||action.id;
    const n=doc ? result.total_minor??result.amount_minor??result.credit_minor : action.tool==='calculator'?Number(result.value):null;
    return {type,title,note,label,doc,kind:type,code:doc||action.tool,amount:n!==null?money(n):result.records?String(result.records.length):money(delta),
      unit:result.records?'записей':'₸',ref:doc===invoice.doc_id?'Компания «Маяк»':'Счёт '+invoice.invoice_id};
  });
  const sources = {
    'PAY-041': ['Первый платёж', money(first.amount_minor)+' ₸', 'wallet'],
    'PAY-042': ['Второй платёж', money(second.amount_minor)+' ₸', 'wallet'],
    'INV-017': ['Счёт компании', money(invoice.total_minor)+' ₸', 'receipt'],
    'L-101': ['Первая проводка', money(left.credit_minor)+' ₸', 'ledger'],
    'L-102': ['Вторая проводка', money(right.credit_minor)+' ₸', 'ledger']
  };
  let cursor = 5;
  let balanceMode = 0;
  let stopPlayback = null;

  const icon = (name, size = 20) => ui.icon(name, size);
  ui.auditCanRead = (id) => steps.slice(0, cursor + 1).some(step => step.doc === id);

  function row(id) {
    const [name, amount, symbol] = sources[id];
    return '<button class="ab-row" type="button" data-ab-doc="' + id + '">' +
      '<span class="ab-source-icon">' + icon(symbol, 20) + '</span>' +
      '<span class="ab-row-name"><b>' + name + '</b><small>' + id + '</small></span>' +
      '<span class="ab-row-amount">' + amount + '</span><span class="ab-row-next">' + icon('chevron', 15) + '</span></button>';
  }

  function pairs(items) {
    return '<dl class="ab-pairs">' + items.map(([label, value]) => '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>').join('') + '</dl>';
  }

  function calculation() {
    ui.sheet('Расчёт расхождения','<div class="ab-sheet-inner"><p>Суммы по счёту '+invoice.invoice_id+' в тенге.</p>'+pairs([
      ['Поступило',money(first.amount_minor)+' + '+money(second.amount_minor)+' = '+money(paid)+' ₸'],
      ['Распределено',money(left.credit_minor)+' + '+money(right.credit_minor)+' = '+money(posted)+' ₸'],
      ['Разница',money(delta)+' ₸']])+'</div>');
  }
  function inspect() {
    const step=steps[cursor], record=trace[cursor];
    if(step.doc)return ui.doc(step.doc);
    if(record.action.tool==='calculator')return calculation();
    if(record.terminated||record.truncated){
      const score=release.report, finding=release.findings[0];
      return ui.sheet('Итог эпизода','<div class="ab-sheet-inner"><p>'+finding.explanation+'</p>'+pairs([
        ['Тип','Частичное распределение'],['Расхождение',money(finding.claimed_amount_minor)+' ₸'],['Доказательства',finding.evidence_ids.join(', ')],
        ['Точность / Полнота',score.precision+' / '+score.recall],['F1',score.f1],['Шагов исследования',score.inspection_steps],['Награда',score.reward.toLocaleString('ru-RU')],['Время',score.elapsed_seconds.toFixed(4)+' с']])+'</div>');
    }
    const rows=record.observation.result.records.map(r=>[r.row_id||r.doc_id,money(r.total_minor??r.amount_minor??(r.debit_minor||r.credit_minor))+' ₸']);
    ui.sheet(step.type,'<div class="ab-sheet-inner"><p>Ответ среды на шаге '+record.step+'.</p>'+pairs(rows)+'</div>');
  }

  function renderSlip(step) {
    return '<div class="ab-slip-back"></div><div class="ab-slip-mid"></div><div class="ab-slip">' +
      '<div class="ab-slip-cap"><span class="ab-slip-emblem"><i></i><i></i><i></i></span><span>' + step.kind + '</span></div>' +
      '<div class="ab-slip-code">' + step.code + '</div><div class="ab-slip-amount">' + step.amount + '<em>' + step.unit + '</em></div>' +
      '<div class="ab-perf"></div><div class="ab-slip-end"><span>' + step.ref + '</span><i class="ab-bars"></i></div></div>';
  }

  ui.views.audit = function (root) {
    if (stopPlayback) stopPlayback();
    root.innerHTML = '<div class="ab-view ab-audit"><section class="ab-hero"><div class="ab-hero-copy">' +
      '<div class="ab-meta"><span class="ab-record-mark" aria-hidden="true"></span><span data-ab-meta></span></div>' +
      '<h2 data-ab-title></h2><p data-ab-note></p><button type="button" class="ab-action" data-ab-inspect></button></div>' +
      '<div class="ab-art" aria-hidden="true"><div class="ab-slip-stack" data-ab-art></div></div></section>' +
      '<section class="ab-player"><div class="ab-player-head"><h2>Запись эпизода</h2><span class="ab-count" data-ab-count></span></div>' +
      '<label class="ab-scrub"><span class="ab-sr">Выбрать шаг записи</span><input type="range" min="1" max="9" step="1" data-ab-slider></label>' +
      '<div class="ab-player-actions"><div class="ab-transport"><button type="button" data-ab-back aria-label="Предыдущий шаг">' + icon('prev',22) + '</button>' +
      '<button type="button" class="ab-play" data-ab-play></button><button type="button" data-ab-next aria-label="Следующий шаг">' + icon('next',22) + '</button></div>' +
      '<span class="ab-budget" data-ab-budget></span></div></section>' +
      '<section class="ab-evidence"><h2>Открытые материалы</h2><div data-ab-materials></div></section></div>';

    const view = root.querySelector('.ab-audit');
    const find = (selector) => view.querySelector(selector);
    const slider = find('[data-ab-slider]');
    const play = find('[data-ab-play]');
    let timer = null;

    function setPlayLabel() {
      const label = timer ? 'Пауза' : cursor === steps.length - 1 ? 'Воспроизвести сначала' : 'Воспроизвести';
      play.setAttribute('aria-label', label);
      play.setAttribute('title', label);
      play.innerHTML = icon(timer ? 'pause' : cursor === steps.length - 1 ? 'restart' : 'play', 19);
    }

    function stop() {
      clearInterval(timer);
      timer = null;
      setPlayLabel();
    }
    stopPlayback = stop;

    function paint() {
      const step = steps[cursor];
      const position = cursor + 1;
      find('[data-ab-meta]').textContent = 'Шаг ' + position + ' · ' + step.type;
      find('[data-ab-title]').textContent = step.title;
      find('[data-ab-note]').textContent = step.note;
      find('[data-ab-inspect]').innerHTML = icon(cursor === 7 ? 'calculator' : cursor === 8 ? 'check' : 'document', 18) + '<span>' + step.label + '</span>';
      find('[data-ab-art]').innerHTML = renderSlip(step);
      find('[data-ab-count]').textContent = position + ' из ' + steps.length;
      find('[data-ab-budget]').textContent = cursor === 8 ? 'Эпизод завершён' : 'Осталось шагов: ' + trace[cursor].observation.remaining_steps;
      slider.value = position;
      slider.setAttribute('aria-valuetext', 'Шаг ' + position + ' из 9. ' + step.title);
      slider.style.setProperty('--ab-fill', cursor * 12.5 + '%');
      find('[data-ab-back]').disabled = cursor === 0;
      find('[data-ab-next]').disabled = cursor === steps.length - 1;
      const docs = steps.slice(0, position).map(item => item.doc).filter(Boolean).reverse();
      find('[data-ab-materials]').innerHTML = docs.length ? docs.map(row).join('') : '<p class="ab-empty">Пока открыт только список счетов.</p>';
      setPlayLabel();
    }
    function move(position) {
      cursor = Math.max(0, Math.min(steps.length - 1, position));
      if (cursor === steps.length - 1) stop();
      paint();
    }
    find('[data-ab-inspect]').addEventListener('click', () => { stop(); inspect(); });
    find('[data-ab-materials]').addEventListener('click', (event) => {
      const button = event.target.closest('[data-ab-doc]');
      if (button) { stop(); ui.doc(button.dataset.abDoc); }
    });
    find('[data-ab-back]').addEventListener('click', () => { stop(); move(cursor - 1); });
    find('[data-ab-next]').addEventListener('click', () => { stop(); move(cursor + 1); });
    slider.addEventListener('input', () => { stop(); move(Number(slider.value) - 1); });
    play.addEventListener('click', () => {
      if (timer) return stop();
      if (cursor === steps.length - 1) move(0);
      timer = window.setInterval(() => {
        if (!view.isConnected || document.hidden || document.querySelector('dialog[open]')) return stop();
        move(cursor + 1);
      }, 3500);
      setPlayLabel();
    });
    paint();
    return () => {
      stop();
      if (stopPlayback === stop) stopPlayback = null;
    };
  };

  ui.views.balance = function (root) {
    if (stopPlayback) stopPlayback();
    root.innerHTML = '<div class="ab-view ab-balance"><section class="ab-balance-top"><div class="ab-balance-head">' +
      '<div><p class="ab-balance-eyebrow">Разница по счёту INV-017</p><h2>'+money(delta)+' <small>₸</small></h2></div>' +
      '<span class="ab-balance-stamp" aria-hidden="true">' + icon('compare', 30) + '</span></div>' +
      '<div class="ab-bar-data"><div><span>Поступило</span><b>'+money(paid)+' ₸</b></div><div class="ab-track"><i></i></div>' +
      '<div><span>Распределено</span><b>'+money(posted)+' ₸</b></div><div class="ab-track ab-track-ledger"><i style="width:'+100*posted/paid+'%"></i></div></div>' +
      '<button type="button" class="ab-calc" data-ab-calc>' + icon('calculator',18) + 'Показать расчёт</button></section>' +
      '<section class="ab-balance-docs"><h2>Основание для сверки</h2><div class="ab-segments" role="group" aria-label="Показать источник">' +
      '<i aria-hidden="true"></i><button type="button" data-ab-mode="0">Платежи</button><button type="button" data-ab-mode="1">Проводки</button></div>' +
      '<div data-ab-sources></div><div class="ab-total"><span>Итого</span><strong data-ab-total></strong></div></section></div>';
    const view = root.querySelector('.ab-balance');
    const segments = view.querySelector('.ab-segments');
    function update() {
      segments.style.setProperty('--ab-segment', balanceMode);
      segments.querySelectorAll('button').forEach((btn, index) => btn.setAttribute('aria-pressed', index === balanceMode ? 'true' : 'false'));
      const docs = balanceMode ? ['L-101', 'L-102'] : ['PAY-041', 'PAY-042'];
      view.querySelector('[data-ab-sources]').innerHTML = docs.map(row).join('');
      view.querySelector('[data-ab-total]').textContent = balanceMode ? money(posted)+' ₸' : money(paid)+' ₸';
    }
    view.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-ab-mode')) { balanceMode = Number(button.dataset.abMode); update(); }
      else if (button.hasAttribute('data-ab-calc')) calculation();
      else if (button.dataset.abDoc) ui.doc(button.dataset.abDoc);
    });
    update();
  };

  window.addEventListener('nolimit:sheetopen', () => { if (stopPlayback) stopPlayback(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && stopPlayback) stopPlayback(); });
  window.addEventListener('hashchange', () => { if (stopPlayback) stopPlayback(); });
})();
