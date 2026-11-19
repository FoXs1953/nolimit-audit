// Stable provider boundary tests. External media and its availability are
// controlled by each service; this test supplies only their documented events.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const engine=process.env.ENGINE || 'chromium';
const base=new URL(process.argv[2] || 'http://127.0.0.1:8000/');

async function verifySpotifyStart(page) {
  const service='https://open.spotify.com/embed/iframe-api/v1';
  await page.unroute(service);
  // Reproduce a real Safari trace: Spotify acknowledges the command while its
  // clock stays at zero, then reports a settled paused state. Native Play can
  // subsequently deliver an advancing position in the same player.
  const fakeSdk=() => window.onSpotifyIframeApiReady({
    createController(slot,options,connect){
      const handlers=new Map();
      const emit=(event,data={})=>handlers.get(event)?.({data});
      const update=(isPaused,isBuffering,position=0)=>emit('playback_update',{
        isPaused,isBuffering,position,duration:16700
      });
      const nativePlay=document.createElement('button');
      nativePlay.textContent='Spotify Play';slot.append(nativePlay);
      window.spotifyProgress=time=>update(false,false,time);
      nativePlay.onclick=()=>{emit('playback_started');update(false,false);};
      connect({
        addListener(event,listener){handlers.set(event,listener);},
        resume(){update(false,true);emit('playback_started');update(true,true);update(true,false);},
        pause(){update(true,false);},
        destroy(){slot.remove();},seek(){}
      });
      emit('ready');update(true,false);
    }
  });
  await page.route(service,route=>route.fulfill({contentType:'text/javascript',body:'('+fakeSdk.toString()+')()'}));
  const song='https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl';
  const id=await page.evaluate(async song=>{
    const {demos}=await import('./diary/demos.js');
    const {saveDay}=await import('./diary/store.js');
    const record={...structuredClone(demos[0]),id:crypto.randomUUID(),music:{kind:'link',name:'Spotify preview',url:song}};
    delete record.demo;
    await saveDay(record);return record.id;
  },song);
  await page.goto(new URL('#day/'+id,base).href);
  const card=k=>page.locator('[data-card="'+k+'"]');
  await page.waitForFunction(()=>typeof window.spotifyProgress==='function');
  const status=card('status');
  assert.equal(await status.textContent(),'','An idle Spotify preview does not prompt for playback');
  await card('hero-play').click();
  await card('play').click();
  await page.waitForTimeout(1350);
  assert.equal(await status.textContent(),'','An intentional pause cancels the native Play hint');
  await card('play').click();
  await status.getByText(/▶/).waitFor();
  assert.equal(await card('source').getAttribute('href'),song);
  const playing=()=>page.locator('.diary-card').evaluate(el=>el.classList.contains('is-playing'));
  assert.equal(await playing(),false,'A command acknowledgement does not start the photo clock');
  await page.getByRole('button',{name:'Spotify Play',exact:true}).click();
  assert.equal(await playing(),false,'An unpaused report at position zero does not claim sound is playing');
  await page.evaluate(()=>window.spotifyProgress(995));
  await page.waitForSelector('.diary-card.is-playing');
  assert.equal(await status.textContent(),'','Real progress clears the native Play hint');
  await card('close').click();
}

