// Run against the static server or the production URL in a fresh browser profile.
const assert = require('node:assert/strict');
const http = require('node:http');
const playwright = require('playwright');

// Disconnect the test server at the socket. WebKit's emulated offline flag can
// reject a navigation before its service worker gets a fetch event.
async function interruptibleOrigin(upstream) {
  let connected = true;
  const server = http.createServer(async (req, res) => {
    if (!connected) { req.socket.destroy(); return; }
    try {
      const target = new URL(req.url.slice(1), upstream);
      const response = await fetch(target);
      res.writeHead(response.status, {'content-type': response.headers.get('content-type') || 'application/octet-stream'});
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: 'http://127.0.0.1:' + server.address().port + '/',
    disconnect() { connected=false; server.closeAllConnections(); },
    close() { server.closeAllConnections(); server.close(); }
  };
}

(async () => {
  const engine = process.env.ENGINE || 'chromium';
  const base = process.argv[2] || 'http://127.0.0.1:8000/';
  const browser = await playwright[engine].launch(engine === 'chromium' && process.env.CHROME_CHANNEL ? {channel:process.env.CHROME_CHANNEL} : {});
  const origin = engine === 'webkit' ? await interruptibleOrigin(base) : null;
  try {
    const context = await browser.newContext({viewport:{width:390,height:844}});
    const page = await context.newPage();
    await page.goto(origin?.url || base);
    await page.getByRole('button',{name:'Записать день',exact:true}).waitFor();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout:45000});
    if (origin) origin.disconnect();
    else await context.setOffline(true);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Записать день',exact:true}).waitFor();
    await page.locator('#dock [data-route="examples"]').click();
    await page.locator('[data-id="demo-leaves"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#view img')].some(img=>img.complete && img.naturalWidth));
    const audio = await page.evaluate(async () => {
      const response = await fetch('./diary/media/leaves.mp3',{headers:{Range:'bytes=0-23'}});
      return [response.status, (await response.arrayBuffer()).byteLength,response.headers.get('content-range')];
    });
    assert.equal(audio[0],206);assert.equal(audio[1],24);assert.match(audio[2],/^bytes 0-23\//);
    console.log(engine+': offline reload, demo navigation, photos and partial audio verified');
  } finally { origin?.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
