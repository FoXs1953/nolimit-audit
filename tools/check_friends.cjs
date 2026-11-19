// Run on a GitHub-hosted browser runner against the built Worker and ephemeral D1/R2.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFile, readdir } = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { Miniflare } = require('miniflare');
const { chromium, webkit } = require('playwright');

const root = path.resolve(__dirname, '..');
const apiRoot = '/api/social';
const engine = process.env.ENGINE || 'chromium';

async function migrate(mf) {
  const db = await mf.getD1Database('DB');
  const dir = path.join(root, 'drizzle');
  for (const name of (await readdir(dir)).filter(name => /^\d.*\.sql$/.test(name)).sort()) {
    const sql = await readFile(path.join(dir, name), 'utf8');
    const statements = sql.replace(/^\s*--[^\n]*$/gm, '').split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
    await db.batch(statements.map(s => db.prepare(s)));
  }
}

async function serve(mf) {
  const identities = new Map();
  let origin, nextWrite;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      assert.equal(url.origin, origin);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined && !['host', 'connection', 'transfer-encoding', 'cookie'].includes(key) && !key.startsWith('oai-')) {
          headers.set(key, String(value));
        }
      }
      // Only this loopback test gateway maps an opaque fixture cookie to a Sites identity.
      const token = /(?:^|;\s*)nolimit_test_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
      const actor = identities.get(token);
      if (actor) {
        headers.set('oai-authenticated-user-id', actor);
        headers.set('oai-authenticated-user-email', actor + '@example.invalid');
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      if (nextWrite?.matches(req.method, url.pathname)) {
        const gate = nextWrite;
        nextWrite = undefined;
        gate.arrived();
        await gate.resume;
      }
      const reply = await mf.dispatchFetch(url.href, { method: req.method, headers, body });
      res.writeHead(reply.status, Object.fromEntries(reply.headers));
      res.end(Buffer.from(await reply.arrayBuffer()));
    } catch (error) {
      if (!res.headersSent) res.writeHead(500);
      res.end();
      console.error('Local Worker gateway', error);
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  return {
    origin,
    holdNextWrite(matches) {
      assert.equal(nextWrite, undefined);
      let arrived, release;
      const seen = new Promise(resolve => { arrived = resolve; });
      const resume = new Promise(resolve => { release = resolve; });
      nextWrite = { matches, arrived, resume };
      return { seen, release };
    },
    cookieFor(actor) {
      const token = randomUUID();
      identities.set(token, actor);
      return { name: 'nolimit_test_session', value: token, url: origin, httpOnly: true, sameSite: 'Strict' };
    },
    close: () => new Promise(resolve => server.close(resolve))
  };
}

