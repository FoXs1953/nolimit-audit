// Verify the ArtTech inputs, generated series and real mobile-player controls.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const origin=new URL(process.argv[2] || 'http://127.0.0.1:8000/');
const words=s=>s.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)||[];
const cases=[
  ['ru','Оживить открытку','3 из 3','Текст','Солнце осталось в листьях'],
  ['kk','Ашықхатты жандандыру','3 / 3','Мәтін','Күннің нұры жапырақта қалды'],
  ['en','Play postcard','3 of 3','Text','Sunlight lingered in the leaves']
];

(async()=>{
  const engine=process.env.ENGINE || 'chromium';
  const browser=await (engine==='webkit'?webkit:chromium).launch(engine==='chromium' && process.env.CHROME_CHANNEL?{channel:process.env.CHROME_CHANNEL}:{});
  try {
    const context=await browser.newContext({viewport:{width:375,height:812},serviceWorkers:'block'});
    const page=await context.newPage(),errors=[];
    page.setDefaultTimeout(15000);
    page.on('pageerror',err=>errors.push(err.message));
    // Observe the actual audio objects used by the production player without replacing playback.
    await page.addInitScript(()=>{
      window.__audio=[];
      // A deterministic local voice inventory covers machines which have no offline speech packs.
      const speech=new EventTarget();
      window.__voices=[];
      speech.getVoices=()=>window.__voices;
      speech.speak=utterance=>{window.__utterance=utterance;};
      speech.cancel=()=>{window.__utterance=null;};
      Object.defineProperty(window,'speechSynthesis',{value:speech,configurable:true});
      Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class {
        constructor(text){this.text=text;}
      },configurable:true});
      const NativeAudio=window.Audio;
      window.Audio=class extends NativeAudio { constructor(...args){super(...args);window.__audio.push(this);} };
    });
    // Hold back the MP3 while the user moves to frame three. This host returns a
    // complete 200 response even for Range requests, like the public static host.
    const mp3=await context.request.get(new URL('diary/media/leaves.mp3',origin).href);
    assert.ok(mp3.ok());
    const mediaBytes=await mp3.body();
    let sendTrack;
    const gate=new Promise(resolve=>{sendTrack=resolve;});
    await page.route('**/diary/media/leaves.mp3',async route=>{
      await gate;
      await route.fulfill({status:200,contentType:'audio/mpeg',body:mediaBytes});
    });
    await page.goto(new URL('#day/demo-leaves',origin).href,{waitUntil:'commit'});
    const card=k=>page.locator('[data-card="'+k+'"]');
    await card('hero-play').waitFor();
    const series=[];
    for(const [lang,play,lastFrame,textLabel,title] of cases){
      await page.locator('[data-language="'+lang+'"]').click();
      await page.getByRole('heading',{name:title,exact:true}).waitFor();
      await page.getByRole('button',{name:play,exact:true}).click();
      const viewer=card('viewer');
      await viewer.waitFor();
      await card('viewer-photo').waitFor();
      assert.ok(await viewer.evaluate(dialog=>dialog.open));
      if(lang==='ru'){
        await card('next').click();
        await card('next').click();
        await card('mute').click();
        sendTrack();
      }
      assert.equal(await card('counter').textContent(),lastFrame);
      assert.equal(await card('mute').getAttribute('aria-pressed'),'true');
      const target=await page.locator('.diary-card').evaluate(el=>
        2*parseFloat(el.style.getPropertyValue('--day-duration'))/1000);
      await page.waitForFunction(start=>{
        const audio=window.__audio.at(-1);
        if (audio?.error) throw Error('Demo playback error '+audio.error.code+': '+audio.error.message);
        return audio && !audio.paused && !audio.seeking && start<audio.duration && audio.currentTime>=start;
      },target,{timeout:6000});
      const startedAt=await page.evaluate(()=>window.__audio.at(-1).currentTime);
      assert.ok(startedAt-target<3,'Playback starts within the selected frame');
      await page.waitForFunction(start=>window.__audio.at(-1).currentTime>=start+.15,startedAt,{timeout:2500});
      const animation=await card('viewer-photo').evaluate(img=>getComputedStyle(img).animationName);
      assert.equal(animation,'day-float');
      assert.equal(await page.locator('.diary-card').evaluate(el=>el.style.getPropertyValue('--day-paper')),'#9c6c33');
      await card('close').click();
      await viewer.waitFor({state:'hidden'});
      assert.ok(await page.evaluate(()=>window.__audio.at(-1).paused),'Dismissing the photo stops its soundtrack');
      assert.equal(await card('explain').count(),0);
      await card('story').waitFor();
      await page.evaluate(()=>{window.__voices=[];});
      await card('read').click();
      const story=page.getByRole('dialog').locator('.card-original');
      assert.equal(await story.getAttribute('lang'),lang);
      const read=page.getByRole('dialog').locator('[data-speak]');
      assert.equal(await read.isVisible(),false);
      await page.evaluate(code=>{
        window.__voices=[{lang:'ru-RU',localService:true},{lang:code,localService:false},{lang:code,localService:true}];
        speechSynthesis.dispatchEvent(new Event('voiceschanged'));
      },lang);
      await read.click();
      const spoken=await page.evaluate(()=>({text:window.__utterance.text,lang:window.__utterance.lang,local:window.__utterance.voice.localService}));
      assert.equal(spoken.text,await story.textContent());assert.equal(spoken.lang.split('-')[0],lang);assert.equal(spoken.local,true);
      await read.click();await page.getByRole('dialog').locator('button').first().click();
      await card('credits').click();
      assert.equal(await page.getByRole('dialog').getByRole('link').count(),3);
      await page.getByRole('dialog').locator('button').first().click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const rows=await page.evaluate(async()=>{
        const {demos}=await import('./diary/demos.js');
        const {makeRecipe}=await import('./diary/art.js');
        return Promise.all(demos.map(async d=>{
          const r=makeRecipe(d);
          const media=await Promise.all([...d.photos,d.music].map(async m=>{
            const res=await fetch(m.src);
            return res.ok && (await res.blob()).size>0;
          }));
          return {id:d.id,title:r.title,text:d.text,caption:r.caption,photos:d.photos.length,
            song:d.music.src,media:media.every(Boolean),style:[r.mood,r.motion,r.color,r.interval]};
        }));
      });
      assert.equal(rows.length,5);
      assert.ok(new Set(rows.map(r=>r.style[0])).size>=3);
      for(const row of rows){
        assert.equal(row.title,words(row.text.split('.')[0]).slice(0,7).join(' '));
        assert.ok(words(row.title).length>=3 && words(row.title).length<=7);
        assert.ok(row.caption && row.photos>=1 && row.song.endsWith('.mp3') && row.media);
      }
      series.push(rows.map(row=>[row.id,...row.style]));
    }
    assert.deepEqual(series[0],series[1]);assert.deepEqual(series[1],series[2]);

    await page.goto(new URL('#day/demo-coffee',origin).href,{waitUntil:'domcontentloaded'});
    await card('hero-play').click();
    await page.getByText('2 of 2',{exact:true}).waitFor();
    await page.getByText('Postcard finished',{exact:true}).waitFor({timeout:25000});
    await card('play').click();
    assert.equal(await card('counter').textContent(),'1 of 2');
    await card('close').click();
    await card('viewer').waitFor({state:'hidden'});

    const comparisons=await page.evaluate(async()=>{
      const {makeRecipe,presentRecipe}=await import('./diary/art.js');
      const {setLanguage}=await import('./diary/i18n.js');
      const base={text:'Quiet moon above the bridge.',photos:[{color:'#345678'}],music:{kind:'file',bpm:66,energy:'calm'},contentLanguage:'en'};
      const r=makeRecipe(base);
      const sample={...base,id:crypto.randomUUID(),date:'2026-11-19',status:'ready',recipe:r,title:r.title,caption:r.caption};
      const described={};
      for (const lang of ['ru','kk','en']){
        setLanguage(lang);
        described[lang]=presentRecipe(sample);
      }
      return {
        base:r,described,
        sadness:['Сегодня мне грустно.','Мұңды күн.','I felt sad.'].map(text=>makeRecipe({text}).mood),
        anger:['Я разозлился.','Мен ашуландым.','I felt angry.'].map(text=>makeRecipe({text}).mood),
        legacy:['quiet','tender'].map(oldMood=>{
          const happy={text:'Happy friends laughed together.'};
          const saved=presentRecipe({...happy,status:'ready',recipe:{
            version:1,mood:oldMood,title:'Personal title',motion:'lift',color:'#123456'
          }});
          return [makeRecipe({...happy,moodOverride:oldMood}).mood,saved.mood,saved.title,saved.motion,saved.color];
        }),
        bright:makeRecipe({...base,text:'Happy friends danced and laughed.'}),
        kazakh:makeRecipe({...base,text:'Достармен билеп, күліп, қуанып жүрдік.'}),
        russian:makeRecipe({...base,text:'Смеялись, улыбались и танцевали вместе.'}),
        photo:makeRecipe({...base,photos:[{color:'#bb2244'}]}),
        track:makeRecipe({...base,music:{kind:'file',bpm:136,energy:'bright'}}),
        external:makeRecipe({...base,music:{kind:'link',url:'https://example.com/song',energy:'bright'}}),
        short:['Домой','Жаңбыр','Rain'].map(text=>makeRecipe({text}).title)
      };
    });
    const {base,bright,kazakh,russian,photo,track,external,described,short}=comparisons;
    assert.equal(base.mood,'calm');
    assert.deepEqual(comparisons.sadness,['sad','sad','sad']);
    assert.deepEqual(comparisons.anger,['angry','angry','angry']);
    for(const legacy of comparisons.legacy) {
      assert.deepEqual(legacy,['calm','calm','Personal title','lift','#123456']);
    }
    for(const r of [bright,kazakh,russian]) assert.equal(r.mood,'bright');
    assert.notEqual(base.voiceRate,bright.voiceRate);assert.notEqual(base.voicePitch,bright.voicePitch);
    assert.notEqual(base.motion,bright.motion);assert.equal(base.color,bright.color);assert.equal(base.interval,bright.interval);
    assert.equal(photo.color,'#bb2244');assert.equal(base.motion,photo.motion);assert.equal(base.interval,photo.interval);
    assert.ok(track.interval<base.interval);assert.equal(track.color,base.color);assert.equal(track.motion,base.motion);
    assert.ok(external.interval<base.interval);
    for(const d of Object.values(described)) {
      for(const k of ['title','caption','color','motion','interval','mood','voiceRate','voicePitch']) assert.equal(d[k],base[k]);
    }
    assert.equal(new Set(Object.values(described).map(d=>d.reasons.music)).size,3);
    assert.ok(short.every(s=>words(s).length>=3 && words(s).length<=7));

    // Open through the production archive route with a persisted song link and a personal story.
    const id=await page.evaluate(async()=>{
      const {saveDay}=await import('./diary/store.js');
      const {makeRecipe}=await import('./diary/art.js');
      const d={id:crypto.randomUUID(),date:'2026-11-19',status:'ready',contentLanguage:'en',
        text:'Quiet moon above the bridge. I carried the camera.',photos:[{id:'moon',name:'My photograph',src:'./diary/media/moon.jpg',color:'#345678'}],
        music:{kind:'link',name:'The piece I chose',url:'https://bandcamp.com/track/test-song',energy:'bright'},moments:[]};
      d.recipe=makeRecipe(d);d.title=d.recipe.title;d.caption=d.recipe.caption;
      await saveDay(d);return d.id;
    });
    await page.goto(new URL('#day/'+id,origin).href,{waitUntil:'domcontentloaded'});
    for(const [lang,play] of cases){
      await page.locator('[data-language="'+lang+'"]').click();
      await page.getByRole('button',{name:play,exact:true}).waitFor();
      await page.getByRole('heading',{name:'Quiet moon above the bridge',exact:true}).waitFor();
      await card('hero-play').click();
      const link=card('viewer').locator('a[href="https://bandcamp.com/track/test-song"]');
      assert.equal(await link.getAttribute('target'),'_blank');
      await card('viewer').getByText('The piece I chose',{exact:true}).first().waitFor();
      assert.ok((await card('status').textContent()).length>10);
      await card('close').click();
      await card('viewer').waitFor({state:'hidden'});
    }
    await context.route('https://bandcamp.com/track/test-song',route=>route.fulfill({contentType:'text/plain',body:'Test song'}));
    await card('hero-play').click();
    const opened=page.waitForEvent('popup');
    await card('viewer').locator('a[href="https://bandcamp.com/track/test-song"]').click();
    const songPage=await opened;
    await songPage.waitForURL('https://bandcamp.com/track/test-song');
    await songPage.close();
    assert.deepEqual(errors,[]);
    console.log('PASS '+engine+': 15 translated example cards, generated titles, 3 independent art inputs, real audio, external song, original story, mobile controls and language-switch playback state');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
