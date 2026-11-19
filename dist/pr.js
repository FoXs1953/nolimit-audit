(() => {
  'use strict';

  const ui = A;
  const {pair, reward:rewardResults} = window.AuditRelease;
  const equal = ['f1','reward','tp','fp','fn'].every(key => pair.before[key] === pair.after[key]);
  const currencySymbol = pair.currency === 'KZT' ? '₸' : pair.currency;
  const amount = minor => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(minor/100);
  const localNumber = (value, digits) => new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(value);
  const badge = (label) => '<span class="pr-version">' + label + '</span>';
  const icon = (name, size = 20) => ui.icon(name, size);
  const toggle = (items) =>
    '<div class="pr-segments" role="group" aria-label="Режим просмотра">' +
    '<span class="pr-slider" aria-hidden="true"></span>' +
    items.map((label, i) => '<button type="button" data-variant="' + i + '" aria-pressed="' + (i === 0) + '">' + label + '</button>').join('') + '</div>';
  function bindSwitch(root, labels, change) {
    const control = root.querySelector('.pr-toggle-mount');
    control.innerHTML = toggle(labels);
    const group = control.firstElementChild;
    const choices = [...group.querySelectorAll('button')];
    const choose = (index) => {
      const next = Number(index);
      group.style.setProperty('--choice', next);
      choices.forEach((button, i) => button.setAttribute('aria-pressed', String(next === i)));
      change(next);
    };
    choices.forEach((button, index) => button.addEventListener('click', () => choose(index)));
    choose(0);
  }
  function sectionHeading(title, note) {
    return '<div class="pr-list-title"><h3>' + title + '</h3>' +
      (note ? '<span>' + note + '</span>' : '') + '</div>';
  }
  function proofRows(rows) {
    return '<dl class="pr-proof">' + rows.map(([a,b]) =>
      '<div><dt>' + a + '</dt><dd>' + b + '</dd></div>').join('') + '</dl>';
  }
  function pairDiagram() {
    return '<div class="pr-flow" aria-label="Сравнение исходного прогона и повтора">' +
      '<div class="pr-flow-source"><span>' + badge('A') + 'Исходная</span><span>' + badge('Б') + 'После замены</span></div>' +
      '<svg class="pr-flow-lines" viewBox="0 0 300 48" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M75 1v9c0 11 10 15 21 15h42c9 0 12 6 12 14v8M225 1v9c0 11-10 15-21 15h-42c-9 0-12 6-12 14" />' +
      '<circle cx="75" cy="2" r="2"/><circle cx="225" cy="2" r="2"/></svg>' +
      '<span class="pr-equivalent">' + icon(equal?'check':'info', 15) + (equal?'Одинаковый результат':'Результаты различаются')+'</span></div>';
  }
  ui.views.pair = (root) => {
    root.innerHTML = '<div class="pr-view pr-pair"><div class="pr-layout">' +
      '<section class="pr-pair-hero"><span class="pr-topline">' + icon('compare') + 'Сверка двух версий</span>' +
      '<div class="pr-amount">' + amount(pair.amount_minor) + ' <span>' + currencySymbol + '</span></div><p class="pr-value-desc">Расхождение в каждом прогоне</p>' +
      pairDiagram() + '<button class="pr-hero-action" type="button" data-normalize>' +
      icon('layers', 18) + 'Как сверили выводы</button></section>' +
      '<section class="pr-record-panel">' + sectionHeading('Записи прогона', 'Дело № 017') +
      '<div class="pr-toggle-mount"></div><div class="pr-records" aria-live="polite"></div></section></div>' +
      '<p class="pr-context">' + icon('info', 16) + '<span>Открытый учебный эпизод. Повтор использует новые идентификаторы и другой порядок строк.</span></p></div>';
    bindSwitch(root, ['Исходная A', 'Повтор Б'], (index) => {
      const rows = index ? pair.replay : pair.original;
      const records = root.querySelector('.pr-records');
      records.innerHTML = rows.map((record) =>
        '<div class="pr-record"><span class="pr-record-icon">' + icon(record.icon) + '</span><span class="pr-record-name"><strong>' +
        record.event + '</strong><small>' + record.id + '</small></span><span class="pr-record-amount">' +
        amount(record.amount_minor) + ' ' + currencySymbol + '</span></div>').join('');
    });
    root.querySelector('[data-normalize]').addEventListener('click', () => {
      ui.sheet('Как сверили выводы', '<div class="pr-explain"><p>Оценщик возвращает новые ID к исходным по карте замен открытого теста. Затем сравнивает тип ошибки, связанные записи, сумму, валюту и набор доказательств.</p>' +
        proofRows(pair.mapping.map(([oldId,newId])=>[oldId,newId])) +
        proofRows([['F1 · исходный / повтор',localNumber(pair.before.f1,3)+' / '+localNumber(pair.after.f1,3)],
          ['Награда · исходный / повтор',localNumber(pair.before.reward,3)+' / '+localNumber(pair.after.reward,3)]]) +
        '<div class="pr-equation">Расхождение <strong>' + amount(pair.amount_minor)+' '+currencySymbol+
        '</strong></div><p>Организаторы используют эталонную политику для проверки максимальной награды. Здесь представлены её замеры на двух версиях открытого эпизода.</p></div>');
    });
  };
  function metric(label, code, value) {
    return '<div class="pr-metric"><dt>' + label + ' <span>' + code + '</span></dt><dd>' + value + '</dd></div>';
  }
  function scoreScale() {
    return '<div class="pr-scale" aria-hidden="true"><div class="pr-scale-rail"><div class="pr-scale-fill"></div><span class="pr-scale-zero"></span><span class="pr-scale-marker"></span></div>' +
      '<div class="pr-scale-labels"><span>−1</span><span>0</span><span>+1</span></div></div>';
  }
  ui.views.reward = (root) => {
    root.innerHTML = '<div class="pr-view pr-reward"><div class="pr-toggle-mount"></div><div class="pr-layout">' +
      '<section class="pr-reward-hero"><span class="pr-topline">' + icon('calculator') + 'Терминальная награда</span>' +
      '<div class="pr-amount" data-score aria-live="polite"></div>' + scoreScale() +
      '<div class="pr-note" data-note></div><button class="pr-hero-action" type="button" data-formula>' +
      icon('calculator', 18) + 'Показать расчёт</button></section>' +
      '<section class="pr-record-panel">' + sectionHeading('Разбор ответа', 'Ошибок в эпизоде: ' + (rewardResults[0].tp+rewardResults[0].fn)) +
      '<dl class="pr-metrics" data-metrics></dl><div class="pr-bottom-stat"><span>' + icon('clock', 18) + 'Шаги исследования</span><strong data-steps></strong></div></section>' +
      '</div><p class="pr-context">' + icon('info', 16) + '<span>Один тестовый эпизод и одинаковые действия исследования. Меняется только состав финального ответа.</span></p></div>';
    let selected = 0;
    bindSwitch(root, ['Один вывод', 'С повтором'], (index) => {
      selected = index;
      const result = rewardResults[index];
      const { f1, reward } = result;
      root.querySelector('[data-steps]').textContent=result.inspection_steps;
      root.querySelector('[data-score]').textContent = localNumber(reward, 3);
      const scale = root.querySelector('.pr-scale');
      scale.style.setProperty('--level', ((reward + 1) * 50) + '%');
      root.querySelector('[data-note]').textContent = index === 1
        ? 'Первый вывод засчитан. Его повтор добавляет одно ложное срабатывание.'
        : 'Один верный вывод подтверждён документами. Ложных срабатываний нет.';
      root.querySelector('[data-metrics]').innerHTML = metric('Верных', 'TP', result.tp) +
        metric('Лишних', 'FP', result.fp) + metric('Пропущено', 'FN', result.fn) + metric('F-мера', 'F1', localNumber(f1, 3));
    });
    root.querySelector('[data-formula]').addEventListener('click', () => {
      const result = rewardResults[selected];
      const { precision, recall, f1, reward, inspection_steps } = result;
      const cost=inspection_steps*0.002;
      const f1Label = selected && f1===2/3 ? '2/3' : localNumber(f1,3);
      ui.sheet('Расчёт награды', '<div class="pr-explain"><p>Оценщик сопоставляет каждый вывод с одной ошибкой. Второй экземпляр уже сопоставленного вывода остаётся лишним.</p>' +
        proofRows([['Точность P', localNumber(precision, 3)], ['Полнота R', localNumber(recall, 3)], ['F-мера F1', f1Label], ['Стоимость шагов', inspection_steps + ' × 0,002 = ' + localNumber(cost,3)]]) +
        '<div class="pr-equation">2 × ' + f1Label + ' − 1 − '+localNumber(cost,3)+' ' + (selected ? '≈' : '=') + ' <strong>' + localNumber(reward,3) +
        '</strong></div><p>Итог ограничивается диапазоном от −1 до +1. Округление до трёх знаков применяется только при отображении.</p></div>');
    });
  };
})();