async function person(browser, site, actor, name, language, width, errors) {
  const ctx = await browser.newContext({ viewport: { width, height: 850 }, locale: { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' }[language] });
  await ctx.addCookies([site.cookieFor(actor)]);
  await ctx.addInitScript(lang => { localStorage.setItem('nolimit:language', lang); }, language);
  const page = await ctx.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(12000);
  await page.goto(site.origin + '/#friends');
  const form = page.locator('[data-name-form]');
  await form.locator('[name=name]').fill(name);
  await form.locator('[type=submit]').click();
  await page.locator('[data-act=profile]').waitFor();
  const session = await (await ctx.request.get(site.origin + apiRoot + '/session')).json();
  assert.equal(session.user.name, name);
  assert.deepEqual(Object.keys(session.user).sort(), ['code', 'id', 'name']);
  assert.equal(await page.locator('html').getAttribute('lang'), language);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Friends fits ' + width + 'px');
  return { page, ctx, name, id: session.user.id, origin: site.origin, site };
}

async function go(actor, hash) {
  await actor.page.bringToFront();
  const url = actor.origin + '/#' + hash;
  if (actor.page.url() === url) await actor.page.reload();
  else await actor.page.goto(url);
}

async function api(actor, route, options = {}) {
  return actor.ctx.request.fetch(actor.origin + (route.startsWith(apiRoot + '/') ? route : apiRoot + route), {
    ...options, headers: { 'X-NoLimit': 'diary', ...options.headers }
  });
}

async function read(actor, route) {
  const response = await api(actor, route);
  assert.equal(response.status(), 200, route + ' ' + await response.text());
  return response.json();
}

async function checkInviteLifecycle(owner, first, second) {
  const issue = () => api(owner, '/invites', { method: 'POST' }).then(r => r.json());
  const invitation = await issue();
  assert.deepEqual(await issue(), invitation);
  const route = '/invites/' + invitation.token;
  const apply = who => api(who, route + '/request', { method: 'POST' }).then(r => r.json());
  const preview = await fetch(owner.origin + apiRoot + route);
  assert.equal((await preview.json()).person.id, owner.id);
  const candidates = [first, second];
  const requests = await Promise.all(candidates.map(apply));
  assert.deepEqual(requests.map(r => r.status), ['pending', 'pending']);
  assert.equal((await apply(first)).requestId, requests[0].requestId);
  const accept = request => api(owner, '/requests/' + request.requestId + '/accept', { method: 'POST' });
  const statuses = (await Promise.all(requests.map(accept))).map(r => r.status());
  assert.deepEqual([...statuses].sort(), [200, 404]);
  const winner = statuses.indexOf(200);
  assert.equal((await accept(requests[winner])).status(), 200);
  assert.equal((await read(candidates[winner], route)).status, 'friends');
  assert.equal((await read(candidates[1 - winner], '/people')).outgoing.length, 0);
  assert.equal((await api(owner, '/friends/' + candidates[winner].id, { method: 'DELETE' })).status(), 200);
  const next = await issue();
  assert.notEqual(next.token, invitation.token);
  assert.equal((await api(owner, '/invites/current?token=' + invitation.token, { method: 'DELETE' })).status(), 409);
  assert.equal((await read(owner, '/people')).invite.token, next.token);
  assert.equal((await api(owner, '/invites/current?token=' + next.token, { method: 'DELETE' })).status(), 200);
  assert.equal((await api(first, '/invites/' + next.token)).status(), 410);
}

async function auditControls(page, scope, label) {
  // Start in keyboard modality. Safari and Chromium then preserve it as focus moves.
  await page.keyboard.press('Tab');
  const controls = scope.locator('button:visible,a[href]:visible,input:not([type=hidden]):visible,select:visible,textarea:visible,summary:visible');
  const count = await controls.count();
  assert.ok(count > 0, label + ' has visible controls');
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    const info = await control.evaluate(el => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || ({ button: 'button', a: 'link', select: 'combobox', textarea: 'textbox' })[tag] ||
        (tag === 'input' ? ({ checkbox: 'checkbox', radio: 'radio', search: 'searchbox', range: 'slider' })[el.type] || 'textbox' : '');
      return { role, tag, text: el.textContent.trim(), description: el.outerHTML.split('>')[0].slice(0, 160) };
    });
    const description = label + ' ' + info.description;
    if (info.role) assert.equal(await control.and(page.getByRole(info.role, { name: /\S/ })).count(), 1, 'Accessible name for ' + description);
    else assert.ok(info.tag === 'summary' && info.text, 'Disclosure label for ' + description);
    if (await control.isDisabled()) continue;
    await control.focus();
    assert.ok(await control.evaluate(el => {
      if (document.activeElement !== el || !el.matches(':focus-visible')) return false;
      const hasOutline = node => {
        const s = getComputedStyle(node);
        return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1 &&
          !['transparent', 'rgba(0, 0, 0, 0)'].includes(s.outlineColor);
      };
      return hasOutline(el) || (el.closest('label') && hasOutline(el.closest('label')));
    }), 'Keyboard focus ring for ' + description);
  }
}

async function clickWrite(actor, button, method, route) {
  const [reply] = await Promise.all([
    actor.page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname === apiRoot + route),
    button.click()
  ]);
  assert.equal(reply.status(), 200, method + ' ' + route + ': ' + await reply.text());
}

