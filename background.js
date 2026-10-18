import { pageCopy, pageMeasure, pagePrepare, pageRestore, pageScrollTo, pageSelect } from './lib/page.js';
import { t } from './lib/i18n.js';
import { cleanupShots, deleteShot, getShot, putShot } from './lib/store.js';

const DEFAULTS = { format: 'png', save: true, preview: false, copy: false, saveAs: false };
const JPEG_QUALITY = 0.92;
const CAPTURE_INTERVAL = 550; // Chrome пропускает не больше двух captureVisibleTab в секунду
const MAX_SIDE = 32767; // предел стороны canvas
const MAX_AREA = 150e6; // разумный предел площади итоговой картинки, пикселей
const SHOT_TTL = 60 * 60 * 1000;

// режим → ключ перевода для пункта контекстного меню
const MODES = {
  visible: 'menuVisible',
  full: 'menuFull',
  region: 'menuRegion',
  element: 'menuElement',
};
const MENU_CONTEXTS = ['page', 'frame', 'selection', 'link', 'image', 'video', 'editable'];
// В Firefox нет offscreen-документов и File System Access (своей папки сохранения),
// зато фоновая страница сама создаёт blob-ссылки, а в буфер обмена пишет browser.clipboard.
const OFFSCREEN = 'offscreen' in chrome;

const busy = new Set();
let lastCaptureAt = 0;
let creatingOffscreen = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- точки входа ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ws', title: 'WebPageShot', contexts: MENU_CONTEXTS });
    for (const [mode, key] of Object.entries(MODES)) {
      chrome.contextMenus.create({ id: `ws:${mode}`, parentId: 'ws', title: t(key), contexts: MENU_CONTEXTS });
    }
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const mode = String(info.menuItemId).split(':')[1];
  if (mode in MODES) start(tab, mode);
});

chrome.commands.onCommand.addListener((command, tab) => {
  const mode = command.replace(/^shot-/, '');
  if (mode in MODES) start(tab, mode);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'capture':
      start(msg.tab, msg.mode);
      sendResponse({ ok: true });
      break;
    case 'ws-selected':
      run(sender.tab, (settings) => captureSelection(sender.tab, msg.mode, msg.rect, settings));
      break;
  }
});

chrome.downloads.onChanged.addListener(async ({ id, state }) => {
  if (!state || state.current === 'in_progress') return;
  const key = `dl:${id}`;
  const { [key]: rec } = await chrome.storage.session.get(key);
  if (!rec) return;
  await chrome.storage.session.remove(key);
  await release(rec.id, rec.url);
});

function start(tab, mode) {
  if (!tab?.id) return;
  if (mode === 'region' || mode === 'element') {
    exec(tab.id, pageSelect, [mode]).catch((e) => fail(tab.id, e));
  } else {
    run(tab, (settings) => (mode === 'full' ? captureFull(tab, settings) : captureVisible(tab, settings)));
  }
}

async function run(tab, job) {
  if (!tab?.id || busy.has(tab.id)) return;
  busy.add(tab.id);
  try {
    const settings = await chrome.storage.sync.get(DEFAULTS);
    const shot = await job(settings);
    // копируем до сохранения: окно сохранения или превью заберёт фокус у страницы
    const copyError = settings.copy ? await copyToClipboard(tab, shot.blob) : null;
    await deliver(tab, shot, settings);
    if (copyError) fail(tab.id, new Error(t('errCopy', copyError)));
    else flash(tab.id, '✓', '#1e9e5a', 1500);
  } catch (e) {
    console.error(e);
    fail(tab.id, e);
  } finally {
    busy.delete(tab.id);
  }
}

// ---------- режимы съёмки ----------

