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
const frameCaption = 'Свет пробивался сквозь листья.';
const frameSong = 'Шорох листвы';
const daySong = 'Звон воды';
const firstLine = firstDay+'.';
const lastLine = 'Мы дошли до воды, когда тучи рассеялись.';
const media = path.join(__dirname,'../dist/diary/media');
const by = (page,name,exact=true) => page.getByRole('button',{name,exact});
const main = page => page.getByRole('main');

function makeTone(name=daySong, seconds=5, frequency=220) {
  const rate=12000, samples=rate*seconds, size=samples*2;
  const wav=Buffer.alloc(44+size);
  wav.write('RIFF',0);wav.writeUInt32LE(36+size,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);
  wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(size,40);
  for(let n=0;n<samples;n++) wav.writeInt16LE(Math.round(3600*Math.sin(n*2*Math.PI*frequency/rate)),44+n*2);
  return {name:name+'.wav',mimeType:'audio/wav',buffer:wav};
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
    today:['Сегодня','Мой дневник'],archive:['Мои дни','Мои дни'],settings:['Настройки','Настройки']
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
    await page.addInitScript(()=>{
      const NativeAudio=window.Audio;
      window.diaryTestAudio=[];
      window.Audio=class extends NativeAudio {
        constructor(...args){super(...args);window.diaryTestAudio.push(this);}
      };
    });
    const waitForTrack=seconds=>page.waitForFunction(duration=>{
      const active=window.diaryTestAudio.filter(audio=>!audio.paused && audio.currentTime>.03);
      return active.length===1 && Math.abs(active[0].duration-duration)<.1;
    },seconds,{timeout:10000});
    const pickSecond=()=>page.locator('[data-ed-select="1"]').click();
    const photoStory=page.locator('.ed-photo-story');
    const photoCaption=photoStory.locator('[data-ed-photo-caption]');
    async function openPhotoStory() {
      if(!await photoCaption.isVisible()) await photoStory.locator('summary').click();
    }
    await ready(page);await layout(page);
    await by(main(page),/^Добавить заметку/,false).click();
    await page.getByRole('textbox',{name:'Что запомнилось?'}).fill(note);
    await by(page.getByRole('dialog'),'Сохранить заметку').click();
    await by(main(page),'Продолжить запись').waitFor();await page.reload();
    await by(main(page),'Продолжить запись').click();
    const story=page.getByRole('textbox',{name:'Текст дня'});
    await story.waitFor();
    assert.equal(await story.inputValue(),note);
    await story.fill([firstLine,note,lastLine].join(' '));
    await by(main(page),'Сохранить открытку').click();
    await page.getByText('Добавьте хотя бы одно фото или видео.',{exact:true}).waitFor();
    await chooseFile(page,'Добавить фото и видео',[path.join(media,'river.jpg'),path.join(media,'leaves.jpg'),path.join(media,'maple.jpg')]);
    await page.locator('[data-ed-select="2"]').waitFor();
    await by(main(page),'Сохранить открытку').click();
    await page.getByText('Выберите аудиофайл или добавьте ссылку на песню.',{exact:true}).waitFor();
    await by(main(page),'Ссылка').click();
    await page.getByRole('textbox',{name:'Ссылка на песню'}).fill('не адрес');
    await by(main(page),'Сохранить открытку').click();
    await page.getByText('Добавьте ссылку на песню или видео.',{exact:true}).waitFor();
    await by(main(page),'Аудиофайл').click();
    await chooseFile(page,'Выбрать аудиофайл',makeTone(daySong,16));
    await by(main(page),'Заменить аудиофайл').waitFor();
    await pickSecond();await openPhotoStory();
    await photoCaption.fill(frameCaption);
    await photoStory.locator('[data-ed-photo-music]').setInputFiles(makeTone(frameSong,7,330));
    await photoStory.getByText(frameSong,{exact:true}).waitFor();
    await page.getByText('Сохранено на устройстве',{exact:true}).waitFor();
    await page.reload();await story.waitFor();
    assert.ok((await story.inputValue()).includes(note));
    await by(main(page),'Заменить аудиофайл').waitFor();
    await pickSecond();await openPhotoStory();
    assert.equal(await photoCaption.inputValue(),frameCaption);
    await photoStory.getByText(frameSong,{exact:true}).waitFor();
    assert.equal(await page.locator('[data-ed-why],[data-ed-preview]').count(),0);
    assert.equal(await by(main(page),'Сохранить открытку').count(),1);
    await layout(page);await saveCard(page);
    await page.getByRole('heading',{name:firstDay,exact:true}).waitFor();
    await by(main(page),'Оживить открытку').click();
    const viewer=page.getByRole('dialog');
    const trackName=viewer.locator('[data-card="track-name"]');
    const runningText=viewer.locator('[data-card="story-scroll"]');
    await trackName.filter({hasText:daySong}).waitFor();
    assert.match(await runningText.textContent(),/Тёплый дождь/,'The day story starts with the first frame');
    await waitForTrack(16);
    await viewer.getByText('2 из 3',{exact:true}).waitFor();
    await trackName.filter({hasText:frameSong}).waitFor();
    assert.equal((await runningText.textContent()).trim(),frameCaption);
    await waitForTrack(7);
    await viewer.getByText('3 из 3',{exact:true}).waitFor();
    await trackName.filter({hasText:daySong}).waitFor();
    assert.match(await runningText.textContent(),/тучи рассеялись/,'The day story continues after a custom caption');
    await waitForTrack(16);
    await viewer.locator('[data-card="play"][aria-pressed="true"]').click();
    assert.ok(await page.evaluate(()=>window.diaryTestAudio.every(audio=>audio.paused)),'Pausing the postcard stops the active track');
    await by(viewer,'Выключить звук').click();
    await by(viewer,'Включить звук').click();
    await by(viewer,'Предыдущее фото').click();
    await viewer.getByText('2 из 3',{exact:true}).waitFor();
    assert.equal((await runningText.textContent()).trim(),frameCaption);
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
    const matchingDay=page.locator('.personal-card').filter({hasText:firstDay});
    await matchingDay.locator('.day-mood-tag').waitFor();
    assert.ok(!(await matchingDay.innerText()).includes(lateNote), 'Notes remain searchable without appearing on previews');
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
    await gotoPage(page,'archive');
    await by(main(page),new RegExp(revised),false).waitFor();
    assert.equal(await page.locator('[data-route="examples"],[data-example]').count(),0);
    console.log(engine+' 390px: moments, autosave, photo captions, soundtrack switching, search, editing, deletion and ZIP OK');
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
    const viewer=page.getByRole('dialog');
    await by(viewer,'Следующее фото').click();
    await viewer.getByText('2 из 3',{exact:true}).waitFor();
    assert.equal((await viewer.locator('[data-card="story-scroll"]').textContent()).trim(),frameCaption);
    await viewer.locator('[data-card="track-name"]').filter({hasText:frameSong}).waitFor();
    await page.reload();await page.getByRole('heading',{name:revised,exact:true}).waitFor();
    console.log(engine+' 820px: ZIP imported through UI, saved photos and sound available after reload');
  } finally { await ctx.close(); }
}
async function personalPreviews(browser,errors) {
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
    const preview=date=>main(page).getByRole('article').filter({has:page.locator('time[datetime="'+date+'"]')});
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
    const story=main(page).getByRole('textbox',{name:'Текст дня'});
    async function editPreview(date,expectedText) {
      await by(preview(date),'Изменить день').tap();
      await page.waitForURL(/#edit\//);
      assert.equal(await dateField.inputValue(),date);
      assert.equal(await story.inputValue(),expectedText);
      return new URL(page.url()).hash;
    }
    const today=await dateField.inputValue();
    await dateField.fill(pastDate);
    await story.fill(firstDay+'.');
    await chooseFile(page,'Добавить фото и видео',path.join(media,'river.jpg'));
    const photoStory=page.locator('.ed-photo-story');
    await photoStory.locator('summary').tap();
    await photoStory.locator('[data-ed-photo-music]').setInputFiles(makeTone(frameSong));
    await photoStory.getByText(frameSong,{exact:true}).waitFor();
    await saveCard(page);
    const savedRoute=new URL(page.url()).hash;
    await gotoPage(page,'today');
    await dayRow(pastDate).getByText(firstDay,{exact:true}).waitFor();
    for(const text of [older,middle,latest]) await addNote(text);
    await dayRow(today).waitFor();await layout(page);

    await by(dayRow(pastDate),new RegExp(firstDay),false).tap();
    await page.waitForURL('**/'+savedRoute);
    await gotoPage(page,'today');
    const savedEdit=await editPreview(pastDate,firstDay+'.');
    assert.equal(savedEdit,savedRoute.replace('#day/','#edit/'));
    const updatedStory=firstDay+'. Вода потемнела.';
    await story.fill(updatedStory);
    await saveCard(page);
    assert.equal(new URL(page.url()).hash,savedRoute);
    await gotoPage(page,'today');
    const draftEdit=await editPreview(today,older);
    assert.notEqual(draftEdit,savedEdit);
    await gotoPage(page,'archive');
    await page.reload();
    assert.equal(await editPreview(pastDate,updatedStory),savedEdit);
    await gotoPage(page,'archive');
    assert.equal(await editPreview(today,older),draftEdit);
    await gotoPage(page,'today');

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
    console.log(engine+' 390px touch: edited the selected saved day and draft from both previews, verified saved changes, deletion and undo');
  } finally {await ctx.close();}
}
async function recordGalleryClip(page,dir) {
  const clip=await page.evaluate(async engine=>{
    const types=engine==='webkit'
      ? ['video/mp4','video/webm;codecs=vp8','video/webm']
      : ['video/webm;codecs=vp8','video/webm','video/mp4'];
    const player=document.createElement('video');
    const mimeType=types.find(type=>MediaRecorder.isTypeSupported(type) && player.canPlayType(type));
    if(!mimeType)throw Error('No recordable and playable gallery format: '+types.join(', '));

    const canvas=document.createElement('canvas');
    canvas.width=160;canvas.height=120;
    const paint=canvas.getContext('2d');
    let frame=0;
    function draw(){
      paint.fillStyle='#345c42';paint.fillRect(0,0,160,120);
      paint.fillStyle='#d4e9ac';paint.fillRect((frame++*8)%144,36,16,48);
    }
    draw();
    const stream=canvas.captureStream(12);
    let recorder, animation, stop, watchdog;
    try {
      recorder=new MediaRecorder(stream,{mimeType});
      const chunks=[];
      await new Promise((resolve,reject)=>{
        recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
        recorder.onerror=event=>reject(event.error || Error('Recorder failed for '+mimeType));
        recorder.onstop=resolve;
        watchdog=setTimeout(()=>reject(Error('Timed out recording '+mimeType)),10000);
        recorder.onstart=()=>{stop=setTimeout(()=>recorder.stop(),1000);};
        recorder.start();
        animation=setInterval(draw,80);
      });
      const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());
      if(!bytes.length)throw Error('Empty gallery clip for '+mimeType);
      return {ext:mimeType.startsWith('video/mp4')?'mp4':'webm',bytes:Array.from(bytes)};
    } finally {
      clearInterval(animation);clearTimeout(stop);clearTimeout(watchdog);
      try {if(recorder && recorder.state!=='inactive')recorder.stop();}
      finally {for(const track of stream.getTracks())track.stop();}
    }
  },engine);
  const filename=path.join(dir,'gallery-clip.'+clip.ext);
  await fs.writeFile(filename,Buffer.from(clip.bytes));
  return filename;
}

