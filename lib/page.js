// Функции, которые выполняются в контексте страницы через chrome.scripting.executeScript({ func }).
// Каждая функция должна быть самодостаточной: браузер сериализует только её текст,
// поэтому замыкания, импорты и общие хелперы тут недоступны.
// Состояние между вызовами живёт в window изолированного мира расширения.

// Размеры вьюпорта и документа, а для отдельных режимов — цель съёмки.
export function pageMeasure(mode) {
  const de = document.documentElement;
  const quirks = document.compatMode === 'BackCompat' && document.body;
  const se = document.scrollingElement || de;
  const m = {
    url: location.href,
    title: document.title,
    iw: innerWidth,
    ih: innerHeight,
    // clientWidth/Height — вьюпорт без полос прокрутки
    vw: (quirks ? document.body.clientWidth : de.clientWidth) || innerWidth,
    vh: (quirks ? document.body.clientHeight : de.clientHeight) || innerHeight,
    sx: scrollX,
    sy: scrollY,
    sw: se.scrollWidth,
    sh: se.scrollHeight,
  };

  // Многие веб-приложения прокручивают не окно, а внутренний контейнер.
  // Если окно не прокручивается, ищем самый большой прокручиваемый блок.
  if (mode === 'full' && m.sh <= m.vh + 1 && document.body) {
    for (const el of document.querySelectorAll('[data-webscreen-scroller]')) el.removeAttribute('data-webscreen-scroller');
    let best = null;
    let bestArea = 0;
    for (const el of document.body.querySelectorAll('*')) {
      if (el.scrollHeight <= el.clientHeight + 1 || el.clientHeight < 100) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, m.vw) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, m.vh) - Math.max(r.top, 0);
      const area = w > 0 && h > 0 ? w * h : 0;
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    if (best && bestArea >= m.vw * m.vh * 0.25) {
      const r = best.getBoundingClientRect();
      best.setAttribute('data-webscreen-scroller', '');
      m.scroller = {
        left: r.left + best.clientLeft,
        top: r.top + best.clientTop,
        cw: best.clientWidth,
        ch: best.clientHeight,
        sh: best.scrollHeight,
      };
    }
  }

  if (mode === 'element') {
    const t = document.querySelector('[data-webscreen-target]');
    if (t) {
      const r = t.getBoundingClientRect();
      m.target = { x: r.left + m.sx, y: r.top + m.sy, w: r.width, h: r.height };
      m.targetFixed = false;
      for (let e = t; e && e !== de; e = e.parentElement) {
        if (getComputedStyle(e).position === 'fixed') {
          m.targetFixed = true;
          break;
        }
      }
    }
  }
  return m;
}

