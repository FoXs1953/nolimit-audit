// The shell loads this before its styles so a saved preference is applied on first paint.
const diaryTheme = (() => {
  const key = 'nolimit:theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const preferenceOf = value => value === 'system' || value === 'dark' ? value : 'light';
  let preference = 'light';
  try { preference = preferenceOf(localStorage.getItem(key)); } catch {}

  function apply() {
    const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#000000' : '#f5f6f8';
    document.dispatchEvent(new Event('diarythemechange'));
  }

  function setPreference(value) {
    preference = preferenceOf(value);
    try {
      localStorage.setItem(key, preference);
    } catch {}
    apply();
  }

  system.addEventListener('change', () => {
    if (preference === 'system') apply();
  });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    try {
      if (event.storageArea !== localStorage) return;
      preference = preferenceOf(localStorage.getItem(key));
    } catch { return; }
    apply();
  });
  apply();
  return {get preference() { return preference; }, setPreference};
})();
