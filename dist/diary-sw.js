importScripts('./offline-list.js');
const PREFIX = 'nolimit-diary-';
const CACHE = PREFIX + self.DIARY_BUILD;
const here = self.registration.scope;
const entries = new Set(self.DIARY_FILES.map(path => new URL(path, here).href));
const shell = new URL('./index.html', here).href;
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache = await caches.open(CACHE);
    await cache.addAll([...entries].map(url=>new Request(url,{cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    for(const name of await caches.keys()) if(name.startsWith(PREFIX) && name!==CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
function audioRange(header, bytes, type) {
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!match || (!match[1] && !match[2])) return new Response(bytes,{headers:{'Content-Type':type}});
  const start = match[1] ? Number(match[1]) : Math.max(0,bytes.byteLength-Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]),bytes.byteLength-1) : bytes.byteLength-1;
  if(start>end || start>=bytes.byteLength) return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+bytes.byteLength}});
  return new Response(bytes.slice(start,end+1),{status:206,headers:{
    'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':'bytes '+start+'-'+end+'/'+bytes.byteLength,'Content-Length':String(end-start+1)
  }});
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET')return;
  const address = new URL(request.url);
  if(address.origin !== location.origin)return;
  const isHome = request.mode==='navigate' && (address.pathname === new URL('./',here).pathname || address.pathname === new URL(shell).pathname);
  const lookup = isHome ? shell : address.href;
  if(!entries.has(lookup))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(lookup);
    if(!cached)return fetch(request);
    const range=request.headers.get('Range');
    if(range && address.pathname.endsWith('.mp3'))return audioRange(range,await cached.arrayBuffer(),cached.headers.get('Content-Type') || 'audio/mpeg');
    return cached;
  })());
});
