// Each service owns its visible iframe and media. Only the service being viewed
// is contacted. The diary receives transport events and a playback clock.
const services={
  youtube:{src:'https://www.youtube.com/iframe_api',callback:'onYouTubeIframeAPIReady'},
  spotify:{src:'https://open.spotify.com/embed/iframe-api/v1',callback:'onSpotifyIframeApiReady'}
};
const apiPromises=new Map();

function loadApi(name) {
  if (name==='youtube' && window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromises.has(name)) return apiPromises.get(name);
  const config=services[name];
  const promise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const previous=window[config.callback];
    const timer=setTimeout(fail,18000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      window[config.callback]=previous;
      apiPromises.delete(name);
      reject(Error('Player API unavailable'));
    }
    window[config.callback]=api=>{
      clearTimeout(timer);
      window[config.callback]=previous;
      resolve(name==='youtube'?window.YT:api);
      if (typeof previous==='function') previous(api);
    };
    script.async=true;
    script.referrerPolicy='strict-origin-when-cross-origin';
    script.onerror=fail;
    script.src=config.src;
    document.head.append(script);
  });
  apiPromises.set(name,promise);
  return promise;
}

function youtubeEmbed(container,link,events,title) {
  const frame=document.createElement('iframe');
  const url=new URL('https://www.youtube.com/embed/'+link.videoId);
  url.searchParams.set('origin',location.origin);
  url.searchParams.set('enablejsapi','1');
  url.searchParams.set('playsinline','1');
  url.searchParams.set('hl',document.documentElement.lang || 'ru');
  if (link.start) url.searchParams.set('start',String(link.start));
  frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen=true;
  frame.title=title || 'YouTube';
  frame.referrerPolicy='strict-origin-when-cross-origin';
  frame.style.cssText='display:block;width:100%;min-height:200px;aspect-ratio:16/9;border:0';
  frame.src=url.href;
  container.replaceChildren(frame);
  let player,disposed=false;
  loadApi('youtube').then(api=>{
    if(disposed) return;
    player=new api.Player(frame,{events:{
      onReady(){events.ready();},
      onStateChange(event){
        const state={0:'ended',1:'playing',2:'paused',3:'buffering'}[event.data];
        if (state) events.state(state);
      },
      onAutoplayBlocked(){events.error('blocked');},
      onError(event){events.error([100,101,150].includes(event.data)?'restricted':'unavailable',event.data);}
    }});
  }).catch(()=>{if(!disposed) events.error('unavailable');});
  return {
    play:()=>player?.playVideo?.(),
    pause:()=>player?.pauseVideo?.(),
    setMuted:muted=>muted?player?.mute?.():player?.unMute?.(),
    seek:time=>player?.seekTo?.(time,true),
    currentTime:()=>player?.getCurrentTime?.() || 0,
    duration:()=>player?.getDuration?.() || 0,
    destroy(){disposed=true;player?.destroy?.();frame.remove();}
  };
}

function spotifyEmbed(container,link,events,title) {
  const slot=document.createElement('div');
  container.replaceChildren(slot);
  let player,disposed=false,time=0,duration=0;
  loadApi('spotify').then(api=>{
    if (disposed) return;
    api.createController(slot,{uri:link.spotifyUri,width:'100%',height:152},controller=>{
      if (disposed) {controller.destroy();return;}
      player=controller;
      const frame=container.querySelector('iframe');
      if(frame) frame.title=title || 'Spotify';
      controller.addListener('ready',()=>events.ready());
      // Spotify sometimes acknowledges a play command before WebKit refuses
      // audio at position zero. Drive the postcard from its actual media clock.
      controller.addListener('playback_update',({data})=>{
        time=(Number(data.position) || 0)/1000;
        duration=(Number(data.duration) || 0)/1000;
        if (data.isBuffering) events.state('buffering');
        else if (data.isPaused) events.state(duration && time>=duration-.25 ? 'ended' : 'paused');
        else if (time>0) events.state('playing');
      });
    });
  }).catch(()=>{if(!disposed) events.error('unavailable');});
  return {
    play:()=>player?.resume(),
    pause:()=>player?.pause(),
    // Spotify exposes volume controls only inside its own player.
    setMuted(){},
    seek:time=>player?.seek(Math.floor(time)),
    currentTime:()=>time,
    duration:()=>duration,
    destroy(){disposed=true;player?.destroy();slot.remove();}
  };
}