async function galleryDiagnostics(page) {
  const snapshot=page.evaluate(async()=>{
    let frames=0, nextFrame;
    function tick(){frames++;nextFrame=requestAnimationFrame(tick);}
    nextFrame=requestAnimationFrame(tick);
    await new Promise(resolve=>setTimeout(resolve,250));
    cancelAnimationFrame(nextFrame);
    const controls=[...document.querySelectorAll('[data-ed-select],[data-ed-photo-op="cover"],[data-card="hero-play"],[data-card="next"]')].map(el=>{
      const {x,y,width,height}=el.getBoundingClientRect();
      const hit=document.elementFromPoint(x+width/2,y+height/2);
      return {name:el.getAttribute('aria-label') || el.textContent.trim(),role:el.getAttribute('role') || el.localName,
        rect:{x,y,width,height},disabled:el.disabled,centerTarget:hit?.localName,hitSelf:el.contains(hit)};
    });
    return {readyState:document.readyState,visibility:document.visibilityState,framesIn250ms:frames,controls,
      videos:[...document.querySelectorAll('video')].map(el=>({readyState:el.readyState,width:el.videoWidth,
        height:el.videoHeight,error:el.error?.message || el.error?.code || null})),
      alerts:[...document.querySelectorAll('[role="alert"]')].map(el=>el.textContent.trim()).filter(Boolean)};
  });
  return Promise.race([snapshot,new Promise(resolve=>setTimeout(()=>resolve('Page did not answer within 3s'),3000).unref())]);
}

