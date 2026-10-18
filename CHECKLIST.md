# Публикация WebPageShot в магазинах

Магазины: Chrome Web Store, Microsoft Edge Add-ons, Firefox (addons.mozilla.org), Opera (addons.opera.com).
Языки: английский (основной), французский, испанский, итальянский, немецкий, русский, украинский.
Язык выбирается по языку браузера; если перевода нет — английский.

## 1. Код

- [x] ID для Firefox — постоянный UUID (`{3256103e-f142-4ef4-9bef-ae0f50fbb53a}`), после публикации не менять
- [x] Мультиязычность: `_locales/{en,fr,es,it,de,ru,uk}/messages.json`, `default_locale: en`
  - [x] манифест: название, описание, подсказка значка, описания горячих клавиш
  - [x] popup, превью, окно сохранения
  - [x] фон: пункты контекстного меню, тексты ошибок
  - [x] оверлей выбора области/блока на странице
  - [x] единицы и форматы (КБ/МБ; имя файла не переводим — оно одинаковое во всех языках)
- [x] Проверка: у всех языков одинаковый набор ключей, интерфейс не ломается на длинных строках (немецкий, французский)
- [x] Скрипт сборки (`build.ps1`): отдельные zip для Chrome/Edge/Opera и для Firefox, у каждого манифест без чужих ключей
- [x] Финальный прогон тестов в Firefox, Edge и Opera из собранных архивов

## 2. Материалы для магазинов

- [x] Название: «WebScreen» занято в Chrome Web Store, «WebShot» — в Chrome Web Store и Firefox, выбрано «WebPageShot» (совпадений не нашлось)
  - [ ] перед подачей ещё раз проверить поиском в каждом магазине (Firefox — свободно)
- [x] Политика конфиденциальности: `docs/privacy.html`, 7 языков (язык по браузеру, есть переключатель)
  - [x] адрес репозитория: `github.com/and-ay/webpageshot`, политика — `and-ay.github.io/webpageshot/privacy.html`
- [x] Тексты карточки на 7 языках: краткое — `extDescription` в `_locales`, полное — `store/description.md`
- [x] Ответы для форм: назначение, разрешения, данные, заметки для проверяющих, категории — `store/dashboard.md`
- [x] Лицензия: Apache 2.0, © 2026 and-ay — `LICENSE`, `NOTICE`
- [x] Картинки (`store/graphics/`, пересборка — `store/graphics/src/render.ps1`):
  - [x] иконка 128×128 (в архиве расширения)
  - [x] промо-плитка 440×280 — `promo-small-440x280.png`
  - [x] большая промо-плитка 1400×560 — `promo-marquee-1400x560.png` (необязательная)
  - [x] скриншоты 1280×800 — `screenshot-1…5.png`, английские, PNG без прозрачности
  - [ ] уточнить размеры для Opera при подаче

## 3. Публикация (делаете вы)

- [x] Репозиторий [`and-ay/webpageshot`](https://github.com/and-ay/webpageshot) — публичный, GitHub Pages из `docs/` включены, политика открывается: https://and-ay.github.io/webpageshot/privacy.html
- [ ] Аккаунты:
  - [x] Chrome Web Store — взнос $5, двухэтапная аутентификация (лимит аккаунта: 3 опубликованных расширения)
  - [ ] Microsoft Partner Center (Edge)
  - [x] addons.mozilla.org — двухэтапная аутентификация
  - [ ] addons.opera.com
- [ ] Загрузить архив и заполнить карточку:
  - [x] Chrome Web Store — отправлено на проверку
  - [ ] Edge Add-ons
  - [x] Firefox — отправлено на проверку (только desktop); проверить скриншоты и переводы описания на странице редактирования
  - [ ] Opera
- [ ] Дождаться проверки, ответить на замечания модераторов
- [ ] После одобрения вставить ссылки на магазины на сайт (`docs/index.html`, раздел установки на 7 языках) и в README
  - Firefox: `https://addons.mozilla.org/firefox/addon/webpageshot/`

## 4. Обновления

- [ ] Порядок выпуска: поднять `version` в манифесте → `build.ps1` → загрузить `webpageshot-chrome-*.zip` в Chrome Web Store, Edge и Opera, `webpageshot-firefox-*.zip` — в Firefox
