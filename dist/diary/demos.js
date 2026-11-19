import {makeRecipe} from './art.js';
import {getLanguage} from './i18n.js';
import {demoText as t} from './locales/demos.js';

const media='./diary/media/';
const gallery='https://npgallery.nps.gov/AssetDetail/';
const skimage='https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.';
const nps='Diane Renkin / National Park Service';
function photo(id,color,author,license,source,x=50,y=50) {
  return {id,name:t(id+'Alt'),src:media+id+'.jpg',color,credit:author+' · '+(license==='CC0'?license:t(license)),source,x,y};
}
function demo(id,date,photos,bpm,energy) {
  const day={
    id:'demo-'+id,date,status:'ready',moments:[],text:t(id+'Story'),photos,contentLanguage:getLanguage(),
    music:{kind:'file',name:t(id+'Song'),src:media+id+'.mp3',bpm,energy,credit:t('musicCredit')},
    demo:true
  };
  const recipe=makeRecipe(day);
  return {...day,title:recipe.title,caption:recipe.caption,recipe};
}

function makeDemos() {
  return [
    demo('leaves','2026-09-17',[
      photo('leaves','#9c6c33',nps,'publicDomain',gallery+'79205401-1c69-4182-9cb9-61a753a5ac59',44,35),
      photo('river','#827c73',nps,'publicDomain',gallery+'dde71062-56f7-4f79-9717-ef3c950fc832'),
      photo('maple','#9d843f',nps,'publicDomain',gallery+'3b3c9937-d8ff-4f63-aab6-2fda23acdd22')],64,'calm'),
    demo('launch','2026-10-03',[photo('launch','#333e58','SpaceX','publicDomain','https://www.flickr.com/photos/spacexphotos/16511594820/',53,54)],136,'bright'),
    demo('coffee','2026-10-11',[
      photo('coffee','#b55f32','Rachel Michetti / Pikolo Espresso Bar','CC0',skimage+'coffee',58,44),
      photo('clock','#939393','Stefan van der Walt','publicDomain',skimage+'clock')],86,'steady'),
    demo('cat','2026-10-22',[photo('cat','#9a745a','Stefan van der Walt','CC0',skimage+'chelsea',56,46)],74,'calm'),
    demo('moon','2026-11-02',[photo('moon','#000c2a','NASA / Ben Smegelsky','nasaPhoto','https://images.nasa.gov/details/KSC-20240819-PH-JBS01_0009',51,60)],54,'calm')
  ];
}

export let demos=makeDemos();
export function refreshDemos() { demos=makeDemos(); }
