# WebPageShot

**English** | [Русский](README.ru.md)

An extension for Chromium-based browsers (Chrome, Edge, Yandex Browser, Opera, Brave; version 121+)
and Firefox (140+) that takes screenshots of web pages and saves them to a file.

Interface languages: English (default), French, Spanish, Italian, German, Russian, Ukrainian.
The language follows the browser's language; if there is no translation, English is used. Translations live in
`_locales/<language>/messages.json`; in the markup, strings are attached with the `data-i18n`, `data-i18n-title`
and `data-i18n-aria` attributes (see `lib/i18n.js`).

## Modes

| Mode | What it captures | Shortcut |
|---|---|---|
| Visible area | what is currently visible in the window | `Alt+S` |
| Full page | the whole page, top to bottom (scrolls and stitches frames together) | `Alt+A` |
| Region | a rectangle selected with the mouse; you can scroll with the wheel or drag to the window edge — the region can be larger than the screen | `Alt+R` |
| Block | the page element under the cursor; `↑`/`↓` — move to the outer/inner block, click or `Enter` — capture, `Esc` — cancel | `Alt+B` |

Modes are available from the toolbar button, keyboard shortcuts and the page context menu (the "WebPageShot" item).

## Settings (in the popup)

- PNG or JPG format;
- after capture — three checkboxes, in any combination:
  - **save to file**;
  - **open preview** (the preview lets you save to PNG/JPG, copy to the clipboard, view at 1:1);
  - **copy to clipboard** — the screenshot (as PNG) is put on the clipboard so you can paste it straight into
    a messenger or an editor. Works on https pages (and on localhost): browsers don't give clipboard access to http pages.

  Saving and copying can't both be turned off, or the screenshot would be lost: if you uncheck one of them
  while the other is unchecked, the other one turns on by itself;
- **folder** — where to save without asking. Defaults to `Downloads/WebPageShot/`, any folder can be chosen;
  the choice is remembered across browser restarts. After a restart the browser may ask once to confirm
  access to the folder — choose "Allow on every visit" and it won't ask again;
- **ask where to save** — after capture a small window with a thumbnail opens; Enter opens the system dialog
  right in the folder you saved to last time.

Why it works this way: files downloaded by an extension through `chrome.downloads` always go to "Downloads",
and the browser doesn't remember the last folder for them. So the extension keeps its own folder via the
File System Access API. The browser only allows the system file dialog to be opened in response to a user action —
hence the window where you press Enter.

## Installation

1. Open `chrome://extensions` (in Edge — `edge://extensions`, in Yandex Browser — `browser://extensions`).
2. Turn on "Developer mode".
3. Click "Load unpacked" and select this folder.

Shortcuts are changed on the `chrome://extensions/shortcuts` page (the gear in the extension popup opens it).

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on…" and select the `dist/webpageshot-firefox-<version>.zip` archive
   (built with the command from the section below). The `manifest.json` in the project folder doesn't work for Firefox — it is for Chromium.

### Building the store archives

```
powershell -ExecutionPolicy Bypass -File build.ps1
```

The script puts two archives into `dist/`:

- `webpageshot-chrome-<version>.zip` — for the Chrome Web Store, Edge Add-ons and Opera;
- `webpageshot-firefox-<version>.zip` — for addons.mozilla.org.

The `manifest.json` in the repository is for Chromium: the project folder can be loaded into Chrome without warnings.
The Chrome archive has the Firefox settings (`browser_specific_settings`) removed. The Firefox archive gets its own variant:
the background runs via `background.scripts` instead of `service_worker`, without `minimum_chrome_version`, the `offscreen`
permission and the offscreen document itself. The version is taken from the manifest.

A temporary add-on disappears after Firefox restarts. To install it permanently, it has to be signed
on [addons.mozilla.org](https://addons.mozilla.org/developers/) (it can be "unlisted" — signing is free and
the extension won't appear in the catalog), then install the resulting `.xpi`.

Differences in Firefox:

- you can't choose your own folder (Firefox has no File System Access API) — files go to Firefox's regular
  downloads, into the `WebPageShot/` subfolder; there is no "Folder" row in the settings;
- "ask where to save" opens Firefox's regular save dialog — it remembers the last folder by itself;
- shortcuts are changed in `about:addons` → gear → "Manage Extension Shortcuts"
  (the gear in the extension popup opens this page).

## How it works

- `background.js` — service worker (a background page in Firefox): runs the modes, captures frames (`chrome.tabs.captureVisibleTab`),
  stitches them on an `OffscreenCanvas` and hands the file over for saving.
- `lib/page.js` — functions that run in the page: measurements, scrolling, region and block selection overlays.
- `lib/store.js` — IndexedDB: temporary screenshots (kept for no more than an hour) and access handles to the save folder.
- `lib/save.js` — writing to the chosen folder, the "Save as" dialog that remembers the folder, regular download.
- `offscreen/` — an offscreen document that writes files to the folder or creates a blob URL for `chrome.downloads`
  (a service worker can do neither). Firefox has no offscreen documents and doesn't need them: the background page
  creates the blob URL itself and writes to the clipboard via `browser.clipboard.setImageData`.
- `save/` — the save window: "Save as", folder access confirmation, folder selection.
- `popup/`, `preview/` — the popup and the preview page.

Full-page capture details:

- headers with `position: sticky` become regular blocks during capture and aren't repeated on every frame;
- elements with `position: fixed` are shown once: top ones (headers) at the beginning, bottom ones (chat buttons, banners) at the end;
- fixed full-height side menus are attached to the page during capture and stretched to its full height,
  and their own scrolling is expanded — the whole menu ends up in the screenshot;
- frames don't overwrite each other: the last frame (aligned to the end of the page) only adds the new rows;
- if it's not the window that scrolls but an inner container (as in many web apps), that container is captured;
- Chrome allows no more than two frames per second, so a long page takes a few seconds to capture —
  progress is shown on the extension icon;
- very long pages are scaled down to fit the canvas limit (32767 px per side).

Limitations: browsers don't allow extensions to capture internal pages (`chrome://…`, `about:…`, extension stores),
and content inside an `iframe` is selected as a whole, as a single block, in block mode.

## Logo and store graphics

The logo source is `store/graphics/src/logo.svg` (16×16 grid); there are pixel-aligned variants for 16, 24 (and 48) and 32 px
(`logo-16.svg`, `logo-24.svg`, `logo-32.svg`). The logo in the extension popup, preview and privacy policy is `logo-24.svg`
inlined into the markup. The icons `icons/icon*.png` and the store graphics (`store/graphics/*.png`)
are built from `store/graphics/src/frames.html` with one command:

```
powershell -ExecutionPolicy Bypass -File store\graphics\src\render.ps1
```

## License

[Apache License 2.0](LICENSE), © 2026 and-ay. The "WebPageShot" name and logo are not licensed (section 6 of the license, see also [NOTICE](NOTICE)).
