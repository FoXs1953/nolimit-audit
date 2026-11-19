import {getLanguage,getLocale} from './i18n.js';
import {artText as t} from './locales/art.js';

const moods = {
  restless:{tilt:5,motion:'cut',voiceRate:1.04,voicePitch:.98},
  bright:{tilt:-3,motion:'pan',voiceRate:1.06,voicePitch:1.06},
  sad:{tilt:-2.5,motion:'lift',voiceRate:.83,voicePitch:.91},
  angry:{tilt:-5,motion:'cut',voiceRate:1.1,voicePitch:.94},
  calm:{tilt:-1.5,motion:'float',voiceRate:.88,voicePitch:.96}
};

export function moodOptions() {
  return Object.fromEntries(Object.keys(moods).map(id => [id,t(id)]));
}

export function normalizeMood(value) {
  if (value === 'quiet' || value === 'tender') return 'calm';
  return typeof value === 'string' && Object.hasOwn(moods,value) ? value : '';
}

const cues = {
  sad:['груст','печал','тоск','тоску','плак','плач','слёз','слез','уныл','одиноко','расстро','разочаров','сағын','мұң','қайғ','жабырқ','жыла','көңілсіз','қапал','ренжі','sadness','sadden','sadder','saddest','sadly','sorrow','griev','lonely','melanchol','heartbrok','unhappy','weep','cried','crying','tearful','deject'],
  angry:['злой','злая','злое','злые','злым','злост','злю','злил','злит','зля','сердит','сержусь','рассер','ненави','разозл','злоб','гнев','ярост','бешен','беси','раздраж','возмущ','ашу','ыза','қаһар','angry','anger','furious','fury','enrag','irritat','outrag','resent'],
  restless:['напряж','напряг','трево','старт','ракет','спеш','гонк','тороп','нерв','сует','опозд','грохот','зымыран','ұшыр','асығ','асық','жарыс','мазасыз','алаңда','қарбалас','дүрсіл','уайым','race','racing','rush','hurr','nerv','anxi','restless','tense','tension','stress','hustl','rocket','launch'],
  bright:['смех','смея','смею','мурлы','улыб','танц','радос','радую','весел','весёл','счаст','празд','прыга','побед','летим','ура','қуаны','қуанд','көтеріңкі','күлі','күлк','күлім','пырыл','биле','тойла','мереке','жеңіс','purr','danc','happy','happin','laugh','smil','celebrat','joy','cheer'],
  calm:['тиш','тих','молч','медлен','спокой','спокоен','умиротвор','безмятеж','үнсіз','тыныш','тынық','жайбарақат','сабыр','баяу','жым-жырт','үндем','quiet','still','silent','silence','calm','peaceful','seren','relax']
};
// Exact words avoid confusing “mad” with “made” or «зол» with «золото».
const exactCues = {
  angry:['mad','зол','зла','злы'],
  sad:['sad','cry'],
  bright:['рад','рада','рады','радуюсь']
};
const energyTempo = {calm:66, steady:91, bright:128};
const beatsPerFrame = {calm:8, steady:7, bright:6};
const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const limit = (n, min, max) => Math.min(max, Math.max(min, n));
const countWords = value => value.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu) || [];
const valid = value => ['ru','kk','en'].includes(value);

// Use the entry's words for both the voice and fallback title. Interface language may differ.
export function storyLanguage(day) {
  const text=clean(day.text).toLowerCase();
  const hinted=valid(day.contentLanguage) ? day.contentLanguage : '';
  const cyrillic=(text.match(/\p{Script=Cyrillic}/gu)||[]).length;
  const latin=(text.match(/\p{Script=Latin}/gu)||[]).length;
  if (latin>cyrillic) return 'en';
  if (/[әғқңөұүһі]/u.test(text)) return 'kk';
  if (cyrillic) {
    const words=countWords(text);
    if (words.some(w=>['жылы','ана','дала','бала','менен','болады','менде','жолда','апам','аспан','алма','бардым'].includes(w))) return 'kk';
    if (words.some(w=>['я','мы','вы','и','на','что','это','как','сегодня','вчера','меня','дома','когда','домой'].includes(w))) return 'ru';
    return hinted==='kk' ? 'kk' : 'ru';
  }
  return hinted || getLanguage();
}

function readMood(text) {
  const normalized=text.toLowerCase()
    .replace(/(?<!\p{L})не\s+успе\p{L}*/gu,'спешка')
    .replace(/(?<!\p{L})(?:не|not)\s+\p{L}+/gu,'')
    .replace(/\p{L}+\s+емес(?!\p{L})/gu,'');
  const words=countWords(normalized);
  let best='calm',score=0;
  for (const [id,stems] of Object.entries(cues)) {
    const matches=words.filter(word=>exactCues[id]?.includes(word) || stems.some(stem=>word.startsWith(stem))).length;
    if(matches>score) {best=id;score=matches;}
  }
  return best;
}