(async()=>{
  const browser=await (engine==='webkit'?webkit:chromium).launch(engine==='chromium' && process.env.CHROME_CHANNEL ? {channel:process.env.CHROME_CHANNEL}:{});
  try {
    const context=await browser.newContext({serviceWorkers:'block'});
    const page=await context.newPage();
    const pageErrors=[];
    page.on('pageerror',err=>pageErrors.push(err.message));
    await page.route('https://www.youtube.com/embed/**',route=>route.fulfill({contentType:'text/html',body:'<title>Test video</title>'}));
    await page.route('https://open.spotify.com/embed/iframe-api/v1',route=>route.abort());
    await page.goto(base.href);
    const result=await page.evaluate(async()=>{
      const {musicLink}=await import('./diary/music-link.js');
      const {mountProvider}=await import('./diary/provider-player.js');
      const id='M7lc1UVf-VE';
      const inputs=['youtu.be/'+id+'?t=1m5s','https://www.youtube.com/shorts/'+id,
        'https://music.youtube.com/watch?v='+id,'https://m.youtube.com/watch?v='+id,
        'https://www.youtube-nocookie.com/embed/'+id,'https://youtube.com/live/'+id+'#t=5'];
      const spotify=musicLink('https://open.spotify.com/intl-es/track/11dFghVXANMlKmJXsNCbNl?si=sample');
      const invalid=['youtube.com/playlist?list=demo','https://www.youtube.com/watch?v=no',
        'https://youtube.com.attacker.invalid/watch?v='+id,'javascript:alert(1)',
        'https://www.youtube.com:123/shorts/'+id,'https://u:p@youtu.be/'+id];
      const links={videos:inputs.map(x=>musicLink(x)),spotify,invalid:invalid.map(x=>musicLink(x)),
        external:musicLink('https://music.apple.com/us/album/example')};
      const nativeCommands=[],states=[],errors=[],durations=[];
      const dialog=document.createElement('dialog'),container=document.createElement('div');
      document.body.append(dialog);dialog.append(container);dialog.showModal();
      let events;
      window.YT={Player:class {
        constructor(frame,config){events=config.events;nativeCommands.push('new');}
        playVideo(){nativeCommands.push('play');}
        pauseVideo(){nativeCommands.push('pause');}
        mute(){nativeCommands.push('mute');}
        unMute(){nativeCommands.push('unmute');}
        seekTo(t){nativeCommands.push('seek '+t);}
        getDuration(){return 120;}
        getCurrentTime(){return 65;}
        destroy(){nativeCommands.push('destroy');}
      }};
      const player=mountProvider(container,links.videos[0],{title:'Official music player',
        onState:v=>states.push(v),onError:(v,code)=>errors.push([v,code]),onDuration:v=>durations.push(v)});
      const frame=container.querySelector('iframe');
      const embed={src:frame.src,title:frame.title,allow:frame.allow,referrer:frame.referrerPolicy};
      player.play();player.setMuted(true);player.seek(68);
      await Promise.resolve();
      events.onReady();
      events.onStateChange({data:1});
      const clock=[player.getCurrentTime(),player.getDuration()];
      events.onStateChange({data:2});
      events.onAutoplayBlocked();
      player.play();events.onStateChange({data:1});
      events.onError({data:101});
      player.play();await Promise.resolve();events.onReady();
      events.onError({data:153});
      player.play();await Promise.resolve();events.onReady();
      dialog.close();events.onStateChange({data:1});
      player.destroy();
      const noFrame=!container.querySelector('iframe');
      const spotifyError=await new Promise(resolve=>{
        const fallback=mountProvider(container,spotify,{onError:r=>{fallback.destroy();resolve(r);}});
        fallback.play();
      });
      dialog.remove();
      return {links,embed,states,errors,durations,nativeCommands,noFrame,clock,spotifyError};
    });
    assert.deepEqual(result.links.videos.map(v=>[v.provider,v.videoId,v.start]),[65,0,0,0,0,5].map(s=>['youtube','M7lc1UVf-VE',s]));
    assert.equal(result.links.spotify.spotifyUri,'spotify:track:11dFghVXANMlKmJXsNCbNl');
    assert.ok(result.links.invalid.every(x=>x===null));
    assert.equal(result.links.external.provider,'external');
    const embed=new URL(result.embed.src);
    assert.equal(embed.origin,'https://www.youtube.com');assert.equal(embed.searchParams.get('origin'),base.origin);
    assert.equal(embed.searchParams.get('start'),'65');assert.match(result.embed.allow,/autoplay/);
    assert.equal(result.embed.title,'Official music player');assert.equal(result.embed.referrer,'strict-origin-when-cross-origin');
    assert.equal(result.noFrame,true);assert.deepEqual(result.clock,[65,120]);
    assert.deepEqual(result.errors,[['blocked',null],['restricted',101],['unavailable',153]].map(([s,n])=>[s,n??undefined]));
    assert.ok(result.durations.includes(120));assert.ok(result.states.includes('playing'));assert.ok(result.states.includes('paused'));
    assert.deepEqual(result.nativeCommands.slice(0,4),['new','mute','seek 68','play']);
    assert.deepEqual(result.nativeCommands.slice(-2),['pause','destroy']);
    assert.equal(result.spotifyError,'unavailable');
    await verifySpotifyStart(page);
    assert.deepEqual(pageErrors,[]);
    console.log(engine+': music share links, official embed, gesture, timestamp, pause, provider restrictions, retry and cleanup verified');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
