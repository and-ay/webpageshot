# Ответы для форм магазинов

Формы магазинов на английском, поэтому ответы — на английском, пояснения — по-русски.
Описание расширения для каждого языка — в [description.md](description.md).

Адреса (заработают после публикации репозитория и включения GitHub Pages из папки `docs/`):

- политика конфиденциальности: `https://and-ay.github.io/webpageshot/privacy.html`
- поддержка: `https://github.com/and-ay/webpageshot/issues`
- сайт: `https://github.com/and-ay/webpageshot`

Архивы: `webpageshot-chrome-<версия>.zip` — в Chrome Web Store, Edge и Opera; `webpageshot-firefox-<версия>.zip` — в Firefox.

---

## Общие ответы (Chrome Web Store, вкладка Privacy practices; используются и в других магазинах)

**Single purpose**

> WebPageShot takes screenshots of web pages — the visible area, the full page, a selected region or a single page element — and saves them to a file or copies them to the clipboard.

**Permission justifications**

| Permission | Justification |
|---|---|
| activeTab | Captures the current tab (tabs.captureVisibleTab) and runs the capture script in it, only after the user clicks the toolbar button, presses a keyboard shortcut or selects a context menu item. |
| scripting | Injects functions into the active tab to measure the page, scroll it frame by frame for full-page capture, temporarily neutralize sticky/fixed elements so they are not repeated, show the region/element selection overlay, and restore the page afterwards. Also copies the image to the clipboard from the focused page. |
| downloads | Saves the screenshot as a PNG or JPG file to the user's Downloads folder. |
| storage | Stores the user's settings (image format, actions after capture) and short-lived state such as the last error message. |
| offscreen | An offscreen document (reason BLOBS) creates blob URLs for chrome.downloads and writes files to a user-chosen folder via the File System Access API, which a service worker cannot do. |
| contextMenus | Adds a "WebPageShot" item with the capture modes to the page context menu. |
| clipboardWrite | Copies the screenshot image to the clipboard when the user enables "Copy to clipboard". |

Host permissions: none.

**Remote code** — No, I am not using remote code.

**Data usage** — не отмечать ни одной категории данных (расширение ничего не собирает) и поставить все три галочки-подтверждения:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Notes for reviewers** (Edge — «Notes for certification», Firefox — «Notes to Reviewer», Opera — комментарий к отправке)

> No account or setup is needed. Open any regular web page (for example https://en.wikipedia.org/wiki/Web_browser), click the WebPageShot toolbar button and choose a mode:
> - Visible area / Full page — the PNG is saved to Downloads/WebPageShot right away.
> - Region — drag a rectangle on the page.
> - Block — hover over an element and click it.
>
> Keyboard shortcuts: Alt+S, Alt+A, Alt+R, Alt+B. The popup also has options for the format (PNG/JPG), preview, saving and copying to the clipboard.
> The extension makes no network requests and loads no remote code. The source code is not minified or bundled.

---

## Chrome Web Store

- Аккаунт разработчика: взнос $5, двухэтапная аутентификация в Google-аккаунте.
- Category: **Productivity → Tools** (проверить список при подаче).
- Language: English — основной. Остальные 6 языков добавляются в карточке как переводы, в каждый вставить описание из `description.md`. Краткое описание Chrome берёт из манифеста сам.
- Graphics: иконка 128×128 берётся из архива; промо-плитка — `graphics/promo-small-440x280.png`; скриншоты — `graphics/screenshot-1…5.png` (1280×800, загружать по порядку). Большая плитка (Marquee) — `graphics/promo-marquee-1400x560.png` (необязательная, нужна для подборок на главной магазина).
- Privacy policy URL — адрес выше.
- Ответы Privacy practices — раздел выше.

## Microsoft Edge Add-ons (Partner Center)

- Аккаунт Partner Center, бесплатно.
- Category: **Productivity**.
- Описание — для каждого языка из `description.md`. У Edge есть минимальная длина описания; наши тексты заметно длиннее.
- Search terms (до 7):
  `screenshot`, `full page screenshot`, `screen capture`, `scrolling screenshot`, `page capture`, `capture region`, `copy screenshot`
- Privacy: «Does your product access, collect or transmit personal information?» — **No**. Адрес политики можно указать всё равно.
- Notes for certification — раздел выше.

## Firefox (addons.mozilla.org)

- Аккаунт Mozilla, бесплатно. Способ публикации: **On this site** (в каталоге).
- «Do you need to submit source code?» — **No**: код не сжат и не собран сборщиком.
- Summary — `extDescription` из `_locales/<язык>/messages.json` (до 250 символов).
- Description — из `description.md`.
- Categories: **Photos, Music & Videos** (там обычно лежат расширения для скриншотов).
- Tags: `screenshot`, `capture`, `full page`, `clipboard`.
- License — **Apache License 2.0**.
- Support website — адрес Issues; Privacy policy — можно указать адрес выше (для расширений без сбора данных не обязательно).
- Notes to Reviewer — раздел выше, плюс абзац про предупреждение валидатора:

  > The validator warning "offscreen.createDocument is not supported" can be ignored: that code path runs only in Chromium browsers. In Firefox it is never reached (it is guarded by a check for `chrome.offscreen`), and files are saved directly from the background page. The warning about the minimum Firefox for Android version does not apply: the extension is submitted for Firefox desktop only.
- Совместимость: только **Firefox** (desktop), галочку Android снять.
- Политика приватности: AMO просит текст, а не ссылку. Вставить:

```text
WebPageShot Privacy Policy

In short: WebPageShot does not collect, keep or transmit any personal data. Everything happens on your computer.

What the extension handles
- Screenshots. When you start a capture, the extension takes an image of the current tab. The image is processed inside your browser and, depending on your settings, saved to a file on your computer, copied to the clipboard or shown in the preview tab. For the preview a temporary copy is kept in the extension's local storage; it is deleted after saving, and in any case within one hour.
- Settings. Your settings (image format, what to do after a capture, whether to ask where to save) are kept in the browser's extension storage. If Firefox Sync is turned on, the browser may sync these settings between your devices; the extension itself does not send them anywhere.

What the extension does not do
- It does not send any data to the developer or to third parties. The extension makes no network requests.
- It uses no analytics, tracking, advertising or cookies.
- It does not sell or share any data.
- It does not load remote code: all code is included in the extension package.

Permissions
- activeTab: capture the tab you are on, and only after you click the extension button, press a shortcut or choose a context menu item.
- scripting: prepare the page for the capture (scroll it, hide repeating sticky elements, show the selection frame) and restore it afterwards. The extension reads only the page layout (sizes and positions of elements) and neither stores nor transmits anything.
- downloads: save screenshots to files.
- storage: keep your settings.
- contextMenus: the "WebPageShot" item in the page context menu.
- clipboardWrite: copy screenshots to the clipboard.

Changes to this policy will be published on this page with a new date. The full policy in 7 languages: https://and-ay.github.io/webpageshot/privacy.html
Questions: https://github.com/and-ay/webpageshot/issues
```

## Opera (addons.opera.com)

- Аккаунт разработчика Opera, бесплатно. Проверка ручная и может занять несколько недель.
- Архив — тот же, что для Chrome.
- Category: **Productivity**.
- Описание и скриншоты — те же; требования к размерам картинок уточнить при подаче.
- Комментарий для проверяющих — раздел выше.
