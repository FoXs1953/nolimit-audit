// Runs on the browser matrix in GitHub Actions with a disposable journal.
const assert = require('node:assert/strict');
const {chromium,webkit} = require('playwright');
const {personalDay} = require('./personal-day-fixture.cjs');

const engine = process.env.ENGINE || 'chromium';
const base = new URL(process.argv[2] || 'http://127.0.0.1:8000/');
const weekStart = '2024-03-25';
const weekEnd = '2024-03-31';
const quickDate = '2024-03-28';
const nextWeek = '2024-04-01';
const song = 'https://www.youtube.com/watch?v=M7lc1UVf-VE';

function audioFile() {
  const rate = 8000;
  const dataSize = rate*2*2;
  const buffer = Buffer.alloc(44+dataSize);
  buffer.write('RIFF',0);
  buffer.writeUInt32LE(buffer.length-8,4);
  buffer.write('WAVEfmt ',8);
  buffer.writeUInt32LE(16,16);
  buffer.writeUInt16LE(1,20);
  buffer.writeUInt16LE(1,22);
  buffer.writeUInt32LE(rate,24);
  buffer.writeUInt32LE(2*rate,28);
  buffer.writeUInt16LE(2,32);
  buffer.writeUInt16LE(16,34);
  buffer.write('data',36);
  buffer.writeUInt32LE(dataSize,40);
  return {name:'Своя мелодия.wav',mimeType:'audio/wav',buffer};
}

async function seedJournal(page) {
  const cover = personalDay().photos[0];
  const ready = (id,date,title)=>personalDay({
    id,date,titleOverride:title,text:title+'. Подробности сохранённого дня.',
    photos:[cover]
  });
  const rows = [
    {...ready('memory-start',weekStart,'Первый день недели'),music:{kind:'link',name:'Трек понедельника',url:song}},
    {...ready('memory-copy',weekStart,'Отдельная версия понедельника'),music:{kind:'link',name:'Трек копии',url:song}},
    {...ready('memory-end',weekEnd,'Последний день недели'),pendingEdit:{status:'draft',text:'Несохранённый текст воскресенья'}},
    ready('memory-april',nextWeek,'Первый день апреля')
  ];
  return page.evaluate(async ({rows,quickDate,wav})=>{
    const {appendDayMoment,saveDay} = await import('./diary/store.js');
    for (const day of rows) {
      if (day.id==='memory-end') day.music = {
        kind:'file',name:'Трек воскресенья',blob:new Blob([Uint8Array.from(atob(wav),byte=>byte.charCodeAt(0))],{type:'audio/wav'})
      };
      const saved = await saveDay(day);
      if (day.id==='memory-copy' && saved.primary!==false) throw new Error('The separate version must be secondary');
    }
    for (const [id,date,text] of [
      ['memory-march','2024-03-01','Записка начала месяца'],
      ['memory-note',quickDate,'Записка о прогулке']
    ]) {
      await appendDayMoment({id,date,status:'draft'},{id:id+'-note',text,time:date+'T12:00:00.000Z'});
    }
    await saveDay({id:'memory-draft',date:'2024-03-27',status:'draft',text:'Текст черновика без заметок'});
  },{rows,quickDate,wav:audioFile().buffer.toString('base64')});
}

async function verifyMobileDock(page) {
  const bounds = await page.locator('#dock').evaluate(dock=>{
    const outer = dock.getBoundingClientRect();
    const labelsFit = Array.from(dock.querySelectorAll('button')).every(button=>{
      const item = button.getBoundingClientRect();
      const label = button.querySelector('span').getBoundingClientRect();
      return label.left>=item.left-1 && label.right<=item.right+1;
    });
    return {left:outer.left,right:outer.right,labelsFit,width:document.documentElement.scrollWidth};
  });
  assert.ok(bounds.labelsFit && bounds.left>=0 && bounds.right<=320 && bounds.width<=320,
    'All dock labels and the page fit a 320px viewport');
}

