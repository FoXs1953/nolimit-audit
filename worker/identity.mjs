const validKey=value=>typeof value==='string' && /^[0-9a-f]{64}$/.test(value);
const hex=bytes=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
async function digest(value) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
}

export async function socialIdentity(request,db,path) {
  const secure=new URL(request.url).protocol==='https:';
  const cookieName=secure?'__Host-nolimit-friends':'nolimit_friends_dev';
  const cookies=(request.headers.get('Cookie') || '').split(';').map(s=>s.trim());
  const cookieKey=cookies.find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const deviceKey=request.headers.get('X-NoLimit-Device');
  const creating=path==='/profile' && request.method==='POST';
  let key=validKey(deviceKey)?deviceKey:validKey(cookieKey)?cookieKey:null;
  const siteId=request.headers.get('oai-authenticated-user-id');
  const legacy=siteId && request.headers.get('oai-authenticated-user-email')
    ? await digest('nolimit-arttech-friends:v1:'+siteId) : null;
  if(!key && !creating)return {id:legacy};
  if(!key)key=hex(crypto.getRandomValues(new Uint8Array(32)));
  const guest=await digest('nolimit-arttech-guest:v1:'+key);
  // Existing browser friendships survive a later platform sign-in. Older accounts
  // keep their original ID and are never granted by a device credential.
  if(legacy || (!creating && path==='/session')){
    const known=await db.prepare('SELECT id FROM profiles WHERE id IN (?,?)').bind(guest,legacy).all();
    if(!known.results.some(row=>row.id===guest)){
      if(legacy && known.results.some(row=>row.id===legacy))return {id:legacy};
      if(!creating)return {id:null};
    }
  }
  const refresh=key!==cookieKey && (creating || path==='/session');
  return {id:guest,cookie:refresh?cookieName+'='+key+'; Path=/; HttpOnly; Max-Age=31536000; '+
    (secure?'Secure; SameSite=None; Partitioned':'SameSite=Lax'):null};
}

export function rememberBrowser(response,identity) {
  if(!identity.cookie || !response.ok)return response;
  const result=new Response(response.body,response);
  result.headers.append('Set-Cookie',identity.cookie);
  return result;
}
