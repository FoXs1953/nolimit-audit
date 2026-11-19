// Personal days for disposable browser profiles. Historical media paths remain usable in saved entries.
const { randomUUID } = require('node:crypto');
const title = 'Тихий вечер у реки';
function personalDay(overrides = {}) {
  const photos = [
    ['leaves','#9c6c33'], ['river','#827c73'], ['maple','#9d843f']
  ].map(([name,color]) => ({id:name,name:name+'.jpg',src:'./diary/media/'+name+'.jpg',color}));
  return {
    id:randomUUID(), date:'2026-09-17', status:'ready', contentLanguage:'ru', moments:[],
    text:title+'. Я запомнила тихий шелест листьев.', photos,
    music:{kind:'file',name:'Музыка у реки',src:'./diary/media/leaves.mp3',bpm:64,energy:'calm'},
    ...overrides
  };
}
async function seedDay(page, overrides = {}) {
  return page.evaluate(async day => {
    const {saveDay}=await import('./diary/store.js');
    const {makeRecipe}=await import('./diary/art.js');
    day.recipe=makeRecipe(day);
    day.title=day.recipe.title;
    day.caption=day.recipe.caption;
    return (await saveDay(day)).id;
  },personalDay(overrides));
}
module.exports = {title,personalDay,seedDay};