async function main() {
  assert.ok(['chromium','webkit'].includes(engine),'Use ENGINE=chromium or ENGINE=webkit');
  const options = engine==='chromium' && process.env.CHROME_CHANNEL ? {channel:process.env.CHROME_CHANNEL} : {};
  const browser = await (engine==='webkit'?webkit:chromium).launch(options);
  try {
    const context = await browser.newContext({viewport:{width:320,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
    const page = await context.newPage();
    const errors = [], external = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const url = new URL(route.request().url());
      if (url.origin===base.origin || ['blob:','data:'].includes(url.protocol)) return route.continue();
      external.push(url.href);
      return route.abort();
    });
    const dock = route=>page.locator('#dock [data-route="'+route+'"]');
    const mode = name=>page.locator('[data-memory-mode="'+name+'"]');
    const step = direction=>page.locator('[data-period-step="'+direction+'"]');
    const view = key=>page.locator('[data-memory-viewer="'+key+'"]');
    const watch = page.locator('[data-memory-watch]');
    const days = page.locator('[data-memory-day] time');
    const soundtrack = page.locator('#memory-source');
    const track = page.locator('[data-memory-track]');
    const start = page.locator('.memory-dates [name="first"]');
    const end = page.locator('.memory-dates [name="last"]');
    const remember = async () => {
      await page.evaluate(async () => {
        const {loadMemoryPreferences} = await import('./diary/memories-data.js');
        await loadMemoryPreferences();
      });
    };
    async function assertDays(expected) {
      await page.waitForFunction(count=>document.querySelectorAll('[data-memory-day]').length===count,expected.length);
      assert.deepEqual(await days.evaluateAll(items=>items.map(time=>time.dateTime)),expected);
    }
    async function applyDates(first,last) {
      await start.fill(first);
      await end.fill(last);
      await page.locator('.memory-dates [type="submit"]').click();
    }
    async function closeViewer() {
      await view('close').click();
      await page.waitForFunction(()=>!document.querySelector('.memory-viewer')?.open && !history.state?.memoryViewer);
    }

    await page.goto(base.href);
    await dock('memories').click();
    await page.getByRole('heading',{name:'Воспоминания',exact:true}).waitFor();
    await page.getByRole('heading',{name:'Здесь появятся твои воспоминания',exact:true}).waitFor();
    assert.equal(await soundtrack.isVisible(),false);
    assert.equal(await dock('memories').getAttribute('aria-current'),'page');
    await verifyMobileDock(page);
    await page.locator('[data-memory-empty]').click();
    await page.waitForURL('**/#edit/*');
    await dock('today').click();
    await page.waitForURL('**/#today');

    await seedJournal(page);
    await dock('memories').click();
    await assertDays([nextWeek]);
    assert.equal(await mode('week').getAttribute('aria-pressed'),'true');
    await step(-1).click();
    const expectedWeek = [weekStart,quickDate,weekEnd];
    await assertDays(expectedWeek);
    assert.equal(await page.getByText('Отдельная версия понедельника',{exact:true}).count(),0);
    assert.equal(await page.getByText('Текст черновика без заметок',{exact:true}).count(),0);
    assert.equal(await track.textContent(),'Трек воскресенья','The automatic selection favours the uploaded track');
    await mode('month').click();
    await assertDays(['2024-03-01',...expectedWeek]);
    await step(1).click();
    await assertDays([nextWeek]);
    await step(1).click();
    await page.getByRole('heading',{name:'За эти даты записей нет',exact:true}).waitFor();
    await page.locator('[data-memory-empty]').click();
    await assertDays([nextWeek]);

    await mode('custom').click();
    await applyDates(weekEnd,weekStart);
    await page.locator('.memory-dates [role="alert"]').waitFor();
    assert.equal(await end.getAttribute('aria-invalid'),'true');
    await assertDays([nextWeek]);
    await applyDates(quickDate,quickDate);
    await assertDays([quickDate]);
    assert.equal(await track.textContent(),'В этом периоде нет сохранённой музыки.');
    await watch.click();
    await view('day').getByText('Записка о прогулке',{exact:true}).waitFor();
    assert.equal(await view('next').isVisible(),false,'Single-day selections hide paging');
    await closeViewer();
    await applyDates(weekStart,weekEnd);
    await assertDays(expectedWeek);

    await watch.focus();
    await watch.click();
    const viewer = page.locator('.memory-viewer:modal');
    await viewer.waitFor();
    assert.equal(await view('prev').isDisabled(),true);
    assert.equal(await view('progress').textContent(),'1 из 3');
    assert.equal(await view('audio').evaluate(audio=>audio.controls && audio.paused),true);
    await view('slideshow').click();
    await view('progress').filter({hasText:'2 из 3'}).waitFor({timeout:15000});
    await view('slideshow').click();
    await view('day').getByText('Записка о прогулке',{exact:true}).waitFor();
    await view('next').click();
    assert.equal(await view('next').isDisabled(),true);
    assert.equal(await view('progress').textContent(),'3 из 3');
    assert.equal(await viewer.getByText('Несохранённый текст воскресенья',{exact:true}).count(),0);
    await view('prev').click();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await view('progress').textContent(),'1 из 3');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.memory-viewer')?.open && !history.state?.memoryViewer);
    await page.waitForFunction(()=>document.activeElement.matches('[data-memory-watch]'));

    await soundtrack.selectOption('day:memory-start');
    assert.equal(await track.textContent(),'Трек понедельника');
    await soundtrack.selectOption('link');
    const url = page.locator('.memory-track-form input');
    const saveLink = page.locator('.memory-track-form button');
    await url.fill('https://example.invalid/not-a-song');
    await saveLink.click();
    await page.locator('.memory-track-form [role="alert"]').waitFor();
    await url.fill('https://youtu.be/M7lc1UVf-VE');
    await saveLink.click();
    assert.equal(await track.textContent(),'Трек по ссылке');
    await watch.click();
    assert.equal(await view('source').getAttribute('href'),song);
    assert.equal(await viewer.locator('iframe').count(),0);
    assert.deepEqual(external,[],'No music host is contacted before loading the player');
    await Promise.all([
      page.waitForRequest(request=>request.url().startsWith('https://www.youtube.com/')),
      view('load-player').click()
    ]);
    await view('music-status').filter({hasText:'Трек не удалось воспроизвести.'}).waitFor();
    assert.equal(await view('source').getAttribute('href'),song,'An unavailable embed keeps its source link');
    await closeViewer();

    await soundtrack.selectOption('file');
    await page.locator('[data-memory-input] [type="file"]').setInputFiles(audioFile());
    await track.filter({hasText:'Своя мелодия'}).waitFor({timeout:15000});
    await remember();
    await page.reload();
    await assertDays(expectedWeek);
    assert.equal(await soundtrack.inputValue(),'file');
    assert.equal(await track.textContent(),'Своя мелодия');
    assert.equal(await start.inputValue(),weekStart);
    assert.equal(await end.inputValue(),weekEnd);
    await page.getByRole('button',{name:'English',exact:true}).click();
    await page.getByRole('heading',{name:'Memories',exact:true}).waitFor();
    await assertDays(expectedWeek);
    assert.equal(await track.textContent(),'Своя мелодия');
    await verifyMobileDock(page);
    await page.getByRole('button',{name:'Қазақша',exact:true}).click();
    await page.getByRole('heading',{name:'Естеліктер',exact:true}).waitFor();
    await assertDays(expectedWeek);
    await verifyMobileDock(page);

    await page.locator('[data-memory-day="2"]').click();
    assert.equal(await view('audio').getAttribute('aria-label'),'Своя мелодия');
    const metadata = await view('audio').evaluate(async audio=>{
      audio.preload = 'metadata';
      audio.load();
      if (!audio.readyState) await new Promise((resolve,reject)=>{
        const timer = setTimeout(()=>reject(new Error('Audio metadata timed out')),5000);
        audio.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve();},{once:true});
        audio.addEventListener('error',()=>{clearTimeout(timer);reject(audio.error);},{once:true});
      });
      return {duration:audio.duration,paused:audio.paused};
    });
    assert.deepEqual(metadata,{duration:2,paused:true});
    await view('open-day').click();
    await page.waitForURL('**/#day/memory-end');
    await page.goBack();
    await assertDays(expectedWeek);
    await soundtrack.selectOption('none');
    await watch.click();
    assert.equal(await view('audio').count(),0);
    assert.equal(await view('source').count(),0);
    await closeViewer();

    assert.deepEqual(errors,[],'The memory controls produce no uncaught errors');
    console.log(engine+': memory dates, entry versions, navigation, soundtracks, persistence and mobile controls verified');
  } finally {
    await browser.close();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
