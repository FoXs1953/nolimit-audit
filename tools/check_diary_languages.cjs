// A fresh journal for each run, including when testing the published site.
const assert = require('node:assert/strict');
const path = require('node:path');
const playwright = require('playwright');
const base = new URL(process.argv[2] || 'http://127.0.0.1:8000/');
const engine = process.env.ENGINE || 'chromium';
const languageNames = {ru:'Русский', kk:'Қазақша', en:'English'};
const titles = {ru:'Солнце осталось в листьях', kk:'Күннің нұры жапырақта қалды', en:'Sunlight lingered in the leaves'};
const story = 'Жылы жаңбыр терезеге тиді. A friend touched the glass. Я запомню этот вечер.';
const song = 'My song · Самал';
const songUrl = 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl';

async function language(page, code) {
  const choice = page.getByRole('button',{name:languageNames[code],exact:true});
  await choice.focus();
  await choice.press('Enter');
  await page.waitForFunction(lang => document.documentElement.lang===lang,code);
  assert.equal(await choice.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#language-switch [aria-pressed="true"]').count(),1);
}

async function verifyPhoneHeader(page) {
  const fits = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.phone-brand,#language-switch button,#about')]
      .map(el => el.getBoundingClientRect()).filter(rect => rect.width !== 0);
    return boxes.every((box,i) => box.left >= 0 && box.right <= innerWidth &&
      (!i || box.left >= boxes[i-1].right - 1)) && document.documentElement.scrollWidth <= innerWidth;
  });
  assert.ok(fits,'Brand and all language controls fit without overlapping at '+page.viewportSize().width+'px');
}

async function closeDialog(page) {
  await page.locator('#sheet-close').click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
}