async function mixedGallery(browser,dir,errors) {
  const ctx=await browser.newContext({colorScheme:'dark',viewport:{width:390,height:844}});
  let page;
  try {
    page=await ctx.newPage();logErrors(page,errors);
    await ready(page);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.locator('#theme-toggle').click();
    await page.reload();await by(main(page),'Записать день').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    await page.getByRole('textbox',{name:'Текст дня'}).fill('Зелёный свет над рекой.');
    const videoPath=await recordGalleryClip(page,dir);
    await page.locator('[data-ed-photos]').setInputFiles([path.join(media,'river.jpg'),videoPath]);
    // Video probing is asynchronous. Wait for the editor to finish its
    // metadata check before starting the separate user-interaction timeout.
    const picks=page.locator('[data-ed-select]');
    await picks.nth(1).waitFor({state:'visible',timeout:20000});
    await picks.nth(0).click();
    await picks.nth(1).click();
    assert.equal(await picks.locator('video').count(),0,'Gallery thumbnails are static');
    await page.locator('[data-ed-photo-op="cover"]').click();
    assert.equal(await page.locator('.ed-crop').count(),0);
    for (const theme of ['light','dark']) {
      if(theme==='dark')await page.locator('#theme-toggle').click();
      const actions=page.locator('[data-ed-photo-op]');
      assert.equal(await actions.count(),4);
      assert.ok(await actions.evaluateAll(buttons=>buttons.every(button=>{
        const style=getComputedStyle(button);
        return parseFloat(style.borderTopWidth)>=1 && style.borderTopStyle==='solid' &&
          style.backgroundColor!=='rgba(0, 0, 0, 0)' && button.getBoundingClientRect().height>=44;
      })),theme+' gallery actions have visible borders, fill and usable touch targets');
      assert.ok(await page.locator('[data-ed-photo-op="cover"]').isDisabled());
      await layout(page);
    }
    await chooseFile(page,'Выбрать аудиофайл',makeTone());
    await by(main(page),'Заменить аудиофайл').waitFor();
    await saveCard(page);
    await page.reload();
    await by(main(page),'Оживить открытку').click();
    const viewerVideo=page.locator('[data-card="viewer-video"]');
    await viewerVideo.waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-card="viewer-video"]')?.videoWidth>0);
    assert.ok(await viewerVideo.evaluate(el=>el.controls && el.paused));
    await viewerVideo.evaluate(el=>el.play());
    await by(page.getByRole('dialog'),'Следующий кадр').click();
    await page.locator('[data-card="viewer-photo"]').waitFor();
    assert.ok(await viewerVideo.evaluate(el=>el.paused));
    await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
    await gotoPage(page,'archive');
    await page.locator('.day-cover [data-gallery-video]').waitFor();
    assert.equal(await page.locator('.day-cover video').count(),0,'Archive covers are static');
    await layout(page);
    console.log(engine+': themes persist, mixed attachments save and play, video cover appears in the archive');
  } catch(error) {
    if(page)console.error(engine+' mixed gallery',JSON.stringify(await galleryDiagnostics(page).catch(reason=>reason.message)));
    throw error;
  } finally {await ctx.close();}
}
async function dimensions(browser,width,errors) {
  const ctx=await browser.newContext({viewport:{width,height:900}});
  try {
    const page=await ctx.newPage();logErrors(page,errors);await ready(page);await layout(page);
    assert.equal(await page.locator('[data-route="examples"],[data-example],.sample-link').count(),0);
    for (const legacy of ['#examples','#day/demo-leaves']) {
      await page.goto(new URL(legacy,origin).href);
      await page.getByRole('heading',{name:'Мой дневник',exact:true}).waitFor();
      await by(main(page),'Записать день').waitFor();
      assert.equal(await page.locator('[data-card=hero-play]').count(),0);
    }
    await gotoPage(page,'archive');await page.getByText('Здесь будут твои дни',{exact:true}).waitFor();await layout(page);
    await by(main(page),'Записать день').click();await by(main(page),'Добавить фото и видео').waitFor();await layout(page);
    await gotoPage(page,'settings');await page.getByRole('switch').waitFor();await layout(page);
    console.log(engine+' '+width+'px: home, editor, archive and settings fit viewport');
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
    await personalPreviews(browser,errors);
    await mixedGallery(browser,dir,errors);
    for (const width of [320,1360]) await dimensions(browser,width,errors);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
