import {assessImport, exportZip, importDays, inspectZip, listDays} from './store.js';
import {t} from './locales/views.js';
import {dayRow, esc, localDate} from './ui.js';

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link);
  link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function downloadDays(days, filename) {
  const zip = await exportZip(days);
  downloadBlob(zip, filename);
}
export function mountSettings(root, days, ctx) {
  root.innerHTML = '<div class="settings-layout"><section class="settings-panel panel"><h2>'+t('display')+'</h2>'+
    '<label class="setting-row"><span class="setting-copy"><strong>'+t('reduceMotion')+'</strong><p>'+t('motionDescription')+'</p></span>'+
    '<input class="motion-switch" type="checkbox" role="switch" aria-label="'+t('reduceMotion')+'"></label></section>'+
    '<section class="settings-panel panel"><h2>'+t('myData')+'</h2><p class="settings-intro">'+t('storageDescription')+'</p>'+
    dayRow({title:t('downloadBackup'),note:t('backupContents'),action:'backup',symbol:'download'})+
    dayRow({title:t('restoreFile'),note:t('previewBeforeAdding'),action:'restore',symbol:'upload'})+
    '<input type="file" data-import accept=".zip,application/zip" hidden></section>'+
    '<section class="settings-panel panel"><h2>'+t('aboutApp')+'</h2>'+
    dayRow({title:t('howItWorks'),note:t('aboutDescription'),action:'about',symbol:'info'})+
    '</section></div>';
  const motion = root.querySelector('.motion-switch');
  motion.checked = ctx.reducedMotion;
  motion.onchange = () => ctx.setMotion(motion.checked);
  const backup = root.querySelector('[data-action="backup"]');
  backup.onclick = async () => {
    backup.disabled = true;
    try {
      const records = await listDays();
      if (!records.length) {ctx.toast(t('emptyBackup'));return;}
      await downloadDays(records,t('backupFilename',{date:localDate()}));
      ctx.toast(t('backupReady'));
    } catch(error){ctx.toast(error.message || t('backupError'));} finally {backup.disabled=false;}
  };
  const input = root.querySelector('[data-import]');
  const restore = root.querySelector('[data-action="restore"]');
  restore.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    restore.disabled = true;
    try {
      const records = await inspectZip(file);
      const preview = await assessImport(records);
      if(!root.isConnected)return;
      ctx.sheet(t('restoreDiary'),'<p>'+esc(t('fileName',{name:file.name}))+'</p><dl class="source-fields">'+
        [['inFile',records.length],['toAdd',preview.added],['matching',preview.skipped],['conflicts',preview.conflicts]].map(
          ([key,n])=>'<div><dt>'+t(key)+'</dt><dd>'+n+'</dd></div>').join('')+
        '</dl><p class="sheet-help">'+t('keepVersions')+'</p><div class="sheet-actions"><button class="primary" data-apply>'+t('restore')+'</button><button class="secondary" data-cancel>'+t('cancel')+'</button></div>',body=>{
          body.querySelector('[data-cancel]').onclick = ctx.closeSheet;
          const apply = body.querySelector('[data-apply]');
          apply.onclick = async () => {
            apply.disabled=true;
            try { const result = await importDays(records);await ctx.go('archive');ctx.toast(t('restored',result)); }
            catch(error){ctx.toast(error.message || t('restoreError'));apply.disabled=false;}
          };
        });
    } catch(error){ctx.toast(error.message || t('readError'));} finally {restore.disabled=false;}
  };
  root.querySelector('[data-action="about"]').onclick = ctx.about;
}