async function requestControls(author, visitor) {
  await go(author, 'friends/people');
  await author.page.locator('[data-act=profile]').click();
  await author.page.locator('[data-act=edit-name]').click();
  const form = author.page.locator('[data-name-form]');
  const original = (await read(author, '/session')).user;
  author.name += ' у реки';
  await form.locator('[name=name]').fill(author.name);
  await clickWrite(author, form.locator('[type=submit]'), 'POST', '/profile');
  await author.page.locator('.fh-profile-name').getByText(author.name, { exact: true }).waitFor();
  assert.deepEqual((await read(author, '/session')).user, { ...original, name: author.name });
  await author.page.locator('[data-act=dismiss]').click();

  await author.page.locator('.fh-toolbar [data-act=add]').click();
  await author.page.locator('[data-act=create-invite]').click();
  const link = author.page.locator('.fh-link-field input');
  const invitation = await link.inputValue();
  const token = new URL(invitation).hash.split('/').pop();
  async function request() {
    await go(visitor, 'friends/invite/' + token);
    const send = visitor.page.locator('[data-act=send-request]');
    await send.waitFor();
    await auditControls(visitor.page, visitor.page.locator('.fh'), 'Invitation');
    await send.click();
    const cancel = visitor.page.locator('[data-act=cancel-request]');
    await cancel.waitFor();
    return cancel.getAttribute('data-id');
  }
  const canceled = await request();
  await go(visitor, 'friends/people');
  await clickWrite(visitor, visitor.page.locator('[data-act=cancel-request]'), 'DELETE', '/requests/' + canceled);
  assert.deepEqual((await read(author, '/people')).incoming, []);

  const declined = await request();
  await go(author, 'friends/people');
  await clickWrite(author, author.page.locator('[data-act=decline]'), 'DELETE', '/requests/' + declined);
  assert.deepEqual((await read(visitor, '/people')).outgoing, []);

  await request();
  await go(author, 'friends/people');
  await author.page.locator('.fh-toolbar [data-act=add]').click();
  const revoke = author.page.locator('[data-act=revoke]');
  await revoke.click();
  await author.page.locator('.fh-actions [data-act=add]').click();
  assert.equal((await read(author, '/people')).invite.token, token);
  await revoke.click();
  await clickWrite(author, author.page.locator('[data-act=confirm-revoke]'), 'DELETE', '/invites/current');
  await author.page.locator('[data-act=create-invite]').waitFor();
  assert.deepEqual((await read(visitor, '/people')).outgoing, []);
  assert.equal((await api(visitor, '/invites/' + token)).status(), 410);
}

async function connect(owner, other) {
  await go(owner, 'friends/people');
  await owner.page.locator('.fh-toolbar [data-act=add]').click();
  await owner.page.locator('[data-act=create-invite]').click();
  const field = owner.page.locator('.fh-link-field input');
  await field.waitFor();
  const url = await field.inputValue();
  await other.page.bringToFront();
  await other.page.goto(url);
  await other.page.locator('[data-act=send-request]').click();
  await other.page.locator('[data-act=cancel-request]').waitFor();
  await go(owner, 'friends/people');
  await owner.page.locator('.fh-request').filter({ hasText: other.name }).locator('[data-act=accept]').click();
  await owner.page.locator('.fh-person-link').filter({ hasText: other.name }).waitFor();
  assert.ok((await read(other, '/people')).friends.some(p => p.id === owner.id));
}

async function saveAccess(author, mode, selected, first) {
  const form = author.page.locator('[data-sharing-form]');
  const radio = form.locator('[name=audience][value=' + mode + ']');
  await radio.check();
  assert.ok(await radio.isChecked());
  assert.equal(await form.getByRole('radio', { checked: true }).count(), 1);
  if (first) {
    assert.ok(await form.locator('[data-save-access]').isDisabled(), 'Choose a recipient before opening the day');
  }
  if (mode === 'selected') {
    const options = form.locator('[name=recipient]');
    await options.first().waitFor();
    for (const option of await options.all()) {
      const included = selected.includes(await option.getAttribute('value'));
      await option.setChecked(included);
      assert.equal(await option.isChecked(), included);
    }
  }
  if (first) await auditControls(author.page, author.page.locator('#sheet[open]'), 'Sharing dialog');
  const saved = author.page.waitForResponse(r => r.request().method() === (first ? 'PUT' : 'PATCH') &&
    new URL(r.url()).pathname.startsWith(apiRoot + '/publications/'));
  const gate = first ? author.site.holdNextWrite((method, pathname) =>
    method === 'PUT' && pathname.startsWith(apiRoot + '/publications/')) : null;
  try {
    await form.locator('[data-save-access]').click();
    if (gate) {
      await Promise.race([gate.seen, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('First publication never reached the Worker')), 15000);
        timer.unref();
      })]);
      assert.ok(await form.locator('[data-save-access]').isDisabled());
      assert.equal(await form.getAttribute('aria-busy'), 'true');
      await author.page.keyboard.press('Enter');
    }
  } finally { gate?.release(); }
  const reply = await saved;
  assert.ok(reply.ok(), 'Audience write ' + reply.status() + ' ' + await reply.text());
  await form.waitFor({ state: 'hidden' });
}

