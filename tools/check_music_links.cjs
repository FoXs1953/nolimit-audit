// Stable provider boundary tests. External media and its availability are
// controlled by each service; this test supplies only their documented events.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const engine=process.env.ENGINE || 'chromium';
const base=new URL(process.argv[2] || 'http://127.0.0.1:8000/');

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
    assert.equal(result.spotifyError,'unavailable');assert.deepEqual(pageErrors,[]);
    console.log(engine+': music share links, official embed, gesture, timestamp, pause, provider restrictions, retry and cleanup verified');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