// Подготовка страницы к покадровой съёмке.
//  multi   — окно прокручивается: sticky превращаем в обычные блоки, fixed делим на верхние/нижние группы;
//  full    — то же для снимка всей страницы, плюс боковые панели на всю высоту растягиваются по странице;
//  inner   — то же, но для внутреннего прокручиваемого контейнера;
//  element — прячем все fixed/sticky, кроме самого блока, его предков и потомков.
export function pagePrepare(kind) {
  const records = [];
  const top = [];
  const bottom = [];
  const panels = [];
  const save = (el, prop, value) => {
    records.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, value, 'important');
  };

  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{scroll-behavior:auto!important}';
  // накладные полосы прокрутки (Firefox в Windows 11) рисуются поверх страницы и попадают в кадры;
  // места они не занимают, поэтому прячем их без перестройки вёрстки
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-999px;width:100px;height:50px;overflow:scroll';
  document.documentElement.append(probe);
  if (probe.offsetWidth === probe.clientWidth) style.textContent += '*{scrollbar-width:none!important}';
  probe.remove();
  (document.head || document.documentElement).append(style);

  const scroller = document.querySelector('[data-webscreen-scroller]');
  const target = document.querySelector('[data-webscreen-target]');
  const band = kind === 'inner' && scroller ? scroller.getBoundingClientRect() : null;
  window.__wsState = {
    style,
    records,
    top,
    bottom,
    x: scrollX,
    y: scrollY,
    scroller: kind === 'inner' && scroller ? { el: scroller, top: scroller.scrollTop } : null,
  };

  const vh = innerHeight;
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    const pos = getComputedStyle(el).position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;

    if (kind === 'element') {
      if (target && (el.contains(target) || target.contains(el))) continue;
      save(el, 'visibility', 'hidden');
    } else if (pos === 'sticky') {
      if (band && !scroller.contains(el)) continue;
      save(el, 'position', 'relative');
      for (const p of ['top', 'right', 'bottom', 'left']) save(el, p, 'auto');
    } else {
      if (panels.some((p) => p.contains(el))) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (band && (r.right <= band.left || r.left >= band.right || r.bottom <= band.top || r.top >= band.bottom)) continue;
      // боковое меню на всю высоту окна: не прячем, а «прикрепляем» к странице (см. ниже)
      if (kind === 'full' && r.height >= vh * 0.9 && r.width <= innerWidth * 0.6) {
        panels.push(el);
        continue;
      }
      (r.top < vh / 2 ? top : bottom).push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
    }
  }

  // Закреплённую боковую панель переводим в position: absolute на том же месте и растягиваем
  // на всю высоту страницы, а её собственную прокрутку раскрываем — так она целиком попадёт в снимок.
  const se = document.scrollingElement || document.documentElement;
  const docHeight = se.scrollHeight;
  const unclip = (el) => {
    if (el.scrollHeight <= el.clientHeight + 1) return;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return;
    // только полные свойства: сокращённые (overflow, transition) при восстановлении стёрли бы инлайн-стили страницы
    save(el, 'overflow-x', 'visible');
    save(el, 'overflow-y', 'visible');
    save(el, 'height', 'auto');
    save(el, 'max-height', 'none');
    save(el, 'flex-basis', 'auto');
  };
  for (const el of panels) {
    const r = el.getBoundingClientRect();
    save(el, 'transition-property', 'none');
    for (const d of el.querySelectorAll('*')) unclip(d);
    unclip(el);
    save(el, 'position', 'absolute');
    save(el, 'box-sizing', 'border-box');
    save(el, 'top', `${r.top}px`);
    save(el, 'left', `${r.left}px`);
    save(el, 'right', 'auto');
    save(el, 'bottom', 'auto');
    save(el, 'width', `${r.width}px`);
    save(el, 'height', 'auto');
    save(el, 'max-height', 'none');
    save(el, 'min-height', `${Math.max(r.height, docHeight - r.top)}px`);
    // у absolute точка отсчёта — ближайший позиционированный предок, поэтому подгоняем по факту:
    // панель должна встать туда, где она была бы при прокрутке в самый верх
    const r2 = el.getBoundingClientRect();
    el.style.setProperty('top', `${2 * r.top - r2.top - scrollY}px`, 'important');
    el.style.setProperty('left', `${2 * r.left - r2.left - scrollX}px`, 'important');
  }

  // растянутая панель могла удлинить страницу
  return { sw: se.scrollWidth, sh: se.scrollHeight };
}

// Прокрутка к позиции и ожидание отрисовки. phase управляет fixed-элементами:
// верхние (шапки) видны только на первом ряду кадров, нижние (подвалы, баннеры) — только на последнем.
export async function pageScrollTo(x, y, phase) {
  const st = window.__wsState;
  if (st && st.scroller) st.scroller.el.scrollTop = y;
  else window.scrollTo(x, y);

  if (st && phase) {
    const show = (list, visible) => {
      for (const [el, value, priority] of list) {
        if (!visible) el.style.setProperty('visibility', 'hidden', 'important');
        else if (value) el.style.setProperty('visibility', value, priority);
        else el.style.removeProperty('visibility');
      }
    };
    show(st.top, phase === 'first' || phase === 'only');
    show(st.bottom, phase === 'last' || phase === 'only');
  }

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // небольшая пауза для ленивых картинок и анимаций появления
  await new Promise((r) => setTimeout(r, 150));
  return st && st.scroller ? { x: 0, y: st.scroller.el.scrollTop } : { x: scrollX, y: scrollY };
}

