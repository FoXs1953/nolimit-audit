(() => {
  const A = window.A;
  const {demo, period} = window.AuditRelease;
  const visible = Object.values(demo.sources);
  const money = (minor, currency) => new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2
  }).format(minor / 100);
  const byId = (a,b) => a[0].localeCompare(b[0]);
  function folder(id, label, icon, rows) {
    const word = id === 'ledger' ? ['запись','записи','записей'] : ['документ','документа','документов'];
    const count = new Intl.PluralRules('ru').select(rows.length);
    return {id, label, icon, records: rows.sort(byId), count: rows.length + ' ' + word[count === 'one' ? 0 : count === 'few' ? 1 : 2]};
  }
  const folders = [
    folder('invoices', 'Счета', 'document', visible.filter(r => 'total_minor' in r)
      .map(r => [r.doc_id, 'Счёт к оплате', money(r.total_minor, r.currency), 'document'])),
    folder('payments', 'Платежи', 'wallet', visible.filter(r => 'amount_minor' in r && r.doc_id)
      .map(r => [r.doc_id, 'Платёж по счёту ' + r.invoice_refs.join(', '), money(r.amount_minor, r.currency), 'wallet'])),
    folder('ledger', 'Проводки', 'ledger', visible.filter(r => r.account === 'receivable' && r.payment_id)
      .map(r => [r.row_id, 'Распределение ' + r.payment_id, money(r.credit_minor, r.currency), 'ledger']))
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
      A.icon(folder.icon, 22) + '</i></span><span class="dp-folder-name">' + folder.label +
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
      list.innerHTML = folder.records.map(record => entry(record[3], record[0], record[1], record[2],
        'data-record="' + record[0] + '"')).join('');
      list.querySelectorAll('[data-record]').forEach(button => {
        button.addEventListener('click', () => A.doc(button.dataset.record));
      });
    }
    root.querySelectorAll('[data-folder]').forEach(button => button.addEventListener('click', () => showFolder(button.dataset.folder)));
    root.querySelector('[data-finding]').addEventListener('click', () => {
      const claim = demo.findings[0];
      const sources = claim.evidence_ids.map(id => {
        const record = demo.sources[id];
        const minor = record.total_minor ?? record.amount_minor ?? record.credit_minor ?? record.debit_minor;
        return '<div class="linkrow"><dt><button class="secondary" type="button" data-source="' + id + '">' +
          id + '</button></dt><dd>' + money(minor, record.currency) + '</dd></div>';
      }).join('');
      A.sheet('Вывод агента', '<div class="dp-sheet-body"><p>' + claim.explanation + '</p><dl>' +
        sources + '<div><dt>Расхождение</dt><dd>' + money(claim.claimed_amount_minor, claim.currency) + '</dd></div></dl></div>');
    });
    showFolder(selectedFolder);
  };

  const zoneName = period.timezone;
  const paid = new Date(period.payment.timestamp);
  const posted = new Date(period.cash.timestamp);
  const cutoff = new Date(period.period_end);
  const hour = 3600000;
  const axisStart = Math.floor(Math.min(+paid,+posted,+cutoff)/hour)*hour;
  const axisEnd = Math.ceil(Math.max(+paid,+posted,+cutoff)/hour)*hour;
  const timeEvents = [
    {id:period.cash.row_id, label:'Проводка', stamp:period.cash.timestamp, icon:'ledger'},
    {id:period.payment.doc_id, label:'Платёж', stamp:period.payment.timestamp, icon:'wallet'}
  ];
  const formatter = (date, timeZone, opts) => new Intl.DateTimeFormat('ru-RU', {timeZone,...opts}).format(date);
  function hhmm(date, zone) {
    return formatter(date, zone, {hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
  }
  function dayTime(date, zone) {
    return formatter(date,zone,{day:'2-digit',month:'short'}).replaceAll('.','')+' · '+hhmm(date,zone);
  }
  function parts(date,zone) {
    return Object.fromEntries(new Intl.DateTimeFormat('ru-RU',{timeZone:zone,day:'2-digit',month:'long',
      weekday:'long',timeZoneName:'longOffset',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
      .formatToParts(date).map(part=>[part.type,part.value]));
  }
  const offset = (display) => display.timeZoneName.replace(/^GMT|^UTC/, 'UTC').replace(/^UTC$/, 'UTC+00:00');
  function periodRecord(id) {
    const item = timeEvents.find(record => record.id === id);
    const stamp = new Date(item.stamp);
    A.sheet(item.label + ' ' + item.id, '<div class="dp-sheet-body"><p>Запись открытого эпизода о границе периода.</p>' +
      '<dl><div><dt>Время компании</dt><dd>' + dayTime(stamp,zoneName) + '</dd></div><div><dt>Время UTC</dt><dd>' + dayTime(stamp,'UTC') + '</dd></div></dl>' +
      '<p class="dp-note">Исходная отметка времени</p><code>' + item.stamp + '</code></div>');
  }

  A.views.period = function (root) {
    root.innerHTML = '<div class="dp-view dp-period"><section class="dp-calendar">' +
      '<div class="dp-calendar-top"><span class="dp-time-label">' + A.icon('calendar', 17) + ' Дата платежа</span>' +
      '<span class="dp-case-mark">' + period.payment.doc_id + '</span></div>' +
      '<div class="dp-date-face"><div><div class="dp-date-line"><strong data-day></strong><span data-month></span></div>' +
      '<p data-zone></p></div><div class="dp-time-display"><div class="dp-clock" aria-hidden="true">' +
      '<i class="dp-hour-hand"></i><i class="dp-minute-hand"></i></div><b data-hour></b></div></div>' +
      '<div class="dp-segment" role="group" aria-label="Часовой пояс"><i aria-hidden="true"></i>' +
      '<button type="button" data-local="1">Время компании</button><button type="button" data-local="0">UTC</button></div>' +
      '</section><section class="dp-panel dp-chronology"><div class="dp-heading"><h2>Закрытие периода</h2></div>' +
      '<div class="dp-timescale" role="img"><span class="dp-axis-bg"></span><i class="dp-market"></i><i class="dp-posted"></i><i class="dp-paid"></i>' +
      '<span class="dp-scale-start" data-start></span><span class="dp-scale-end" data-end></span><span class="dp-boundary" data-boundary></span></div>' +
      '<div class="dp-time-records"></div></section>' +
      '<button type="button" class="dp-evidence" data-policy><span class="dp-evidence-icon" aria-hidden="true">' +
      A.icon('calendar', 20) + '</span><span><strong>Правило периода</strong><small>Дата признания по политике компании</small></span>' +
      '<span class="dp-evidence-open" aria-hidden="true">' + A.icon('chevron', 18) + '</span></button></div>';

    function showTime() {
      const zone = displayLocal ? zoneName : 'UTC';
      const face = parts(paid,zone);
      const update = (selector, text) => { root.querySelector(selector).textContent = text; };
      update('[data-day]', face.day);
      update('[data-month]', face.month);
      update('[data-zone]', face.weekday[0].toUpperCase()+face.weekday.slice(1)+' · '+offset(face));
      update('[data-hour]', hhmm(paid,zone));
      update('[data-start]', hhmm(axisStart,zone));
      update('[data-end]', hhmm(axisEnd,zone));
      update('[data-boundary]', hhmm(cutoff,zone)+' · Закрытие');
      for (const [selector,date] of [['.dp-posted',posted],['.dp-market',cutoff],['.dp-boundary',cutoff],['.dp-paid',paid]]) {
        root.querySelector(selector).style.left = 100*(date-axisStart)/(axisEnd-axisStart)+'%';
      }
      root.querySelector('.dp-timescale').setAttribute('aria-label',
        'Проводка '+dayTime(posted,zone)+', закрытие '+dayTime(cutoff,zone)+', платёж '+dayTime(paid,zone));
      root.querySelector('.dp-clock').style.setProperty('--hour-angle', ((Number(face.hour)%12)*30+Number(face.minute)*.5)+'deg');
      root.querySelector('.dp-minute-hand').style.transform = 'rotate('+Number(face.minute)*6+'deg)';
      const segment = root.querySelector('.dp-segment');
      segment.classList.toggle('dp-utc-active', !displayLocal);
      segment.querySelectorAll('button').forEach(button => {
        button.setAttribute('aria-pressed', String((button.dataset.local === '1') === displayLocal));
      });
      const list = root.querySelector('.dp-time-records');
      list.innerHTML = timeEvents.map(event => entry(event.icon, event.label, event.id, dayTime(new Date(event.stamp), zone),
        'data-period-record="' + event.id + '"')).join('');
      list.querySelectorAll('button').forEach(button => button.addEventListener('click', () => periodRecord(button.dataset.periodRecord)));
    }
    root.querySelectorAll('[data-local]').forEach(button => {
      button.addEventListener('click', () => { displayLocal = button.dataset.local === '1'; showTime(); });
    });
    root.querySelector('[data-policy]').addEventListener('click', () => {
      const local = parts(paid,zoneName);
      const policyText = '<p>Платёж признаётся по местной дате поступления. Начало периода включительно, конец — исключительно.</p>';
      const recognized = formatter(paid,zoneName,{month:'long',year:'numeric'});
      A.sheet('Правило периода', '<div class="dp-sheet-body">'+policyText+'<dl>' +
        '<div><dt>Часовой пояс</dt><dd>'+offset(local)+'</dd></div><div><dt>Конец периода</dt><dd>'+
        dayTime(cutoff,zoneName)+'</dd></div><div><dt>Та же граница в UTC</dt><dd>'+dayTime(cutoff,'UTC')+'</dd></div></dl>'+
        '<p>'+period.payment.doc_id+' по дате поступления относится к периоду «'+recognized+'».</p>'+
        '<details><summary>Исходное правило из policy.json</summary><p>'+period.policy.period+'</p></details></div>');
    });
    showTime();
  };
})();
