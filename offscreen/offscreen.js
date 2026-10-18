import { baseName, getFolder, hasPermission, writeToFolder } from '../lib/save.js';
import { t } from '../lib/i18n.js';
import { getShot } from '../lib/store.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;

  if (msg.type === 'save') {
    save(msg).then(sendResponse, (e) => sendResponse({ error: String(e?.message || e) }));
    return true;
  }

  if (msg.type === 'revoke') URL.revokeObjectURL(msg.url);
});

// Сохраняет снимок в выбранную папку. Если папки нет — отдаёт blob-ссылку для chrome.downloads,
// если доступ к папке нужно подтвердить — сообщает об этом (запросить его можно только по клику).
async function save({ id, filename }) {
  const shot = await getShot(id);
  if (!shot) return { error: t('errShotNotFound') };
  const dir = await getFolder();
  if (!dir) return { url: URL.createObjectURL(shot.blob) };
  if (!(await hasPermission(dir))) return { needPermission: true };
  return { saved: await writeToFolder(dir, baseName(filename), shot.blob) };
}