async function captureVisible(tab, settings) {
  const jpeg = settings.format === 'jpeg';
  const dataUrl = await captureTab(tab, jpeg ? { format: 'jpeg', quality: Math.round(JPEG_QUALITY * 100) } : { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;
  bmp.close();
  const { url, title } = await chrome.tabs.get(tab.id);
  return { blob, width, height, url, title };
}

async function captureFull(tab, settings) {
  const m = await exec(tab.id, pageMeasure, ['full']);
  if (m.scroller) return captureScroller(tab, m, settings);
  // мелкие горизонтальные «вылеты» вёрстки (скроллбар, 100vw) не стоят второго столбца кадров
  const w = m.sw - m.vw <= 32 ? m.vw : m.sw;
  return captureRect(tab, m, { x: 0, y: 0, w, h: Math.max(m.sh, m.vh) }, 'full', settings);
}

async function captureSelection(tab, mode, rect, settings) {
  const m = await exec(tab.id, pageMeasure, [mode]);
  const target = mode === 'element' ? m.target : rect;
  if (!target) throw new Error(t('errBlockNotFound'));
  return captureRect(tab, m, target, mode, settings);
}

// Снимает прямоугольник документа, прокручивая окно и склеивая кадры.
async function captureRect(tab, m, rect, kind, settings) {
  const pinned = kind === 'element' && m.targetFixed; // блок в position: fixed не двигается при прокрутке
  const plan = () => {
    const maxX = Math.max(0, m.sw - m.vw);
    const maxY = Math.max(0, m.sh - m.vh);
    let R = intersect(rect, { x: 0, y: 0, w: maxX + m.vw, h: maxY + m.vh });
    if (R && pinned) R = intersect(R, { x: m.sx, y: m.sy, w: m.vw, h: m.vh });
    if (!R) throw new Error(t('errAreaEmpty'));
    const xs = pinned ? [m.sx] : steps(R.x, R.w, m.vw, maxX, m.sx);
    const ys = pinned ? [m.sy] : steps(R.y, R.h, m.vh, maxY, m.sy);
    return { R, xs, ys };
  };

  let { R, xs, ys } = plan();
  const multi = xs.length * ys.length > 1;
  const prep = kind === 'element' ? 'element' : !multi ? null : kind === 'full' ? 'full' : 'multi';
  if (prep) {
    const dims = await exec(tab.id, pagePrepare, [prep]);
    // растянутое боковое меню могло удлинить страницу — пересчитываем кадры
    if (kind === 'full' && dims && dims.sh !== m.sh) {
      m = { ...m, sh: dims.sh };
      rect = { ...rect, h: Math.max(dims.sh, m.vh) };
      ({ R, xs, ys } = plan());
    }
  }
  const grouped = prep === 'multi' || prep === 'full';
  const total = xs.length * ys.length;

  let out;
  try {
    let n = 0;
    // кадры перекрываются (последний прижат к концу страницы), поэтому каждый ряд
    // дорисовывает только новые строки и не затирает уже снятое
    let covered = -Infinity;
    for (const [i, y] of ys.entries()) {
      const phase = !grouped ? null : ys.length === 1 ? 'only' : i === 0 ? 'first' : i === ys.length - 1 ? 'last' : 'middle';
      let rowEnd = covered;
      for (const x of xs) {
        const pos = await exec(tab.id, pageScrollTo, [x, y, phase]);
        if (total > 1) progress(tab.id, ++n, total);
        const bmp = await grab(tab);
        out ??= createOutput(bmp, m, R.w, R.h);
        const x0 = Math.max(R.x, pos.x);
        const y0 = Math.max(R.y, pos.y, covered);
        const x1 = Math.min(R.x + R.w, pos.x + m.vw);
        const y1 = Math.min(R.y + R.h, pos.y + m.vh);
        if (x1 > x0 && y1 > y0) out.draw(bmp, x0 - pos.x, y0 - pos.y, x1 - x0, y1 - y0, x0 - R.x, y0 - R.y);
        rowEnd = pos.y + m.vh;
        bmp.close();
      }
      covered = rowEnd;
    }
  } finally {
    await exec(tab.id, pageRestore).catch(() => {});
  }
  return out.finish(settings, m);
}

// Вся страница, когда прокручивается внутренний контейнер, а не окно:
// всё вокруг контейнера берём с первого/последнего кадра, а сам контейнер «растягиваем» по высоте.
async function captureScroller(tab, m, settings) {
  const sc = m.scroller;
  const maxS = Math.max(0, sc.sh - sc.ch);
  const ys = steps(0, sc.sh, sc.ch, maxS, -1);
  const W = m.vw;
  const H = m.vh + maxS;
  const top = sc.top;
  const bottom = sc.top + sc.ch;
  const left = sc.left;
  const right = sc.left + sc.cw;

  await exec(tab.id, pagePrepare, ['inner']);
  let out;
  try {
    let covered = 0; // докуда по высоте содержимого контейнера уже снято
    for (const [i, s] of ys.entries()) {
      const last = i === ys.length - 1;
      const phase = ys.length === 1 ? 'only' : i === 0 ? 'first' : last ? 'last' : 'middle';
      const pos = await exec(tab.id, pageScrollTo, [0, s, phase]);
      if (ys.length > 1) progress(tab.id, i + 1, ys.length);
      const bmp = await grab(tab);
      out ??= createOutput(bmp, m, W, H);
      if (i === 0) {
        out.draw(bmp, 0, 0, W, top, 0, 0);
        out.draw(bmp, 0, top, left, sc.ch, 0, top);
        out.draw(bmp, right, top, W - right, sc.ch, right, top);
      }
      const skip = Math.max(0, covered - pos.y);
      out.draw(bmp, left, top + skip, sc.cw, sc.ch - skip, left, top + pos.y + skip);
      covered = pos.y + sc.ch;
      if (last) out.draw(bmp, 0, bottom, W, m.vh - bottom, 0, bottom + pos.y);
      bmp.close();
    }
  } finally {
    await exec(tab.id, pageRestore).catch(() => {});
  }
  return out.finish(settings, m);
}

// ---------- склейка ----------

// Позиции прокрутки по одной оси, чтобы окнами размера view покрыть отрезок [start, start + len).
function steps(start, len, view, max, cur) {
  if (start >= cur && start + len <= cur + view) return [cur];
  if (view < 1) throw new Error(t('errZeroViewport'));
  const out = [];
  for (let p = start; ; p += view) {
    const q = Math.min(Math.max(p, 0), max);
    if (q !== out[out.length - 1]) out.push(q);
    if (q + view >= start + len || q >= max) return out;
  }
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w >= 1 && h >= 1 ? { x, y, w, h } : null;
}

// Холст результата размером w×h CSS-пикселей. Масштаб берём из первого кадра (учитывает DPR и зум).
function createOutput(first, m, w, h) {
  const scale = first.width / m.iw;
  const k = Math.min(1, MAX_SIDE / (w * scale), MAX_SIDE / (h * scale), Math.sqrt(MAX_AREA / (w * h * scale * scale)));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w * scale * k)), Math.max(1, Math.round(h * scale * k)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';

  return {
    // (sx, sy, sw, sh) — CSS-пиксели кадра, (dx, dy) — CSS-пиксели результата
    draw(bmp, sx, sy, sw, sh, dx, dy) {
      let x0 = Math.round(sx * scale);
      let y0 = Math.round(sy * scale);
      const x1 = Math.min(bmp.width, Math.round((sx + sw) * scale));
      const y1 = Math.min(bmp.height, Math.round((sy + sh) * scale));
      let ox = dx * scale;
      let oy = dy * scale;
      if (x0 < 0) [ox, x0] = [ox - x0, 0];
      if (y0 < 0) [oy, y0] = [oy - y0, 0];
      if (x1 <= x0 || y1 <= y0) return;
      ctx.drawImage(bmp, x0, y0, x1 - x0, y1 - y0,
        Math.round(ox * k), Math.round(oy * k), Math.round((x1 - x0) * k), Math.round((y1 - y0) * k));
    },
    async finish(settings, meta) {
      const blob = await canvas.convertToBlob(
        settings.format === 'jpeg' ? { type: 'image/jpeg', quality: JPEG_QUALITY } : { type: 'image/png' },
      );
      return { blob, width: canvas.width, height: canvas.height, url: meta.url, title: meta.title };
    },
  };
}

async function captureTab(tab, opts = { format: 'png' }) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastCaptureAt + CAPTURE_INTERVAL - Date.now();
    if (wait > 0) await sleep(wait);
    const current = await chrome.tabs.get(tab.id);
    if (!current.active) throw new Error(t('errTabSwitched'));
    lastCaptureAt = Date.now();
    try {
      return await chrome.tabs.captureVisibleTab(current.windowId, opts);
    } catch (e) {
      if (attempt < 3 && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(e.message)) continue;
      throw e;
    }
  }
}