async function changeAccess(author, publication, mode, selected = [], checkCancel = false) {
  await go(author, 'friends/mine');
  await author.page.locator('[data-act=access][data-id="' + publication + '"]').click();
  if (checkCancel) {
    const form = author.page.locator('[data-sharing-form]');
    await form.locator('[data-remove]').click();
    await form.locator('[data-confirm]').waitFor();
    assert.ok(await form.locator('[data-remove-no]').evaluate(el => el === document.activeElement));
    await author.page.keyboard.press('Enter');
    await form.locator('[data-confirm]').waitFor({ state: 'hidden' });
    assert.equal((await read(author, '/publications/' + publication)).id, publication);
  }
  await saveAccess(author, mode, selected, false);
}

async function updateOnSecondDevice(browser, author, publication, recipients, errors) {
  await go(author, 'friends/mine');
  await author.page.locator('[data-act=access][data-id="' + publication + '"]').click();
  const stale = author.page.locator('[data-sharing-form]');
  await stale.locator('[name=audience][value=all]').check();

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await ctx.addCookies([author.site.cookieFor('author')]);
    const page = await ctx.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    await changeAccess({ ...author, page, ctx }, publication, 'selected', recipients, true);
  } finally { await ctx.close(); }

  await author.page.bringToFront();
  const attempted = author.page.waitForResponse(r => r.request().method() === 'PATCH' &&
    new URL(r.url()).pathname === apiRoot + '/publications/' + publication + '/access');
  await stale.locator('[data-save-access]').click();
  const rejected = await attempted;
  assert.equal(rejected.status(), 409);
  const current = await read(author, '/publications/' + publication);
  assert.equal(current.mode, 'selected');
  assert.deepEqual(current.recipientIds.sort(), [...recipients].sort());
  await stale.locator('[data-cancel]').click();
}

async function denied(actor, routes) {
  for (const route of routes) {
    const audio = route.includes('/media/');
    const reply = await api(actor, route, audio ? { headers: { Range: 'bytes=0-15' } } : {});
    assert.equal(reply.status(), 404, 'Revoked or missing grant for ' + route);
    assert.deepEqual(await reply.json(), { error: 'unavailable' });
    assert.match(reply.headers()['cache-control'], /no-store/);
  }
}

async function leaveComment(actor, text, audit = false) {
  const discussion = actor.page.locator('[data-discussion]');
  const input = discussion.locator('textarea[name=comment]');
  const send = discussion.locator('[data-send-comment]');
  await input.fill('  ');
  assert.ok(await send.isDisabled(), 'Blank comments cannot be submitted');
  await input.fill(text);
  if (audit) await auditControls(actor.page, discussion, 'Discussion');
  await send.click();
  await discussion.getByText(text, { exact: true }).waitFor();
  assert.ok(await input.evaluate(el => el === document.activeElement));
}

async function keyboardNavigation(actor) {
  await actor.page.bringToFront();
  const tab = actor.page.locator('.fh-tabs [data-id="friends/people"]');
  await tab.focus();
  await actor.page.keyboard.press('ArrowRight');
  assert.ok(await tab.evaluate(el => {
    const style = getComputedStyle(el);
    return el.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  }), 'Keyboard focus is visible on the People tab');
  await actor.page.keyboard.press('Enter');
  await actor.page.waitForURL('**/#friends/people');
  await actor.page.locator('.fh-tabs [data-id="friends/people"][aria-current=page]').waitFor();
}

