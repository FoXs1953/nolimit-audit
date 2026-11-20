import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const root=fileURLToPath(new URL('../',import.meta.url));
const {outputFiles}=await build({
  stdin:{contents:`import {handlePublications,collectPublicationMedia} from './worker/publications.mjs';
    import {json} from './worker/http.mjs';
    export default {async fetch(r,env) {try {
      return await handlePublications(r,env,r.headers.get('test-profile'),new URL(r.url).pathname.replace('/api/social','')) || json({},404);
    } catch(e){return json({error:e.code||e.message}, e.status||500)}}};`,resolveDir:root},
  bundle:true,format:'esm',target:'es2022',write:false
});
const mf=new Miniflare({modules:true,script:outputFiles[0].text,d1Databases:['DB'],r2Buckets:['BUCKET'],compatibilityDate:'2025-04-01'});
const id=()=>crypto.randomUUID(), pub=id(), photo=id(), audio=id(), video=id(), otherPhoto=id(), comment=id();
const photoAudio=id();
const files=new URL('../dist/diary/media/',import.meta.url);
const image=await readFile(new URL('river.jpg',files)), song=await readFile(new URL('coffee.mp3',files));
const webmHeader=Buffer.from([0x1a,0x45,0xdf,0xa3,0x42,0x82,0x84,0x77,0x65,0x62,0x6d]);
const videoSize=50*1024*1024;
function videoStream(size) {
  let written=0;
  return new ReadableStream({
    pull(controller) {
      const bytes=new Uint8Array(Math.min(size-written,64*1024));
      if (!written) bytes.set(webmHeader);
      written+=bytes.length;
      if (written===size) bytes[bytes.length-1]=0xaf;
      controller.enqueue(bytes);
      if (written===size) controller.close();
    }
  });
}
const card={title:'River bend',caption:'Spring',text:'An afternoon walk',date:'2026-06-30',
  recipe:{version:1,color:'#228833',reasons:{private:'never disclose'}},photos:[{assetId:video,kind:'video'},
    {assetId:photo,name:'private.jpg',caption:'By the river',music:{kind:'file',assetId:photoAudio,name:'private.mp3'}}],
  music:{kind:'file',assetId:audio,name:'local_filename'},moments:['private note']};
