import {formatDate, getLanguage, getLocale} from './i18n.js';
import {t} from './locales/friends-hub.js';
import {galleryThumbnail} from './ui.js';
import {shareText} from './locales/sharing.js';
import {api, signInUrl} from './social-api.js';

function initials(name) {
  const words = String(name || '').trim().split(/\s+/u);
  return [words[0], words.length > 1 ? words.at(-1) : '']
    .map(word => Array.from(word)[0] || '').join('').toLocaleUpperCase(getLocale());
}

function localDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return '';
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}

function coverUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value, location.href);
    return url.origin === location.origin && url.pathname.startsWith('/api/social/media/') ? url.href : '';
  } catch { return ''; }
}

function normalized(value) {
  return String(value || '').normalize('NFC').trim().toLocaleLowerCase(getLocale());
}

const enc = encodeURIComponent;

export function mountFriendsHub(root, route, ctx, viewState = {}) {
  const {esc, icon} = ctx;
  const language = getLanguage();
  const [,page = 'feed', rawId = ''] = route.split('/');
  let routeId = '';
  try { routeId = decodeURIComponent(rawId); } catch { /* Invalid links use the unavailable screen. */ }

  let alive = true;
  let loading;
  let writing;
  let snapshot;
  let model;
  let failure = '';
  let pane = '';
  let paneTrigger = '';
  let targetId = '';
  let query = '';
  let nameDraft = '';
  let actionError = '';
  let restore = viewState;
  let restoreFrame;
  const fullDate = day => formatDate(day, {year:'numeric',month:'long',day:'numeric'});
  const button = (act, text, {id = '', style = 'secondary', symbol = '', attrs = '', fid = act+':'+id} = {}) =>
    '<button type="button" class="'+style+'" data-act="'+act+'" data-id="'+esc(id)+'" data-fid="'+esc(fid)+'" '+attrs+'>'+
    (symbol ? icon(symbol,17) : '')+'<span>'+esc(text)+'</span></button>';
  const avatar = (person, large = false) =>
    '<span aria-hidden="true" class="fh-avatar'+(large?' fh-avatar-lg':'')+'">'+esc(initials(person.name))+'</span>';
  const identity = person => avatar(person)+'<span class="fh-identity"><strong>'+esc(person.name)+'</strong><small>'+esc(person.code)+'</small></span>';
  const linkToSignIn = () => '<a class="primary" target="_top" data-fid="signin" title="'+esc(t('provider'))+'" href="'+esc(signInUrl())+'">'+esc(t('signIn'))+'</a>';
  const art = () => '<div class="fh-letter" aria-hidden="true"><i></i><b><span></span></b></div>';
  const stateBox = (title, hint = '', action = '', motif = '') =>
    '<section class="fh-state panel">'+(motif === 'letter' ? art() : motif ? '<span class="fh-mark">'+icon(motif,25)+'</span>' : '')+
    '<div><h2>'+esc(title)+'</h2>'+(hint?'<p>'+esc(hint)+'</p>':'')+'</div>'+action+'</section>';
  const goButton = (destination, label, style = 'secondary') => button('go',t(label),{id:destination,style});
  const personRoute = person => 'friends/person/'+enc(person.id);
  const backButton = (destination, label) => button('go',t(label),{id:destination,style:'fh-back',symbol:'chevron'});
  const subPage = !['feed','people'].includes(page);
  const friends = () => model?.people?.friends || [];
  const person = () => friends().find(friend=>friend.id===routeId);
  const signed = () => model?.session?.user;
  const focusKey = key => Array.from(root.querySelectorAll('[data-fid]')).find(el=>el.dataset.fid===key);
  function focus(key, fallback = false) {
    const el = focusKey(key) || (fallback && (root.querySelector('[data-fid="pane-title"]') ||
      root.querySelector('[aria-current="page"]') || root.querySelector('.fh-title') || root.querySelector('a.primary,input,button')));
    if (el) el.focus({preventScroll:true});
  }

  function toolbar() {
    const personAccount = signed();
    if (!personAccount) return '';
    if (subPage) return backButton('friends/people','backPeople');
    const requests = model.people.incoming.length;
    const tab = (key, destination, extra = '') => '<button type="button" data-act="go" data-id="'+destination+'" data-fid="tab-'+key+'" '+
      (page===key?'aria-current="page"':'')+'>'+esc(t(key))+extra+'</button>';
    const profileOpen = pane==='profile'||pane==='name';
    return '<div class="fh-toolbar"><nav class="fh-tabs" aria-label="'+esc(t('friends'))+'">'+tab('feed','friends')+
      tab('people','friends/people',requests ? '<span class="fh-badge" aria-label="'+esc(t('incoming')+' · '+requests)+'">'+requests+'</span>' : '')+
      '</nav><div class="fh-tools">'+button('add',t('add'),{style:'primary',symbol:'plus',attrs:'aria-controls="fh-content" aria-expanded="'+String(pane==='add'||pane==='revoke')+'"'})+
      '<button type="button" data-act="profile" data-fid="profile:" class="fh-me" aria-controls="fh-content" aria-expanded="'+profileOpen+'" aria-label="'+esc(t('profile')+' · '+personAccount.name)+'" title="'+esc(t('profile'))+'">'+avatar(personAccount)+'</button></div></div>';
  }

  function panel(title, html, buttonLabel = 'close') {
    return '<section class="fh-panel panel"><header><h2 tabindex="-1" data-fid="pane-title">'+esc(title)+'</h2>'+
      button('dismiss',t(buttonLabel),{style:'fh-icon',symbol:'close'})+'</header>'+html+'</section>';
  }

  function nameForm() {
    return '<form class="fh-form" data-name-form novalidate><label for="fh-name">'+esc(t('yourName'))+'</label>'+
      '<input id="fh-name" name="name" type="text" autocomplete="nickname" required data-fid="name-field" value="'+esc(nameDraft)+'">'+
      '<p>'+esc(t('nameHint'))+'</p><button class="primary" type="submit" data-fid="save-name">'+esc(t('saveName'))+'</button></form>';
  }

  function activePane() {
    if (pane==='profile') {
      return panel(t('profile'),'<div class="fh-profile-name">'+identity(signed())+'</div><div class="fh-menu">'+
        goButton('friends/mine','mine','fh-menu-link')+goButton('friends/responses','responses','fh-menu-link')+
        button('edit-name',t('editName'),{style:'fh-menu-link',symbol:'pen'})+'</div>');
    }
    if (pane==='name') return panel(t('editName'),nameForm());
    if (pane==='add') {
      const invite = model.people?.invite;
      if (!invite) return panel(t('add'),'<p>'+esc(t('inviteHint'))+'</p><p>'+esc(t('inviteTiming'))+'</p>'+
        button('create-invite',t('createInvite'),{style:'primary',symbol:'plus'}));
      const url = new URL(location.href);
      url.search = '';
      url.hash = 'friends/invite/'+enc(invite.token);
      return panel(t('add'),'<p>'+esc(t('inviteHint'))+'</p><label class="fh-link-field">'+esc(t('inviteLink'))+
        '<input readonly data-fid="invite-url" value="'+esc(url.href)+'"></label><p>'+esc(t('expires',{date:fullDate(localDay(invite.expiresAt))}))+
        '</p><div class="fh-actions">'+button('copy',t('copy'),{style:'primary'})+
        button('revoke',t('revoke'),{style:'fh-danger-text'})+'</div>');
    }
    if (pane==='revoke') return panel(t('revoke'),'<p>'+esc(t('revokeHint'))+'</p><div class="fh-actions">'+
      button('confirm-revoke',t('revoke'),{style:'fh-danger'})+button('add',t('cancel'))+'</div>');
    if (pane==='friend-menu' && person()) return panel(person().name,button('remove',t('removeFriend'),{style:'fh-danger-text',symbol:'trash'}));
    if (pane==='remove' && person()) return panel(t('removeTitle',{name:person().name}),'<p>'+esc(t('removeHint'))+'</p><div class="fh-actions">'+
      button('confirm-remove',t('removeFriend'),{style:'fh-danger'})+button('dismiss',t('cancel'),{fid:'cancel-pane'})+'</div>');
    if (pane==='comment'||pane==='reaction') {
      const isComment = pane==='comment';
      const item = isComment ? model.responses.comments.find(comment=>comment.id===targetId) :
        model.responses.reactions.find(reaction=>reaction.publicationId===targetId);
      if (item) return panel(t(isComment?'deleteComment':'deleteReaction'),
        '<p class="fh-response-text">'+esc(isComment ? item.text : reactionLabel(item.kind))+'</p><div class="fh-actions">'+
        button('confirm-response',t(isComment?'deleteComment':'deleteReaction'),{style:'fh-danger'})+button('dismiss',t('cancel'),{fid:'cancel-pane'})+'</div>');
    }
    return '';
  }

  function dayCards(days, owner = false) {
    return '<div class="fh-days">'+days.map(day=>{
      const src = coverUrl(day.cover);
      const audience = {all:'all',selected:'selected',private:'private'}[day.mode] || 'private';
      return '<article class="fh-card panel"><button type="button" class="fh-day" data-act="go" data-id="shared/'+esc(enc(day.id))+
        '" data-fid="day:'+esc(day.id)+'"><span class="fh-cover'+(src?'':' fh-paper')+'">'+
        (src?galleryThumbnail(src,day.coverKind==='video'):'<i aria-hidden="true"></i>')+
        '</span><span class="fh-card-text"><time datetime="'+esc(day.date)+'">'+esc(fullDate(day.date))+'</time><strong>'+esc(day.title||t('untitled'))+
        '</strong></span></button>'+(owner?'<footer><span class="fh-audience">'+esc(shareText(audience))+'</span>'+
        button('access',shareText('access'),{id:day.id,style:'fh-text'})+'</footer>':day.owner?'<footer><button type="button" class="fh-byline" data-act="go" data-id="'+esc(personRoute(day.owner))+
        '" data-fid="author:'+esc(day.id)+'">'+avatar(day.owner)+'<span>'+esc(day.owner.name)+'</span></button></footer>':'')+'</article>';
    }).join('')+'</div>';
  }

  function feed() {
    if (model.days.length) return dayCards(model.days);
    if (friends().length) return stateBox(t('noDays'),'',goButton('friends/people','openPeople'),'letter');
    return stateBox(t('firstTitle'),t('firstHint'),button('add',t('first'),{style:'primary',symbol:'plus',fid:'first-add'}),'letter');
  }

  function requestGroup(key) {
    const list = model.people[key];
    if (!list.length) return '';
    const incoming = key==='incoming';
    return '<section class="fh-group panel"><h2>'+esc(t(key))+' <span>'+list.length+'</span></h2><ul>'+list.map(row=>
      '<li class="fh-request"><div class="fh-person">'+identity(row.person)+'</div><div class="fh-actions">'+
      (incoming?button('accept',t('accept'),{id:row.id,style:'primary'})+button('decline',t('decline'),{id:row.id}):
        button('cancel-request',t('cancelRequest'),{id:row.id}))+'</div></li>').join('')+'</ul></section>';
  }

  function friendRows() {
    const search = normalized(query);
    const matches = friends().filter(friend => normalized(friend.name+' '+friend.code).includes(search));
    if (!matches.length) return '<div class="fh-no-match"><p>'+esc(t('noMatch'))+'</p>'+button('clear',t('clearSearch'),{style:'fh-text'})+'</div>';
    return '<ul>'+matches.map(friend => '<li><button type="button" class="fh-person fh-person-link" data-act="go" data-id="'+esc(personRoute(friend))+
      '" data-fid="friend:'+esc(friend.id)+'">'+identity(friend)+icon('chevron',17)+'</button></li>').join('')+'</ul>';
  }

  function people() {
    return requestGroup('incoming')+requestGroup('outgoing')+
      (friends().length?'<section class="fh-group panel"><h2>'+esc(t('myFriends'))+' <span>'+friends().length+'</span></h2>'+
        '<label class="fh-search">'+icon('search',18)+'<span class="ab-sr">'+esc(t('search'))+'</span><input type="search" data-fid="search" data-search value="'+
        esc(query)+'" placeholder="'+esc(t('search'))+'"></label><div data-friend-list>'+friendRows()+'</div></section>':
        stateBox(t('noPeople'),'',button('add',t('first'),{style:'primary',symbol:'plus',fid:'first-add'}),'letter'));
  }

  function friendProfile() {
    const friend = person();
    if (!friend) return stateBox(t('noFriend'),'',goButton('friends/people','openPeople'),'book');
    return '<header class="fh-friend-header">'+avatar(friend,true)+'<div><h2>'+esc(friend.name)+'</h2><p>'+esc(friend.code)+'</p></div>'+
      button('friend-menu',t('friendMenu'),{style:'fh-icon',symbol:'more'})+'</header>'+
      (model.days.length?'<section><h3 class="fh-section-label">'+esc(t('friendDays'))+'</h3>'+dayCards(model.days)+'</section>':
      stateBox(t('noFriendDays'),t('friendDaysHint',{name:friend.name}),'','letter'));
  }

  function invitePage() {
    const invite = model.invite;
    if (!invite?.person) return stateBox(t('unavailable'),t('newInvite'),'','clock');
    const inviter = invite.person;
    let title = t('inviteFrom',{name:inviter.name}), hint = '', actions = '';
    if (!model.session.authenticated) actions = linkToSignIn();
    else if (!signed()) actions = nameForm();
    else switch (invite.status) {
      case 'pending':
        title = t('pending'); hint=t('pendingHint');
        if (invite.requestId) actions=button('cancel-request',t('cancelRequest'),{id:invite.requestId});
        break;
      case 'friends':
        title=t('already'); actions=goButton(personRoute(inviter),'openFriend'); break;
      case 'self':
        title=t('own'); hint=t('ownHint'); actions=goButton('friends/people','openPeople'); break;
      case 'incoming':
        title=t('incomingTitle',{name:inviter.name});
        actions=button('accept',t('accept'),{id:invite.requestId,style:'primary'}); break;
      case 'available':
        actions=button('send-request',t('request'),{style:'primary'}); break;
      default: return stateBox(t('unavailable'),t('newInvite'),'','clock');
    }
    if (!hint && (!signed() || invite.status==='available')) hint=t('requestHint');
    return '<section class="fh-state fh-invitation panel">'+avatar(inviter,true)+'<div><h2>'+esc(title)+'</h2><p class="fh-inviter-code">'+
      esc([inviter.name,inviter.code].join(' · '))+'</p>'+(hint?'<p>'+esc(hint)+'</p>':'')+'</div>'+actions+'</section>';
  }

  function reactionLabel(kind) {
    const label = {close:'closeFeeling',warm:'warm',surprise:'surprise'}[kind];
    return label ? shareText(label) : t('reactions');
  }

  function responses() {
    const {comments,reactions} = model.responses;
    const rows = (list,isComment) => !list.length ? '' : '<section class="fh-group panel"><h3>'+esc(t(isComment?'comments':'reactions'))+
      ' <span>'+list.length+'</span></h3><ul>'+list.map(item => '<li class="fh-response"><div><p class="fh-response-text">'+
      esc(isComment?item.text:reactionLabel(item.kind))+'</p>'+(isComment&&item.createdAt?'<small>'+esc(fullDate(localDay(item.createdAt)))+'</small>':'')+'</div>'+
      button(isComment?'comment':'reaction',t(isComment?'deleteComment':'deleteReaction'),{id:isComment?item.id:item.publicationId,style:'fh-icon',symbol:'trash'})+
      '</li>').join('')+'</ul></section>';
    return '<h2 class="fh-title" tabindex="-1">'+esc(t('responses'))+'</h2>'+
      (comments.length||reactions.length?rows(comments,true)+rows(reactions,false):stateBox(t('noResponses'),t('responsesHint'),'','pen'));
  }

  function content() {
    if (!model) {
      if (failure) return stateBox(t(failure),t(failure==='offline'?'offlineHint':'failedHint'),button('retry',t('retry'),{symbol:'restart'}),'info');
      return '<p class="fh-loading" role="status">'+esc(t('loading'))+'</p>';
    }
    if (page==='invite') return invitePage();
    if (!model.session.authenticated) return stateBox(t('hello'),t('signHint'),linkToSignIn(),'letter');
    if (!signed()) return '<section class="fh-panel panel"><h2>'+esc(t('chooseName'))+'</h2>'+nameForm()+'</section>';
    const panelMarkup = activePane();
    if (panelMarkup) return panelMarkup;
    if (page==='people') return people();
    if (page==='person') return friendProfile();
    if (page==='mine') return '<h2 class="fh-title" tabindex="-1">'+esc(t('mine'))+'</h2>'+
      (model.days.length?dayCards(model.days,true):stateBox(t('noPublications'),t('publishHint'),goButton('archive','archive'),'letter'));
    if (page==='responses') return responses();
    return feed();
  }

  function paint() {
    if (!alive) return;
    const previous = document.activeElement;
    const key = root.contains(previous) ? previous.dataset.fid : '';
    const selection = previous?.tagName==='INPUT' ? [previous.selectionStart, previous.selectionEnd] : null;
    root.innerHTML = '<div class="fh">'+toolbar()+'<div id="fh-content" class="fh-content">'+content()+'</div>'+
      (actionError ? '<p class="fh-error" role="alert">'+esc(t(actionError))+'</p>':'')+
      (writing?'<p class="fh-loading" role="status">'+esc(t('busy'))+'</p>':'')+'</div>';
    root.querySelector('.fh').setAttribute('aria-busy',String(!!writing));
    if (writing) root.querySelectorAll('button,input').forEach(el=>{el.disabled=true;});
    const next = key && focusKey(key);
    if (next) {
      next.focus({preventScroll:true});
      if (selection && next.tagName==='INPUT') next.setSelectionRange(...selection);
    }
  }

  function applyRestore() {
    const saved = restore;
    restore = null;
    if (!saved || (saved.ownerId && saved.ownerId!==signed()?.id)) return;
    restoreFrame = requestAnimationFrame(()=>{
      if (!alive) return;
      if (saved.focusId) focus(saved.focusId);
      if (Number.isFinite(saved.scrollY)) window.scrollTo({top:saved.scrollY,behavior:'instant'});
    });
  }

  async function refresh() {
    if (!alive || writing || loading) return;
    const reader = new AbortController();
    loading = reader;
    let accountId;
    const read = path => api(path,{signal:reader.signal,headers:accountId ? {'X-NoLimit-Account':accountId} : {}});
    try {
      if (!navigator.onLine) throw new TypeError();
      const session = await read('/session');
      if (reader.signal.aborted) return;
      accountId=session.user?.id;
      if (model && model.session.user?.id!==session.user?.id) {
        model=null; snapshot=null; pane=''; query=''; nameDraft=''; targetId=''; actionError='';
        paint();
      }
      const next = {session};
      if (page==='invite') {
        try { next.invite = routeId ? await read('/invites/'+enc(routeId)) : null; }
        catch (error) {
          if (error.code==='invite_unavailable'||[404,410].includes(error.status)) next.invite=null;
          else throw error;
        }
      } else if (session.user) {
        if (page==='mine') next.days = (await read('/mine')).days;
        else if (page==='responses') next.responses = await read('/my-responses');
        else {
          const feedRoute = page==='feed' ? '/feed' : page==='person' ? '/feed?author='+enc(routeId) : null;
          const [peopleData,feedData] = await Promise.all([read('/people'),feedRoute ? read(feedRoute) : null]);
          next.people = peopleData;
          next.days = feedData?.days || [];
        }
      }
      if (!alive || reader.signal.aborted) return;
      const serialized = JSON.stringify(next);
      const changed = snapshot!==serialized || !!failure || !!restore;
      model=next; snapshot=serialized; failure='';
      if (restore && (!restore.ownerId || restore.ownerId===session.user?.id)) {
        query=restore.search || '';
        if (restore.language && restore.language!==getLanguage()) {
          pane=restore.pane || ''; paneTrigger=restore.paneTrigger || ''; targetId=restore.targetId || ''; nameDraft=restore.nameDraft || '';
        } else if (restore.pane) {
          restore={...restore,focusId:restore.paneTrigger};
        }
      }
      if (pane==='revoke' && model.people?.invite?.token!==targetId) pane='add';
      if ((pane==='remove'||pane==='friend-menu') && !person()) pane='';
      if (pane==='comment' && !model.responses?.comments.some(row=>row.id===targetId)) pane='';
      if (pane==='reaction' && !model.responses?.reactions.some(row=>row.publicationId===targetId)) pane='';
      if (changed) paint();
      applyRestore();
    } catch (error) {
      if (!alive || reader.signal.aborted) return;
      const networkError = error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
      model=null; snapshot=null; pane=''; failure=(!navigator.onLine || networkError || error.code==='network_error')?'offline':'failed'; paint();
    } finally { if (loading===reader) loading=null; }
  }

  function openPane(next, key, id = '') {
    actionError=''; targetId=id;
    if (!pane) paneTrigger=key || document.activeElement?.dataset.fid || '';
    pane=next;
    paint();
    (focusKey(next==='name'?'name-field':'pane-title'))?.focus();
  }

  function dismiss() {
    const key=paneTrigger;
    pane=''; paneTrigger=''; targetId=''; actionError=''; paint(); focus(key,true);
  }

  async function mutate(path, method, success, options = {}) {
    if (writing || !alive) return;
    if (loading) { loading.abort(); loading=null; }
    const controller = new AbortController();
    const actionFocus=document.activeElement?.dataset.fid;
    writing=controller; actionError=''; paint();
    let complete=false;
    try {
      const session = await api('/session',{signal:controller.signal});
      if (!session.authenticated || session.user?.id!==signed()?.id) throw Object.assign(new Error('account_changed'),{code:'account_changed'});
      const headers=session.user ? {'X-NoLimit-Account':session.user.id} : {};
      await api(path,{method,body:options.body,headers,signal:controller.signal});
      complete=true;
    } catch (error) {
      if (!alive||controller.signal.aborted) return;
      actionError=error.code==='invalid_name'?'simpleName':'actionFailed';
      if (error.code==='account_changed') ctx.toast(t('accountChanged'));
    } finally {
      if (writing===controller) writing=null;
    }
    if (!alive || controller.signal.aborted) return;
    if (complete) {
      pane=options.nextPane || ''; targetId=''; actionError='';
      if (success) ctx.toast(t(success));
    }
    snapshot=null;
    await refresh();
    if (!alive) return;
    if (!complete) return focus(actionError==='simpleName'?'name-field':actionFocus,true);
    if (options.to) ctx.go(options.to);
    else focus(options.focus || actionFocus || paneTrigger,true);
  }

  function offline() {
    loading?.abort(); loading=null; writing?.abort(); writing=null;
    model=null; snapshot=null; pane=''; failure='offline'; actionError=''; paint();
  }

  function revalidate() {
    if (document.visibilityState!=='hidden') refresh();
  }

  function socialUpdated() {
    if (!alive || document.visibilityState==='hidden') return;
    loading?.abort();
    loading=null;
    refresh();
  }

  async function click(event) {
    const el=event.target.closest('button[data-act]');
    if (!el || !root.contains(el) || el.disabled) return;
    const {act,id,fid}=el.dataset;
    const requestPath='/requests/'+enc(id);
    switch (act) {
      case 'retry': failure=''; paint(); return refresh();
      case 'go':
        if (id===route) return pane ? dismiss() : refresh();
        return ctx.go(id);
      case 'access': return ctx.openSharedAccess(id);
      case 'add':
      case 'profile':
        return pane===act ? dismiss() : openPane(act,fid);
      case 'edit-name': nameDraft=signed().name; return openPane('name',fid);
      case 'dismiss': return dismiss();
      case 'create-invite': return mutate('/invites','POST','',{nextPane:'add',focus:'copy:'});
      case 'revoke': return openPane('revoke',fid,model.people.invite.token);
      case 'confirm-revoke': return mutate('/invites/current?token='+enc(targetId),'DELETE','revoked',{nextPane:'add',focus:'create-invite:'});
      case 'copy': {
        const field = root.querySelector('[data-fid="invite-url"]');
        if (!field) return;
        try { await navigator.clipboard.writeText(field.value); if (alive) ctx.toast(t('copied')); }
        catch { if (alive) { field.focus(); field.select(); ctx.toast(t('copyManual')); } }
        return;
      }
      case 'accept': return mutate(requestPath+'/accept','POST','accepted',{to:page==='invite'?'friends/people':null});
      case 'decline': return mutate(requestPath,'DELETE','declined');
      case 'cancel-request': return mutate(requestPath,'DELETE','cancelled');
      case 'send-request': return mutate('/invites/'+enc(routeId)+'/request','POST','pending');
      case 'friend-menu':
      case 'remove':
      case 'comment':
      case 'reaction': return openPane(act,fid,id);
      case 'confirm-remove': return mutate('/friends/'+enc(routeId),'DELETE','removed',{to:'friends/people'});
      case 'confirm-response': return mutate('/my-responses/'+pane+'/'+enc(targetId),'DELETE','removedResponse');
      case 'clear':
        query=''; paint(); return focus('search');
    }
  }

  function input(event) {
    if (event.target.matches('[data-search]')) {
      query=event.target.value;
      root.querySelector('[data-friend-list]').innerHTML=friendRows();
    }
    if (event.target.matches('[name="name"]')) {
      nameDraft=event.target.value;
      event.target.setCustomValidity('');
    }
  }

  function submit(event) {
    if (!event.target.matches('[data-name-form]')) return;
    event.preventDefault();
    const field=event.target.elements.name;
    const name=field.value.normalize('NFC').trim();
    if (!name || Array.from(name).length>60) {
      field.setCustomValidity(t(!name?'simpleName':'nameLength')); field.reportValidity(); return;
    }
    mutate('/profile','POST','savedName',{body:{name},nextPane:pane==='name'?'profile':'',focus:pane==='name'?'pane-title':'add:'});
  }

  function keydown(event) {
    if (event.key==='Escape' && pane && !writing) { event.preventDefault(); dismiss(); }
  }

  root.addEventListener('click',click);
  root.addEventListener('input',input);
  root.addEventListener('submit',submit);
  root.addEventListener('keydown',keydown);
  window.addEventListener('focus',revalidate);
  window.addEventListener('online',revalidate);
  window.addEventListener('nolimit-social-updated',socialUpdated);
  window.addEventListener('offline',offline);
  document.addEventListener('visibilitychange',revalidate);
  const poll=setInterval(revalidate,15000);
  paint(); refresh();

  function cleanup() {
    alive=false; loading?.abort(); writing?.abort();
    clearInterval(poll); cancelAnimationFrame(restoreFrame);
    document.removeEventListener('visibilitychange',revalidate);
    window.removeEventListener('focus',revalidate);
    window.removeEventListener('online',revalidate);
    window.removeEventListener('nolimit-social-updated',socialUpdated);
    window.removeEventListener('offline',offline);
    root.removeEventListener('click',click);
    root.removeEventListener('input',input);
    root.removeEventListener('submit',submit);
    root.removeEventListener('keydown',keydown);
    root.replaceChildren();
  }
  cleanup.getViewState=()=>({language,scrollY:window.scrollY,focusId:root.contains(document.activeElement)?document.activeElement.dataset.fid:'',search:query,
    ownerId:signed()?.id || null,pane,paneTrigger,targetId,nameDraft});
  return cleanup;
}
