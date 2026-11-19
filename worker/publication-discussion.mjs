import { body, fail, json } from './http.mjs';
import { operationId, person, readable } from './publication-data.mjs';

const access=`SELECT 1 FROM publications p WHERE p.id=?2 AND ${readable}`;
const check=(db,user,id)=>db.prepare(access).bind(user,id);
function requireAccess(result) {
  if (!result.results.length) fail(404,'unavailable');
}
const timestamp=value=>new Date(value).toISOString();

export async function discussion(db,user,id) {
  const [allowed,comments,reactions]=await db.batch([
    check(db,user,id),
    db.prepare(`SELECT c.id,c.text,c.created_at,u.name,u.code,u.id owner_id FROM publication_comments c
      JOIN profiles u ON u.id=c.user_id WHERE c.publication_id=?2 AND c.text IS NOT NULL AND EXISTS(${access})
      ORDER BY c.created_at,c.rowid`).bind(user,id),
    db.prepare(`SELECT r.kind,u.name,u.code,u.id owner_id FROM publication_reactions r JOIN profiles u ON u.id=r.user_id
      WHERE r.publication_id=?2 AND EXISTS(${access}) ORDER BY u.name,u.id`).bind(user,id)
  ]);
  requireAccess(allowed);
  return json({
    comments:comments.results.map(c=>({id:c.id,text:c.text,createdAt:timestamp(c.created_at),person:person(c)})),
    reactions:reactions.results.map(r=>({kind:r.kind,person:person(r)}))
  });
}

export async function putComment(request,db,user,id,comment) {
  const input=await body(request);
  if (typeof input.text!=='string') fail(400,'invalid_comment');
  const text=input.text.trim();
  if (!text || !text.replace(/[\p{White_Space}\p{Cf}]/gu,'') || Array.from(text).length>1000) fail(400,'invalid_comment');
  const [allowed,,prior]=await db.batch([
    check(db,user,id),
    db.prepare(`INSERT INTO publication_comments(id,publication_id,user_id,text,created_at)
      SELECT ?3,?2,?1,?4,?5 WHERE EXISTS(${access}) ON CONFLICT(id) DO NOTHING`).bind(user,id,comment,text,Date.now()),
    db.prepare(`SELECT text FROM publication_comments WHERE user_id=?1 AND publication_id=?2 AND id=?3
      AND EXISTS(${access})`).bind(user,id,comment)
  ]);
  requireAccess(allowed);
  const saved=prior.results[0];
  // A removed message keeps just its ID so a delayed retry cannot restore it.
  if (!saved || (saved.text!==null && saved.text!==text)) fail(409,'comment_conflict');
  return json({id:comment});
}

export async function removeComment(db,user,id,comment) {
  const [allowed,eligible]=await db.batch([
    check(db,user,id),
    db.prepare(`SELECT 1 FROM publication_comments c JOIN publications p ON c.publication_id=p.id
      WHERE p.id=?2 AND c.id=?3 AND (p.owner_id=?1 OR c.user_id=?1) AND ${readable}`).bind(user,id,comment),
    db.prepare(`UPDATE publication_comments SET text=NULL WHERE id=?3 AND publication_id=?2 AND EXISTS(
      SELECT 1 FROM publications p WHERE p.id=?2 AND (p.owner_id=?1 OR publication_comments.user_id=?1) AND ${readable})`)
      .bind(user,id,comment)
  ]);
  requireAccess(allowed);
  if (!eligible.results.length) fail(404,'unavailable');
  return json({id:comment,deleted:true});
}

export async function putReaction(request,db,user,id) {
  const input=await body(request), kind=input.kind;
  if (kind!==null && !['close','warm','surprise'].includes(kind)) fail(400,'invalid_reaction');
  const key=operationId(request,input), value=kind || 'removed';
  const replay=`SELECT digest FROM publication_operations WHERE actor_id=?1 AND publication_id=?2 AND scope='reaction' AND operation_id=?3`;
  const condition=`EXISTS(${access}) AND (?3 IS NULL OR NOT EXISTS(${replay}))`;
  const statements=[check(db,user,id)];
  if (kind===null) {
    statements.push(db.prepare(`DELETE FROM publication_reactions WHERE publication_id=?2 AND user_id=?1 AND ${condition}`).bind(user,id,key));
  } else {
    statements.push(db.prepare(`INSERT INTO publication_reactions(publication_id,user_id,kind) SELECT ?2,?1,?4
      WHERE ${condition} ON CONFLICT(publication_id,user_id) DO UPDATE SET kind=excluded.kind`).bind(user,id,key,kind));
  }
  if (key) statements.push(
    db.prepare(`INSERT INTO publication_operations(publication_id,actor_id,scope,operation_id,digest)
      SELECT ?2,?1,'reaction',?3,?4 WHERE ${condition} ON CONFLICT DO NOTHING`).bind(user,id,key,value),
    db.prepare(replay).bind(user,id,key)
  );
  const result=await db.batch(statements);
  requireAccess(result[0]);
  if (key && result.at(-1).results[0]?.digest!==value) fail(409,'operation_conflict');
  return json({ok:true});
}

export async function myResponses(db,user) {
  const [comments,reactions]=await db.batch([
    db.prepare(`SELECT id,publication_id,text,created_at FROM publication_comments WHERE user_id=? AND text IS NOT NULL
      ORDER BY created_at DESC,rowid DESC`).bind(user),
    db.prepare('SELECT publication_id,kind FROM publication_reactions WHERE user_id=? ORDER BY rowid DESC').bind(user)
  ]);
  return json({
    comments:comments.results.map(c=>({id:c.id,publicationId:c.publication_id,text:c.text,createdAt:timestamp(c.created_at)})),
    reactions:reactions.results.map(r=>({publicationId:r.publication_id,kind:r.kind}))
  });
}

export async function removeMyResponse(db,user,kind,id) {
  const sql=kind==='comment' ? 'UPDATE publication_comments SET text=NULL WHERE user_id=? AND id=?' :
    'DELETE FROM publication_reactions WHERE user_id=? AND publication_id=?';
  await db.prepare(sql).bind(user,id).run();
  return json({deleted:true});
}
