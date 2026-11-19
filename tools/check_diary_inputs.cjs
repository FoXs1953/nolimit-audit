// Verify the contribution of each input through the editor and the saved postcard.
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright');
const origin = new URL(process.argv[2] || 'http://127.0.0.1:8000/');
const engine = process.env.ENGINE || 'chromium';

async function solidPhoto(page, color) {
  const data = await page.evaluate(fill => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = fill;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, color);
  return {name:'frame.png', mimeType:'image/png', buffer:Buffer.from(data, 'base64')};
}

function clickTrack(bpm) {
  const rate = 12000, samples = 14 * rate;
  const wav = Buffer.alloc(44 + 2 * samples);
  // Mono, signed 16-bit PCM. Each beat is a short decaying sine wave.
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const elapsed = (i / rate) % (60 / bpm);
    const amplitude = 26000 * Math.exp(-60 * elapsed) * Math.sin(2 * Math.PI * 440 * elapsed);
    wav.writeInt16LE(Math.round(amplitude), 44 + 2 * i);
  }
  // Identical filenames across inputs keep filenames from conveying tempo or colour.
  return {name:'recording.wav', mimeType:'audio/wav', buffer:wav};
}

async function uploadTempo(page, bpm) {
  await page.locator('[data-ed-music]').setInputFiles(clickTrack(bpm));
  await page.getByText('Темп · ' + bpm + ' уд/мин', {exact:true}).waitFor();
}

async function saveAndReadCard(page) {
  await page.getByRole('button', {name:'Сохранить открытку', exact:true}).click();
  await page.waitForURL(/#day\//);
  return page.locator('.diary-card').evaluate(card => ({
    color:card.style.getPropertyValue('--day-paper'),
    duration:parseFloat(card.style.getPropertyValue('--day-duration')),
    motion:card.dataset.motion
  }));
}

(async () => {
  assert.ok(['chromium','webkit'].includes(engine), 'Unsupported ENGINE');
  const launch = {headless:true};
  if (engine === 'chromium' && process.env.CHROME_CHANNEL) launch.channel = process.env.CHROME_CHANNEL;
  const browser = await (engine === 'webkit' ? webkit : chromium).launch(launch);
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin.href);
    await page.getByRole('button', {name:'Записать день', exact:true}).click();
    const story = page.getByRole('textbox', {name:'Текст дня'});
    await story.fill('A quiet moon over the still lake.');
    const mood = page.locator('[data-ed-scene]');
    assert.equal(await mood.innerText(), 'Тихое');

    const colors = ['#c87a34', '#36739c'];
    const photos = await Promise.all(colors.map(color => solidPhoto(page, color)));
    await page.locator('[data-ed-photos]').setInputFiles(photos);
    await page.getByText('2 / 6', {exact:true}).waitFor();
    const wash = () => page.locator('[data-ed-mini]').evaluate(el => el.style.getPropertyValue('--ed-wash'));
    assert.equal(await wash(), colors[0]);
    await uploadTempo(page, 75);
    const first = await saveAndReadCard(page);
    assert.equal(first.color, colors[0]);

    await page.getByRole('button', {name:'Изменить день', exact:true}).click();
    await story.fill('We dance with joy and laugh together.');
    assert.equal(await mood.innerText(), 'Радостное');
    assert.equal(await wash(), colors[0], 'Changing the words keeps the photo colour');
    await page.locator('[data-ed-select="1"]').click();
    await page.getByRole('button', {name:'На обложку', exact:true}).click();
    assert.equal(await wash(), colors[1]);
    assert.equal(await mood.innerText(), 'Радостное', 'Changing the cover keeps the story mood');
    await uploadTempo(page, 125);
    const second = await saveAndReadCard(page);
    assert.equal(second.color, colors[1]);
    assert.notEqual(second.motion, first.motion, 'The story changes the published motion treatment');
    assert.ok(first.duration > second.duration && second.duration > 0, 'The faster recording advances frames sooner');
    assert.deepEqual(errors, []);
    console.log(engine + ': text changed motion ' + first.motion + ' → ' + second.motion +
      ', cover changed colour ' + first.color + ' → ' + second.color +
      ', measured 75 → 125 BPM changed frame interval ' + first.duration + ' → ' + second.duration + ' ms');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
