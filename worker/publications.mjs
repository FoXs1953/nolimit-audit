import { body, fail, json } from './http.mjs';
import { asPublication, audience, cleanDay, digest, friends, mediaURL, operationId, person, readable, uuid } from './publication-data.mjs';
import { collectPublicationMedia, readMedia, upload } from './publication-media.mjs';
import { discussion, myResponses, putComment, putReaction, removeComment, removeMyResponse } from './publication-discussion.mjs';

export { collectPublicationMedia };

async function publication(db,user,id) {
  const [card,selected]=await db.batch([
    db.prepare(`SELECT p.*,u.name,u.code FROM publications p JOIN profiles u ON u.id=p.owner_id
      WHERE p.id=?2 AND ${readable}`).bind(user,id),
    db.prepare(`SELECT r.user_id FROM recipients r JOIN publications p ON p.id=r.publication_id
      WHERE p.id=? AND p.owner_id=? ORDER BY r.user_id`).bind(id,user)
  ]);
  const row=card.results[0];
  if (!row) fail(404,'unavailable');
  const result=asPublication(row);
  if (row.owner_id===user) result.recipientIds=selected.results.map(r=>r.user_id);
  return json(result);
}

async function feed(request,db,user,mine) {
  const author=new URL(request.url).searchParams.get('author');
  const condition=mine ? 'p.owner_id=?1' : `p.owner_id<>?1 AND ${readable}${author ? ' AND p.owner_id=?2' : ''}`;
  const query=db.prepare(`SELECT p.id,p.owner_id,u.name,u.code,p.mode,p.access_version,p.content_version,
    json_extract(p.day_json,'$.title') title,json_extract(p.day_json,'$.date') date,
    json_extract(p.day_json,'$.photos[0].assetId') cover FROM publications p JOIN profiles u ON u.id=p.owner_id
    WHERE ${condition} ORDER BY p.published_at DESC,p.id DESC`);
  const {results}=await query.bind(...(!mine && author ? [user,author] : [user])).all();
  return json({days:results.map(row=>({
    id:row.id,title:row.title,date:row.date,cover:row.cover ? mediaURL(row.id,row.cover) : null,owner:person(row),
    ...(mine ? {mode:row.mode,accessVersion:row.access_version,contentVersion:row.content_version} : {})
  }))});
}

const validAssets=`NOT EXISTS (SELECT 1 FROM json_each(?4) a WHERE NOT EXISTS (
  SELECT 1 FROM publication_media m WHERE m.id=json_extract(a.value,'$.id') AND m.kind=json_extract(a.value,'$.kind')
  AND m.owner_id=?1 AND (m.state='staged' OR (m.state='active' AND m.publication_id=?2))))`;
const validRecipients=param=>`NOT EXISTS (SELECT 1 FROM json_each(${param}) a WHERE NOT ${friends('?1','a.value')})`;

function opSQL(db,id,user,scope,key) {
  return db.prepare('SELECT digest FROM publication_operations WHERE publication_id=? AND actor_id=? AND scope=? AND operation_id=?')
    .bind(id,user,scope,key);
}

function noOperation(scope,key) {
  return `NOT EXISTS (SELECT 1 FROM publication_operations WHERE publication_id=?2 AND actor_id=?1 AND scope='${scope}' AND operation_id=${key})`;
}

function guard(column) {
  return `EXISTS (SELECT 1 FROM publications WHERE id=?1 AND ${column}=?2)`;
}

function setRecipients(db,id,marker,ids) {
  const test=guard('access_marker');
  return [
    db.prepare(`DELETE FROM recipients WHERE publication_id=?1 AND ${test}`).bind(id,marker),
    db.prepare(`INSERT INTO recipients(publication_id,user_id) SELECT ?1,value FROM json_each(?3) WHERE ${test}`)
      .bind(id,marker,JSON.stringify(ids))
  ];
}

function receipt(db,id,marker,column,user,scope,key,hash) {
  return db.prepare(`INSERT INTO publication_operations(publication_id,actor_id,scope,operation_id,digest)
    SELECT ?1,?3,?4,?5,?6 WHERE ${guard(column)}`).bind(id,marker,user,scope,key,hash);
}

function insistVersion(value) {
  if (!Number.isSafeInteger(value) || value<0) fail(400,'invalid_version');
}

