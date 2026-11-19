(() => {
  const A = window.A;
  const folders = [
    { id: 'invoices', label: 'Счета', count: '1 документ', records: [
      ['INV-017', 'Счёт к оплате', '480 000', 'document']
    ] },
    { id: 'payments', label: 'Платежи', count: '2 документа', records: [
      ['PAY-041', 'Первый платёж', '180 000', 'wallet'],
      ['PAY-042', 'Второй платёж', '300 000', 'wallet']
    ] },
    { id: 'ledger', label: 'Проводки', count: '2 записи', records: [
      ['L-101', 'Распределение первого платежа', '180 000', 'ledger'],
      ['L-102', 'Распределение второго платежа', '280 000', 'ledger']
    ] }
  ];
  let selectedFolder = 'payments';
  let displayLocal = true;

  function entry(icon, main, secondary, value, attribute) {
    return '<button type="button" class="dp-row" ' + attribute + '>' +
      '<span class="dp-file-icon" aria-hidden="true">' + A.icon(icon, 22) + '</span>' +
      '<span class="dp-row-label"><strong>' + main + '</strong><small>' + secondary + '</small></span>' +
      '<span class="dp-row-value">' + value + '</span><span aria-hidden="true" class="dp-row-next">' + A.icon('chevron', 16) + '</span></button>';
  }

  function folderButton(folder) {
    return '<button type="button" class="dp-folder dp-' + folder.id + '" data-folder="' + folder.id + '" aria-pressed="false" aria-controls="dp-documents">' +
      '<span class="dp-folder-art" aria-hidden="true"><i class="dp-folder-back"></i><i class="dp-slip dp-slip-one"></i>' +
      '<i class="dp-slip dp-slip-two"><b></b><b></b><b></b></i><i class="dp-folder-front">' +
      A.icon(folder.records[0][3], 22) + '</i></span><span class="dp-folder-name">' + folder.label +
      '</span><span class="dp-folder-count">' + folder.count + '</span></button>';
  }

  A.views.dossier = function (root) {
    root.innerHTML = '<div class="dp-view"><section class="dp-library"><div class="dp-library-top"><span class="dp-case-mark">' +
      A.icon('layers', 16) + ' INV-017</span><span>Октябрь 2026</span></div><h2>Документы «Маяка»</h2>' +
      '<div class="dp-folders" aria-label="Виды документов">' + folders.map(folderButton).join('') + '</div></section>' +
      '<section class="dp-panel" id="dp-documents"><div class="dp-heading"><h2></h2><span></span></div><div class="dp-records"></div></section>' +
      '<button type="button" class="dp-evidence" data-finding><span class="dp-evidence-icon" aria-hidden="true">' +
      A.icon('compare', 20) + '</span><span><strong>Вывод агента</strong><small>Доказательства по счёту INV-017</small></span>' +
      '<span class="dp-evidence-open" aria-hidden="true">' + A.icon('chevron', 18) + '</span></button></div>';
    function showFolder(id) {
      selectedFolder = id;
      const folder = folders.find(item => item.id === id);
      root.querySelectorAll('[data-folder]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.folder === id));
      });
      root.querySelector('.dp-heading h2').textContent = folder.label;
      root.querySelector('.dp-heading > span').textContent = folder.count;
      const list = root.querySelector('.dp-records');
      list.innerHTML = folder.records.map(record => entry(record[3], record[0], record[1], record[2] + '&nbsp;₸',
        'data-record="' + record[0] + '"')).join('');
      list.querySelectorAll('[data-record]').forEach(button => {
        button.addEventListener('click', () => A.doc(button.dataset.record));
      });
    }
    root.querySelectorAll('[data-folder]').forEach(button => button.addEventListener('click', () => showFolder(button.dataset.folder)));
    root.querySelector('[data-finding]').addEventListener('click', () => A.sheet('Вывод агента',
      '<div class="dp-sheet-body"><p>К счёту INV-017 отнесли только часть второго платежа.</p><dl>' +
      '<div><dt>Поступило · PAY-042</dt><dd>300 000 ₸</dd></div><div><dt>Распределено · L-102</dt><dd>280 000 ₸</dd></div>' +
      '<div><dt>Разница</dt><dd>20 000 ₸</dd></div></dl><p class="dp-note">Оба источника доступны в папках «Платежи» и «Проводки».</p></div>'));
    showFolder(selectedFolder);
  };

  const timeEvents = [
    { id: 'L-208', label: 'Проводка', local: '31 окт · 23:50', utc: '31 окт · 18:50',
      localStamp: '2026-10-31T23:50:00+05:00', utcStamp: '2026-10-31T18:50:00Z', icon: 'ledger' },
    { id: 'PAY-088', label: 'Платёж', local: '01 ноя · 02:15', utc: '31 окт · 21:15',
      localStamp: '2026-11-01T02:15:00+05:00', utcStamp: '2026-10-31T21:15:00Z', icon: 'wallet' }
  ];

  function periodRecord(id) {
    const item = timeEvents.find(record => record.id === id);
    A.sheet(item.label + ' ' + item.id, '<div class="dp-sheet-body"><p>Фрагмент записи из учебного эпизода о границе периода.</p>' +
      '<dl><div><dt>Время компании</dt><dd>' + item.local + '</dd></div><div><dt>Время UTC</dt><dd>' + item.utc + '</dd></div></dl>' +
      '<p class="dp-note">Исходная отметка времени</p><code>' + item.localStamp + '</code></div>');
  }

  A.views.period = function (root) {
    root.innerHTML = '<div class="dp-view dp-period"><section class="dp-calendar">' +
      '<div class="dp-calendar-top"><span class="dp-time-label">' + A.icon('calendar', 17) + ' Дата платежа</span>' +
      '<span class="dp-case-mark">PAY-088</span></div>' +
      '<div class="dp-date-face"><div><div class="dp-date-line"><strong data-day></strong><span data-month></span></div>' +
      '<p data-zone></p></div><div class="dp-time-display"><div class="dp-clock" aria-hidden="true">' +
      '<i class="dp-hour-hand"></i><i class="dp-minute-hand"></i></div><b data-hour></b></div></div>' +
      '<div class="dp-segment" role="group" aria-label="Часовой пояс"><i aria-hidden="true"></i>' +
      '<button type="button" data-local="1">Время компании</button><button type="button" data-local="0">UTC</button></div>' +
      '</section><section class="dp-panel dp-chronology"><div class="dp-heading"><h2>Граница октября</h2></div>' +
      '<div class="dp-timescale" role="img"><span class="dp-axis-bg"></span><i class="dp-market"></i><i class="dp-posted"></i><i class="dp-paid"></i>' +
      '<span class="dp-scale-start" data-start></span><span class="dp-scale-end" data-end></span><span class="dp-boundary" data-boundary></span></div>' +
      '<div class="dp-time-records"></div></section>' +
      '<button type="button" class="dp-evidence" data-policy><span class="dp-evidence-icon" aria-hidden="true">' +
      A.icon('calendar', 20) + '</span><span><strong>Правило периода</strong><small>Дата признания по политике компании</small></span>' +
      '<span class="dp-evidence-open" aria-hidden="true">' + A.icon('chevron', 18) + '</span></button></div>';

    function showTime() {
      const mode = displayLocal ? 'local' : 'utc';
      const update = (selector, text) => { root.querySelector(selector).textContent = text; };
      update('[data-day]', displayLocal ? '01' : '31');
      update('[data-month]', displayLocal ? 'ноября' : 'октября');
      update('[data-zone]', displayLocal ? 'Воскресенье · UTC+05:00' : 'Суббота · UTC+00:00');
      update('[data-hour]', displayLocal ? '02:15' : '21:15');
      update('[data-start]', displayLocal ? '23:00' : '18:00');
      update('[data-end]', displayLocal ? '03:00' : '22:00');
      update('[data-boundary]', displayLocal ? '00:00 · Закрытие' : '19:00 · Закрытие');
      root.querySelector('.dp-timescale').setAttribute('aria-label', displayLocal ?
        'Проводка в 23:50, закрытие месяца в 00:00, платёж в 02:15 местного времени.' :
        'Проводка в 18:50, закрытие месяца в 19:00, платёж в 21:15 UTC.');
      root.querySelector('.dp-clock').style.setProperty('--hour-angle', displayLocal ? '67.5deg' : '277.5deg');
      const segment = root.querySelector('.dp-segment');
      segment.classList.toggle('dp-utc-active', !displayLocal);
      segment.querySelectorAll('button').forEach(button => {
        button.setAttribute('aria-pressed', String((button.dataset.local === '1') === displayLocal));
      });
      const list = root.querySelector('.dp-time-records');
      list.innerHTML = timeEvents.map(event => entry(event.icon, event.label, event.id, event[mode],
        'data-period-record="' + event.id + '"')).join('');
      list.querySelectorAll('button').forEach(button => button.addEventListener('click', () => periodRecord(button.dataset.periodRecord)));
    }
    root.querySelectorAll('[data-local]').forEach(button => {
      button.addEventListener('click', () => { displayLocal = button.dataset.local === '1'; showTime(); });
    });
    root.querySelector('[data-policy]').addEventListener('click', () => A.sheet('Правило периода',
      '<div class="dp-sheet-body"><p>Платёж признаётся на дату поступления по местному времени компании.</p><dl>' +
      '<div><dt>Часовой пояс</dt><dd>UTC+05:00</dd></div><div><dt>Начало ноября</dt><dd>01 ноя · 00:00</dd></div>' +
      '<div><dt>Та же граница в UTC</dt><dd>31 окт · 19:00</dd></div></dl>' +
      '<p>PAY-088 поступил через 2 часа 15 минут после закрытия октября. По политике компании этот платёж относится к ноябрю.</p></div>'));
    showTime();
  };
})();
