import {api,signInUrl,publicationLink,claimPublication,rememberPublication,forgetPublication} from './social-api.js';
import {shareText as t} from './locales/sharing.js';
import {presentRecipe,storyLanguage} from './art.js';
import {musicLink} from './music-link.js';
import {localAsset} from './store.js';

export function socialError(error) {
  if(error?.code==='invalid_music_link')return t('linkError');
  if(error?.code==='media_too_large')return t('largeMedia');
  if(error?.code==='invalid_media')return t('mediaType');
  if(error?.code==='profile_required')return t('needProfile');
  if(error?.code==='account_changed')return t('otherOwner');
  if([401,403].includes(error?.status))return t('needLogin');
  if(error?.status===404)return t('missing');
  if(error?.status===409)return t('conflict');
  return t('network');
}
async function upload(asset,kind,owner) {
  const data=await localAsset(asset,kind);
  const id=crypto.randomUUID();
  const mime=data.type || (kind==='photo'?'image/jpeg':'audio/mpeg');
  await api('/uploads/'+id,{method:'POST',body:data.slice(0,data.size,mime),headers:{'X-NoLimit-Account':owner}});
  return id;
}
async function snapshot(day,alternative,owner) {
  const recipe=presentRecipe(day);
  const photos=[];
  for (const photo of day.photos) {
    photos.push({assetId:await upload(photo,'photo',owner),x:photo.x,y:photo.y,color:photo.color});
  }
  const source=day.music, music={kind:source.kind,bpm:source.bpm,energy:source.energy};
  if(alternative || source.kind==='link'){
    music.kind='link';music.url=alternative || source.url;
    music.name=alternative?t('track'):source.name;
  } else {
    music.assetId=await upload(source,'audio',owner);
    music.name=t('track');
  }
  const {color,mood,motion,tilt,interval,bpm,energy}=recipe;
  return {title:recipe.title,caption:recipe.caption,date:day.date,text:day.text,contentLanguage:storyLanguage(day),
    recipe:{version:1,title:recipe.title,caption:recipe.caption,color,mood,motion,tilt,interval,bpm,energy},photos,music};
}
export async function removeRemoteForLocal(localId) {
  const link=await publicationLink(localId);
  if (!link)return;
  const {user}=await api('/session');
  if(!user || user.id!==link.ownerId)throw new Error(t('otherOwner'));
  await api('/publications/'+link.id,{method:'DELETE',headers:{'X-NoLimit-Account':link.ownerId}}).catch(err=>{if(err.status!==404)throw new Error(socialError(err));});
  await forgetPublication(localId,link.id);
}
export function openAccess(ctx,{day,publicationId}){
  const {esc,icon}=ctx;
  ctx.sheet(t('access'),'<div class="social-settings" data-sharing-root><p role="status">'+esc(t('loading'))+'</p></div>',host=>{
    const root=host.querySelector('[data-sharing-root]');
    let previews=[];
    const release=()=>{for(const url of previews) URL.revokeObjectURL(url);previews=[];};
    const dialog=host.closest('dialog');
    dialog?.addEventListener('close',release,{once:true});
    async function start(){
      release();
      try{
        const session=await api('/session');
        if(!root.isConnected)return;
        if(!session.user){
          root.innerHTML='<p>'+esc(t(session.authenticated?'needProfile':'needLogin'))+'</p><a class="primary social-link" '+(session.authenticated?'href="#friends/people"':'target="_top" href="'+esc(signInUrl())+'"')+'>'+esc(t(session.authenticated?'setup':'login'))+'</a>';
          if(session.authenticated)root.querySelector('a').onclick=e=>{e.preventDefault();ctx.go('friends/people');};
          return;
        }
        let binding=day?await publicationLink(day.id):null;
        if (binding && binding.ownerId!==session.user.id) throw Object.assign(new Error(t('otherOwner')),{display:true});
        let pubId=publicationId || binding?.id;
        const [people,publication]=await Promise.all([api('/people'),pubId?api('/publications/'+pubId).catch(err=>{
          if(err.status===404 && day)return null;
          throw err;
        }):null]);
        if(!root.isConnected)return;
        if(publication && publication.owner.id!==session.user.id)throw Object.assign(new Error(t('otherOwner')),{display:true});
        if(publication && day && binding && (!binding.confirmed || binding.mode!==publication.mode))await rememberPublication(day.id,pubId,publication.mode);
        if(!publication && binding?.confirmed){await forgetPublication(day.id,binding.id);binding=null;pubId=null;}
        if(!publication && (!day || day.status!=='ready' || !day.text?.trim() || !day.photos?.length || !day.music))throw Object.assign(new Error(t('notReady')),{display:true});
        const version=publication?.accessVersion || 0, contentVersion=publication?.contentVersion || 0;
        const selected=new Set(publication?.recipientIds || []), source=day || publication.day;
        const recipe=presentRecipe({...source,status:'ready'});
        let value=publication?.mode || 'private';
        const pictures=(source.photos || []).map(photo=>{
          if(photo.blob instanceof Blob){const url=URL.createObjectURL(photo.blob);previews.push(url);return url;}
          return /^(?:\.\/diary\/media\/[\w.-]+|\/api\/social\/media\/[\w/-]+)$/.test(photo.src || '')?photo.src:'';
        }).filter(Boolean);
        const choice=(mode)=>'<label class="social-mode"><input type="radio" name="audience" value="'+mode+'" '+(value===mode?'checked':'')+'><span>'+esc(t(mode))+'</span></label>';
        const candidates=people.friends.map(p=>'<label class="social-friend-check"><input type="checkbox" name="recipient" value="'+esc(p.id)+'" '+(selected.has(p.id)?'checked':'')+'><span>'+esc(p.name)+' <small>'+esc(p.code)+'</small></span></label>').join('');
        root.innerHTML='<form data-sharing-form><p class="social-as">'+esc(t('as',{name:session.user.name}))+'</p><details class="share-preview" '+(!publication?'open':'')+'><summary>'+esc(t('preview'))+'</summary><div class="share-preview-inner"><strong>'+esc(recipe.title || source.title)+'</strong><p>'+esc(source.text)+'</p><div class="share-images">'+pictures.map(url=>'<img src="'+esc(url)+'" alt="">').join('')+'</div><span>'+icon('music',16)+esc(source.music?.kind==='link'?source.music.name || t('track'):t('track'))+'</span></div></details>'+
          '<fieldset class="social-audience"><legend>'+esc(t('audience'))+'</legend>'+['private','all','selected'].map(choice).join('')+'</fieldset>'+
          '<p data-mode-hint></p><div data-recipient-area><label>'+esc(t('find'))+'<input type="search" class="day-field" data-find-person></label>'+
          (candidates?'<div class="social-friend-list">'+candidates+'</div><p data-count></p>':'<p>'+esc(t('none'))+'</p><button class="secondary" type="button" data-people>'+esc(t('people'))+'</button>')+'</div>'+
          (day?.music?.kind==='file'?'<fieldset class="share-song"><legend>'+esc(t('track'))+'</legend><select aria-label="'+esc(t('track'))+'" data-song><option value="file">'+esc(t('file'))+'</option><option value="link">'+esc(t('link'))+'</option></select><label hidden data-url-label>'+esc(t('link'))+'<input class="day-field" type="url" data-url placeholder="https://"></label><p>'+esc(t('rights'))+'</p></fieldset>':'')+
          '<p data-message role="status"></p><div class="social-actions"><button class="primary" data-save-access type="submit">'+esc(t(publication?'save':'publish'))+'</button>'+
          (day && publication?'<button type="button" class="secondary" data-update>'+esc(t('refresh'))+'</button>':'')+
          '<button type="button" class="secondary" data-cancel>'+esc(t('close'))+'</button></div>'+
          (publication?'<div class="share-remove"><button type="button" class="social-danger" data-remove>'+esc(t('remove'))+'</button><div hidden data-confirm><p>'+esc(t('removeInfo'))+'</p><button type="button" class="social-danger" data-remove-yes>'+esc(t('remove'))+'</button> <button type="button" class="secondary" data-remove-no>'+esc(t('keep'))+'</button></div></div>':'')+'</form>';
        const form=root.querySelector('form'), get=s=>root.querySelector(s), message=get('[data-message]');
        let busy=false,prepared=null;
        const ids=()=>[...form.querySelectorAll('[name=recipient]:checked')].map(node=>node.value);
        function sync(){
          value=form.elements.audience.value;
          get('[data-mode-hint]').textContent=t(value==='all'?'allHint':value==='selected'?'selectHint':'privateHint');
          get('[data-recipient-area]').hidden=value!=='selected';
          if(get('[data-count]'))get('[data-count]').textContent=ids().length?t('count',{count:ids().length}):t('choose');
          const original=[...selected].sort().join(','), next=ids().sort().join(',');
          const changed=value!==(publication?.mode || 'private') || (value==='selected' && original!==next);
          get('[data-save-access]').disabled=busy || !changed || (value==='selected'&&!ids().length);
          if(get('[data-url-label]'))get('[data-url-label]').hidden=get('[data-song]').value!=='link';
        }
        function busyState(on){
          busy=on;form.setAttribute('aria-busy',String(on));
          for(const control of form.querySelectorAll('button,select,input'))control.disabled=on;
          sync();
        }
        form.onchange=()=>{message.textContent='';sync();};
        get('[data-find-person]').oninput=e=>{for(const label of root.querySelectorAll('.social-friend-check'))label.hidden=!label.textContent.toLocaleLowerCase().includes(e.target.value.trim().toLocaleLowerCase());};
        if(get('[data-people]'))get('[data-people]').onclick=()=>ctx.go('friends/people');
        get('[data-cancel]').onclick=ctx.closeSheet;
        const changed=()=>window.dispatchEvent(new Event('nolimit-social-updated'));
        async function perform(kind){
          if(busy || (kind==='access' && get('[data-save-access]').disabled))return;
          const recipientIds=value==='selected'?ids():[];
          let alternative=null;
          if((kind==='update' || !publication) && get('[data-song]')?.value==='link'){
            alternative=musicLink(get('[data-url]').value.trim())?.url;
            if(!alternative){message.textContent=t('linkError');get('[data-url]').focus();return;}
          }
          busyState(true);message.textContent=t('sending');
          try{
            if(kind==='remove'){
              await api('/publications/'+pubId,{method:'DELETE',headers:{'X-NoLimit-Account':session.user.id}});
              if(day)await forgetPublication(day.id,pubId);
              changed();ctx.toast(t('deleted'));if(root.isConnected)ctx.closeSheet();return;
            }
            if(!publication || kind==='update'){
              if(!day)throw new Error('unavailable');
              binding=await claimPublication(day.id,session.user.id);
              if(binding.ownerId!==session.user.id)throw Object.assign(new Error(t('otherOwner')),{display:true});
              pubId=binding.id;
              const config=JSON.stringify([alternative,!publication && value,!publication && recipientIds]);
              if(prepared?.config!==config){
                const ready=await snapshot(day,alternative,session.user.id);
                prepared={config,ready,operationId:crypto.randomUUID()};
              }
              const stored=await api('/publications/'+pubId,{method:'PUT',headers:{'X-NoLimit-Account':session.user.id},body:{day:prepared.ready,mode:value,recipientIds,contentVersion,operationId:prepared.operationId}});
              await rememberPublication(day.id,pubId,stored.mode);
            }else{
              const stored=await api('/publications/'+pubId+'/access',{method:'PATCH',headers:{'X-NoLimit-Account':session.user.id},body:{mode:value,recipientIds,accessVersion:version}});
              if(day)await rememberPublication(day.id,pubId,stored.mode);
            }
            changed();ctx.toast(t(kind==='update'?'updated':'saved'));if(root.isConnected)ctx.closeSheet();
          }catch(error){
            if(!root.isConnected)return;
            message.textContent=error.display?error.message:socialError(error);
            if(error.status===409 || !error.status || error.status>=500){
              const retry=document.createElement('button');retry.className='secondary';retry.type='button';retry.textContent=t('retry');retry.onclick=start;message.append(' ',retry);
            }
            busyState(false);
          }
        }
        form.onsubmit=e=>{e.preventDefault();perform('access');};
        if(get('[data-update]'))get('[data-update]').onclick=()=>perform('update');
        if(get('[data-remove]')){
          get('[data-remove]').onclick=()=>{get('[data-confirm]').hidden=false;get('[data-remove]').hidden=true;get('[data-remove-no]').focus();};
          get('[data-remove-no]').onclick=()=>{get('[data-confirm]').hidden=true;get('[data-remove]').hidden=false;get('[data-remove]').focus();};
          get('[data-remove-yes]').onclick=()=>perform('remove');
        }
        sync();
      }catch(error){
        if(root.isConnected){root.innerHTML='<p role="alert"></p><button type="button" class="secondary">'+esc(t('retry'))+'</button>';root.querySelector('p').textContent=error.display?error.message:socialError(error);root.querySelector('button').onclick=start;}
      }
    }
    start();
  });
}
