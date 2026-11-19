import {api,signInUrl} from './social-api.js';
import {mountPlayer} from './player.js';
import {forgetPanels,hidePanel} from './ui.js';
import {getLocale,formatDate} from './i18n.js';
import {shareText as t} from './locales/sharing.js';
import {discussionText as d} from './locales/discussion.js';
import {t as peopleText} from './locales/friends-hub.js';

const reactions=[['close','closeFeeling'],['warm','warm'],['surprise','surprise']];
const meaningful=text=>Boolean(text.replace(/[\p{White_Space}\p{Cf}]/gu,''));
const lengthOf=text=>Array.from(text).length;
const denied=error=>[403,404,410].includes(error?.status);

function commentDate(iso) {
  const value=new Date(iso);
  const day=[value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');
  return formatDate(day,{day:'numeric',month:'long',year:'numeric'})+' · '+
    value.toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'});
}

export function mountSharedDay(root,id,ctx,viewState={}) {
  const {esc,icon}=ctx, path='/publications/'+encodeURIComponent(id);
  const lifetime=new AbortController(), opts={signal:lifetime.signal};
  let alive=true, reader=null, writer=null, timer=null, page='', actor=null, card=null, player=null, usedSheet=false;
  let draft=viewState.commentDraft?.text || '', draftOwner=viewState.commentDraft?.owner || null;
  let pendingComment=viewState.commentDraft?.submission || null, playerState=viewState.player || {};
  let thread={comments:[],reactions:[]}, commentSignature='', confirming=null, viewerObserver=null;
  const find=selector=>root.querySelector(selector);
  const buttons=(label,attr,cls='secondary')=>'<button type="button" class="'+cls+'" '+attr+'>'+esc(label)+'</button>';
  const back=()=>buttons(d('back'),'data-shared-back','sd-back');
  const signalRequest=(endpoint,options,ctrl)=>api(endpoint,{...options,
    signal:AbortSignal.any([ctrl.signal,AbortSignal.timeout(15000)])});

  function resetDraft() {
    draft='';draftOwner=null;pendingComment=null;
  }
  function cancelRead() {reader?.abort();reader=null;}
  function cancelWrite() {writer?.abort();writer=null;}
  function moveDiscussion(modal) {
    const discussion=find('[data-discussion]'), slot=modal?.querySelector('.viewer-content') || find('[data-discussion-slot]');
    if (discussion && slot && discussion.parentNode!==slot) slot.append(discussion);
  }
  function watchViewer() {
    const modal=find('[data-shared-player] [data-card=viewer]');
    if (!modal) return;
    const place=()=>moveDiscussion(modal.open && !modal.hasAttribute('data-inline') ? modal : null);
    viewerObserver=new MutationObserver(place);
    viewerObserver.observe(modal,{attributes:true,attributeFilter:['open','data-inline']});
    place();
  }
  function closePlayer() {
    viewerObserver?.disconnect();viewerObserver=null;moveDiscussion(null);
    if (player) {playerState=player.getViewState();player();player=null;}
    const hadSheet=usedSheet;
    if (hadSheet) {
      hidePanel(true);
      forgetPanels();
      usedSheet=false;
      const title=document.querySelector('#sheet-title');
      if (title) title.textContent='';
    }
    if (history.state?.cardViewer===id || (hadSheet && history.state?.panel)) {
      const next={...history.state};delete next.cardViewer;delete next.panel;
      history.replaceState(next,'',location.href);
    }
  }
  function stopPrivateView() {
    closePlayer();
    card=null;thread={comments:[],reactions:[]};commentSignature='';confirming=null;
  }
  function bindBack() {
    find('[data-shared-back]').onclick=()=>ctx.backFromShared ? ctx.backFromShared() : ctx.go('friends');
  }
  function showState(next) {
    const shouldFocus=page==='ready' && (next==='missing' || next==='offline');
    if (next===page) return;
    stopPrivateView();
    page=next;
    const message={loading:t('loading'),offline:t('waiting'),login:d('accessSignIn'),profile:t('needProfile'),missing:t('missing')};
    const copy=(next==='missing' || next==='offline') && draft.trim();
    root.innerHTML='<div class="social-actions">'+back()+'</div><section class="social-discussion sd-state panel">'+
      '<h2 tabindex="-1" data-state-title>'+esc(message[next])+'</h2>'+
      (next==='login' ? '<a class="primary" target="_top" href="'+esc(signInUrl())+'">'+esc(t('login'))+'</a>' : '')+
      (next==='profile' ? '<form data-profile-form><label>'+esc(peopleText('yourName'))+
        '<input name="name" autocomplete="nickname" required></label><button class="primary" type="submit">'+esc(t('setup'))+'</button></form>' : '')+
      (next==='offline' || next==='missing' ? buttons(t('retry'),'data-retry') : '')+
      (copy ? '<label>'+esc(d('draft'))+'<textarea data-draft-copy rows="3" readonly></textarea></label>'+buttons(t('copyDraft'),'data-copy') : '')+
      '<p role="status" aria-live="polite" data-status></p></section>';
    bindBack();
    if (copy) find('[data-draft-copy]').value=draft;
    if (shouldFocus) find('[data-state-title]').focus({preventScroll:true});
  }
  function status(message) {
    const el=find('[data-status]');
    if (el) el.textContent=message;
  }
  function renderReader(next) {
    if (page!=='ready') {
      root.innerHTML='<div class="social-actions sd-toolbar">'+back()+'<p class="sd-byline"></p></div>'+
        '<div data-shared-player></div><div data-discussion-slot><section class="social-discussion panel" data-discussion aria-labelledby="sd-discussion-title">'+
        '<h2 id="sd-discussion-title">'+esc(t('discussion'))+'</h2>'+
        '<div role="group" aria-label="'+esc(t('reactions'))+'" class="sd-reactions">'+reactions.map(([kind,key])=>
          '<button type="button" aria-pressed="false" data-reaction="'+kind+'"><span aria-hidden="true" class="sd-mark">'+
          ({close:'≈',warm:'☀',surprise:'✧'})[kind]+'</span><span>'+esc(t(key))+'</span><span class="sd-count">0</span></button>').join('')+
        '</div><ul class="sd-reactors" data-reactors></ul><ol class="sd-comments" data-comments></ol>'+
        '<p data-empty>'+esc(t('empty'))+'</p><form data-comment-form><label for="sd-comment">'+esc(t('comment'))+'</label>'+
        '<textarea rows="3" name="comment" id="sd-comment" aria-describedby="sd-visible sd-length"></textarea>'+
        '<p id="sd-visible">'+esc(t('visible'))+'</p><span id="sd-length"></span>'+
        '<div class="sd-submit"><button type="submit" class="primary" data-send-comment>'+esc(t('send'))+'</button>'+
        '<p role="status" aria-live="polite" data-status></p></div></form></section></div>';
      page='ready';
      bindBack();
      find('textarea[name=comment]').value=draft;
      find('[data-discussion]').addEventListener('keydown',event=>{
        // The player handles arrows to change frames. Keep native caret
        // movement and keyboard interaction within the discussion.
        if (event.key==='ArrowLeft' || event.key==='ArrowRight') event.stopPropagation();
      });
    }
    const isOwner=actor===next.owner.id;
    find('.sd-byline').textContent=next.owner.name+' · '+next.owner.code;
    const toolbar=find('.sd-toolbar'), access=find('[data-shared-access]');
    if (isOwner && !access) toolbar.insertAdjacentHTML('beforeend',buttons(t('access'),'data-shared-access'));
    if (!isOwner && access) access.remove();
    if (!player || card?.contentVersion!==next.contentVersion) {
      closePlayer();
      const playContext={...ctx,readOnly:true,sheet:(...args)=>{usedSheet=true;return ctx.sheet(...args);}};
      player=mountPlayer(find('[data-shared-player]'),{...next.day,id},playContext,playerState);
      watchViewer();
    }
    card=next;
  }
  function controls() {
    if (page!=='ready') return;
    const field=find('textarea[name=comment]'), length=lengthOf(field.value.trim()), busy=Boolean(writer);
    find('[data-send-comment]').disabled=busy || !meaningful(field.value) || length>1000;
    field.readOnly=busy && writer?.kind==='comment';
    field.setAttribute('aria-invalid',String(length>1000));
    find('#sd-length').textContent=length>1000 ? d('tooLong') : '';
    for (const b of root.querySelectorAll('[data-reaction],[data-remove],[data-confirm],[data-keep]')) b.disabled=busy;
    const access=find('[data-shared-access]');
    if (access) access.disabled=busy;
  }
  function renderThread(next) {
    thread=next;
    const names=[];
    for (const [kind,key] of reactions) {
      const group=thread.reactions.filter(r=>r.kind===kind), b=find('[data-reaction="'+kind+'"]');
      b.setAttribute('aria-pressed',String(group.some(r=>r.person.id===actor)));
      b.querySelector('.sd-count').textContent=String(group.length);
      if (group.length) names.push('<li><strong>'+esc(t(key))+'</strong> '+group.map(r=>esc(r.person.name)+' <small>'+esc(r.person.code)+'</small>').join(', ')+'</li>');
    }
    find('[data-reactors]').innerHTML=names.join('');
    const signature=JSON.stringify([next.comments,confirming]);
    if (signature!==commentSignature) {
      commentSignature=signature;
      const focus=document.activeElement?.closest('[data-remove],[data-keep],[data-confirm]');
      find('[data-comments]').innerHTML=next.comments.map(c=>{
        const removable=actor===card.owner.id || c.person.id===actor;
        const controls=removable ? (confirming===c.id ? '<div class="sd-confirm"><p>'+esc(d('confirmRemove'))+'</p>'+
          buttons(t('keep'),'data-keep="'+esc(c.id)+'"')+buttons(t('deleteComment'),'data-confirm="'+esc(c.id)+'"','sd-danger')+'</div>' :
          '<button type="button" class="sd-delete" data-remove="'+esc(c.id)+'" aria-label="'+esc(t('deleteComment')+' · '+c.person.name)+'" title="'+esc(t('deleteComment'))+'">'+icon('trash',17)+'</button>') : '';
        return '<li><div class="sd-c-head"><b>'+esc(c.person.name)+'</b><small>'+esc(c.person.code)+'</small><time datetime="'+esc(c.createdAt)+'">'+
          esc(commentDate(c.createdAt))+'</time></div><p class="sd-comment-text">'+esc(c.text)+'</p>'+controls+'</li>';
      }).join('');
      if (focus) {
        const attr=['data-remove','data-keep','data-confirm'].find(k=>focus.hasAttribute(k));
        find('['+attr+'="'+CSS.escape(focus.getAttribute(attr))+'"]')?.focus({preventScroll:true});
      }
      find('[data-empty]').hidden=Boolean(next.comments.length);
    }
    controls();
  }

  function schedule() {
    clearTimeout(timer);
    if (alive && !document.hidden && (page==='ready' || page==='offline')) timer=setTimeout(refresh,4000);
  }
  function disconnect(next) {
    cancelRead();cancelWrite();clearTimeout(timer);
    if (next==='login' || next==='profile') {resetDraft();actor=null;}
    showState(next);
    schedule();
  }
  function handleError(error) {
    if (error.code==='account_changed') {
      resetDraft();actor=null;disconnect('loading');playerState={};void refresh();
    } else if (error.status===401) disconnect('login');
    else if (error.code==='profile_required') disconnect('profile');
    else if (denied(error)) disconnect('missing');
    else disconnect('offline');
  }
  function setActor(user) {
    if ((actor && actor!==user) || (draftOwner && draftOwner!==user)) {
      resetDraft();showState('loading');playerState={};
    }
    actor=user;
  }
  async function refresh() {
    if (!alive || document.hidden || reader || (writer && page!=='ready')) return;
    if (!navigator.onLine) {disconnect('offline');return;}
    const ctrl=new AbortController(), verifying=writer;reader=ctrl;
    try {
      const session=await signalRequest('/session',{},ctrl);
      if (!alive || reader!==ctrl) return;
      if (!session.authenticated || !session.user) {disconnect(session.authenticated?'profile':'login');return;}
      if (verifying && actor!==session.user.id) cancelWrite();
      setActor(session.user.id);
      if (verifying && writer===verifying) {
        await signalRequest(path,{headers:{'X-NoLimit-Account':actor}},ctrl);
        return;
      }
      const [current,nextThread]=await Promise.all([path,path+'/discussion'].map(p=>signalRequest(p,{headers:{'X-NoLimit-Account':actor}},ctrl)));
      if (!alive || reader!==ctrl) return;
      // A lost response may have committed the very same pending comment.
      if (pendingComment && nextThread.comments.some(c=>c.id===pendingComment.id && c.person.id===actor)) {
        if (draft.trim()===pendingComment.text) draft='';
        pendingComment=null;
        const field=find('textarea[name=comment]');
        if (field) field.value=draft;
      }
      renderReader(current);
      renderThread(nextThread);
    } catch(error) {if (alive && reader===ctrl) handleError(error);}
    finally {if (reader===ctrl) reader=null;schedule();}
  }
  async function mutate(kind,endpoint,method,payload,success) {
    if (page!=='ready' || writer || !alive) return;
    const owner=actor, ctrl=new AbortController();
    ctrl.kind=kind;writer=ctrl;cancelRead();schedule();
    controls();status(d(({comment:'commenting',reaction:'reacting',delete:'removing'})[kind]));
    try {
      const session=await signalRequest('/session',{},ctrl);
      if (writer!==ctrl || !alive) return;
      if (session.user?.id!==owner) {
        resetDraft();setActor(session.user?.id || null);
        disconnect(session.user?'loading':session.authenticated?'profile':'login');
        if (session.user) void refresh();
        return;
      }
      // The mutation also checks the current grant in its D1 transaction.
      await signalRequest(endpoint,{method,body:payload,headers:{'X-NoLimit-Account':owner}},ctrl);
      if (writer!==ctrl || !alive) return;
      success();
      const updated=await signalRequest(path+'/discussion',{headers:{'X-NoLimit-Account':owner}},ctrl);
      if (writer!==ctrl || !alive) return;
      renderThread(updated);
    } catch(error) {
      if (writer!==ctrl || !alive) return;
      if (!error.status || error.status>=500 || denied(error) || error.status===401 || ['profile_required','account_changed'].includes(error.code)) handleError(error);
      else status(d('failed'));
    } finally {
      if (writer===ctrl) {
        writer=null;controls();
        if (kind==='comment' && page==='ready') find('textarea[name=comment]').focus({preventScroll:true});
        schedule();
      }
    }
  }
  function sendComment() {
    const field=find('textarea[name=comment]'), text=field.value.trim();
    if (find('[data-send-comment]').disabled || !meaningful(text)) return;
    if (pendingComment?.text!==text) pendingComment={id:crypto.randomUUID(),text};
    void mutate('comment',path+'/comments/'+pendingComment.id,'PUT',{text},()=>{
      pendingComment=null;draft='';field.value='';status(d('saved'));
    });
  }
  async function createProfile(form) {
    if (writer) return;
    const field=form.elements.name, name=field.value.trim(), button=form.querySelector('button');
    if (!name || lengthOf(name)>60) {status(peopleText(name?'nameLength':'simpleName'));field.focus();return;}
    const ctrl=new AbortController();writer=ctrl;button.disabled=true;
    try {
      await signalRequest('/profile',{method:'POST',body:{name}},ctrl);
      if (alive && writer===ctrl) {writer=null;await refresh();}
    } catch(error) {if (alive && writer===ctrl) status(error.code==='invalid_name'?peopleText('simpleName'):t('network'));}
    finally {if (writer===ctrl) {writer=null;button.disabled=false;}}
  }
  root.addEventListener('input',e=>{
    if (e.target.matches('textarea[name=comment]')) {draft=e.target.value;draftOwner=actor;controls();}
  },opts);
  root.addEventListener('submit',e=>{
    if (e.target.matches('[data-comment-form]')) {e.preventDefault();sendComment();}
    if (e.target.matches('[data-profile-form]')) {e.preventDefault();void createProfile(e.target);}
  },opts);
  root.addEventListener('click',async e=>{
    const b=e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-retry')) {cancelRead();void refresh();return;}
    if (b.hasAttribute('data-copy')) {
      const field=find('[data-draft-copy]');
      try {await navigator.clipboard.writeText(field.value);if (field.isConnected) status(t('copied'));}
      catch {if (field.isConnected) {field.focus();field.select();status(d('manualCopy'));}}
      return;
    }
    if (page!=='ready' || writer) return;
    if (b.hasAttribute('data-shared-access')) {usedSheet=true;ctx.openSharedAccess(id);return;}
    if (b.dataset.reaction) {
      const kind=b.getAttribute('aria-pressed')==='true' ? null : b.dataset.reaction;
      void mutate('reaction',path+'/reaction','PUT',{kind,operationId:crypto.randomUUID()},()=>status(d(kind?'reactionSaved':'reactionRemoved')));
    } else if (b.dataset.remove || b.dataset.keep) {
      const item=b.dataset.remove || b.dataset.keep;
      confirming=b.dataset.remove || null;renderThread(thread);
      find('[data-'+(confirming?'keep':'remove')+'="'+CSS.escape(item)+'"]')?.focus({preventScroll:true});
    } else if (b.dataset.confirm && confirming===b.dataset.confirm) {
      void mutate('delete',path+'/comments/'+confirming,'DELETE',undefined,()=>{
        confirming=null;status(d('removed'));find('textarea[name=comment]').focus({preventScroll:true});
      });
    }
  },opts);
  function suspend() {
    if (!alive) return;
    clearTimeout(timer);cancelRead();cancelWrite();
    if (page==='ready' || page==='loading') showState('loading');
  }
  function resume() {if (!document.hidden) void refresh();}
  document.addEventListener('visibilitychange',()=>document.hidden?suspend():resume(),opts);
  window.addEventListener('focus',resume,opts);
  window.addEventListener('pagehide',suspend,opts);
  window.addEventListener('pageshow',resume,opts);
  window.addEventListener('online',resume,opts);
  window.addEventListener('offline',()=>disconnect('offline'),opts);
  showState('loading');void refresh();
  const cleanup=()=>{
    alive=false;lifetime.abort();cancelRead();cancelWrite();clearTimeout(timer);
    stopPrivateView();resetDraft();actor=null;playerState={};
  };
  cleanup.getViewState=()=>({player:player?.getViewState() || playerState,
    commentDraft:draft ? {owner:draftOwner,text:draft,submission:pendingComment} : null});
  return cleanup;
}