async function grab(tab) {
  const blob = await (await fetch(await captureTab(tab))).blob();
  return createImageBitmap(blob);
}

async function exec(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

// ---------- сохранение ----------

// В буфер обмена браузер пускает только PNG. Возвращает null или текст ошибки.
async function copyToClipboard(tab, blob) {
  try {
    // в Chromium тоже есть chrome.clipboard, но он для ChromeOS — там копирует сама страница
    if (!OFFSCREEN) {
      await chrome.clipboard.setImageData(await blob.arrayBuffer(), blob.type === 'image/jpeg' ? 'jpeg' : 'png');
      return null;
    }
    let png = blob;
    if (png.type !== 'image/png') {
      const bmp = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      canvas.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close();
      png = await canvas.convertToBlob({ type: 'image/png' });
    }
    const bytes = new Uint8Array(await png.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return await exec(tab.id, pageCopy, [btoa(bin)]);
  } catch (e) {
    return e.message || String(e);
  }
}

async function deliver(tab, shot, settings) {
  const ext = shot.blob.type === 'image/jpeg' ? 'jpg' : 'png';
  const filename = makeFilename(shot.url, ext);
  // у сохранения и превью свои копии снимка: сохранение удаляет свою, как только файл записан
  const store = async () => {
    const id = crypto.randomUUID();
    await putShot({
      id,
      blob: shot.blob,
      filename,
      width: shot.width,
      height: shot.height,
      pageUrl: shot.url,
      title: shot.title,
      created: Date.now(),
    });
    return id;
  };
  cleanupShots(SHOT_TTL).catch(() => {});

  // превью открываем первым, чтобы окно «Сохранить как» оказалось поверх него
  if (settings.preview) {
    const id = await store();
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`preview/preview.html?id=${id}`),
      // без windowId вкладка откроется в последнем активном окне, а opener должен быть в том же окне
      windowId: tab.windowId,
      index: tab.index + 1,
      openerTabId: tab.id,
    });
  }
  if (settings.save) {
    const id = await store();
    // диалог выбора файла можно открыть только по действию пользователя — просим нажать Enter
    if (settings.saveAs && OFFSCREEN) await openSaveWindow(tab, id, 'ask');
    else await saveFile(tab, id, filename, settings.saveAs);
  }
}

