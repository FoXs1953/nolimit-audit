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
      const freshDate='2026-11-26';
      const seed=id=>({id,date:freshDate,status:'draft',moments:[]});
      const note=(id,text,n)=>({id,text,time:`2026-11-26T08:00:0${n}.000Z`});
      const firstNote=note('note-a','Пока было тихо',1),secondNote=note('note-b','Шаги на лестнице',2);
      await Promise.all([db.appendDayMoment(seed('new-a'),firstNote),db.appendDayMoment(seed('new-b'),secondNote)]);
      let todayRows=(await db.listDays()).filter(item=>item.date===freshDate);
      check(todayRows.length===1 && todayRows[0].moments.length===2,'Concurrent first notes must create one draft');
      const snapshot=todayRows[0];
      const repeat=await db.appendDayMoment(seed('retry'),firstNote);
      check(repeat.moments.length===2 && repeat.revision===snapshot.revision,'A retry must be idempotent');
      check(db.visibleDayNotes(undefined).length===0 && db.visibleDayNotes(snapshot)[0].id==='note-a','Notes must be chronological and empty days supported');
      const published=await db.saveDay({...snapshot,text:'Запись автора',status:'ready',photos:day.photos,music:day.music});
      const ready=await db.appendDayMoment(seed('ready'),note('note-c','Свет изменился',3));
      check(ready.id===published.id && ready.status==='ready' && !ready.pendingEdit && ready.text===published.text &&
        ready.moments.length===3,'Appending to a published day keeps it published and leaves the story alone');
      const editing=await db.saveDay({...published,pendingEdit:{status:'draft',text:'Мой несохранённый абзац',moments:published.moments}});
      check(editing.id===published.id && editing.moments.length===3 && editing.pendingEdit.moments.length===3,'A previous editor snapshot must retain a newly committed note on the original day');
      const oldNote={text:'Старая заметка без ID',time:'2026-11-26T08:00:04.000Z'};
      const legacy={...editing,pendingEdit:{...editing.pendingEdit,moments:[...editing.moments,oldNote,oldNote]}};
      check(db.visibleDayNotes(legacy).length===4 && db.visibleDayNotes(legacy)[3].text===oldNote.text,'Pending-only legacy notes must appear once without re-saving');
      await db.saveDay(legacy);
      const updated=await db.appendDayMoment(seed('pending'),note('note-e','Последняя деталь',5));
      check(updated.text===published.text && updated.pendingEdit.text===editing.pendingEdit.text &&
        updated.moments.length===5 && updated.pendingEdit.moments.length===5,'A new note must reach both views while preserving unpublished changes');
      const roundtrip=await db.inspectZip(await db.exportZip([updated]));
      check((await db.assessImport(roundtrip)).skipped===1 && db.visibleDayNotes(roundtrip[0]).length===5,'Backup and duplicate detection must preserve appended notes');
      // Seed a historical row directly through import, which preserves a pending-only note without an ID.
      const legacyId='legacy-pending';
      await db.importDays([{...updated,id:legacyId,date:'2026-11-28',moments:[firstNote],
        pendingEdit:{...updated.pendingEdit,moments:[firstNote,oldNote,oldNote]}}]);
      const legacyEditor=await db.getDay(legacyId);
      const removed=await db.removeDayNote(legacyId,{...oldNote});
      let current=await db.getDay(legacyId);
      check(removed?.text===oldNote.text && db.visibleDayNotes(current).length===1 &&
        current.pendingEdit.moments.length===1 && current.text===updated.text &&
        current.pendingEdit.text===updated.pendingEdit.text,'Remove must find old pending notes and preserve both stories');
      check(await db.removeDayNote(legacyId,oldNote)===null,'Removing an absent note must be harmless');
      current=await db.saveDay({...legacyEditor,pendingEdit:{...legacyEditor.pendingEdit,caption:'Новое описание'}});
      check(current.moments.length===1 && current.pendingEdit.moments.length===1 &&
        current.pendingEdit.caption==='Новое описание','A stale pending edit must respect removal of a note without an ID');
      const exported=await db.exportZip([current]);
      const zipText=await exported.text();
      check(!zipText.includes(oldNote.text) && !zipText.includes('_removedNotes') && !zipText.includes('_noteSeed'),
        'Deleted text and internal metadata must stay out of the archive');
      check((await db.assessImport(await db.inspectZip(exported))).skipped===1,'Duplicate detection must ignore local note metadata');
      check(await db.restoreDayNote(legacyId,removed) && await db.restoreDayNote(legacyId,removed) &&
        db.visibleDayNotes(await db.getDay(legacyId)).length===2,'Restoring an old note twice must add one copy');

      const quickDate='2026-11-29', blank={id:'quick-seed',date:quickDate,status:'draft'};
      const quick=await db.appendDayMoment(blank,firstNote);
      const next=await db.appendDayMoment(blank,secondNote);
      const [deletedSeed]=await Promise.all([db.removeDayNote(quick.id,firstNote),
        db.appendDayMoment(blank,note('note-f','Соседняя заметка',6))]);
      current=await db.getDay(quick.id);
      check(deletedSeed.id===firstNote.id && !current.text.includes(firstNote.text) &&
        current.moments.map(note=>note.id).join(',')==='note-b,note-f','Concurrent delete and append must preserve the other notes');
      const retry=await db.appendDayMoment(blank,firstNote);
      check(retry.moments.length===2,'A delayed add retry must respect a subsequent deletion');
      current=await db.saveDay({...next,caption:'Первое автосохранение'});
      const afterFreshSave=await db.saveDay({...next,revision:current.revision,caption:'Второе автосохранение'});
      check(afterFreshSave.id===quick.id && afterFreshSave.moments.length===2 && !afterFreshSave.text.includes(firstNote.text),
        'Successive saves from an open editor must not reintroduce a deleted note or its automatic draft text');
      await Promise.all([db.restoreDayNote(quick.id,deletedSeed),
        db.saveDay({...afterFreshSave,text:'Новый абзац автора'})]);
      current=await db.getDay(quick.id);
      check(current.text==='Новый абзац автора' && current.moments.map(note=>note.id).join(',')==='note-a,note-b,note-f',
        'Undo and a concurrent story edit must both survive');
      await db.removeDayNote(quick.id,firstNote);
      check((await db.getDay(quick.id)).text==='Новый абзац автора','Removing the old seed must preserve authored text');
      const authored=await db.saveDay({id:'authored-story',date:'2026-11-30',text:firstNote.text});
      await db.appendDayMoment(authored,firstNote);
      await db.removeDayNote(authored.id,firstNote);
      check((await db.getDay(authored.id)).text===firstNote.text,'An authored draft can contain the same words as a note');
      const oldQuickId='legacy-quick';
      await db.importDays([{id:oldQuickId,date:'2026-12-02',status:'draft',text:oldNote.text,moments:[oldNote]}]);
      const oldQuick=await db.getDay(oldQuickId);
      await db.removeDayNote(oldQuickId,oldNote);
      const oldAutosave=await db.saveDay({...oldQuick,musicMode:'file',caption:'Черновик'});
      check(oldAutosave.text==='' && !oldAutosave.moments.length,'A legacy editor must not revive deleted automatic text');
      const lone=await db.appendDayMoment({id:'lone-seed',date:'2026-12-01'},firstNote);
      const loneNote=await db.removeDayNote(lone.id,firstNote);
      check((await db.getDay(lone.id)).text==='' && await db.restoreDayNote(lone.id,loneNote) &&
        (await db.getDay(lone.id)).text===firstNote.text,'Undo on an untouched draft restores its automatic seed');
      await db.removeDay(quick.id);
      check(await db.restoreDayNote(quick.id,deletedSeed)===false && await db.removeDayNote(quick.id,deletedSeed)===null &&
        !await db.getDay(quick.id),'Undo must never recreate a deleted day');
      return 'versions, photos, audio, pending edits, backups, corruption, drafts, note deletion and undo, stale editors, concurrent note and story changes';
    },origin.href);
    console.log(engine + ': ' + report + ' OK');
  } finally {
    await browser.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