async function sampleDays(page) {
  await page.locator('#dock [data-route="examples"]').click();
  for(const lang of ['ru','kk','en']){
    await language(page,lang);
    const first = page.locator('[data-id="demo-leaves"]');
    await first.getByText(titles[lang],{exact:true}).waitFor();
    assert.equal(await page.locator('[data-id]').count(),5);
    await verifyPhoneHeader(page);
  }
  await page.locator('[data-id="demo-leaves"]').click();
  const viewer = page.locator('[data-card="viewer"]');
  await page.getByRole('button',{name:'Play postcard',exact:true}).click();
  await viewer.getByRole('button',{name:'Next photo',exact:true}).click();
  await page.locator('[data-card="close"]').click();
  await viewer.waitFor({state:'hidden'});
  await language(page,'kk');
  await page.locator('[data-card="hero-play"]').click();
  await viewer.getByText('2 / 3',{exact:true}).waitFor();
  await page.locator('[data-card="close"]').click();
  await viewer.waitFor({state:'hidden'});
  await page.getByRole('heading',{name:titles.kk,exact:true}).waitFor();
  assert.match(await page.locator('#page-sub').innerText(),/17 қыркүйек/);
  assert.equal(await page.locator('[data-card="explain"]').count(),0);
  await page.locator('[data-card="read"]').click();
  assert.equal(await page.locator('#sheet-close').getAttribute('aria-label'),'Жабу');
  await closeDialog(page);
  await page.reload();
  await page.getByRole('heading',{name:titles.kk,exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'),'kk');
}

async function createLinkedDay(page) {
  await page.locator('#dock [data-route="today"]').click();
  await page.locator('[data-action="moment"]').click();
  const note = page.getByRole('textbox',{name:'Есіңде не қалды?'});
  await page.getByRole('button',{name:'Күнге қосу',exact:true}).click();
  assert.equal(await note.evaluate(el=>el.validationMessage),'Кемінде бір сөз жаз.');
  await note.fill(story);
  await page.getByRole('button',{name:'Күнге қосу',exact:true}).click();
  await page.getByRole('button',{name:'Жазбаны жалғастыру',exact:true}).click();
  const editorURL = page.url();
  await language(page,'en');
  const dayText=page.getByRole('textbox',{name:'Your day',exact:true});
  const save=page.getByRole('button',{name:'Save postcard',exact:true});
  assert.equal(await dayText.inputValue(),story);
  assert.equal(page.url(),editorURL);
  assert.equal(await save.count(),1);
  await dayText.fill('');
  await save.click();
  await page.getByText('Write at least one line about your day.',{exact:true}).waitFor();
  assert.equal(await dayText.getAttribute('aria-invalid'),'true');
  assert.equal(await dayText.evaluate(el=>document.activeElement===el),true);
  await dayText.fill(story);
  await save.click();
  await page.getByText('Add at least one photo.',{exact:true}).waitFor();
  await page.locator('[data-ed-photos]').setInputFiles(path.join(__dirname,'../dist/diary/media/river.jpg'));
  await page.locator('[data-ed-select]').waitFor();
  await page.getByRole('button',{name:'Link',exact:true}).click();
  const link=page.getByRole('textbox',{name:'Song link',exact:true});
  await link.fill('https://www.youtube.com/watch?v=');
  await save.click();
  await page.getByText('Add a song or video link.',{exact:true}).waitFor();
  assert.equal(await link.getAttribute('aria-invalid'),'true');
  assert.equal(await link.evaluate(el=>document.activeElement===el),true);
  await link.fill(songUrl);
  await page.getByRole('textbox',{name:'Song title (optional)',exact:true}).fill(song);
  assert.equal(await page.locator('[data-ed-energy],[data-ed-why],[data-ed-preview]').count(),0);
  await language(page,'ru');
  const saveInRussian=page.getByRole('button',{name:'Сохранить открытку',exact:true});
  await saveInRussian.evaluate(button=>{button.click();button.click();});
  await page.waitForURL(/#day\//);
  assert.equal(new URL(page.url()).hash,new URL(editorURL).hash.replace('#edit/','#day/'));
  const ids=await page.evaluate(async()=>{
    const {listDays}=await import('./diary/store.js');
    return (await listDays()).map(day=>day.id);
  });
  assert.deepEqual(ids,[new URL(page.url()).hash.split('/')[1]],'Two save taps produce one saved day');
  const savedTitle = 'Жылы жаңбыр терезеге тиді';
  await page.getByRole('heading',{name:savedTitle,exact:true}).waitFor();
  await language(page,'en');
  await page.getByRole('heading',{name:savedTitle,exact:true}).waitFor();
  await page.locator('[data-card="hero-play"]').click();
  const playback=page.locator('[data-card="viewer"]');
  assert.equal(await playback.locator('a[href="'+songUrl+'"]').getAttribute('href'),songUrl);
  await playback.getByText(song,{exact:true}).first().waitFor();
  await playback.locator('[data-card="close"]').click();
  await playback.waitFor({state:'hidden'});
  await page.locator('[data-card="read"]').click();
  await page.getByRole('dialog').getByText(story,{exact:true}).first().waitFor();
  await closeDialog(page);
  await page.locator('#dock [data-route="archive"]').click();
  await page.getByRole('searchbox',{name:'Search archive'}).fill('жаңбыр');
  await language(page,'kk');
  assert.equal(await page.getByRole('searchbox',{name:'Мұрағаттан іздеу'}).inputValue(),'жаңбыр');
  await page.getByText(savedTitle,{exact:true}).click();
  await page.getByRole('heading',{name:savedTitle,exact:true}).waitFor();
  await page.locator('#dock [data-route="settings"]').click();
  await language(page,'en');
  await page.getByRole('switch',{name:'Reduce motion',exact:true}).waitFor();
  await page.reload();
  await page.getByRole('switch',{name:'Reduce motion',exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
}

// A second tab receives its own version when both edit the same saved day.
async function concurrentEditors(browser) {
  const context = await browser.newContext({viewport:{width:390,height:844}});
  try {
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto(base.href);
    await first.getByRole('button',{name:'Записать день',exact:true}).click();
    const storyField = page => page.getByRole('textbox',{name:'Текст дня',exact:true});
    const saved = page => page.getByText('Сохранено на устройстве',{exact:true}).waitFor();
    await storyField(first).fill('Первая общая строка');
    await saved(first);
    const original = first.url();
    await second.goto(original);
    await storyField(second).waitFor();
    await storyField(first).fill('Версия у первого автора');
    await saved(first);
    const own = 'Жазбаның екінші нұсқасы';
    await storyField(second).fill(own);
    await saved(second);
    const fork = second.url();
    assert.notEqual(fork,original,'The second tab follows its own saved version');
    await language(second,'kk');
    assert.equal(await second.getByRole('textbox',{name:'Бүгінгі жазба',exact:true}).inputValue(),own);
    await second.reload();
    assert.equal(await second.getByRole('textbox',{name:'Бүгінгі жазба',exact:true}).inputValue(),own);
    assert.equal(second.url(),fork);
    assert.equal(await storyField(first).inputValue(),'Версия у первого автора');
  } finally {await context.close();}
}

(async()=>{
  const options = engine==='chromium' && process.env.CHROME_CHANNEL ? {channel:process.env.CHROME_CHANNEL} : {};
  const browser = await playwright[engine].launch(options);
  try {
    const page = await browser.newPage({viewport:{width:320,height:760}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.setDefaultTimeout(10000);
    await page.goto(base.href);
    await page.getByRole('button',{name:'Записать день',exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),'ru');
    await sampleDays(page);
    await page.setViewportSize({width:390,height:844});
    await createLinkedDay(page);
    await verifyPhoneHeader(page);
    await concurrentEditors(browser);
    assert.deepEqual(errors,[]);
    console.log(engine+': language switch, mobile header, 5 samples, saved frames, song link, private text, archive, validation and reload verified');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
