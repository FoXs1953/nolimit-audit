import {assessImport, exportZip, importDays, inspectZip, listDays} from './store.js';
import {dayRow, esc, icon, localDate} from './ui.js';

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
  root.innerHTML = '<div class="settings-layout"><section class="settings-panel panel"><h2>Просмотр</h2>'+
    '<label class="setting-row"><span class="setting-copy"><strong>Уменьшить движение</strong><p>Спокойные переходы и неподвижные фотографии.</p></span>'+
    '<input class="motion-switch" type="checkbox" role="switch" aria-label="Уменьшить движение"></label></section>'+
    '<section class="settings-panel panel"><h2>Мои данные</h2><p class="settings-intro">Личные записи хранятся в этом браузере. Копия позволяет перенести их на другой телефон.</p>'+
    dayRow({title:'Скачать копию',note:'Все дни, фотографии, музыка и черновики в ZIP',action:'backup',symbol:'download'})+
    dayRow({title:'Восстановить из файла',note:'Просмотреть содержимое перед добавлением',action:'restore',symbol:'upload'})+
    '<input type="file" data-import accept=".zip,application/zip" hidden></section>'+
    '<section class="settings-panel panel"><h2>О приложении</h2>'+
    dayRow({title:'Как работает дневник',note:'Создание открытки и материалы команды',action:'about',symbol:'info'})+
    '</section></div>';
  const motion = root.querySelector('.motion-switch');
  motion.checked = ctx.reducedMotion;
  motion.onchange = () => ctx.setMotion(motion.checked);
  const backup = root.querySelector('[data-action="backup"]');
  backup.onclick = async () => {
    backup.disabled = true;
    try {
      const records = await listDays();
      if (!records.length) {ctx.toast('Архив пока пуст. Сначала сохрани день или заметку.');return;}
      await downloadDays(records,'NoLimit-дневник-'+localDate()+'.zip');
      ctx.toast('Резервная копия готова к скачиванию.');
    } catch(error){ctx.toast(error.message);} finally {backup.disabled=false;}
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
      ctx.sheet('Восстановить дневник','<p>Файл «'+esc(file.name)+'»</p><dl class="source-fields">'+
        [['Записей в файле',records.length],['Будет добавлено',preview.added],['Совпадающих',preview.skipped],['Конфликтующих версий',preview.conflicts]].map(
          ([name,n])=>'<div><dt>'+name+'</dt><dd>'+n+'</dd></div>').join('')+
        '</dl><p class="sheet-help">Разные версии одного дня сохраняются отдельно.</p><div class="sheet-actions"><button class="primary" data-apply>Восстановить</button><button class="secondary" data-cancel>Отмена</button></div>',body=>{
          body.querySelector('[data-cancel]').onclick = ctx.closeSheet;
          const apply = body.querySelector('[data-apply]');
          apply.onclick = async () => {
            apply.disabled=true;
            try { const result = await importDays(records);ctx.go('archive');ctx.toast('Добавлено: '+result.added+'. Совпадающих: '+result.skipped+'.'); }
            catch(error){ctx.toast(error.message);apply.disabled=false;}
          };
        });
    } catch(error){ctx.toast(error.message || 'Не удалось прочитать копию.');} finally {restore.disabled=false;}
  };
  root.querySelector('[data-action="about"]').onclick = ctx.about;
}