// Файлы пишет offscreen-документ: service worker не умеет ни работать с папками
// через File System Access API, ни создавать blob:-ссылки для chrome.downloads.
// saveAs — только для Firefox: там «Сохранить как» показывает сама загрузка.
async function saveFile(tab, id, filename, saveAs = false) {
  let url;
  if (OFFSCREEN) {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'save', id, filename });
    if (res?.saved) return deleteShot(id);
    if (res?.needPermission) return openSaveWindow(tab, id, 'permission');
    if (!res?.url) throw new Error(res?.error || t('errPrepareFile'));
    url = res.url;
  } else {
    url = URL.createObjectURL((await getShot(id)).blob);
  }

  // папка не выбрана — обычная загрузка в «Загрузки/WebPageShot»
  let downloadId;
  try {
    downloadId = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', ...(saveAs && { saveAs }) });
  } catch (e) {
    await release(id, url);
    if (saveAs && /cancel/i.test(e.message)) return; // закрыли диалог «Сохранить как»
    throw e;
  }
  await chrome.storage.session.set({ [`dl:${downloadId}`]: { id, url } });
  const [item] = await chrome.downloads.search({ id: downloadId });
  if (item && item.state !== 'in_progress') {
    await chrome.storage.session.remove(`dl:${downloadId}`);
    await release(id, url);
  }
}

async function release(id, url) {
  if (OFFSCREEN) chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url }).catch(() => {});
  else URL.revokeObjectURL(url);
  await deleteShot(id).catch(() => {});
}

async function openSaveWindow(tab, id, mode) {
  const width = 460;
  const height = 380;
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  await chrome.windows.create({
    url: chrome.runtime.getURL(`save/save.html?mode=${mode}&id=${id}`),
    type: 'popup',
    width,
    height,
    focused: true,
    ...(win && {
      left: Math.round(win.left + (win.width - width) / 2),
      top: Math.round(win.top + (win.height - height) / 3),
    }),
  });
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Blob URL for saving a screenshot to a file',
    })
    .finally(() => (creatingOffscreen = null));
  await creatingOffscreen;
}

function makeFilename(url, ext) {
  let host = 'screenshot';
  try {
    const u = new URL(url);
    host = u.hostname || u.protocol.replace(':', '') || host;
  } catch {}
  host = host.replace(/^www\./, '').replace(/[^\w.-]+/g, '_');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  return `WebPageShot/${host}_${stamp}.${ext}`;
}

// ---------- значок и ошибки ----------

function badge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (color) chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

function progress(tabId, n, total) {
  badge(tabId, `${Math.round((n / total) * 100)}%`, '#2f6feb');
}

function flash(tabId, text, color, ms) {
  badge(tabId, text, color);
  setTimeout(() => badge(tabId, ''), ms);
}

function fail(tabId, e) {
  const raw = String(e?.message || e);
  const message = /cannot be scripted|Cannot access|chrome:\/\/|edge:\/\/|extensions gallery|permission/i.test(raw)
    ? t('errRestricted')
    : raw;
  const defaultTitle = t('actionTitle');
  badge(tabId, '!', '#d93025');
  chrome.action.setTitle({ tabId, title: `WebPageShot: ${message}` }).catch(() => {});
  chrome.storage.session.set({ lastError: { message, at: Date.now() } }).catch(() => {});
  setTimeout(() => {
    badge(tabId, '');
    chrome.action.setTitle({ tabId, title: defaultTitle }).catch(() => {});
  }, 8000);
}
