import { localize, t } from '../lib/i18n.js';
import { getFolder } from '../lib/save.js';
import { deleteHandle } from '../lib/store.js';

localize();

const DEFAULTS = { format: 'png', save: true, preview: false, copy: false, saveAs: false };
const RESTRICTED =
  /^(chrome|edge|brave|opera|vivaldi|yandex|browser|about|chrome-extension|moz-extension|extension|devtools|view-source|chrome-search|chrome-untrusted|resource):/i;
const STORES =
  /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons|addons\.mozilla\.org|addons\.opera\.com)/i;

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

// кнопки режимов
const restricted = !tab?.url || RESTRICTED.test(tab.url) || STORES.test(tab.url);
document.getElementById('warn').hidden = !restricted;
for (const btn of document.querySelectorAll('[data-mode]')) {
  btn.disabled = restricted;
  btn.addEventListener('click', async () => {
    const { id, windowId, index, url, title } = tab;
    await chrome.runtime.sendMessage({ type: 'capture', mode: btn.dataset.mode, tab: { id, windowId, index, url, title } });
    window.close();
  });
}

// горячие клавиши
const commands = await chrome.commands.getAll();
for (const kbd of document.querySelectorAll('kbd[data-command]')) {
  kbd.textContent = commands.find((c) => c.name === kbd.dataset.command)?.shortcut || '';
}
document.getElementById('shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  if (chrome.commands.openShortcutSettings) chrome.commands.openShortcutSettings(); // Firefox
  else chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// последняя ошибка
const { lastError } = await chrome.storage.session.get('lastError');
if (lastError && Date.now() - lastError.at < 5 * 60 * 1000) {
  const el = document.getElementById('error');
  el.textContent = t('failed', lastError.message);
  el.hidden = false;
  chrome.storage.session.remove('lastError');
}

// папка сохранения (выбирается в отдельном окне: popup закрывается, как только открывается системный диалог);
// в Firefox выбрать папку нельзя — файлы идут в его обычные загрузки
document.getElementById('folder-row').hidden = !('showDirectoryPicker' in window);
const folderBtn = document.getElementById('folder');
const folderReset = document.getElementById('folder-reset');
const showFolder = (dir) => {
  folderBtn.textContent = dir ? dir.name : t('folderDefault');
  folderReset.hidden = !dir;
};
showFolder(await getFolder());
folderBtn.addEventListener('click', async () => {
  const [width, height] = [460, 300];
  await chrome.windows.create({
    url: chrome.runtime.getURL('save/save.html?mode=pick'),
    type: 'popup',
    width,
    height,
    left: Math.round(screen.availLeft + (screen.availWidth - width) / 2),
    top: Math.round(screen.availTop + (screen.availHeight - height) / 3),
  });
  window.close();
});
folderReset.addEventListener('click', async () => {
  await deleteHandle('folder');
  showFolder(null);
});

// настройки
const settings = await chrome.storage.sync.get(DEFAULTS);
const box = (name) => document.querySelector(`.settings input[name="${name}"]`);
const section = document.querySelector('.settings');
const showSaveOptions = () => section.classList.toggle('no-save', !box('save').checked);
for (const input of document.querySelectorAll('.settings input')) {
  if (input.type === 'checkbox') input.checked = Boolean(settings[input.name]);
  else input.checked = settings[input.name] === input.value;
  input.addEventListener('change', () => {
    const changes = { [input.name]: input.type === 'checkbox' ? input.checked : input.value };
    // сохранять или копировать — хотя бы что-то одно, иначе снимок пропадёт
    if (!input.checked && (input.name === 'save' || input.name === 'copy')) {
      const other = box(input.name === 'save' ? 'copy' : 'save');
      if (!other.checked) changes[other.name] = other.checked = true;
    }
    chrome.storage.sync.set(changes);
    showSaveOptions();
  });
}
showSaveOptions();
