// Exercise the public UI only, with a fresh Playwright profile. No existing diary is modified.
const {chromium,webkit} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const origin = new URL(process.argv[2] || 'http://127.0.0.1:8000/');
const engine = process.env.ENGINE || 'chromium';
const firstDay = 'Тёплый дождь у тихого озера';
const revised = 'Вечер под тёплым дождём';
const note = 'В камышах звенели капли.';
const media = path.join(__dirname,'../dist/diary/media');
const by = (page,name,exact=true) => page.getByRole('button',{name,exact});
const main = page => page.getByRole('main');

function makeTone() {
  const rate=12000, samples=rate*5, size=samples*2;
  const wav=Buffer.alloc(44+size);
  wav.write('RIFF',0);wav.writeUInt32LE(36+size,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);
  wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(size,40);
  for(let n=0;n<samples;n++) wav.writeInt16LE(Math.round(3600*Math.sin(n*2*Math.PI*220/rate)),44+n*2);
  return {name:'Звон воды.wav',mimeType:'audio/wav',buffer:wav};
}
async function chooseFile(page,label,files) {
  const selection=page.waitForEvent('filechooser');
  await by(main(page),label,typeof label==='string').click();
  await (await selection).setFiles(files);
}
async function gotoPage(page,section) {
  const mobile=page.getByRole('navigation',{name:'Основная навигация'});
  const nav=await mobile.isVisible()?mobile:page.getByRole('navigation',{name:'Разделы дневника'});
  const labels={
    today:['Сегодня','Мой дневник'],archive:['Мои дни','Мои дни'],examples:['Примеры','Примеры дней'],settings:['Настройки','Настройки']
  };
  await by(nav,labels[section][await mobile.isVisible()?0:1]).click();
  await page.waitForURL('**/#'+section);
}
async function layout(page) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'No horizontal clipping at '+page.viewportSize().width+'px');
}
async function closeSheet(page) {
  const dialog=page.getByRole('dialog');
  await by(dialog,'Закрыть').click();
  await dialog.waitFor({state:'hidden'});
}
async function ready(page) {
  await page.goto(new URL('#audit',origin).href);
  await page.getByRole('heading',{name:'Мой дневник',exact:true}).waitFor();
  await by(main(page),'Записать день').waitFor();
  assert.equal(new URL(page.url()).hash,'#today');
}
async function saveCard(page) {
  await by(main(page),'Сохранить открытку').click();
  await page.waitForURL(/#day\//);
  await by(main(page),'Оживить открытку').waitFor();
}
async function restore(page,zip) {
  await gotoPage(page,'settings');
  await chooseFile(page,/^Восстановить из файла/,zip);
  const dialog=page.getByRole('dialog',{name:'Восстановить дневник'});
  await dialog.waitFor();
  return dialog;
}
async function search(page,query) {
  const field=page.getByRole('searchbox');
  await field.fill(query);
  return field;
}
function logErrors(page,errors) {
  page.setDefaultTimeout(7000);
  page.on('pageerror',e=>errors.push(e.message));
}
async function journey(browser,dir,errors) {
  const ctx=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  try {
    const page=await ctx.newPage();logErrors(page,errors);
    await ready(page);await layout(page);
    await by(main(page),/^Добавить заметку/,false).click();
    await page.getByRole('textbox',{name:'Что запомнилось?'}).fill(note);
    await by(page.getByRole('dialog'),'Сохранить заметку').click();
    await by(main(page),'Продолжить запись').waitFor();await page.reload();
    await by(main(page),'Продолжить запись').click();
    const story=page.getByRole('textbox',{name:'Текст дня'});
    await story.waitFor();
    assert.equal(await story.inputValue(),note);
    await story.fill(firstDay+'. '+note+' Мы дошли до воды, когда тучи рассеялись.');
    await by(main(page),'Сохранить открытку').click();
    await page.getByText('Добавьте хотя бы одну фотографию.',{exact:true}).waitFor();
    await chooseFile(page,'Добавить фото',[path.join(media,'river.jpg'),path.join(media,'leaves.jpg')]);
    await by(main(page),'На обложку').waitFor();
    await by(main(page),'Сохранить открытку').click();
    await page.getByText('Выберите аудиофайл или добавьте ссылку на песню.',{exact:true}).waitFor();
    await by(main(page),'Ссылка').click();
    await page.getByRole('textbox',{name:'Ссылка на песню'}).fill('не адрес');
    await by(main(page),'Сохранить открытку').click();
    await page.getByText('Добавьте ссылку на песню или видео.',{exact:true}).waitFor();
    await by(main(page),'Аудиофайл').click();
    await chooseFile(page,'Выбрать аудиофайл',makeTone());
    await by(main(page),'Заменить аудиофайл').waitFor();
    await page.getByText('Сохранено на устройстве',{exact:true}).waitFor();
    await page.reload();await story.waitFor();
    assert.ok((await story.inputValue()).includes(note));
    await by(main(page),'Заменить аудиофайл').waitFor();
    assert.equal(await page.locator('[data-ed-why],[data-ed-preview]').count(),0);
    assert.equal(await by(main(page),'Сохранить открытку').count(),1);
    await layout(page);await saveCard(page);
    await page.getByRole('heading',{name:firstDay,exact:true}).waitFor();
    await by(main(page),'Оживить открытку').click();await by(page.getByRole('dialog'),'Выключить звук').click();
    await by(page.getByRole('dialog'),'Включить звук').click();
    await by(page.getByRole('dialog'),'Следующее фото').click();await page.getByRole('dialog').getByText('2 из 2',{exact:true}).waitFor();
    await by(page.getByRole('dialog'),'Предыдущее фото').click();
    assert.ok(await page.locator('[data-card="viewer-photo"]').isVisible());
    await page.goBack();await page.getByRole('dialog').waitFor({state:'hidden'});
    await by(main(page),/^Прочитать запись/,false).click();
    await page.getByRole('dialog').getByText(note,{exact:true}).waitFor();await closeSheet(page);
    await gotoPage(page,'today');
    await by(main(page),'Открыть мой день').waitFor();
    assert.match(await page.locator('[data-cover]').getAttribute('src'),/^blob:/);
    const lateNote='После заката на мосту зажглись фонари.';
    await by(main(page),'Добавить заметку').click();
    await page.getByRole('textbox',{name:'Что запомнилось?'}).fill(lateNote);
    await by(page.getByRole('dialog'),'Сохранить заметку').click();
    await page.locator('.latest-note').getByText(lateNote,{exact:true}).waitFor();
    await by(main(page),'Открыть мой день').click();
    await page.reload();
    const cardNotes=page.locator('.diary-card > .day-notes');
    for (const expected of [note,lateNote]) {
      await cardNotes.getByText(expected,{exact:true}).waitFor();
    }
    await by(main(page),'Оживить открытку').click();
    await page.getByRole('dialog').locator('.day-notes').getByText(lateNote,{exact:true}).waitFor();
    await by(page.getByRole('dialog'),'Закрыть').click();
    await page.getByRole('dialog').waitFor({state:'hidden'});

    await gotoPage(page,'archive');
    await search(page,lateNote);
    await page.locator('.personal-card .day-note-excerpt').filter({hasText:lateNote}).waitFor();
    await search(page,'камышах');
    const found=by(main(page),new RegExp(firstDay),false);await found.waitFor();
    await search(page,'такой записи здесь нет');await by(main(page),'Сбросить поиск').click();await found.click();
    await by(main(page),'Изменить день').click();
    await page.getByText('Настроить оформление',{exact:true}).click();
    await page.getByRole('textbox',{name:'Название папки'}).fill(revised);
    await saveCard(page);await page.getByRole('heading',{name:revised,exact:true}).waitFor();
    await by(main(page),'Действия с папкой').click();
    await by(page.getByRole('dialog'),'Удалить день').click();
    await by(page.getByRole('dialog'),'Отмена').click();await page.getByRole('dialog').waitFor({state:'hidden'});
    await by(main(page),'Действия с папкой').click();
    await by(page.getByRole('dialog'),'Удалить день').click();
    await by(page.getByRole('dialog',{name:'Удалить день?'}),'Удалить день').click();
    await by(page,'Вернуть').click();
    await by(main(page),new RegExp(revised),false).waitFor();
    await gotoPage(page,'settings');
    const motion=page.getByRole('switch',{name:'Уменьшить движение'});
    await motion.check();await page.reload();await motion.waitFor();assert.equal(await motion.isChecked(),true);
    const downloaded=page.waitForEvent('download');
    await by(main(page),/^Скачать копию/,false).click();
    const zip=path.join(dir,'personal-backup.zip');await (await downloaded).saveAs(zip);
    const duplicate=await restore(page,zip);
    assert.equal(await duplicate.getByText('Совпадающих',{exact:true}).locator('..').getByRole('definition').innerText(),'1');
    await by(duplicate,'Отмена').click();await page.getByRole('dialog').waitFor({state:'hidden'});
    await chooseFile(page,/^Восстановить из файла/,{name:'broken.zip',mimeType:'application/zip',buffer:Buffer.from([0,1,2,3])});
    await page.getByText(/Не удалось открыть ZIP-копию/).waitFor();
    await gotoPage(page,'examples');
    await by(main(page),/Солнце осталось в листьях/,false).click();
    await by(main(page),/^Авторы материалов/,false).click();await page.getByRole('dialog').getByRole('link').first().waitFor();await closeSheet(page);
    await by(main(page),/^Попробовать на копии/,false).click();await page.waitForURL(/#edit\//);
    await gotoPage(page,'archive');
    await by(main(page),/Солнце осталось в листьях/,false).waitFor();
    await by(main(page),'Действия с черновиком').click();
    await by(page.getByRole('dialog'),'Экспортировать день').waitFor();
    await closeSheet(page);
    console.log(engine+' 390px: moment, reload, own text + photos + WAV, playback, search, edit, delete + restore, demo copy and ZIP OK');
    return zip;
  } finally {await ctx.close();}
}
async function importOnCleanDevice(browser,zip,errors) {
  const ctx=await browser.newContext({viewport:{width:820,height:1000}});
  try {
    const page=await ctx.newPage();logErrors(page,errors);await ready(page);
    const dialog=await restore(page,zip);
    assert.equal(await dialog.getByText('Будет добавлено',{exact:true}).locator('..').getByRole('definition').innerText(),'1');
    await by(dialog,'Восстановить').click();
    await by(main(page),new RegExp(revised),false).click();
    await page.getByRole('heading',{name:revised,exact:true}).waitFor();await layout(page);
    await by(main(page),'Оживить открытку').click();await by(page.getByRole('dialog'),'Выключить звук').click();
    await by(page.getByRole('dialog'),'Следующее фото').click();await page.getByRole('dialog').getByText('2 из 2',{exact:true}).waitFor();
    await page.reload();await page.getByRole('heading',{name:revised,exact:true}).waitFor();
    console.log(engine+' 820px: ZIP imported through UI, saved photos and sound available after reload');
  } finally { await ctx.close(); }
}
async function homeDeletion(browser,errors) {
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try {
    const page=await ctx.newPage();logErrors(page,errors);
    await ready(page);
    const home=main(page).locator('.home-personal');
    const pastDate='2024-03-03';
    const older='Ранним утром на реке стоял туман.';
    const middle='В полдень мы встретили цаплю.';
    const latest='Вечером туман вернулся.';
    const noteRow=text=>home.locator('li').filter({has:page.getByText(text,{exact:true})});
    const dayRow=date=>home.locator('.home-memory-row').filter({has:page.locator('time[datetime="'+date+'"]')});
    const undo=by(page,'Вернуть');
    async function addNote(text) {
      await by(home,'Добавить заметку').tap();
      const dialog=page.getByRole('dialog');
      await dialog.getByRole('textbox',{name:'Что запомнилось?'}).fill(text);
      await by(dialog,'Сохранить заметку').tap();
      await noteRow(text).waitFor();
    }
    async function showNote(text) {
      const row=noteRow(text);
      await row.waitFor({state:'attached'});
      if(!await row.isVisible()) {
        await home.locator('details').filter({has:page.getByText(text,{exact:true})}).locator('summary').tap();
      }
      await row.waitFor();
      return row;
    }
    const confirm=page.getByRole('dialog',{name:'Удалить день?'});
    async function confirmDay(date) {
      const displayedDate=await dayRow(date).locator('time').textContent();
      const displayedTitle=await dayRow(date).locator('strong').textContent();
      await by(dayRow(date),'Удалить день').tap();
      const prompt=await confirm.innerText();
      assert.ok(prompt.includes(displayedDate),'Confirmation identifies the selected date');
      assert.ok(prompt.includes(displayedTitle),'Confirmation identifies the selected title');
      await by(confirm,'Удалить день').tap();
      await undo.waitFor();
      assert.equal(new URL(page.url()).hash,'#today');
      assert.equal(await dayRow(date).count(),0);
    }

    await addNote(note);
    await by(main(page),'Продолжить запись').tap();
    const dateField=main(page).getByLabel('Дата',{exact:true});
    const today=await dateField.inputValue();
    await dateField.fill(pastDate);
    await main(page).getByRole('textbox',{name:'Текст дня'}).fill(firstDay+'.');
    await chooseFile(page,'Добавить фото',path.join(media,'river.jpg'));
    await chooseFile(page,'Выбрать аудиофайл',makeTone());
    await saveCard(page);
    await gotoPage(page,'today');
    await dayRow(pastDate).getByText(firstDay,{exact:true}).waitFor();
    for(const text of [older,middle,latest]) await addNote(text);
    await dayRow(today).waitFor();await layout(page);

    await by(await showNote(middle),'Удалить заметку').tap();
    await undo.waitFor();
    assert.equal(await noteRow(middle).count(),0);
    await showNote(older);await showNote(latest);await showNote(note);
    await undo.tap();
    await showNote(middle);
    await page.reload();
    await by(await showNote(middle),'Удалить заметку').tap();
    await undo.waitFor();await page.reload();
    await showNote(older);await showNote(latest);await showNote(note);
    assert.equal(await noteRow(middle).count(),0,'A deleted note stays deleted after reload');
    await by(await showNote(note),'Удалить заметку').tap();
    await undo.waitFor();
    assert.equal(await noteRow(note).count(),0);
    await dayRow(pastDate).getByText(firstDay,{exact:true}).waitFor();
    await showNote(older);await showNote(latest);
    await undo.tap();await showNote(note);

    await by(dayRow(pastDate),'Удалить день').tap();
    await by(confirm,'Отмена').tap();await confirm.waitFor({state:'hidden'});
    await dayRow(pastDate).waitFor();await dayRow(today).waitFor();
    await confirmDay(pastDate);
    await dayRow(today).waitFor();await showNote(latest);
    await undo.tap();
    await dayRow(pastDate).waitFor();await page.reload();
    await showNote(note);await dayRow(today).waitFor();
    await confirmDay(today);
    await dayRow(pastDate).waitFor();await page.reload();
    await by(main(page),'Записать день').waitFor();await showNote(note);
    assert.equal(await dayRow(today).count(),0);
    await gotoPage(page,'archive');
    await by(main(page),new RegExp(firstDay),false).waitFor();
    assert.equal(await main(page).locator('.personal-card').count(),1);
    console.log(engine+' 390px touch: deleted a middle note, handled both day targets, verified cancel, undo and persistence');
  } finally {await ctx.close();}
}
async function dimensions(browser,width,errors) {
  const ctx=await browser.newContext({viewport:{width,height:900}});
  try {
    const page=await ctx.newPage();logErrors(page,errors);await ready(page);await layout(page);
    await by(page,'Следующая открытка').click();await by(main(page),'Открыть открытку').click();
    await by(main(page),'Оживить открытку').waitFor();await layout(page);
    await gotoPage(page,'archive');await page.getByText('Здесь будут твои дни',{exact:true}).waitFor();await layout(page);
    await by(main(page),'Записать день').click();await by(main(page),'Добавить фото').waitFor();await layout(page);
    await gotoPage(page,'settings');await page.getByRole('switch').waitFor();await layout(page);
    await gotoPage(page,'examples');await by(main(page),/Солнце осталось в листьях/,false).waitFor();await layout(page);
    console.log(engine+' '+width+'px: home, collection, editor, archive and settings fit viewport');
  } finally {await ctx.close();}
}
(async()=>{
  assert.ok(['chromium','webkit'].includes(engine),'Unsupported ENGINE');
  const launch={headless:true};
  if(engine==='chromium' && process.env.CHROME_CHANNEL) launch.channel=process.env.CHROME_CHANNEL;
  const browser=await (engine==='webkit'?webkit:chromium).launch(launch);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nolimit-diary-test-'));
  const errors=[];
  try {
    const zip=await journey(browser,dir,errors);
    await importOnCleanDevice(browser,zip,errors);
    await homeDeletion(browser,errors);
    for (const width of [320,1360]) await dimensions(browser,width,errors);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
