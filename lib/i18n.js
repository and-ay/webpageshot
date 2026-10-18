// Переводы лежат в _locales/<язык>/messages.json. Язык выбирает браузер по языку своего интерфейса,
// если такого перевода нет — берётся default_locale из манифеста (английский).

export const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));

// Подставляет переводы в разметку: data-i18n — текст, data-i18n-title — подсказка, data-i18n-aria — aria-label.
export function localize() {
  document.documentElement.lang = t('lang');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}
