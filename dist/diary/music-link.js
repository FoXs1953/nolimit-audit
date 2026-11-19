// Normalize share links without a network request. Only official track identifiers
// are used to construct embeds; other known music services open at their source.
const externalHosts = [
  'spotify.com', 'spotify.link', 'soundcloud.com', 'deezer.com', 'deezer.page.link',
  'tidal.com', 'bandcamp.com', 'music.yandex.ru', 'music.yandex.kz', 'music.yandex.com',
  'music.yandex.by', 'music.yandex.uz', 'music.amazon.com', 'music.amazon.co.uk',
  'qobuz.com', 'music.vk.com'
];

function startSeconds(raw) {
  if (!raw) return 0;
  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(raw);
  const seconds = units ? Number(units[1] || 0)*3600 + Number(units[2] || 0)*60 + Number(units[3] || 0) : Number(raw);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 0;
}

export function musicLink(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) return null;
  let url;
  try {
    const raw=value.trim();
    url=new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://'+raw);
  } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host=url.hostname;
  const parts=url.pathname.split('/').filter(Boolean);
  if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com',
      'www.youtube-nocookie.com','youtu.be','www.youtu.be'].includes(host)) {
    let videoId;
    if (host==='youtu.be' || host==='www.youtu.be') videoId=parts.length===1 ? parts[0] : null;
    else if (parts.length===1 && parts[0]==='watch') videoId=url.searchParams.get('v');
    else if (parts.length===2 && ['shorts','embed','live','v'].includes(parts[0])) videoId=parts[1];
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || '')) return null;
    const start=startSeconds(url.searchParams.get('t') || url.searchParams.get('start') ||
      new URLSearchParams(url.hash.slice(1)).get('t'));
    const canonical=new URL('https://www.youtube.com/watch');
    canonical.searchParams.set('v',videoId);
    if(start) canonical.searchParams.set('t',String(start)+'s');
    return {url:canonical.href,provider:'youtube',videoId,start};
  }
  if (host==='open.spotify.com') {
    const match=/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|episode)\/([A-Za-z0-9]{22})\/?$/i.exec(url.pathname);
    if (match) {
      const [,type,id]=match;
      return {url:'https://open.spotify.com/'+type+'/'+id,provider:'spotify',spotifyUri:'spotify:'+type+':'+id,videoId:null,start:0};
    }
  }
  if(host==='music.apple.com' || externalHosts.some(domain=>host===domain || host.endsWith('.'+domain))) {
    return {url:url.href,provider:'external',videoId:null,start:0};
  }
  return null;
}
