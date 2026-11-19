const locales = {ru:'ru-RU', kk:'kk-KZ', en:'en-GB'};
const languages = Object.keys(locales);
const preference = 'nolimit:language';
let language = 'ru';
try {
  const saved = localStorage.getItem(preference);
  if (languages.includes(saved)) language = saved;
} catch { /* A private session can still switch language. */ }

export const getLanguage = () => language;
export const getLocale = () => locales[language];
export function setLanguage(next) {
  if (!languages.includes(next)) return false;
  language = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  try { localStorage.setItem(preference, next); } catch {}
  return true;
}


// Some Chromium builds report kk-KZ as supported but display “M09” and “Thu”.
const kazakhMonths = 'қаңтар ақпан наурыз сәуір мамыр маусым шілде тамыз қыркүйек қазан қараша желтоқсан'.split(' ');
const kazakhWeekdays = 'жексенбі дүйсенбі сейсенбі сәрсенбі бейсенбі жұма сенбі'.split(' ');
export function formatDate(value, options = {day:'numeric',month:'long'}) {
  const date = new Date(value+'T12:00:00');
  if (Number.isNaN(date.getTime())) return value;
  if (language !== 'kk') return new Intl.DateTimeFormat(getLocale(), options).format(date);
  const parts = [];
  if (options.year) parts.push(date.getFullYear()+' ж.');
  if (options.day) parts.push(String(date.getDate()));
  if (options.month) parts.push(kazakhMonths[date.getMonth()]);
  const formatted = parts.join(' ');
  return options.weekday ? [formatted, kazakhWeekdays[date.getDay()]].filter(Boolean).join(', ') : formatted;
}

export function translator(messages) {
  return (key, values = {}) => {
    const entry = messages[key];
    if (!Array.isArray(entry)) throw new Error('Missing translation: ' + key);
    return entry[languages.indexOf(language)].replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match);
  };
}
