import { body, fail, json } from './http.mjs';

const profileColumns = 'id, name, code';
const activeInvite = 'expires_at > unixepoch()';

function lookupProfile(db, user) {
  return db.prepare(`SELECT ${profileColumns} FROM profiles WHERE id = ?`).bind(user).first();
}

function session(user, authenticated = true) {
  return json({ authenticated, user });
}

async function saveProfile(db, id, request) {
  const { name: input } = await body(request);
  const name = typeof input === 'string' ? input.normalize('NFC').trim() : '';
  if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(name) || [...name].length > 60 ||
      /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(name)) fail(400, 'invalid_name');

  const upsert = db.prepare(`
    INSERT INTO profiles (id, name, code) VALUES (?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name
    ON CONFLICT (code) DO NOTHING
    RETURNING ${profileColumns}
  `);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();
    const profile = await upsert.bind(id, name, code).first();
    if (profile) return session(profile);
  }
  fail(503, 'profile_code_unavailable');
}

function serializeInvite(row) {
  return row ? { token: row.token, expiresAt: new Date(row.expires_at * 1000).toISOString() } : null;
}

function currentInvite(db, user) {
  return db.prepare(`SELECT token, expires_at FROM friend_invites WHERE owner_id = ? AND ${activeInvite}`).bind(user);
}

async function createInvite(db, user) {
  const [, , state] = await db.batch([
    db.prepare(`DELETE FROM friend_invites WHERE owner_id = ? AND expires_at <= unixepoch()`).bind(user),
    db.prepare(`
      INSERT INTO friend_invites (token, owner_id, expires_at) VALUES (?, ?, unixepoch() + 604800)
      ON CONFLICT (owner_id) DO NOTHING
    `).bind(crypto.randomUUID(), user),
    currentInvite(db, user)
  ]);
  return json(serializeInvite(state.results[0]));
}

async function revokeInvite(db, user, expectedToken) {
  if (expectedToken === null) {
    await db.prepare('DELETE FROM friend_invites WHERE owner_id = ?').bind(user).run();
  } else {
    const [, remaining] = await db.batch([
      db.prepare('DELETE FROM friend_invites WHERE owner_id = ? AND token = ?').bind(user, expectedToken),
      currentInvite(db, user)
    ]);
    if (remaining.results.length) fail(409, 'invite_changed');
  }
  return json({ ok: true });
}

async function listPeople(db, user) {
  const [friends, requests, invite] = await db.batch([
    db.prepare(`
      SELECT p.id, p.name, p.code FROM friendships AS f
      JOIN profiles AS p ON p.id = CASE WHEN f.a = ?1 THEN f.b ELSE f.a END
      WHERE f.a = ?1 OR f.b = ?1 ORDER BY p.name COLLATE NOCASE, p.code
    `).bind(user),
    db.prepare(`
      SELECT r.id AS request_id, r.owner_id, p.id, p.name, p.code FROM active_friend_requests AS r
      JOIN profiles AS p ON p.id = CASE WHEN r.owner_id = ?1 THEN r.requester_id ELSE r.owner_id END
      WHERE r.owner_id = ?1 OR r.requester_id = ?1 ORDER BY r.created_at, r.id
    `).bind(user),
    currentInvite(db, user)
  ]);
  const incoming = [], outgoing = [];
  for (const { request_id, owner_id, ...person } of requests.results) {
    const list = owner_id === user ? incoming : outgoing;
    list.push({ id: request_id, person });
  }
  return json({ friends: friends.results, incoming, outgoing, invite: serializeInvite(invite.results[0]) });
}

function findInviteStatus(db, token, user) {
  // Only participants can revisit a consumed link. Its receipt disappears with the friendship.
  return db.prepare(`
    WITH invitation AS (
      SELECT owner_id FROM friend_invites WHERE token = ?1 AND ${activeInvite}
      UNION ALL
      SELECT inviter_id FROM friendships WHERE accepted_token = ?1 AND ?2 IN (a, b)
    )
    SELECT p.id, p.name, p.code, f.a AS friend, r.id AS request_id, r.requester_id
    FROM invitation AS i JOIN profiles AS p ON p.id = i.owner_id
    LEFT JOIN friendships AS f ON f.a = min(?2, p.id) AND f.b = max(?2, p.id)
    LEFT JOIN active_friend_requests AS r
      ON min(r.owner_id, r.requester_id) = min(?2, p.id)
      AND max(r.owner_id, r.requester_id) = max(?2, p.id)
  `).bind(token, user);
}

function inviteResponse(row, user) {
  if (!row) fail(410, 'invite_unavailable');
  const { id, name, code, friend, request_id, requester_id } = row;
  const person = { id, name, code };
  if (id === user) return json({ person, status: 'self' });
  if (friend) return json({ person, status: 'friends' });
  if (request_id) {
    return json({ person, status: requester_id === user ? 'pending' : 'incoming', requestId: request_id });
  }
  return json({ person, status: 'available' });
}