function entryMood(day) {
  return normalizeMood(day.moodOverride) || readMood(clean(day.text));
}

export function postcardMood(day) {
  const saved = day.status === 'ready' && day.recipe?.version === 1 ? day.recipe.mood : undefined;
  return normalizeMood(saved) || entryMood(day);
}

const fallbackTitles = {
  ru:['Один день из жизни','День в памяти'],
  kk:['Есте қалған бір күн','Күннен қалған естелік'],
  en:['A day to remember','I remember']
};
function titleFrom(sentences,lang) {
  const sentence=sentences.find(s=>countWords(s).length>=3) || sentences[0] || '';
  const words=countWords(sentence);
  const [empty,prefix]=fallbackTitles[lang];
  if (!words.length) return empty;
  if (words.length<3) return prefix+' · '+words.join(' ');
  return words.slice(0,7).join(' ');
}

function excerpt(value, max) {
  const text = clean(value);
  return text.length <= max ? text : text.slice(0,max - 1).replace(/\s+\S*$/u,'') + '…';
}

function describe(day,recipe) {
  const moodLabel=t(recipe.mood);
  const treatment=t(recipe.motion);
  const music=day.music || {};
  const measured=Number(music.bpm);
  const tempoSource=Object.hasOwn(energyTempo,day.rhythmOverride) ? 'manualTempo' :
    Number.isFinite(measured) && measured>=35 && measured<=245 ? 'measuredTempo' : 'energyTempo';
  const fmt=new Intl.NumberFormat(getLocale(),{maximumFractionDigits:1});
  const lower=value=>value.toLocaleLowerCase(getLocale());
  return {...recipe,moodLabel,treatment,reasons:{
    text:t(normalizeMood(day.moodOverride)?'chosen':'inferred',{mood:lower(moodLabel)})+' '+t('technique',{technique:lower(treatment)}),
    photo:day.photos?.length ? t('color',{color:recipe.color.toUpperCase()}) : t('missingColor'),
    music:music.kind==='link' ? t('linkTempo') : t(tempoSource,{bpm:fmt.format(recipe.bpm)})+'. '+t('time',{seconds:fmt.format(recipe.interval/1000)})
  }};
}

export function makeRecipe(day = {}) {
  const text = clean(day.text);
  const sentences = text.match(/[^.!?…]+[.!?…]*/gu)?.map(clean).filter(Boolean) || [];
  const title = clean(day.titleOverride) || titleFrom(sentences,storyLanguage(day));
  const caption = clean(day.captionOverride) || excerpt(sentences.find((s,i) => i>0 && s.length >= 12) || sentences[0] || '',135);
  const mood = entryMood(day);
  const photoColor = day.photos?.[0]?.color || '';
  const color = /^#[\da-f]{6}$/i.test(photoColor) ? photoColor : '#85a7d2';
  const music=day.music || {};
  const override=Object.hasOwn(energyTempo,day.rhythmOverride);
  const energy = override ? day.rhythmOverride : Object.hasOwn(energyTempo,music.energy) ? music.energy : 'steady';
  const measured = Number(music.bpm);
  const hasTempo = Number.isFinite(measured) && measured >= 35 && measured <= 245;
  const bpm = override || !hasTempo ? energyTempo[energy] : Math.round(measured);
  const interval = Math.round(limit(60000/bpm * beatsPerFrame[energy],2350,8700));
  return describe(day,{version:1,title,caption,color,mood,...moods[mood],interval,bpm,energy});
}

// Existing postcards retain their authored words and composition. Captions explaining
// that composition follow the interface language, including for pre-localization backups.
export function presentRecipe(day) {
  const derived=makeRecipe(day);
  const saved=day.status==='ready' && day.recipe?.version===1 ? day.recipe : null;
  if (!saved) return derived;
  const numeric=(v,fallback,min,max)=>Number.isFinite(v)?limit(v,min,max):fallback;
  const mood=postcardMood(day);
  return describe(day,{
    ...derived,
    title:clean(saved.title) || clean(day.title) || derived.title,
    caption:typeof saved.caption==='string' ? saved.caption : day.caption || derived.caption,
    mood,
    voiceRate:numeric(saved.voiceRate,moods[mood].voiceRate,.75,1.25),
    voicePitch:numeric(saved.voicePitch,moods[mood].voicePitch,.8,1.2),
    color:/^#[\da-f]{6}$/i.test(saved.color) ? saved.color : derived.color,
    motion:['float','lift','pan','cut'].includes(saved.motion) ? saved.motion : moods[mood].motion,
    tilt:numeric(saved.tilt,moods[mood].tilt,-8,8),
    interval:numeric(saved.interval,derived.interval,1800,12000),
    bpm:numeric(saved.bpm,derived.bpm,35,245),
    energy:Object.hasOwn(energyTempo,saved.energy)?saved.energy:derived.energy
  });
}