// Mount while displaying a saved day, then invoke play() synchronously from the
// user's opening gesture. A provider that denies autoplay retains its native play control.
export function mountProvider(container,link,{onState,onDuration,onError,title}={}) {
  if (!['youtube','spotify'].includes(link?.provider)) return null;
  let player,ready=false,requested=false,destroyed=false,failed=false,started=false;
  let muted=false,seekTarget=null,lastState='',lastDuration=0,deadline,generation=0;
  function watch(reason,delay) {
    clearTimeout(deadline);
    deadline=setTimeout(()=>error(reason),delay);
  }
  function error(reason,code) {
    if (destroyed) return;
    clearTimeout(deadline);requested=false;
    failed=reason!=='blocked';
    if (link.provider==='spotify' && reason==='blocked') lastState='paused';
    onError?.(reason,code);
  }
  function playReady() {
    lastState='';
    watch('blocked',10000);
    player.play();
  }
  function mount() {
    const ticket=++generation;
    player?.destroy();
    ready=false;failed=false;started=false;lastState='';lastDuration=0;
    const events={
      ready(){
        if (destroyed || generation!==ticket) return;
        clearTimeout(deadline);ready=true;failed=false;
        if (muted) player.setMuted(true);
        if (seekTarget!==null) {player.seek(seekTarget);seekTarget=null;}
        onState?.('ready');
        if (requested) playReady();
      },
      state(state) {
        if (destroyed || generation!==ticket) return;
        const duration=Number(player.duration());
        if (duration>0 && duration!==lastDuration) {lastDuration=duration;onDuration?.(duration);}
        if (state==='playing') {
          if(container.closest('dialog:not([open])')) {player.pause();return;}
          clearTimeout(deadline);failed=false;requested=false;started=true;
        } else if (state==='paused' && link.provider==='spotify' && ready && requested) {
          // A brief paused update is possible during a successful start. Give
          // the next clock update a moment to confirm playback before offering native Play.
          if (lastState!=='waiting-for-native-play') watch('blocked',1100);
          lastState='waiting-for-native-play';
          return;
        } else if (state==='paused' && !started) return;
        else if (state==='buffering' && requested && state!==lastState) watch('unavailable',18000);
        if (state===lastState) return;
        lastState=state;
        onState?.(state);
      },
      error(reason,code){if(generation===ticket) error(reason,code);}
    };
    player=(link.provider==='youtube'?youtubeEmbed:spotifyEmbed)(container,link,events,title);
  }
  mount();
  return {
    play() {
      if (destroyed) return;
      if (failed) mount();
      requested=true;
      if (ready) playReady();
      else watch('unavailable',18000);
    },
    pause({keepAvailable=false}={}) {
      const cancellingSpotifyStart=link.provider==='spotify' && requested;
      requested=false;
      clearTimeout(deadline);
      if (ready) player.pause();
      else if (!destroyed) {
        // Even a native iframe which did not establish its JS connection
        // may have been started through its own controls.
        generation++;player?.destroy();player=null;failed=true;
        if(keepAvailable) mount();
      }
      if (cancellingSpotifyStart) {
        lastState='paused';onState?.('paused');
      }
    },
    setMuted(value){muted=Boolean(value);if (ready) player.setMuted(muted);},
    seek(seconds) {
      const time=Number(seconds);
      if(!Number.isFinite(time) || time<0) return;
      if(ready) player.seek(time);
      else seekTarget=time;
    },
    getCurrentTime:()=>Number(player?.currentTime()) || 0,
    getDuration:()=>Number(player?.duration()) || 0,
    destroy(){destroyed=true;requested=false;clearTimeout(deadline);player?.destroy();container.replaceChildren();}
  };
}