async function requestFriend(db, token, user) {
  const [, , state] = await db.batch([
    // An expired reciprocal request must not occupy the pair's unique index.
    db.prepare(`DELETE FROM friend_invites WHERE owner_id = ? AND expires_at <= unixepoch()`).bind(user),
    db.prepare(`
      INSERT INTO friend_requests (id, token, owner_id, requester_id)
      SELECT ?1, i.token, i.owner_id, ?2 FROM friend_invites AS i
      WHERE i.token = ?3 AND i.owner_id <> ?2 AND i.${activeInvite}
        AND NOT EXISTS (SELECT 1 FROM friendships WHERE a = min(?2, i.owner_id) AND b = max(?2, i.owner_id))
      ON CONFLICT DO NOTHING
    `).bind(crypto.randomUUID(), user, token),
    findInviteStatus(db, token, user)
  ]);
  return inviteResponse(state.results[0], user);
}

async function acceptRequest(db, id, user) {
  const [, , receipt] = await db.batch([
    db.prepare(`
      INSERT INTO friendships (a, b, inviter_id, accepted_token, accepted_request_id)
      SELECT min(owner_id, requester_id), max(owner_id, requester_id), owner_id, token, id
      FROM active_friend_requests WHERE id = ? AND owner_id = ?
      ON CONFLICT DO NOTHING
    `).bind(id, user),
    // Consuming the winning invitation cascades to every pending request made through it.
    db.prepare(`
      DELETE FROM friend_invites WHERE token = (
        SELECT accepted_token FROM friendships WHERE accepted_request_id = ? AND inviter_id = ?
      )
    `).bind(id, user),
    db.prepare('SELECT 1 AS accepted FROM friendships WHERE accepted_request_id = ? AND inviter_id = ?').bind(id, user)
  ]);
  if (!receipt.results.length) fail(404, 'request_unavailable');
  return json({ ok: true });
}

async function removeFriend(db, user, other) {
  if (other === user) return json({ ok: true });
  await db.batch([
    db.prepare(`
      UPDATE publications SET access_version = access_version + 1,
        mode = CASE WHEN (
          SELECT COUNT(*) FROM recipients WHERE publication_id = publications.id
        ) = 1 THEN 'private' ELSE mode END
      WHERE owner_id IN (?1, ?2) AND mode = 'selected' AND EXISTS (
        SELECT 1 FROM recipients WHERE publication_id = publications.id AND
          ((publications.owner_id = ?1 AND user_id = ?2) OR (publications.owner_id = ?2 AND user_id = ?1))
      )
    `).bind(user, other),
    db.prepare(`
      DELETE FROM recipients WHERE
        (user_id = ?1 AND publication_id IN (SELECT id FROM publications WHERE owner_id = ?2)) OR
        (user_id = ?2 AND publication_id IN (SELECT id FROM publications WHERE owner_id = ?1))
    `).bind(user, other),
    db.prepare('DELETE FROM friendships WHERE a = min(?1, ?2) AND b = max(?1, ?2)').bind(user, other)
  ]);
  return json({ ok: true });
}

export async function handlePeople(request, env, user, path) {
  const route = /^\/(session|profile|people|invites|requests|friends)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path);
  if (!route) return null;
  const [, group, id, action] = route;
  const { method } = request;
  const db = env.DB;

  if (group === 'session' && !id && method === 'GET') {
    return user ? session(await lookupProfile(db, user)) : session(null, false);
  }
  if (group === 'invites' && id && id !== 'current' && !action && method === 'GET') {
    return inviteResponse(await findInviteStatus(db, id, user).first(), user);
  }
  if (!user) fail(401, 'auth_required');
  if (group === 'profile' && !id && method === 'POST') return saveProfile(db, user, request);
  if (!(await lookupProfile(db, user))) fail(409, 'profile_required');

  if (group === 'people' && !id && method === 'GET') return listPeople(db, user);
  if (group === 'invites') {
    if (!id && method === 'POST') return createInvite(db, user);
    if (id === 'current' && !action && method === 'DELETE') {
      return revokeInvite(db, user, new URL(request.url).searchParams.get('token'));
    }
    if (id && action === 'request' && method === 'POST') return requestFriend(db, id, user);
  }
  if (group === 'requests' && id) {
    if (action === 'accept' && method === 'POST') return acceptRequest(db, id, user);
    if (!action && method === 'DELETE') {
      await db.prepare('DELETE FROM friend_requests WHERE id = ?1 AND ?2 IN (owner_id, requester_id)').bind(id, user).run();
      return json({ ok: true });
    }
  }
  if (group === 'friends' && id && !action && method === 'DELETE') return removeFriend(db, user, id);
  fail(405, 'method_not_allowed');
}