// Кладёт PNG (в base64) в буфер обмена. У service worker нет доступа к буферу,
// а у вкладки, которую только что сняли, есть: она активна и в фокусе.
// Возвращает null или текст ошибки.
export async function pageCopy(base64) {
  if (!navigator.clipboard) return chrome.i18n.getMessage('errNoHttps');
  // всплывающее окно расширения могло ещё не закрыться и не вернуть фокус странице
  if (!document.hasFocus()) {
    await new Promise((r) => {
      addEventListener('focus', r, { once: true });
      setTimeout(r, 1500);
    });
    if (!document.hasFocus()) return chrome.i18n.getMessage('errNoFocus');
  }
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return null;
  } catch (e) {
    return e.message || String(e);
  }
}

// Возвращает страницу в исходное состояние.
export function pageRestore() {
  const st = window.__wsState;
  if (st) {
    const put = (el, prop, value, priority) =>
      value ? el.style.setProperty(prop, value, priority) : el.style.removeProperty(prop);
    for (const [el, value, priority] of [...st.top, ...st.bottom]) put(el, 'visibility', value, priority);
    for (const [el, prop, value, priority] of st.records.reverse()) put(el, prop, value, priority);
    if (st.scroller) st.scroller.el.scrollTop = st.scroller.top;
    window.scrollTo(st.x, st.y);
    st.style.remove();
    window.__wsState = null;
  }
  for (const el of document.querySelectorAll('[data-webscreen-target],[data-webscreen-scroller]')) {
    el.removeAttribute('data-webscreen-target');
    el.removeAttribute('data-webscreen-scroller');
  }
}

