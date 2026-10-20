/*
 * Baja Blast, on every website the wall opens.
 *
 * The wall's browser is the calendar's own window: Browser sends it to the
 * site itself, because most big sites (Google, YouTube, recipe sites) refuse
 * to be shown inside another page. That keeps everything in one full-screen
 * window, but a website knows nothing about the calendar — so this puts the
 * calendar's controls on top of it:
 *
 *   a small bar along the bottom — back, forward, keyboard, search, and
 *   Calendar to come home;
 *   the calendar's own on-screen keyboard, whenever a text box is tapped,
 *   because the wall has no keyboard of its own;
 *   and two ways home without anyone pressing anything: ten quiet minutes,
 *   or a kitchen timer going off.
 *
 * Everything is drawn inside a shadow root, so a site's styles can't touch
 * it and it can't touch the site's.
 */
(() => {
  const CALENDAR = 'http://localhost:8787/';
  const here = location.host;

  // On the calendar itself, just say we're here: the calendar opens sites in
  // this window only when it knows there's a way back.
  if (here === 'localhost:8787' || here === '127.0.0.1:8787') {
    document.documentElement.dataset.bajaWall = '1';
    return;
  }
  if (window.top !== window) return; // never inside a site's own frames

  const goHome = (hash = '') => {
    location.href = CALENDAR + hash;
  };

  /* ------------------------------------------------------------------ *
   * Coming home on its own
   * ------------------------------------------------------------------ */

  const IDLE_MS = 10 * 60 * 1000;
  let lastTouch = Date.now();
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, () => (lastTouch = Date.now()), { capture: true, passive: true });
  }
  setInterval(() => {
    if (Date.now() - lastTouch > IDLE_MS) goHome();
    try {
      chrome.runtime.sendMessage({ type: 'timers' }, (r) => {
        if (r && r.ringing) goHome();
      });
    } catch {
      /* the extension was reloaded; the next page load picks it up */
    }
  }, 4000);

  // Links that would open a second full-screen window open here instead,
  // where the bar is.
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[target="_blank"]') : null;
      if (a && a.href && /^https?:/i.test(a.href)) {
        e.preventDefault();
        e.stopPropagation();
        location.href = a.href;
      }
    },
    true
  );

  /* ------------------------------------------------------------------ *
   * The bar and the keyboard
   * ------------------------------------------------------------------ */

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Satoshi', -apple-system, 'Segoe UI', Roboto, sans-serif; }
    .bar {
      position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
      z-index: 2147483647; display: flex; gap: 6px; padding: 6px;
      background: rgba(12, 11, 10, 0.92); border-radius: 999px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
      transition: transform 0.25s ease, opacity 0.25s ease;
    }
    .bar.kb { transform: translate(-50%, calc(-1 * var(--kb, 0px))); }
    button {
      all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
      gap: 8px; min-width: 56px; height: 52px; padding: 0 18px; border-radius: 999px;
      color: #f3efe7; font-size: 17px; font-weight: 600; -webkit-tap-highlight-color: transparent;
    }
    button:active { background: rgba(243, 239, 231, 0.14); }
    .home { background: #d8c3a0; color: #14120e; }
    .home:active { background: #c6ae86; }
    svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    .kbd {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483646;
      display: none; flex-direction: column; gap: 8px; padding: 12px 16px 16px;
      background: #0f0e0c; border-radius: 22px 22px 0 0; box-shadow: 0 -20px 50px rgba(0, 0, 0, 0.35);
    }
    .kbd.open { display: flex; }
    .row { display: flex; gap: 7px; justify-content: center; }
    .key {
      all: unset; flex: 1 1 0; max-width: 84px; height: 56px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      background: #1a1815; color: #f3efe7; font-size: 21px; -webkit-tap-highlight-color: transparent;
    }
    .key:active { background: #d8c3a0; color: #14120e; }
    .wide { flex-grow: 1.6; max-width: 140px; font-size: 15px; font-weight: 700; }
    .space { flex-grow: 5; max-width: 460px; font-size: 14px; color: #9a9387; }
    .go { background: #d8c3a0; color: #14120e; }
    .on { background: #f3efe7; color: #14120e; }
  `;

  const ICONS = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    fwd: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    kbd: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11.5h13V9"/></svg>',
  };

  function mount() {
    if (!document.body || document.getElementById('baja-wall')) return;
    const hostEl = document.createElement('div');
    hostEl.id = 'baja-wall';
    document.documentElement.appendChild(hostEl);
    const root = hostEl.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="bar">
        <button data-a="back" aria-label="Back">${ICONS.back}</button>
        <button data-a="fwd" aria-label="Forward">${ICONS.fwd}</button>
        <button data-a="kbd" aria-label="Keyboard">${ICONS.kbd}</button>
        <button data-a="search" aria-label="Search or go somewhere">${ICONS.search}</button>
        <button data-a="home" class="home">${ICONS.home}Calendar</button>
      </div>
      <div class="kbd"></div>`;

    const bar = root.querySelector('.bar');
    const kbd = root.querySelector('.kbd');
    let field = null;
    let shift = false;
    let symbols = false;

    // Pointer-down, cancelled: the page keeps its focus and its cursor.
    const press = (el, fn) =>
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });

    press(root.querySelector('[data-a=back]'), () => history.back());
    press(root.querySelector('[data-a=fwd]'), () => history.forward());
    press(root.querySelector('[data-a=search]'), () => goHome('#browser'));
    press(root.querySelector('[data-a=home]'), () => goHome());
    press(root.querySelector('[data-a=kbd]'), () => {
      if (kbd.classList.contains('open')) hide();
      else show(field || findField());
    });

    const isField = (el) =>
      el &&
      ((el.tagName === 'INPUT' && /^(text|search|url|email|tel|number|password|)$/i.test(el.type || '')) ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable);

    const findField = () => {
      const el = document.activeElement;
      if (isField(el)) return el;
      return document.querySelector('input[type=search], input[name=q], textarea, input[type=text]');
    };

    function setValue(el, value) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) setter.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function type(text) {
      if (!field) return;
      field.focus();
      if (field.isContentEditable) {
        document.execCommand('insertText', false, text);
        return;
      }
      let start = field.value.length;
      let end = start;
      try {
        if (field.selectionStart != null) {
          start = field.selectionStart;
          end = field.selectionEnd;
        }
      } catch {
        /* inputs without a selection */
      }
      setValue(field, field.value.slice(0, start) + text + field.value.slice(end));
      try {
        field.setSelectionRange(start + text.length, start + text.length);
      } catch {
        /* see above */
      }
    }

    function backspace() {
      if (!field) return;
      field.focus();
      if (field.isContentEditable) {
        document.execCommand('delete');
        return;
      }
      let start = field.value.length;
      let end = start;
      try {
        if (field.selectionStart != null) {
          start = field.selectionStart;
          end = field.selectionEnd;
        }
      } catch {
        /* see above */
      }
      if (start === end && start === 0) return;
      const from = start === end ? start - 1 : start;
      setValue(field, field.value.slice(0, from) + field.value.slice(end));
      try {
        field.setSelectionRange(from, from);
      } catch {
        /* see above */
      }
    }

    function enter() {
      if (!field) return;
      if (field.tagName === 'TEXTAREA' && !/search|q/i.test(field.name || '')) {
        type('\n');
        return;
      }
      const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      const go = field.dispatchEvent(new KeyboardEvent('keydown', opts));
      field.dispatchEvent(new KeyboardEvent('keypress', opts));
      field.dispatchEvent(new KeyboardEvent('keyup', opts));
      if (go && field.form) {
        if (field.form.requestSubmit) field.form.requestSubmit();
        else field.form.submit();
      }
      hide();
    }

    const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    const SYMBOLS = ['@#$%&*()-+', '\'":;!?/=_', ',.'];

    function render() {
      const rows = [];
      rows.push([...'1234567890'].map((c) => ({ label: c, fn: () => type(c) })));
      (symbols ? SYMBOLS : LETTERS).forEach((row, i) => {
        const keys = [...row].map((c) => {
          const ch = shift && !symbols ? c.toUpperCase() : c;
          return {
            label: ch,
            fn: () => {
              type(ch);
              if (shift) {
                shift = false;
                render();
              }
            },
          };
        });
        if (i === 2 && !symbols) keys.unshift({ label: '⇧', cls: `wide ${shift ? 'on' : ''}`, fn: () => ((shift = !shift), render()) });
        if (i === 2) keys.push({ label: '⌫', cls: 'wide', fn: backspace });
        rows.push(keys);
      });
      rows.push([
        { label: symbols ? 'abc' : '#+=', cls: 'wide', fn: () => ((symbols = !symbols), render()) },
        { label: '.com', cls: 'wide', fn: () => type('.com') },
        { label: 'space', cls: 'space', fn: () => type(' ') },
        { label: '.', fn: () => type('.') },
        { label: 'go', cls: 'wide go', fn: enter },
        { label: 'hide', cls: 'wide', fn: hide },
      ]);
      kbd.innerHTML = '';
      for (const keys of rows) {
        const r = document.createElement('div');
        r.className = 'row';
        for (const k of keys) {
          const b = document.createElement('button');
          b.className = `key ${k.cls || ''}`;
          b.textContent = k.label;
          press(b, k.fn);
          r.appendChild(b);
        }
        kbd.appendChild(r);
      }
    }

    function show(el) {
      if (!el) return;
      field = el;
      render();
      kbd.classList.add('open');
      requestAnimationFrame(() => {
        bar.style.setProperty('--kb', `${kbd.offsetHeight + 12}px`);
        bar.classList.add('kb');
        try {
          el.scrollIntoView({ block: 'center' });
        } catch {
          /* fine */
        }
      });
    }

    function hide() {
      kbd.classList.remove('open');
      bar.classList.remove('kb');
    }

    // Tap a text box on the page, get the keyboard.
    document.addEventListener(
      'focusin',
      (e) => {
        const el = e.composedPath ? e.composedPath()[0] : e.target;
        if (isField(el)) show(el);
      },
      true
    );
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
