import {esc} from './ui.js';
import {t} from './locales/friends-hub.js';
import {getCachedProfileName} from './social-api.js';

export function profileNameForm(id,value=getCachedProfileName()) {
  return '<form class="fh-form" data-name-form data-profile-form novalidate><label for="'+id+'">'+esc(t('yourName'))+'</label>'+
    '<input class="day-field" type="text" id="'+id+'" name="name" autocomplete="nickname" required aria-describedby="'+id+'-hint" data-fid="name-field" value="'+esc(value)+'">'+
    '<p id="'+id+'-hint">'+esc(t('nameHint'))+'</p><button class="primary" type="submit" data-fid="save-name" '+
    (value.trim()?'':'disabled')+'>'+esc(t('saveName'))+'</button></form>';
}

export function updateNameInput(field) {
  field.setCustomValidity('');
  field.form.querySelector('[type="submit"]').disabled=!field.value.trim();
}

export function readProfileName(form) {
  const field=form.elements.name;
  const name=field.value.normalize('NFC').trim();
  let error='';
  if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(name)) error='simpleName';
  else if (Array.from(name).length>60) error='nameLength';
  else if (/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(name)) error='invalidName';
  if (error) {
    field.setCustomValidity(t(error));
    field.reportValidity();
    return null;
  }
  return name;
}

export function profileNameError(error) {
  if (error.code==='invalid_name') return 'invalidName';
  if (error.code==='profile_unconfirmed' || error.code==='storage_unavailable') return 'storageUnavailable';
  return '';
}