async function save(request,env,user,id,accessOnly) {
  const input=await body(request), db=env.DB;
  const expected=accessOnly ? input.accessVersion : input.contentVersion;
  insistVersion(expected);
  const create=!accessOnly && expected===0;
  const acl=create || accessOnly ? audience(input) : null;
  const snapshot=accessOnly ? null : cleanDay(input.day);
  const hash=await digest([expected,acl,snapshot?.day]);
  const scope=accessOnly?'access':'content', key=operationId(request,input) || hash, marker=crypto.randomUUID();
  const column=accessOnly?'access_marker':'content_marker';
  const ids=JSON.stringify(acl?.ids || []), assets=JSON.stringify(snapshot?.assets || []);
  const serialized=JSON.stringify(snapshot?.day || null);
  const sql=[];
  if (create) {
    sql.push(db.prepare(`INSERT INTO publications(id,owner_id,day_json,mode,content_marker,access_marker,published_at)
      SELECT ?2,?1,?3,?5,?7,?7,?8 WHERE ${validAssets} AND ${validRecipients('?6')}
      AND NOT EXISTS (SELECT 1 FROM deleted_publications WHERE id=?2)
      ON CONFLICT(id) DO NOTHING`).bind(user,id,serialized,assets,acl.mode,ids,marker,Date.now()));
  } else if (accessOnly) {
    sql.push(db.prepare(`UPDATE publications SET mode=?3,access_version=access_version+1,access_marker=?5
      WHERE id=?2 AND owner_id=?1 AND access_version=?6 AND ${validRecipients('?4')} AND ${noOperation(scope,'?7')}`)
      .bind(user,id,acl.mode,ids,marker,expected,key));
  } else {
    sql.push(db.prepare(`UPDATE publications SET day_json=?3,content_version=content_version+1,content_marker=?5
      WHERE id=?2 AND owner_id=?1 AND content_version=?6 AND ${validAssets} AND ${noOperation(scope,'?7')}`)
      .bind(user,id,serialized,assets,marker,expected,key));
  }
  if (acl) sql.push(...setRecipients(db,id,marker,acl.ids));
  if (snapshot) {
    const selected="SELECT json_extract(value,'$.id') FROM json_each(?3)", test=guard('content_marker');
    sql.push(
      db.prepare(`UPDATE publication_media SET publication_id=NULL,state='garbage' WHERE publication_id=?1
        AND id NOT IN (${selected}) AND ${test}`).bind(id,marker,assets),
      db.prepare(`UPDATE publication_media SET publication_id=?1,state='active' WHERE id IN (${selected}) AND ${test}`).bind(id,marker,assets)
    );
  }
  sql.push(receipt(db,id,marker,column,user,scope,key,hash),opSQL(db,id,user,scope,key));
  const results=await db.batch(sql);
  const accepted=results.at(-1).results[0];
  if (!accepted) {
    const current=await db.prepare('SELECT owner_id,access_version,content_version FROM publications WHERE id=?').bind(id).first();
    if ((!create && !current) || (current && current.owner_id!==user)) fail(404,'unavailable');
    if (current && (accessOnly?current.access_version:current.content_version)!==expected) fail(409,'version_conflict');
    if (acl) {
      const valid=await db.prepare(`SELECT ${validRecipients('?2')} AS ok`).bind(user,ids).first();
      if (!valid.ok) fail(409,'invalid_recipient');
    }
    if (snapshot) {
      const valid=await db.prepare(`SELECT ${validAssets} AS ok`).bind(user,id,null,assets).first();
      if (!valid.ok) fail(409,'media_unavailable');
    }
    fail(409,'version_conflict');
  }
  if (accepted.digest!==hash) fail(409,'operation_conflict');
  if (snapshot && !create) await collectPublicationMedia(env);
  return publication(db,user,id);
}

async function removePublication(env,user,id) {
  const db=env.DB;
  const result=await db.batch([
    db.prepare(`INSERT INTO deleted_publications(id,owner_id) SELECT id,owner_id FROM publications
      WHERE id=? AND owner_id=? ON CONFLICT(id) DO NOTHING`).bind(id,user),
    db.prepare(`UPDATE publication_media SET state='garbage',publication_id=NULL WHERE publication_id=?1
      AND EXISTS (SELECT 1 FROM publications WHERE id=?1 AND owner_id=?2)`).bind(id,user),
    db.prepare('DELETE FROM publications WHERE id=? AND owner_id=?').bind(id,user),
    db.prepare('SELECT 1 FROM deleted_publications WHERE id=? AND owner_id=?').bind(id,user),
  ]);
  if (!result[3].results.length) fail(404,'unavailable');
  await collectPublicationMedia(env);
  return json({id,deleted:true});
}

export async function handlePublications(request,env,user,path) {
  const [section,id,action,child,...extra]=path.split('/').slice(1);
  if (!['uploads','publications','feed','mine','media','my-responses'].includes(section)) return null;
  if (!user) fail(401,'auth_required');
  const method=request.method, db=env.DB;
  if (extra.length) fail(404,'unavailable');
  if (!await db.prepare('SELECT 1 FROM profiles WHERE id=?').bind(user).first()) fail(409,'profile_required');
  if (section==='my-responses') {
    if (!id && method==='GET') return myResponses(db,user);
    if (!child && uuid.test(action) && ['comment','reaction'].includes(id) && method==='DELETE')
      return removeMyResponse(db,user,id,action);
  }
  if (!id && method==='GET' && (section==='feed' || section==='mine')) return feed(request,db,user,section==='mine');
  if (!uuid.test(id)) fail(404,'unavailable');
  if (section==='media' && !child && uuid.test(action) && ['GET','HEAD'].includes(method)) return readMedia(request,env,user,id,action);
  if (section==='uploads' && !action && method==='POST') return upload(request,env,user,id);
  if (section==='publications') {
    if (!action && method==='GET') return publication(db,user,id);
    if (!action && method==='PUT') return save(request,env,user,id,false);
    if (!action && method==='DELETE') return removePublication(env,user,id);
    if (action==='access' && !child && method==='PATCH') return save(request,env,user,id,true);
    if (action==='discussion' && !child && method==='GET') return discussion(db,user,id);
    if (action==='reaction' && !child && method==='PUT') return putReaction(request,db,user,id);
    if (action==='comments' && uuid.test(child)) {
      if (method==='PUT') return putComment(request,db,user,id,child);
      if (method==='DELETE') return removeComment(db,user,id,child);
    }
  }
  fail(404,'unavailable');
}
