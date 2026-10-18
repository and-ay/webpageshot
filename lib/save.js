// Сохранение файлов через File System Access API. Работает только в окнах расширения
// (offscreen-документ, превью, окно сохранения, popup), не в service worker.
//
// chrome.downloads всегда кладёт файлы расширений в «Загрузки» и не помнит выбранную папку,
// поэтому доступы к папке и к последнему сохранённому файлу храним в IndexedDB сами.

import { t } from './i18n.js';
import { getHandle, setHandle } from './store.js';

const FOLDER = 'folder';
const LAST_FILE = 'lastFile';

export const getFolder = () => getHandle(FOLDER);
export const setFolder = (dir) => setHandle(FOLDER, dir);

export const baseName = (filename) => filename.split('/').pop();

// После перезапуска браузера доступ к сохранённой папке нужно подтвердить заново
// (запросить можно только по действию пользователя — клику или нажатию клавиши).
export async function hasPermission(handle, request = false) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return request && (await handle.requestPermission(opts)) === 'granted';
}

// Пишет файл в папку, не затирая существующие: name.png → name (1).png.
// blob может быть промисом — чтобы диалоги открывались сразу, пока действие пользователя «свежее».
export async function writeToFolder(dir, name, blob) {
  const dot = name.lastIndexOf('.');
  const stem = name.slice(0, dot);
  const ext = name.slice(dot);
  let candidate = name;
  for (let i = 1; await exists(dir, candidate); i++) candidate = `${stem} (${i})${ext}`;
  const file = await dir.getFileHandle(candidate, { create: true });
  await writeFile(file, await blob);
  return candidate;
}

// Системный диалог «Сохранить как», который открывается в папке прошлого сохранения.
// Возвращает имя файла или null, если пользователь передумал.
export async function saveWithPicker(blob, name) {
  const jpeg = /\.jpe?g$/i.test(name);
  const types = [
    jpeg
      ? { description: t('imageJpeg'), accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }
      : { description: t('imagePng'), accept: { 'image/png': ['.png'] } },
  ];
  const startIn = (await getHandle(LAST_FILE)) || (await getFolder()) || 'downloads';
  let file;
  try {
    file = await showSaveFilePicker({ id: 'webscreen-save', suggestedName: name, types, startIn });
  } catch (e) {
    if (e.name === 'AbortError') return null;
    // сохранённый файл могли удалить или переместить — открываем диалог без подсказки
    try {
      file = await showSaveFilePicker({ id: 'webscreen-save', suggestedName: name, types });
    } catch (e2) {
      if (e2.name === 'AbortError') return null;
      throw e2;
    }
  }
  await writeFile(file, await blob);
  await setHandle(LAST_FILE, file);
  return file.name;
}

// Выбор папки по умолчанию. Возвращает папку или null.
export async function pickFolder() {
  try {
    const dir = await showDirectoryPicker({
      id: 'webscreen-folder',
      mode: 'readwrite',
      startIn: (await getFolder()) || 'downloads',
    });
    await setFolder(dir);
    return dir;
  } catch (e) {
    if (e.name === 'AbortError') return null;
    throw e;
  }
}

// Обычное скачивание в «Загрузки» через chrome.downloads.
// wait — дождаться конца загрузки (нужно, если окно сразу закроется и blob-ссылка пропадёт).
// saveAs — показать диалог «Сохранить как» самой загрузки (для Firefox).
export async function downloadBlob(blob, filename, { wait = false, saveAs = false } = {}) {
  const url = URL.createObjectURL(await blob);
  const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', ...(saveAs && { saveAs }) });
  if (!wait) return;
  await new Promise((resolve) => {
    const done = () => {
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve();
    };
    const onChanged = (d) => d.id === id && d.state && d.state.current !== 'in_progress' && done();
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id }).then(([item]) => item && item.state !== 'in_progress' && done());
  });
}

async function exists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function writeFile(fileHandle, blob) {
  const w = await fileHandle.createWritable();
  await w.write(blob);
  await w.close();
}
