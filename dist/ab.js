(() => {
  'use strict';

  const ui = window.A;
  const steps = [
    { type: 'Список счетов', title: 'Поиск счёта', note: 'В списке счетов компании «Маяк» агент нашёл INV-017.', call: 'list_records', label: 'Открыть список', kind: 'Счёт', code: 'INV-017', amount: '480 000', unit: '₸', ref: 'Октябрь 2026' },
    { type: 'Документ', title: 'Проверка счёта', note: 'Агент сверил сумму счёта по исходному документу.', call: 'get_document', label: 'Открыть счёт', doc: 'INV-017', kind: 'Счёт', code: 'INV-017', amount: '480 000', unit: '₸', ref: 'Компания «Маяк»' },
    { type: 'Список проводок', title: 'Записи в книге', note: 'В журнале найдены две проводки со ссылкой на INV-017.', call: 'list_records', label: 'Открыть записи', kind: 'Главная книга', code: 'L-101 / L-102', amount: '2', unit: 'записи', ref: 'Счёт INV-017' },
    { type: 'Список платежей', title: 'Поиск платежей', note: 'В назначении двух платежей указан тот же счёт.', call: 'list_records', label: 'Открыть список', kind: 'Платежи', code: 'INV-017', amount: '2', unit: 'платежа', ref: 'Компания «Маяк»' },
    { type: 'Документ', title: 'Первый платёж', note: 'Агент открыл первый из двух платежей по счёту INV-017.', call: 'get_document', label: 'Открыть платёж', doc: 'PAY-041', kind: 'Платёж', code: 'PAY-041', amount: '180 000', unit: '₸', ref: 'Счёт INV-017' },
    { type: 'Документ', title: 'Второй платёж', note: 'Агент проверяет, какая сумма поступила по счёту INV-017.', call: 'get_document', label: 'Открыть платёж', doc: 'PAY-042', kind: 'Платёж', code: 'PAY-042', amount: '300 000', unit: '₸', ref: 'Счёт INV-017' },
    { type: 'Проводка', title: 'Запись в книге', note: 'Агент проверяет сумму, отнесённую на счёт по второму платежу.', call: 'get_record', label: 'Открыть проводку', doc: 'L-102', kind: 'Проводка', code: 'L-102', amount: '280 000', unit: '₸', ref: 'Платёж PAY-042' },
    { type: 'Арифметика', title: 'Проверка разницы', note: 'Из общей суммы платежей агент вычитает сумму распределения.', call: 'calculator', label: 'Посмотреть расчёт', kind: 'Расчёт', code: 'INV-017', amount: '20 000', unit: '₸', ref: '480 000 − 460 000' },
    { type: 'Отправка', title: 'Вывод отправлен', note: 'Агент указал частичное распределение и приложил доказательства.', call: 'submit', label: 'Открыть итог', kind: 'Расхождение', code: 'INV-017', amount: '20 000', unit: '₸', ref: 'Эпизод завершён' },
  ];

  const sources = {
    'PAY-041': ['Первый платёж', '180 000 ₸', 'wallet'],
    'PAY-042': ['Второй платёж', '300 000 ₸', 'wallet'],
    'INV-017': ['Счёт компании', '480 000 ₸', 'receipt'],
    'L-101': ['Первая проводка', '180 000 ₸', 'ledger'],
    'L-102': ['Вторая проводка', '280 000 ₸', 'ledger'],
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
    ui.sheet('Расчёт расхождения', '<div class="ab-sheet-inner"><p>Платежи по счёту INV-017 и записи об их распределении выражены в тенге.</p>' +
      pairs([['Поступило', '180 000 + 300 000 = 480 000 ₸'], ['Распределено', '180 000 + 280 000 = 460 000 ₸'], ['Разница', '480 000 − 460 000 = 20 000 ₸']]) + '</div>');
  }

  function inspect() {
    const step = steps[cursor];
    if (step.doc) return ui.doc(step.doc);
    if (cursor === 7) return calculation();
    if (cursor === 8) {
      return ui.sheet('Итог эпизода', '<div class="ab-sheet-inner"><p>Из второго платежа в 300 000 ₸ к счёту INV-017 отнесли 280 000 ₸.</p>' +
        pairs([['Тип', 'Частичное распределение'], ['Расхождение', '20 000 ₸'], ['Доказательства', 'INV-017, PAY-041, PAY-042, L-101, L-102'], ['Полнота / точность', '1,00 / 1,00'], ['F1', '1,00'], ['Шагов исследования', '8'], ['Награда', '0,984']]) + '</div>');
    }
    const items = cursor === 0 ? [['INV-017', '480 000 ₸']] : cursor === 2 ? [['L-101', '180 000 ₸'], ['L-102', '280 000 ₸']] : [['PAY-041', '180 000 ₸'], ['PAY-042', '300 000 ₸']];
    ui.sheet(step.type, '<div class="ab-sheet-inner"><p>Записи в ответе среды на шаге ' + (cursor + 1) + '.</p>' + pairs(items) + '</div>');
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
      find('[data-ab-budget]').textContent = cursor === 8 ? 'Эпизод завершён' : 'Осталось шагов: ' + (100 - position);
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
      '<div><p class="ab-balance-eyebrow">Разница по счёту INV-017</p><h2>20 000 <small>₸</small></h2></div>' +
      '<span class="ab-balance-stamp" aria-hidden="true">' + icon('compare', 30) + '</span></div>' +
      '<div class="ab-bar-data"><div><span>Поступило</span><b>480 000 ₸</b></div><div class="ab-track"><i></i></div>' +
      '<div><span>Распределено</span><b>460 000 ₸</b></div><div class="ab-track ab-track-ledger"><i></i></div></div>' +
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
      view.querySelector('[data-ab-total]').textContent = balanceMode ? '460 000 ₸' : '480 000 ₸';
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