async function toggleWarmth(actor, publication, expected) {
  const button = actor.page.locator('[data-reaction=warm]');
  const saved = actor.page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/reaction'));
  await button.click();
  assert.ok((await saved).ok());
  await actor.page.locator('[data-reaction=warm][aria-pressed=' + expected + ']').waitFor();
  const data = await read(actor, '/publications/' + publication + '/discussion');
  const own = data.reactions.filter(r => r.person.id === actor.id);
  assert.deepEqual(own.map(r => r.kind), expected ? ['warm'] : []);
}

async function journey(browser, site) {
  const errors = [];
  const signedOut = await fetch(site.origin + apiRoot + '/session');
  assert.deepEqual(await signedOut.json(), { authenticated: false, user: null });
  const author = await person(browser, site, 'author', 'Аня', 'ru', 1150, errors);
  const ilya = await person(browser, site, 'ilya', 'Илья', 'en', 320, errors);
  const lena = await person(browser, site, 'lena', 'Лена', 'kk', 390, errors);
  await keyboardNavigation(author);
  await checkInviteLifecycle(author, ilya, lena);
  await requestControls(author, lena);
  await connect(author, ilya);
  await connect(author, lena);
  await auditControls(author.page, author.page.locator('.fh'), 'People');
  assert.deepEqual((await read(ilya, '/feed')).days, []);

  await go(author, 'day/demo-leaves');
  await author.page.locator('[data-card=copy]').click();
  await author.page.locator('[data-ed-save]').click();
  await author.page.locator('[data-card=share]').click();
  await saveAccess(author, 'selected', [ilya.id], true);
  const mine = (await read(author, '/mine')).days;
  assert.equal(mine.length, 1);
  const id = mine[0].id, card = '/publications/' + id;
  const published = await read(ilya, card);
  const cover = published.day.photos[0].src, audio = published.day.music.src;
  const protectedPaths = [card, card + '/discussion', cover, audio];
  assert.deepEqual((await read(lena, '/feed')).days, []);
  await denied(lena, protectedPaths);

  await go(ilya, 'friends/person/' + author.id);
  const profileEntry = ilya.page.locator('.fh-day').filter({ hasText: mine[0].title });
  await profileEntry.focus();
  await profileEntry.press('Enter');
  await ilya.page.locator('[data-discussion]').waitFor();
  await ilya.page.locator('[data-shared-back]').click();
  await ilya.page.waitForURL('**/#friends/person/' + author.id);
  await profileEntry.waitFor();
  await ilya.page.waitForFunction(fid => document.activeElement?.dataset.fid === fid, 'day:' + id);

  await go(ilya, 'friends');
  const entry = ilya.page.locator('.fh-day').filter({ hasText: mine[0].title });
  await entry.click();
  await ilya.page.locator('[data-discussion]').waitFor();
  assert.equal(await ilya.page.locator('[data-card=edit],[data-card=viewer-edit],[data-card=share]').count(), 0);
  await ilya.page.waitForFunction(() => document.querySelector('[data-card=photo]')?.naturalWidth > 0);
  await ilya.page.locator('[data-card=hero-play]').click();
  await ilya.page.locator('.diary-card.is-playing').waitFor();
  await ilya.page.locator('[data-card=viewer][open] [data-discussion] [data-reaction=warm]').waitFor();
  await toggleWarmth(ilya, id, true);
  assert.equal(await ilya.page.locator('.diary-card.is-playing').count(), 1, 'Reacting preserves playback');
  await ilya.page.locator('[data-card=close]').click();
  await ilya.page.locator('[data-card=viewer] [data-discussion]').waitFor({ state: 'detached' });
  const bytes = await api(ilya, audio, { headers: { Range: 'bytes=0-15' } });
  assert.equal(bytes.status(), 206);
  assert.equal((await bytes.body()).length, 16);
  assert.match(bytes.headers()['cache-control'], /no-store/);
  for (const expected of [false, true]) await toggleWarmth(ilya, id, expected);
  const first = 'Тёплый день у реки.';
  await leaveComment(ilya, first, true);

  await updateOnSecondDevice(browser, author, id, [ilya.id, lena.id], errors);
  await go(lena, 'friends');
  await lena.page.locator('.fh-day').filter({ hasText: mine[0].title }).click();
  await lena.page.locator('[data-discussion]').getByText(first, { exact: true }).waitFor();
  const second = 'Сохранила этот момент.';
  await leaveComment(lena, second);
  await lena.page.locator('textarea[name=comment]').fill('Мой незаконченный ответ');
  await lena.page.locator('[data-card=hero-play]').click();
  await lena.page.locator('.diary-card.is-playing').waitFor();
  await changeAccess(author, id, 'selected', [ilya.id]);
  await denied(lena, protectedPaths);
  await lena.page.bringToFront();
  await lena.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await lena.page.locator('[data-card=hero]').waitFor({ state: 'detached', timeout: 25000 });
  const preserved = lena.page.locator('[data-draft-copy]');
  await preserved.waitFor({ timeout: 25000 });
  assert.equal(await preserved.inputValue(), 'Мой незаконченный ответ');
  assert.equal(await lena.page.locator('.diary-card.is-playing').count(), 0);
  assert.equal((await read(ilya, card)).id, id);

  await go(lena, 'friends/responses');
  await lena.page.locator('.fh-response-text').filter({ hasText: second }).waitFor();
  assert.equal(await lena.page.getByText(mine[0].title, { exact: true }).count(), 0);
  const commentAction = lena.page.locator('.fh-response').filter({ hasText: second }).locator('[data-act=comment]');
  const commentId = await commentAction.getAttribute('data-id');
  await commentAction.click();
  const [deleted] = await Promise.all([
    lena.page.waitForResponse(r => r.request().method() === 'DELETE' &&
      new URL(r.url()).pathname === apiRoot + '/my-responses/comment/' + commentId),
    lena.page.locator('[data-act=confirm-response]').click()
  ]);
  assert.equal(deleted.status(), 200);
  assert.deepEqual(await deleted.json(), { deleted: true });
  await lena.page.locator('#fh-content .fh-title + .fh-state').waitFor();
  assert.deepEqual((await read(lena, '/my-responses')).comments, []);

  await go(author, 'friends/people');
  await author.page.locator('.fh-person-link').filter({ hasText: ilya.name }).click();
  await author.page.locator('[data-act=friend-menu]').click();
  await author.page.locator('[data-act=remove]').click();
  await author.page.locator('.fh-actions [data-act=dismiss]').click();
  assert.ok((await read(author, '/people')).friends.some(p => p.id === ilya.id));
  for (const act of ['friend-menu', 'remove', 'confirm-remove']) await author.page.locator('[data-act=' + act + ']').click();
  await author.page.waitForURL('**/#friends/people');
  await denied(ilya, protectedPaths);
  assert.equal((await read(author, card)).mode, 'private');
  await connect(author, ilya);
  await denied(ilya, protectedPaths);
  await changeAccess(author, id, 'all');
  assert.equal((await read(ilya, card)).id, id);
  assert.equal((await read(lena, card)).id, id);
  assert.equal((await api(author, '/friends/' + lena.id, { method: 'DELETE' })).status(), 200);
  await denied(lena, protectedPaths);
  await connect(author, lena);
  assert.equal((await read(lena, card)).id, id, 'A new friend inherits the all-friends audience');
  assert.deepEqual(errors, []);
  console.log(engine + ' Friends passed: three isolated accounts, D1/R2, selected and all audiences, audio range, discussion, revocation and reconnection');
}

(async () => {
  const mf = new Miniflare({ modules: true, scriptPath: path.join(root, 'dist/server/index.js'),
    compatibilityDate: '2026-07-01', host: '127.0.0.1', d1Databases: ['DB'], r2Buckets: ['BUCKET'] });
  let browser, site;
  try {
    await migrate(mf);
    site = await serve(mf);
    const launch = { headless: true };
    if (engine === 'chromium') {
      launch.args = ['--mute-audio'];
      if (process.env.CHROME_CHANNEL) launch.channel = process.env.CHROME_CHANNEL;
    }
    assert.ok(['chromium', 'webkit'].includes(engine));
    browser = await (engine === 'webkit' ? webkit : chromium).launch(launch);
    await journey(browser, site);
  } finally {
    await browser?.close();
    await site?.close();
    await mf.dispose();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