// Интерактивный выбор: mode = 'region' (рамка мышью) или 'element' (клик по блоку).
// По завершении отправляет в service worker { type: 'ws-selected', mode, rect } с координатами документа.
export function pageSelect(mode) {
  if (window.__wsSelect) window.__wsSelect.cancel(true);

  const ac = new AbortController();
  const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: ac.signal });
  const block = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const host = document.createElement('div');
  host.setAttribute('data-webscreen-ui', '');
  host.style.cssText =
    'all:initial;position:fixed;inset:0;z-index:2147483647;' +
    (mode === 'region' ? 'cursor:crosshair;' : 'pointer-events:none;');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .shade { position: fixed; inset: 0; background: rgba(10, 14, 24, .38); }
      .box { position: fixed; display: none; box-sizing: border-box; border: 2px solid #2f6feb;
             background: rgba(47, 111, 235, .14); border-radius: 2px; }
      .box.drag { background: transparent; box-shadow: 0 0 0 100vmax rgba(10, 14, 24, .38); }
      .label { position: absolute; left: -2px; bottom: 100%; margin-bottom: 6px; padding: 5px 8px;
               font: 600 12px/1 system-ui, "Segoe UI", sans-serif; color: #fff; background: #2f6feb;
               border-radius: 4px; white-space: nowrap; }
      .label.inside { bottom: auto; top: 4px; left: 4px; margin: 0; }
      .hint { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); padding: 9px 14px;
              font: 13px/1.4 system-ui, "Segoe UI", sans-serif; color: #fff; background: rgba(20, 22, 28, .9);
              border-radius: 6px; box-shadow: 0 6px 20px rgba(0, 0, 0, .3); white-space: nowrap; pointer-events: none; }
      .hint.bottom { top: auto; bottom: 16px; }
      kbd { display: inline-block; margin: 0 1px; padding: 1px 6px; font: inherit; font-size: 11px;
            border-radius: 4px; background: rgba(255, 255, 255, .14); border: 1px solid rgba(255, 255, 255, .25); }
    </style>
    <div class="shade"></div>
    <div class="box"><span class="label"></span></div>
    <div class="hint"></div>`;
  const shade = root.querySelector('.shade');
  const box = root.querySelector('.box');
  const label = root.querySelector('.label');
  const hint = root.querySelector('.hint');
  if (mode !== 'region') shade.remove();
  const hintHtml = chrome.i18n.getMessage(mode === 'region' ? 'hintRegion' : 'hintElement');
  hint.append(...new DOMParser().parseFromString(hintHtml, 'text/html').body.childNodes);
  (document.fullscreenElement || document.documentElement).append(host);

  let last = { x: -1, y: -1 };
  let raf = 0;

  const finish = (rect, silent) => {
    ac.abort();
    cancelAnimationFrame(raf);
    host.remove();
    window.__wsSelect = null;
    if (silent) return;
    // даём браузеру перерисовать страницу без оверлея, прежде чем снимать
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        chrome.runtime.sendMessage(rect ? { type: 'ws-selected', mode, rect } : { type: 'ws-cancel' }).catch(() => {});
      }),
    );
  };
  window.__wsSelect = { cancel: (silent) => finish(null, silent) };

  on(window, 'mousemove', (e) => {
    last = { x: e.clientX, y: e.clientY };
    hint.classList.toggle('bottom', last.y < 90);
  }, { capture: true });
  on(window, 'keydown', (e) => {
    if (e.key === 'Escape') {
      block(e);
      finish(null);
    }
  }, { capture: true });
  on(window, 'contextmenu', (e) => {
    block(e);
    finish(null);
  }, { capture: true });

  const place = (x, y, w, h) => {
    Object.assign(box.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    label.classList.toggle('inside', y < 30);
  };

  if (mode === 'region') {
    let start = null;
    const docPoint = () => ({ x: last.x + scrollX, y: last.y + scrollY });
    const current = () => {
      const p = docPoint();
      return {
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
      };
    };
    const render = () => {
      if (!start) return;
      const r = current();
      place(r.x - scrollX, r.y - scrollY, r.w, r.h);
      label.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
    };
    // автопрокрутка, когда при выделении курсор упирается в край окна
    const tick = () => {
      const edge = 40;
      const speed = (d) => Math.min(40, Math.max(0, edge - d) / 1.5);
      const dx = speed(innerWidth - last.x) - speed(last.x);
      const dy = speed(innerHeight - last.y) - speed(last.y);
      if (dx || dy) {
        scrollBy(dx, dy);
        render();
      }
      raf = requestAnimationFrame(tick);
    };
    const reset = () => {
      cancelAnimationFrame(raf);
      start = null;
      box.style.display = 'none';
      box.classList.remove('drag');
      shade.style.display = '';
    };

    on(host, 'mousedown', (e) => {
      if (e.button !== 0) return;
      block(e);
      last = { x: e.clientX, y: e.clientY };
      start = docPoint();
      shade.style.display = 'none';
      box.classList.add('drag');
      render();
      raf = requestAnimationFrame(tick);
    });
    on(window, 'mousemove', render, { capture: true });
    on(window, 'scroll', render, { passive: true });
    on(window, 'mouseup', (e) => {
      if (!start || e.button !== 0) return;
      block(e);
      const r = current();
      if (r.w < 5 || r.h < 5) reset();
      else finish(r);
    }, { capture: true });
    return;
  }

  // mode === 'element'
  let el = null;
  let leaf = null;
  const stack = [];
  const describe = (n) => {
    let s = n.tagName.toLowerCase();
    if (n.id) s += `#${n.id}`;
    const cls = [...n.classList].slice(0, 2);
    if (cls.length) s += `.${cls.join('.')}`;
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  };
  const draw = () => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    place(r.left, r.top, r.width, r.height);
    label.textContent = `${describe(el)}   ${Math.round(r.width)} × ${Math.round(r.height)}`;
  };
  const pick = () => {
    if (last.x < 0) return;
    const t = document.elementFromPoint(last.x, last.y);
    if (!t || t === host || t === leaf) return;
    leaf = el = t;
    stack.length = 0;
    draw();
  };
  const done = () => {
    if (!el) return;
    for (const n of document.querySelectorAll('[data-webscreen-target]')) n.removeAttribute('data-webscreen-target');
    el.setAttribute('data-webscreen-target', '');
    const r = el.getBoundingClientRect();
    finish({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height });
  };

  on(window, 'mousemove', pick, { capture: true });
  on(window, 'scroll', () => {
    pick();
    draw();
  }, { passive: true, capture: true });
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick']) {
    on(window, type, block, { capture: true });
  }
  on(window, 'click', (e) => {
    block(e);
    if (!el) pick();
    done();
  }, { capture: true });
  on(window, 'keydown', (e) => {
    if (!el) return;
    if (e.key === 'ArrowUp') {
      block(e);
      if (el.parentElement && el !== document.documentElement) {
        stack.push(el);
        el = el.parentElement;
        draw();
      }
    } else if (e.key === 'ArrowDown') {
      block(e);
      const next = stack.pop() || el.firstElementChild;
      if (next) {
        el = next;
        draw();
      }
    } else if (e.key === 'Enter') {
      block(e);
      done();
    }
  }, { capture: true });
}