const A='anna', B='ilya', C='lena';
async function request(who,method,path,data,extra={}) {
  const headers={'test-profile':who,...extra};
  let body=data;
  const streaming=data instanceof ReadableStream;
  if (data && !Buffer.isBuffer(data) && !streaming) {headers['Content-Type']='application/json';body=JSON.stringify(data);}
  return mf.dispatchFetch('https://diary.test/api/social'+path,{method,headers,body,...(streaming?{duplex:'half'}:{})});
}
async function api(who,method,path,data,expected=200,extra={}) {
  const r=await request(who,method,path,data,extra), result=await r.json();
  assert.equal(r.status,expected,method+' '+path+' '+JSON.stringify(result));
  assert.match(r.headers.get('Cache-Control'),/no-store/);
  return result;
}
const publish=(data,status,extra)=>api(A,'PUT','/publications/'+pub,data,status,extra);
const upload=(who,key,data,type,expected=200)=>api(who,'POST','/uploads/'+key,data,expected,{
  'Content-Type':type,...(Buffer.isBuffer(data)?{'Content-Length':String(data.length)}:{})
});
try {
  const db=await mf.getD1Database('DB');
  for (const file of ['0000_people','0001_publications']) {
    const migration=await readFile(new URL('../drizzle/'+file+'.sql',import.meta.url),'utf8');
    // Migrations here contain plain statements and no trigger bodies.
    const statements=migration.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
    await db.batch(statements.map(s=>db.prepare(s)));
  }
  await db.batch([A,B,C].map(u=>db.prepare('INSERT INTO profiles(id,name,code) VALUES(?,?,?)').bind(u,u,u)));
  const friend=(b)=>db.prepare('INSERT INTO friendships(a,b,inviter_id,accepted_token,accepted_request_id) VALUES(?,?,?,?,?)').bind(A,b,A,id(),id()).run();
  await friend(B);
  await upload(A,photo,image,'image/jpeg');
  await upload(A,video,videoStream(videoSize),'video/webm');
  await upload(A,id(),image,'video/mp4',415);
  await upload(A,audio,song,'audio/mpeg');
  await upload(A,photoAudio,song,'audio/mpeg');
  await upload(C,otherPhoto,image,'image/jpeg');
  await upload(A,id(),Buffer.from('<html>'), 'image/png',415);
  const first={day:card,mode:'selected',recipientIds:[B],contentVersion:0,operationId:id()};
  assert.equal((await publish({...first,recipientIds:[C]},409)).error,'invalid_recipient');
  await publish({...first,day:{...card,photos:[{assetId:otherPhoto}]}},409);
  assert.equal((await api(A,'GET','/mine')).days.length,0);
  await publish({...first,day:{...card,photos:[{assetId:video}]}},409);
  const still=card.photos[1];
  await publish({...first,day:{...card,photos:[{...still,caption:'a'.repeat(221)}]}},400);
  await publish({...first,day:{...card,photos:[{...still,music:{kind:'file',assetId:photo}}]}},409);
  await publish({...first,day:{...card,music:null,photos:[{assetId:photo}]}},400);
  const saved=await publish(first);
  assert.equal(saved.accessVersion,1);
  assert.deepEqual(saved.recipientIds,[B]);
  assert.equal(saved.day.music.name,undefined);
  assert.equal(saved.day.moments,undefined);
  assert.equal(saved.day.photos[0].kind,'video');
  assert.equal(saved.day.photos[1].name,undefined);
  assert.equal(saved.day.photos[1].caption,'By the river');
  assert.equal(saved.day.photos[1].music.name,undefined);
  const frameMedia=saved.day.photos[1].music.src.replace('/api/social','');
  const frameRange=await request(B,'GET',frameMedia,null,{Range:'bytes=0-7'});
  assert.equal(frameRange.status,206);
  assert.deepEqual(Buffer.from(await frameRange.arrayBuffer()),song.subarray(0,8));
  await api(C,'GET',frameMedia,null,404);
  const cover=await request(B,'GET',saved.day.photos[0].src.replace('/api/social',''),null,{Range:'bytes=0-3'});
  assert.equal(cover.status,206);
  assert.equal(cover.headers.get('Content-Type'),'video/webm');
  assert.deepEqual(Buffer.from(await cover.arrayBuffer()),webmHeader.subarray(0,4));
  assert.equal(cover.headers.get('Content-Range'),'bytes 0-3/'+videoSize);
  const finalByte=await request(B,'GET',saved.day.photos[0].src.replace('/api/social',''),null,{Range:'bytes=-1'});
  assert.deepEqual(Buffer.from(await finalByte.arrayBuffer()),Buffer.from([0xaf]));
  assert.equal((await api(B,'GET','/feed')).days[0].coverKind,'video');
  assert.equal(saved.day.recipe.reasons,undefined);
  assert.equal((await publish(first)).contentVersion,1);
  await api(C,'GET','/publications/'+pub,null,404);
  assert.equal((await api(C,'GET','/feed')).days.length,0);
  assert.equal((await api(B,'GET','/feed?author='+A)).days[0].id,pub);
  assert.equal((await api(B,'GET','/publications/'+pub)).recipientIds,undefined);
  const media=saved.day.music.src.replace('/api/social','');
  const range=await request(B,'GET',media,null,{Range:'bytes=3-8'});
  assert.equal(range.status,206);
  assert.match(range.headers.get('Cache-Control'),/no-store/);
  assert.equal(range.headers.get('Content-Range'),'bytes 3-8/'+song.length);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),song.subarray(3,9));
  const suffix=await request(B,'GET',media,null,{Range:'bytes=-10'});
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),song.subarray(-10));
  assert.equal((await request(B,'HEAD',media,null,{Range:'bytes='+song.length+'-'})).status,416);
  const comments='/publications/'+pub+'/comments/',discussion='/publications/'+pub+'/discussion';
  await api(B,'PUT',comments+comment,{text:'A quiet afternoon'});
  await api(B,'PUT',comments+comment,{text:'A quiet afternoon'});
  await api(B,'PUT',comments+id(),{text:'  \u200b  '},400);
  await api(B,'PUT',comments+id(),{text:'🎵'.repeat(1001)},400);
  const reaction='/publications/'+pub+'/reaction', op=id();
  await api(B,'PUT',reaction,{kind:'warm',operationId:op});
  await api(B,'PUT',reaction,{kind:'surprise',operationId:id()});
  await api(B,'PUT',reaction,{kind:'warm',operationId:op});
  const thread=await api(B,'GET',discussion);
  assert.equal(thread.comments.length,1);
  assert.equal(thread.reactions[0].kind,'surprise');
  await friend(C);
  const access='/publications/'+pub+'/access', expand={mode:'all',accessVersion:1,operationId:id()};
  await api(A,'PATCH',access,expand);
  assert.equal((await api(C,'GET',discussion)).comments[0].person.id,B);
  await api(C,'DELETE',comments+comment,null,404);
  await api(A,'PATCH',access,{mode:'selected',recipientIds:[C],accessVersion:2});
  await api(A,'PATCH',access,expand);
  await api(A,'PATCH',access,{mode:'all',accessVersion:2},409);
  await api(B,'GET',discussion,null,404);
  await api(B,'GET',media,null,404,{Range:'bytes=3-8'});
  await api(B,'GET',frameMedia,null,404,{Range:'bytes=0-7'});
  await api(B,'PUT',comments+id(),{text:'revoked'},404);
  await api(B,'PUT',reaction,{kind:'close'},404);
  assert.deepEqual(Object.keys((await api(B,'GET','/my-responses')).comments[0]).sort(),['createdAt','id','publicationId','text']);
  await api(B,'DELETE','/my-responses/comment/'+comment);
  await api(B,'DELETE','/my-responses/reaction/'+pub);
  assert.deepEqual(await api(B,'GET','/my-responses'),{comments:[],reactions:[]});
  assert.deepEqual(await api(C,'GET',discussion),{comments:[],reactions:[]});
  const replacement=id(), replacementAudio=id();
  await upload(A,replacement,image,'image/jpeg');
  await upload(A,replacementAudio,song,'audio/mpeg');
  const revised={...card,title:'Later',music:null,photos:[{assetId:replacement,music:{kind:'file',assetId:replacementAudio}}]};
  assert.equal((await publish({day:revised,mode:'all',contentVersion:1})).mode,'selected');
  await api(B,'GET','/publications/'+pub,null,404);
  await api(A,'GET','/media/'+pub+'/'+photo,null,404);
  await api(A,'GET',frameMedia,null,404);
  await publish({day:card,contentVersion:1},409);
  await publish({day:card,contentVersion:2},409);
  const updated=await api(C,'GET','/publications/'+pub);
  assert.equal(updated.day.title,'Later');
  assert.equal(updated.day.music,null);
  const newFrameMedia=updated.day.photos[0].music.src.replace('/api/social','');
  assert.equal((await request(C,'HEAD',newFrameMedia)).status,200);
  await api(C,'DELETE','/publications/'+pub,null,404);
  await api(A,'DELETE','/publications/'+pub);
  await api(A,'DELETE','/publications/'+pub);
  await api(A,'GET','/publications/'+pub,null,404);
  await api(A,'GET',media,null,404);
  await api(A,'GET',newFrameMedia,null,404);
  await publish(first,409);
  assert.equal((await api(A,'GET','/mine')).days.length,0);
  assert.deepEqual(await api(C,'GET','/my-responses'),{comments:[],reactions:[]});
  const bucket=await mf.getR2Bucket('BUCKET');
  assert.equal((await bucket.list()).objects.length,1);
  console.log('Publication checks passed with the Worker runtime, D1 and R2.');
} finally { await mf.dispose(); }
