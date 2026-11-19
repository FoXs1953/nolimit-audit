// Run against a local or published diary. All changes live in a disposable browser profile.
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');

async function main() {
  const origin = new URL(process.argv[2] || 'http://127.0.0.1:8000/');
  const engine = process.env.ENGINE || 'chromium';
  assert.ok(['chromium','webkit'].includes(engine), 'Use ENGINE=chromium or ENGINE=webkit');
  const launcher = engine === 'webkit' ? webkit : chromium;
  const options = {headless:true};
  if (engine === 'chromium' && process.env.CHROME_CHANNEL) options.channel = process.env.CHROME_CHANNEL;
  const browser = await launcher.launch(options);
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin.href);
    const report = await page.evaluate(async base => {
      const db = await import(new URL('diary/store.js',base).href);
      const { demos } = await import(new URL('diary/demos.js',base).href);
      function check(value, reason) { if (!value) throw new Error(reason); }
      const day = structuredClone(demos[0]);
      day.id = 'test-first';
      delete day.demo;
      const saved = await db.saveDay(day);
      check(saved.revision===1 && saved.primary,'A new date must have one primary record');
      const concurrent = structuredClone(saved);
      saved.pendingEdit = {...day,text:'Ещё один рассказ',photos:[day.photos[1]],music:day.music};
      const second = await db.saveDay(saved);
      concurrent.caption = 'Параллельная правка';
      const fork = await db.saveDay(concurrent);
      check(second.revision===2 && fork.id!==saved.id && !fork.primary,'A stale save must preserve both versions');
      const backup = await db.exportZip(await db.listDays());
      const rows = await db.inspectZip(backup);
      const main = rows.find(r=>r.id===saved.id);
      check(rows.length===2 && main.photos[0].blob instanceof Blob && main.music.blob instanceof Blob && main.pendingEdit.photos[0].blob instanceof Blob,'Export must include original media and pending edits');
      check((await db.assessImport(rows)).skipped===2,'Preview must detect an unchanged backup');
      const existing = await db.importDays(rows);
      check(existing.added===0 && existing.skipped===2,'Repeat import must skip duplicates');

      await db.makePrimary(fork.id);
      check((await db.getDay(fork.id)).primary && !(await db.getDay(saved.id)).primary,'Switching primary updates both records');
      await db.removeDay(fork.id);
      check((await db.getDay(saved.id)).primary,'Deleting a primary promotes the remaining record');
      await db.removeDay(saved.id);
      check((await db.listDays()).length===0,'Deleted records must disappear');
      const restored = await db.importDays(rows);
      check(restored.added===2 && (await db.getDay(saved.id)).primary,'Restore must keep the designated primary');

      const changed=await db.getDay(saved.id);
      changed.text='Ручная локальная правка';
      await db.saveDay(changed);
      check((await db.importDays(rows)).added===1 && (await db.importDays(rows)).added===0,'Conflicting imports must preserve data once');
      const before=(await db.listDays()).length;
      const damaged=new Uint8Array(await backup.arrayBuffer());
      damaged[120]^=32;
      let rejected=false;
      try { await db.inspectZip(new Blob([damaged])); } catch { rejected=true; }
      check(rejected && (await db.listDays()).length===before,'A damaged archive must leave saved records intact');
      const link=await db.saveDay({id:'test-link',date:'2026-11-20',status:'draft',music:{kind:'link',name:'Песня',url:'https://music.apple.com/'}});
      const moment=await db.saveDay({id:'test-moment',date:'2026-11-21',moments:[{id:'n',text:'Запах дождя',time:new Date().toISOString()}]});
      const drafts=await db.inspectZip(await db.exportZip([moment,link]));
      check(drafts.find(r=>r.id===moment.id).moments[0].text==='Запах дождя','An unfinished moment must survive export');
      check(drafts.find(r=>r.id===link.id).music.url===link.music.url,'A music link must survive export');
      return 'versions, photos, audio, pending edits, backup preview, ZIP restore, duplicate import, corruption, drafts';
    },origin.href);
    console.log(engine + ': ' + report + ' OK');
  } finally {
    await browser.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
