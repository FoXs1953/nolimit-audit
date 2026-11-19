import { makeRecipe } from './art.js';

const media='./diary/media/';
const gallery='https://npgallery.nps.gov/AssetDetail/';
const skimage='https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.';
const nps = 'Diane Renkin / National Park Service · public domain';
function photo(id,name,color,credit,source,x=50,y=50) {
  return {id,name,src:media+id+'.jpg',color,credit,source,x,y};
}
function demo(id,date,text,photos,musicName,bpm,energy) {
  const day={
    id:'demo-'+id,date,status:'ready',moments:[],text,photos,
    music:{kind:'file',name:musicName,src:media+id+'.mp3',bpm,energy,credit:'Музыка NoLimit · оригинальная композиция'},
    demo:true
  };
  const recipe=makeRecipe(day);
  return {...day,title:recipe.title,caption:recipe.caption,recipe};
}

export const demos=[
  demo('leaves','2026-09-17',
    'Солнце осталось в листьях. На изгибе реки мы наконец замолчали. Под ногами шуршал клён. В наушниках повторялись восемь тихих нот, и даже дорога домой казалась длиннее.',
    [photo('leaves','Свет сквозь золотые осины','#9c6c33',nps,gallery+'79205401-1c69-4182-9cb9-61a753a5ac59',44,35),
     photo('river','Изгиб реки Ламар','#827c73',nps,gallery+'dde71062-56f7-4f79-9717-ef3c950fc832'),
     photo('maple','Жёлтые листья горного клёна','#9d843f',nps,gallery+'3b3c9937-d8ff-4f63-aab6-2fda23acdd22')],
    'Послевкусие',64,'calm'),
  demo('launch','2026-10-03',
    'Щелчок затвора перед стартом. На экране ракета ещё стояла между мачтами. Мы считали секунды вслух, а когда вспыхнула площадка, у нас пропали все слова. Потом я первым делом пересмотрел этот неподвижный кадр.',
    [photo('launch','Ракета Falcon 9 на стартовой площадке','#333e58','SpaceX · public domain','https://www.flickr.com/photos/spacexphotos/16511594820/',53,54)],
    'Обратный отсчёт',136,'bright'),
  demo('coffee','2026-10-11',
    'Круги на утреннем кофе. Ложечка звякнула о край красного блюдца. Я выключила будильник, позвонила маме и впервые за неделю допила кофе горячим.',
    [photo('coffee','Чашка эспрессо на красном блюдце','#b55f32','Rachel Michetti / Pikolo Espresso Bar · CC0',skimage+'coffee',58,44),
     photo('clock','Размытый циферблат на светлой стене','#939393','Stefan van der Walt · public domain',skimage+'clock')],
    'Ложечка на блюдце',86,'steady'),
  demo('cat','2026-10-22',
    'Усы на краю одеяла. Кошка уткнулась носом мне в ладонь. Мы сидели на диване, и от её мурлыканья под пальцами мелко дрожал плед. На кухне уже остывал чай.',
    [photo('cat','Кошка смотрит из-под одеяла','#9a745a','Stefan van der Walt · CC0',skimage+'chelsea',56,46)],
    'Тёплая лапа',74,'calm'),
  demo('moon','2026-11-02',
    'Луна над крышами домов. Из окна я заметил красный круг у самого горизонта. Пока сосед включал на лестнице свет, луна поднялась выше антенн. Мы простояли в тишине до самого холода.',
    [photo('moon','Красная луна над тёмным силуэтом зданий','#000c2a','NASA / Ben Smegelsky · снимок NASA','https://images.nasa.gov/details/KSC-20240819-PH-JBS01_0009',51,60)],
    'Ночное окно',54,'calm')
];
