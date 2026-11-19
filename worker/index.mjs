import {handlePeople} from './people.mjs';
import {handlePublications} from './publications.mjs';
import {json,fail} from './http.mjs';
import {publicFiles} from 'nolimit:public-files';

const apiRoot='/api/social';
async function accountId(request) {
  const id=request.headers.get('oai-authenticated-user-id');
  if (!id || !request.headers.get('oai-authenticated-user-email')) return null;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('nolimit-arttech-friends:v1:'+id));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function staticResponse(request,path) {
  const file=publicFiles[path.endsWith('/')?path+'index.html':path];
  if (!file || !['GET','HEAD'].includes(request.method)) return new Response(null,{status:404});
  const [type,base64,tag]=file;
  const headers=new Headers({'Content-Type':type,'Cache-Control':'public, max-age=0, must-revalidate','ETag':tag,'X-Content-Type-Options':'nosniff'});
  if(request.headers.get('If-None-Match')===tag) return new Response(null,{status:304,headers});
  const bytes=Uint8Array.from(atob(base64),ch=>ch.charCodeAt(0));
  headers.set('Content-Length',bytes.length);
  const range=request.headers.get('Range');
  if(type.startsWith('audio/')) {
    headers.set('Accept-Ranges','bytes');
    if(range) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match || (!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+bytes.length}});
      const start=match[1]?Number(match[1]):Math.max(0,bytes.length-Number(match[2]));
      const end=match[1]&&match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;
      if (start>end || start>=bytes.length) return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+bytes.length}});
      headers.set('Content-Range','bytes '+start+'-'+end+'/'+bytes.length);
      headers.set('Content-Length',end-start+1);
      return new Response(request.method==='HEAD'?null:bytes.subarray(start,end+1),{status:206,headers});
    }
  }
  return new Response(request.method==='HEAD'?null:bytes,{headers});
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(!url.pathname.startsWith(apiRoot+'/')) return staticResponse(request,url.pathname);
    try {
      if(!['GET','HEAD'].includes(request.method)) {
        const origin=request.headers.get('Origin');
        if ((origin && origin!==url.origin) || request.headers.get('Sec-Fetch-Site')==='cross-site' || request.headers.get('X-NoLimit')!=='diary') fail(403,'invalid_request');
      }
      const actor=await accountId(request);
      const expected=request.headers.get('X-NoLimit-Account');
      if(expected && actor!==expected)fail(409,'account_changed');
      const path=url.pathname.slice(apiRoot.length);
      return await handlePeople(request,env,actor,path) || await handlePublications(request,env,actor,path) || json({error:'unavailable'},404);
    } catch(error) {
      if (!error.status) console.error('Social service error',error.name,String(error.message).slice(0,180));
      return json({error:error.code || 'service_unavailable'},error.status || 503);
    }
  }
};
