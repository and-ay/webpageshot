import { localize, t } from '../lib/i18n.js';
import { baseName, downloadBlob, getFolder, hasPermission, saveWithPicker, writeToFolder } from '../lib/save.js';
import { getShot } from '../lib/store.js';

localize();

const $ = (id) => document.getElementById(id);
const img = $('img');

const id = new URLSearchParams(location.search).get('id');
const shot = id && (await getShot(id));
if (!shot) {
  $('title').textContent = t('notFoundTitle');
  $('meta').textContent = t('notFoundText');
  throw new Error('shot not found');
}

const TYPES = { png: 'image/png', jpg: 'image/jpeg' };
const ext = shot.blob.type === 'image/jpeg' ? 'jpg' : 'png';
const altExt = ext === 'png' ? 'jpg' : 'png';
const { saveAs } = await chrome.storage.sync.get({ saveAs: false });

img.src = URL.createObjectURL(shot.blob);
await img.decode().catch(() => {});

let host = '';
try {
  host = new URL(shot.pageUrl).hostname;
} catch {}
document.title = t('previewTitle', shot.title || host || 'WebPageShot');
$('title').textContent = shot.title || host || t('untitled');
const meta = $('meta');
meta.textContent = `${shot.width} × ${shot.height} px · ${formatSize(shot.blob.size)} · ${ext.toUpperCase()} · `;
if (shot.pageUrl) {
  const a = document.createElement('a');
  a.href = shot.pageUrl;
  a.textContent = shot.pageUrl;
  a.target = '_blank';
  meta.append(a);
}

$('save').textContent = t('saveFormat', ext.toUpperCase());
$('save-alt').textContent = t('saveFormat', altExt.toUpperCase());
for (const b of document.querySelectorAll('button')) b.disabled = false;

$('save').addEventListener('click', () => save(ext));
$('save-alt').addEventListener('click', () => save(altExt));
$('copy').addEventListener('click', copy);
$('zoom').addEventListener('click', toggleZoom);
img.addEventListener('click', toggleZoom);

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save(ext);
  } else if (mod && e.key.toLowerCase() === 'c' && !getSelection().toString()) {
    e.preventDefault();
    copy();
  } else if (!mod && e.key.toLowerCase() === 'z') {
    toggleZoom();
  }
});

async function save(target) {
  try {
    // конвертацию не ждём: диалоги нужно открыть сразу, пока действует клик пользователя
    const blob = convert(shot.blob, TYPES[target]);
    const filename = shot.filename.replace(/\.\w+$/, `.${target}`);
    const name = baseName(filename);
    // в Firefox нет showSaveFilePicker — там «Сохранить как» показывает сама загрузка
    if (saveAs && !('showSaveFilePicker' in window)) {
      await downloadBlob(blob, filename, { saveAs }).catch((e) => {
        if (!/cancel/i.test(e.message)) throw e; // закрыли диалог
      });
      return;
    }
    if (saveAs) {
      const saved = await saveWithPicker(blob, name);
      if (saved) toast(t('saved', saved));
      return;
    }
    const dir = await getFolder();
    if (dir && (await hasPermission(dir, true))) {
      toast(t('savedToFolder', dir.name, await writeToFolder(dir, name, blob)));
    } else {
      await downloadBlob(blob, filename);
    }
  } catch (e) {
    toast(t('saveFailed', e.message));
  }
}

async function copy() {
  try {
    // в буфер обмена браузер пускает только PNG
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': convert(shot.blob, 'image/png') })]);
    toast(t('copied'));
  } catch (e) {
    toast(t('copyFailed', e.message));
  }
}

async function convert(blob, type) {
  if (blob.type === type) return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas.convertToBlob({ type, quality: 0.92 });
}

function toggleZoom() {
  const fit = img.classList.toggle('fit');
  // «1:1» — один пиксель снимка на один физический пиксель экрана
  img.style.width = fit ? '' : `${img.naturalWidth / devicePixelRatio}px`;
  $('zoom').textContent = fit ? '1:1' : t('zoomFit');
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return t('sizeKB', Math.round(bytes / 1024));
  return t('sizeMB', (bytes / 1024 / 1024).toLocaleString(t('lang'), { maximumFractionDigits: 1 }));
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
