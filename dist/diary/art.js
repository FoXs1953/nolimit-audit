const moods = {
  quiet: {label:'Тихое', technique:'Длинная экспозиция', tilt:-1.5, motion:'float'},
  tender: {label:'Тёплое', technique:'Плёночный отпечаток', tilt:3.5, motion:'lift'},
  bright: {label:'Радостное', technique:'Контактный лист', tilt:-3, motion:'pan'},
  restless: {label:'Напряжённое', technique:'Ритмический монтаж', tilt:5, motion:'cut'}
};

const cues = {
  quiet: ['тиш','тих','молч','медлен','лун','сумерк','замер','спокой','один','пауза','quiet','still','moon'],
  tender: ['тёпл','тепл','обня','домой','домаш','ладон','нежн','мурлы','какао','кофе','кружк','family','warm','home'],
  bright: ['смех','смея','улыб','танц','радос','празд','прыга','побед','летим','ура','dance','happy','laugh'],
  restless: ['старт','ракет','спеш','гонк','тороп','нерв','сует','успет','не успе','грохот','любую секунду','race','rush','hurry']
};

const energyTempo = {calm:66, steady:91, bright:128};
const beatsPerFrame = {calm:8, steady:7, bright:6};
const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const limit = (n, min, max) => Math.min(max, Math.max(min, n));
const countWords = value => value.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu) || [];

function readMood(text) {
  const normalized = text.toLowerCase().replace(/не\s+(груст\p{L}*|тих\p{L}*|спокой\p{L}*|радост\p{L}*|нерв\p{L}*)/gu, '');
  let best = 'quiet', score = 0;
  for (const [id,words] of Object.entries(cues)) {
    const matches = words.reduce((sum,word) => sum + Number(normalized.includes(word)),0);
    if (matches > score) { best=id; score=matches; }
  }
  return best;
}

function titleFrom(sentences) {
  const sentence = sentences.find(s => countWords(s).length >= 3) || sentences[0] || '';
  const words = countWords(sentence);
  if (!words.length) return 'Один день из жизни';
  if (words.length < 3) return 'День в памяти · ' + words.join(' ');
  return words.slice(0,7).join(' ');
}

function excerpt(value, max) {
  const text = clean(value);
  return text.length <= max ? text : text.slice(0,max - 1).replace(/\s+\S*$/u,'') + '…';
}

export function makeRecipe(day = {}) {
  const text = clean(day.text);
  const sentences = text.match(/[^.!?…]+[.!?…]*/gu)?.map(clean).filter(Boolean) || [];
  const title = clean(day.titleOverride) || titleFrom(sentences);
  const caption = clean(day.captionOverride) || excerpt(sentences.find((s,i) => i>0 && s.length >= 12) || sentences[0] || '',135);
  const mood = Object.hasOwn(moods,day.moodOverride) ? day.moodOverride : readMood(text);
  const photoColor = day.photos?.[0]?.color || '';
  const color = /^#[\da-f]{6}$/i.test(photoColor) ? photoColor : '#85a7d2';
  const music=day.music || {};
  const override=Object.hasOwn(energyTempo,day.rhythmOverride);
  const energy = override ? day.rhythmOverride : Object.hasOwn(energyTempo,music.energy) ? music.energy : 'steady';
  const measured = Number(music.bpm);
  const hasTempo = Number.isFinite(measured) && measured >= 35 && measured <= 245;
  const bpm = override || !hasTempo ? energyTempo[energy] : Math.round(measured);
  const interval = Math.round(limit(60000/bpm * beatsPerFrame[energy],2350,8700));
  const seconds = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(interval/1000);
  const colorText = color.toUpperCase();
  const musicSource = override ? 'Темп задан тобой' : music.kind === 'link' ? 'Темп взят из выбранного характера песни' :
    hasTempo ? 'Темп музыки — ' + bpm + ' уд/мин' : 'Ритм выбран по энергии дорожки';
  return {
    version:1, title, caption, color, mood, moodLabel:moods[mood].label,
    treatment:moods[mood].technique, motion:moods[mood].motion, tilt:moods[mood].tilt,
    interval, bpm, energy,
    reasons:{
      text: (day.moodOverride ? 'Ты выбрал настроение «' : 'По словам записи выбрано настроение «') +
        moods[mood].label.toLowerCase() + '». Приём «' + moods[mood].technique.toLowerCase() + '» задаёт композицию и движение кадра.',
      photo: day.photos?.length ? 'Оттенок обложки ' + colorText + ' перешёл на край отпечатка и поля. Точка кадрирования сохраняет выбранную деталь.' : 'Палитра появится после выбора обложки.',
      music: musicSource + '. На один кадр отведено ' + seconds + ' с.'
    }
  };
}
