// Окно, которое открывается, когда для сохранения нужно действие пользователя:
//  ask        — «Сохранить как…» (диалог открывается в папке прошлого сохранения);
//  permission — подтвердить доступ к папке по умолчанию (браузер спрашивает после перезапуска);
//  pick       — выбрать папку по умолчанию (из popup нельзя: он закрывается, когда открывается диалог).

import { localize, t } from '../lib/i18n.js';
import { baseName, downloadBlob, getFolder, hasPermission, pickFolder, saveWithPicker, writeToFolder } from '../lib/save.js';
import { deleteShot, getShot } from '../lib/store.js';

localize();

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const mode = params.get('mode');
const id = params.get('id');

const action = $('action');
const alt = $('alt');

$('cancel').addEventListener('click', () => close());
document.addEventListener('keydown', (e) => e.key === 'Escape' && close());

const shot = id ? await getShot(id) : null;
if (id && !shot) {
  show(t('notFoundTitle'), t('notFoundText'));
  action.hidden = true;
} else if (mode === 'pick') {
  await setupPick();
} else if (mode === 'permission') {
  await setupPermission();
} else {
  setupAsk();
}
action.focus();

function setupAsk() {
  showThumb();
  show(t('askTitle'), t('askText', escape(baseName(shot.filename)), shot.width, shot.height));
  action.textContent = t('askAction');
  action.addEventListener('click', () =>
    run(async () => {
      const name = await saveWithPicker(shot.blob, baseName(shot.filename));
      if (name) await close();
    }),
  );
}

async function setupPermission() {
  const dir = await getFolder();
  if (!dir) return setupAsk();
  showThumb();
  show(t('permTitle'), t('permText', escape(dir.name)));
  action.textContent = t('permAction');
  action.addEventListener('click', () =>
    run(async () => {
      if (!(await hasPermission(dir, true))) {
        $('status').textContent = t('permDenied');
        return;
      }
      await writeToFolder(dir, baseName(shot.filename), shot.blob);
      await close();
    }),
  );
  alt.hidden = false;
  alt.textContent = t('toDownloads');
  alt.addEventListener('click', () =>
    run(async () => {
      await downloadBlob(shot.blob, shot.filename, { wait: true });
      await close();
    }),
  );
}

async function setupPick() {
  const dir = await getFolder();
  show(t('pickTitle'), t('pickText', escape(dir ? dir.name : t('folderDefault'))));
  action.textContent = t('pickAction');
  action.addEventListener('click', () =>
    run(async () => {
      if (await pickFolder()) window.close();
    }),
  );
}

async function run(job) {
  action.disabled = alt.disabled = true;
  $('status').textContent = '';
  try {
    await job();
  } catch (e) {
    $('status').textContent = t('failed', e.message);
  } finally {
    action.disabled = alt.disabled = false;
  }
}

async function close() {
  if (shot) await deleteShot(shot.id).catch(() => {});
  window.close();
}

function show(title, html) {
  $('title').textContent = title;
  $('text').replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
}

function showThumb() {
  $('thumb').src = URL.createObjectURL(shot.blob);
  $('thumb-wrap').hidden = false;
}

function escape(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
