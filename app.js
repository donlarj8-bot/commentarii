(function () {
  'use strict';

  /* ======= SETTINGS ======= */
  var REPO = 'donlarj8-bot/commentarii';
  var BRANCH = 'main';
  /* ======================== */

  /* ======= YOUR WORDING (edit here) =======
     Tip: text containing an apostrophe must sit in "double quotes". */
  var TAGLINE = 'Lines worth keeping from the books I read and the people I listen to.';
  var EPI_LINE = "I'm Deepak Lead";
  var EPI_SUB = 'I Read, I Lead, by God.';
  /* ======================================== */

  var FILE = 'quotes.json';
  var TOKEN_KEY = 'commentarii-token';
  var MODE_KEY = 'commentarii-mode';

  var state = { nextId: 1, quotes: [] };
  var ui = {
    search: '', newestFirst: true,
    owner: false, token: '', busy: false, confirmId: null, editT: null, confirmRenum: false,
    loading: true, loadError: false, showSignin: false,
    mode: 'scroll', idx: 0, dir: '',
    view: 'home', srcKey: '', srcSort: 'az'
  };

  /* ---------- storage (guarded) ---------- */
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  ui.mode = read(MODE_KEY) === 'swipe' ? 'swipe' : 'scroll';

  /* ---------- helpers ---------- */
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else if (v !== false && v != null) el.setAttribute(k, v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function toRoman(n) {
    if (n < 1 || n > 3999) return String(n);
    var map = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
    var s = '';
    map.forEach(function (p) { while (n >= p[0]) { s += p[1]; n -= p[0]; } });
    return s;
  }

  function fmtDate(d) {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function toB64(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function fromB64(b64) {
    var bin = atob(b64.replace(/\n/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function normalize(d) {
    if (!d || !Array.isArray(d.quotes)) return { nextId: 1, quotes: [] };
    var max = d.quotes.reduce(function (m, q) { return Math.max(m, q.n || 0); }, 0);
    return { nextId: Math.max(d.nextId || 1, max + 1), quotes: d.quotes };
  }

  function wreathSvg() {
    var cx = 100, cy = 104, r = 66, N = 12, out = [];
    for (var side = -1; side <= 1; side += 2) {
      var a0 = Math.PI / 2 + side * 0.22, a1 = Math.PI / 2 + side * 2.42;
      out.push('<path d="M' + (cx + r * Math.cos(a0)).toFixed(1) + ' ' + (cy + r * Math.sin(a0)).toFixed(1) +
        ' A' + r + ' ' + r + ' 0 0 ' + (side === 1 ? 1 : 0) + ' ' + (cx + r * Math.cos(a1)).toFixed(1) + ' ' + (cy + r * Math.sin(a1)).toFixed(1) +
        '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>');
      for (var i = 0; i < N; i++) {
        var t = i / (N - 1);
        var th = Math.PI / 2 + side * (0.22 + t * 2.2);
        var x = cx + r * Math.cos(th), y = cy + r * Math.sin(th);
        var rot = th * 180 / Math.PI + side * 90;
        var sc = 1 - 0.38 * t;
        [-1, 1].forEach(function (o) {
          out.push('<path d="M0 0Q8 -5 19 0Q8 5 0 0Z" fill="currentColor" transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) +
            ') rotate(' + (rot + o * 34).toFixed(1) + ') scale(' + sc.toFixed(2) + ')"/>');
        });
      }
    }
    return '<svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">' + out.join('') + '</svg>';
  }

  /* ---------- sources ---------- */
  function sourceKey(s) { return (s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

  // One row per source (spelling and capital letters ignored), with how many quotes it has.
  function sourceList() {
    var map = Object.create(null), order = [];
    state.quotes.slice().sort(function (a, b) { return a.n - b.n; }).forEach(function (e) {
      var k = sourceKey(e.s);
      if (!k) return;
      if (!map[k]) { map[k] = { key: k, name: e.s.trim().replace(/\s+/g, ' '), count: 0 }; order.push(k); }
      map[k].count++;
    });
    return order.map(function (k) { return map[k]; });
  }
  function uniqueSources() {
    return sourceList().map(function (s) { return s.name; }).sort(function (a, b) { return a.localeCompare(b); });
  }

  /* ---------- routing (#/ , #/sources , #/source/<name>) ---------- */
  function parseHash() {
    var hsh = location.hash || '';
    if (hsh === '#/sources') return { view: 'sources', key: '' };
    var m = hsh.match(/^#\/source\/(.+)$/);
    if (m) { try { return { view: 'source', key: decodeURIComponent(m[1]) }; } catch (e) {} }
    return { view: 'home', key: '' };
  }
  function nav(hash) { location.hash = hash; }

  /* ---------- GitHub API ---------- */
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + ui.token
    }, opts.headers || {});
    return fetch('https://api.github.com' + path, opts).then(function (r) {
      if (r.ok) return r.json();
      return r.json().catch(function () { return {}; }).then(function (b) {
        var e = new Error(b.message || ('HTTP ' + r.status));
        e.status = r.status;
        throw e;
      });
    });
  }
  function filePath() { return '/repos/' + REPO + '/contents/' + FILE; }

  // Read the latest file straight from the repo, apply a change, write it back.
  function mutate(fn, message) {
    return api(filePath() + '?ref=' + encodeURIComponent(BRANCH) + '&t=' + Date.now()).then(function (f) {
      var cur = normalize(JSON.parse(fromB64(f.content)));
      var out = fn(cur);
      return api(filePath(), {
        method: 'PUT',
        body: JSON.stringify({
          message: message,
          content: toB64(JSON.stringify(out.data, null, 2) + '\n'),
          sha: f.sha,
          branch: BRANCH
        })
      }).then(function () { return out; });
    });
  }

  function explain(err) {
    var s = err && err.status;
    if (s === 401) return 'GitHub rejected the token. Sign out and sign in again with a fresh one.';
    if (s === 403 || s === 404) return 'That token cannot write to ' + REPO + '. It needs Contents: read and write on that repo.';
    if (s === 409 || s === 422) return 'The file changed while saving. Try again.';
    return 'Could not reach GitHub. Check your connection and try again.';
  }

  /* ---------- page skeleton ---------- */
  var app = document.getElementById('app');

  var crown = h('div', { class: 'crown', role: 'img' });
  var scrollBtn = h('button', { type: 'button', text: 'Scroll', onclick: function () { setMode('scroll'); } });
  var swipeBtn = h('button', { type: 'button', text: 'Swipe', onclick: function () { setMode('swipe'); } });
  var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'How to browse the quotes' }, [scrollBtn, swipeBtn]);

  var bar = h('header', { class: 'bar' }, [
    h('div', { class: 'bar-in' }, [
      h('div', { class: 'bar-top' }, [
        crown,
        h('h1', null, [h('a', { href: '#/', text: 'Commentarii' })]),
        seg
      ]),
      h('p', { class: 'bar-line', text: TAGLINE }),
      h('p', { class: 'bar-line epi' }, [h('b', { text: EPI_LINE }), h('span', { text: EPI_SUB })])
    ])
  ]);

  var adminEl = h('section', { class: 'admin', hidden: true, 'aria-label': 'Add an entry' });

  var searchEl = h('input', {
    type: 'search', placeholder: 'Search quotes and sources', autocomplete: 'off',
    'aria-label': 'Search quotes and sources',
    oninput: function (e) { ui.search = e.target.value; ui.idx = 0; renderList(); }
  });
  var srcBtn = h('button', { type: 'button', class: 'ctl-btn', onclick: function () { nav('#/sources'); } });
  var sortBtn = h('button', { type: 'button', class: 'link-btn', onclick: toggleSort });
  var homeCtl = h('div', { class: 'controls' }, [searchEl, srcBtn, sortBtn]);

  var backBtn = h('button', { type: 'button', class: 'link-btn back', text: '\u2190 All sources', onclick: function () { nav('#/sources'); } });
  var sortBtn2 = h('button', { type: 'button', class: 'link-btn', onclick: toggleSort });
  var srcCtl = h('div', { class: 'controls src-ctl' }, [backBtn, sortBtn2]);
  var srcTitle = h('h2', { class: 'src-title' });

  var countEl = h('p', { class: 'count-line', 'aria-live': 'polite' });
  var listEl = h('div', { class: 'entries' });
  var sourcesEl = h('section', { class: 'sources', 'aria-label': 'All sources' });

  var main = h('main', { class: 'wrap' }, [adminEl, homeCtl, srcCtl, srcTitle, countEl, listEl, sourcesEl]);

  var signinEl = h('div', { class: 'signin', hidden: true });
  var signinToggle = h('button', {
    type: 'button', class: 'link-btn', text: 'Owner sign in',
    onclick: function () { ui.showSignin = !ui.showSignin; renderFooter(); }
  });
  var foot = h('footer', { class: 'foot' }, [signinToggle, signinEl]);

  app.textContent = '';
  app.appendChild(bar);
  app.appendChild(main);
  app.appendChild(foot);

  function toggleSort() { ui.newestFirst = !ui.newestFirst; ui.idx = 0; renderList(); }

  /* ---------- header badge: how many entries ---------- */
  function renderCrown() {
    var total = state.quotes.length;
    var t = total === 0 ? '0' : toRoman(total);
    if (t.length > 4) t = String(total);
    var fs = t.length <= 2 ? '0.95rem' : t.length === 3 ? '0.78rem' : t.length === 4 ? '0.62rem' : '0.5rem';
    crown.textContent = '';
    crown.innerHTML = wreathSvg();
    crown.setAttribute('aria-label', total + (total === 1 ? ' entry' : ' entries'));
    crown.appendChild(h('span', { class: 'count', text: t, style: 'font-size:' + fs }));
  }

  /* ---------- which part of the page is showing ---------- */
  function renderPage() {
    var v = ui.view;
    adminEl.hidden = !(ui.owner && v === 'home');
    homeCtl.hidden = v !== 'home';
    srcCtl.hidden = v !== 'source';
    srcTitle.hidden = v !== 'source';
    countEl.hidden = v === 'sources';
    listEl.hidden = v === 'sources';
    sourcesEl.hidden = v !== 'sources';
    main.className = 'wrap' + (v === 'sources' ? ' wide' : '');
    bar.className = 'bar' + (v === 'sources' ? ' wide' : '');
    document.title = v === 'sources' ? 'Sources | Commentarii' : 'Commentarii';
  }

  function renderControls() {
    var n = sourceList().length;
    srcBtn.textContent = 'Sources (' + n + ')';
    srcBtn.setAttribute('aria-label', 'Browse all ' + n + (n === 1 ? ' source' : ' sources'));
  }

  /* ---------- quotes list ---------- */
  function visible() {
    var term = ui.view === 'home' ? ui.search.trim().toLowerCase() : '';
    var list = state.quotes.filter(function (e) {
      if (ui.view === 'source' && sourceKey(e.s) !== ui.srcKey) return false;
      if (!term) return true;
      return (e.q + ' ' + (e.s || '')).toLowerCase().indexOf(term) !== -1;
    });
    list.sort(function (a, b) { return ui.newestFirst ? b.n - a.n : a.n - b.n; });
    return list;
  }

  function numCol(e) {
    return h('div', { class: 'num' }, [
      h('span', { class: 'arabic' + (e.n > 999 ? ' big' : ''), text: String(e.n) }),
      h('span', { class: 'roman', text: toRoman(e.n), 'aria-hidden': 'true' })
    ]);
  }

  function editorEl(e) {
    var qIn = h('textarea', { id: 'e-quote', rows: '4', maxlength: '4000' });
    qIn.value = e.q;
    var sIn = h('input', { id: 'e-source', type: 'text', list: 'f-sources', maxlength: '200', autocomplete: 'off' });
    sIn.value = e.s || '';
    var msg = h('p', { class: 'error', role: 'alert' });
    var save = h('button', { type: 'button', class: 'btn', text: 'Save changes' });
    var cancel = h('button', { type: 'button', class: 'link-btn', text: 'Cancel', onclick: function () { if (!ui.busy) { ui.editT = null; renderList(); } } });

    save.addEventListener('click', function () {
      if (ui.busy) return;
      var q = qIn.value.trim(), s = sIn.value.trim();
      if (!q) { msg.textContent = 'The quote cannot be empty.'; qIn.focus(); return; }
      msg.textContent = '';
      ui.busy = true; save.disabled = true; save.textContent = 'Saving…';
      mutate(function (cur) {
        var hit = cur.quotes.filter(function (x) { return x.t === e.t; })[0];
        if (!hit) throw new Error('missing');
        hit.q = q; hit.s = s;
        return { data: normalize(cur) };
      }, 'Edit entry ' + e.n).then(function (out) {
        state = normalize(out.data);
        ui.editT = null;
        if (noticeEl) noticeEl.textContent = 'Entry ' + e.n + ' updated. It changes for everyone in about a minute.';
        renderAll();
      }).catch(function (error) {
        msg.textContent = (error && error.message === 'missing') ? 'That entry no longer exists. Refresh the page.' : explain(error);
        save.disabled = false; save.textContent = 'Save changes';
      }).then(function () { ui.busy = false; });
    });

    return h('article', { class: 'entry' }, [
      numCol(e),
      h('div', { class: 'body' }, [
        h('div', { class: 'field' }, [h('label', { for: 'e-quote', text: 'Quote, note or line' }), qIn]),
        h('div', { class: 'field' }, [h('label', { for: 'e-source', text: 'Source' }), sIn]),
        msg,
        h('div', { class: 'meta' }, [save, cancel])
      ])
    ]);
  }

  function entryEl(e) {
    if (ui.owner && ui.editT === e.t) return editorEl(e);
    var meta = [];
    if (e.s && ui.view !== 'source') {
      meta.push(h('button', {
        type: 'button', class: 'link-btn source', text: e.s,
        title: 'See every quote from this source',
        onclick: function () { nav('#/source/' + encodeURIComponent(sourceKey(e.s))); }
      }));
    }
    meta.push(h('time', { class: 'when', datetime: e.t, text: fmtDate(e.t) }));
    if (ui.owner) {
      if (ui.confirmId === e.t) {
        meta.push(h('button', { type: 'button', class: 'link-btn remove danger', text: 'Confirm remove', onclick: function () { removeEntry(e.t); } }));
        meta.push(h('button', { type: 'button', class: 'link-btn', text: 'Keep', onclick: function () { ui.confirmId = null; renderList(); } }));
      } else {
        meta.push(h('button', {
          type: 'button', class: 'link-btn remove', text: 'Edit', 'aria-label': 'Edit entry ' + e.n,
          onclick: function () { ui.editT = e.t; ui.confirmId = null; renderList(); }
        }));
        meta.push(h('button', {
          type: 'button', class: 'link-btn', text: 'Remove', 'aria-label': 'Remove entry ' + e.n,
          style: 'color:var(--muted);font-size:0.95rem',
          onclick: function () { ui.confirmId = e.t; renderList(); }
        }));
      }
    }
    return h('article', { class: 'entry' }, [
      numCol(e),
      h('div', { class: 'body' }, [
        h('p', { class: 'quote', text: e.q }),
        h('div', { class: 'meta' }, meta)
      ])
    ]);
  }

  function renderList() {
    scrollBtn.setAttribute('aria-pressed', ui.mode === 'scroll' ? 'true' : 'false');
    swipeBtn.setAttribute('aria-pressed', ui.mode === 'swipe' ? 'true' : 'false');
    var label = ui.newestFirst ? 'Newest first' : 'Oldest first';
    [sortBtn, sortBtn2].forEach(function (b) {
      b.textContent = label;
      b.setAttribute('aria-label', 'Sort order: ' + label + '. Press to reverse.');
    });
    if (ui.view === 'sources') { renderSources(); return; }

    listEl.textContent = '';
    if (ui.loading) { countEl.textContent = ''; listEl.style.border = '0'; listEl.appendChild(h('p', { class: 'empty', text: 'Loading the collection…' })); return; }
    if (ui.loadError) { countEl.textContent = ''; listEl.style.border = '0'; listEl.appendChild(h('p', { class: 'empty', text: 'The collection could not be loaded. Refresh the page to try again.' })); return; }

    var isSrc = ui.view === 'source';
    if (isSrc) {
      var found = sourceList().filter(function (s) { return s.key === ui.srcKey; })[0];
      srcTitle.textContent = found ? found.name : 'Source not found';
    }

    if (state.quotes.length === 0) {
      countEl.textContent = '';
      listEl.style.border = '0';
      listEl.appendChild(h('p', { class: 'empty', text: ui.owner ? 'The record is empty. Add your first line in the box above.' : 'Nothing is written here yet. Check back soon.' }));
      return;
    }

    var items = visible();
    listEl.style.border = '';
    if (isSrc) countEl.textContent = items.length + (items.length === 1 ? ' quote' : ' quotes');
    else if (ui.search.trim()) countEl.textContent = items.length + ' of ' + state.quotes.length + ' entries match';
    else countEl.textContent = state.quotes.length + (state.quotes.length === 1 ? ' entry' : ' entries');

    if (items.length === 0) {
      listEl.style.border = '0';
      listEl.appendChild(h('p', { class: 'empty', text: isSrc ? 'No quotes from this source.' : 'No entries match. Try a different word.' }));
      return;
    }
    if (ui.mode === 'swipe') { renderDeck(items); return; }
    items.forEach(function (e) { listEl.appendChild(entryEl(e)); });
  }

  /* ---------- sources page ---------- */
  function renderSources() {
    sourcesEl.textContent = '';
    if (ui.loading) { sourcesEl.appendChild(h('p', { class: 'empty', text: 'Loading the collection…' })); return; }
    if (ui.loadError) { sourcesEl.appendChild(h('p', { class: 'empty', text: 'The collection could not be loaded. Refresh the page to try again.' })); return; }

    var list = sourceList();
    if (ui.srcSort === 'most') {
      list.sort(function (a, b) { return (b.count - a.count) || a.name.localeCompare(b.name); });
    } else {
      list.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); });
    }

    var azBtn = h('button', {
      type: 'button', class: 'link-btn', text: 'A to Z', 'aria-pressed': ui.srcSort === 'az' ? 'true' : 'false',
      onclick: function () { ui.srcSort = 'az'; renderSources(); }
    });
    var mostBtn = h('button', {
      type: 'button', class: 'link-btn', text: 'Most quotes', 'aria-pressed': ui.srcSort === 'most' ? 'true' : 'false',
      onclick: function () { ui.srcSort = 'most'; renderSources(); }
    });

    sourcesEl.appendChild(h('div', { class: 'src-head' }, [
      h('button', { type: 'button', class: 'link-btn back', text: '\u2190 Quotes', onclick: function () { nav('#/'); } }),
      h('h2', { text: 'Sources' }),
      h('p', { class: 'src-count', text: list.length + (list.length === 1 ? ' source' : ' sources') + ', ' + state.quotes.length + (state.quotes.length === 1 ? ' quote' : ' quotes') }),
      h('div', { class: 'src-sort' }, [azBtn, mostBtn])
    ]));

    if (list.length === 0) {
      sourcesEl.appendChild(h('p', { class: 'empty', text: 'No sources yet. Quotes added with a source will appear here.' }));
      return;
    }

    sourcesEl.appendChild(h('ol', { class: 'src-list' }, list.map(function (s, i) {
      return h('li', null, [h('button', {
        type: 'button', class: 'src-item', title: s.name,
        onclick: function () { nav('#/source/' + encodeURIComponent(s.key)); }
      }, [
        h('span', { class: 'src-n', text: String(i + 1) }),
        h('span', { class: 'src-name', text: s.name }),
        h('span', { class: 'src-c', text: String(s.count), 'aria-label': s.count + (s.count === 1 ? ' quote' : ' quotes') })
      ])]);
    })));
  }

  /* ---------- swipe view ---------- */
  function setMode(m) {
    ui.mode = m; ui.idx = 0; ui.dir = ''; ui.confirmId = null;
    store(MODE_KEY, m);
    renderList();
  }

  function go(d) {
    if (ui.view === 'sources') return;
    var n = visible().length, ni = ui.idx + d;
    if (ui.editT || ni < 0 || ni >= n) return;
    ui.idx = ni; ui.dir = d > 0 ? 'next' : 'prev'; ui.confirmId = null;
    renderList();
  }

  function attachSwipe(card) {
    var sx = null, sy = null;
    card.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest && ev.target.closest('button, input, textarea, select, label')) { sx = null; return; }
      sx = ev.clientX; sy = ev.clientY;
    });
    card.addEventListener('pointerup', function (ev) {
      if (sx == null) return;
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    });
    card.addEventListener('pointercancel', function () { sx = null; });
  }

  function renderDeck(items) {
    listEl.style.border = '0';
    if (ui.idx >= items.length) ui.idx = items.length - 1;
    if (ui.idx < 0) ui.idx = 0;
    var card = h('div', { class: 'deck-card' }, [entryEl(items[ui.idx])]);
    if (ui.dir) card.setAttribute('data-dir', ui.dir);
    ui.dir = '';
    var prev = h('button', { type: 'button', class: 'nav-btn', text: 'Previous', onclick: function () { go(-1); } });
    var next = h('button', { type: 'button', class: 'nav-btn', text: 'Next', onclick: function () { go(1); } });
    prev.disabled = !!ui.editT || ui.idx === 0;
    next.disabled = !!ui.editT || ui.idx === items.length - 1;
    attachSwipe(card);
    listEl.appendChild(h('div', { class: 'deck' }, [
      card,
      h('div', { class: 'deck-nav' }, [prev, h('span', { class: 'deck-pos', text: (ui.idx + 1) + ' of ' + items.length }), next]),
      h('p', { class: 'deck-hint', text: 'Swipe the card left or right, or use the arrow keys.' })
    ]));
  }

  document.addEventListener('keydown', function (ev) {
    if (ui.mode !== 'swipe' || ui.view === 'sources') return;
    var t = ev.target && ev.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    if (ev.key === 'ArrowRight') go(1);
    else if (ev.key === 'ArrowLeft') go(-1);
  });

  /* ---------- admin ---------- */
  var qEl, sEl, previewEl, errEl, noticeEl, addBtn, datalistEl, gapEl, gapMsg, gapBtn;

  function hasGap() {
    return state.quotes.map(function (e) { return e.n; })
      .sort(function (a, b) { return a - b; })
      .some(function (n, i) { return n !== i + 1; });
  }

  function refreshAdminMeta() {
    if (!ui.owner || !previewEl) return;
    if (gapEl) {
      var gap = hasGap();
      if (!gap) ui.confirmRenum = false;
      gapEl.hidden = !gap;
      gapMsg.textContent = 'Some numbers are skipped.';
      gapBtn.textContent = ui.confirmRenum
        ? 'Confirm: renumber 1 to ' + state.quotes.length
        : 'Renumber 1 to ' + state.quotes.length;
    }
    previewEl.textContent = 'Saved as No. ' + state.nextId + ', dated ' + fmtDate(new Date()) + '.';
    datalistEl.textContent = '';
    uniqueSources().forEach(function (s) { datalistEl.appendChild(h('option', { value: s })); });
  }

  function buildAdmin() {
    adminEl.textContent = '';
    if (!ui.owner) return;

    qEl = h('textarea', {
      id: 'f-quote', rows: '4', maxlength: '4000', placeholder: 'Paste or write the line here',
      onkeydown: function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') addEntry(); }
    });
    sEl = h('input', { id: 'f-source', type: 'text', list: 'f-sources', maxlength: '200', autocomplete: 'off', placeholder: 'Book, person, podcast or talk' });
    datalistEl = h('datalist', { id: 'f-sources' });
    previewEl = h('p', { class: 'preview' });
    gapMsg = h('span');
    gapBtn = h('button', { type: 'button', class: 'link-btn', onclick: renumber });
    gapEl = h('p', { class: 'preview', hidden: true }, [gapMsg, ' ', gapBtn]);
    errEl = h('p', { class: 'error', role: 'alert' });
    noticeEl = h('p', { class: 'notice', role: 'status' });
    addBtn = h('button', { type: 'button', class: 'btn', text: 'Add entry', onclick: addEntry });

    adminEl.appendChild(h('div', { class: 'admin-top' }, [
      h('h2', { text: 'Add to the record' }),
      h('button', { type: 'button', class: 'link-btn', text: 'Sign out', onclick: signOut })
    ]));
    adminEl.appendChild(h('p', { class: 'hint', text: 'Only you can see this box. The number and date are added for you.' }));
    adminEl.appendChild(h('div', { class: 'field' }, [h('label', { for: 'f-quote', text: 'Quote, note or line' }), qEl]));
    adminEl.appendChild(h('div', { class: 'field' }, [h('label', { for: 'f-source', text: 'Source' }), sEl, datalistEl]));
    adminEl.appendChild(previewEl);
    adminEl.appendChild(gapEl);
    adminEl.appendChild(errEl);
    adminEl.appendChild(noticeEl);
    adminEl.appendChild(addBtn);
    refreshAdminMeta();
  }

  function setBusy(on, label) {
    ui.busy = on;
    if (addBtn) { addBtn.disabled = on; addBtn.textContent = on ? (label || 'Saving…') : 'Add entry'; }
  }

  function addEntry() {
    if (!ui.owner || ui.busy) return;
    var q = qEl.value.trim(), s = sEl.value.trim();
    errEl.textContent = ''; noticeEl.textContent = '';
    if (!q) { errEl.textContent = 'Write the quote or note before adding it.'; qEl.focus(); return; }
    var created;
    setBusy(true, 'Adding…');
    mutate(function (cur) {
      created = { n: cur.nextId, q: q, s: s, t: new Date().toISOString() };
      return { data: { nextId: cur.nextId + 1, quotes: cur.quotes.concat([created]) } };
    }, 'Add entry').then(function (out) {
      state = normalize(out.data);
      qEl.value = ''; sEl.value = '';
      noticeEl.textContent = 'Added as No. ' + created.n + '. It goes live for everyone in about a minute.';
      renderAll();
    }).catch(function (err) {
      errEl.textContent = explain(err);
      if (err && err.status === 401) signOut();
    }).then(function () { setBusy(false); });
  }

  // Close any gaps so the numbers run 1, 2, 3... in the order entries were added.
  function renumber() {
    if (!ui.owner || ui.busy) return;
    if (!ui.confirmRenum) { ui.confirmRenum = true; refreshAdminMeta(); return; }
    ui.confirmRenum = false;
    errEl.textContent = ''; noticeEl.textContent = '';
    setBusy(true, 'Saving…');
    mutate(function (cur) {
      var list = cur.quotes.slice().sort(function (a, b) {
        return (a.n - b.n) || ((a.t || '') < (b.t || '') ? -1 : 1);
      });
      list.forEach(function (e, i) { e.n = i + 1; });
      return { data: { nextId: list.length + 1, quotes: list } };
    }, 'Renumber entries').then(function (out) {
      state = normalize(out.data);
      noticeEl.textContent = 'Done. The entries now run 1 to ' + state.quotes.length + '.';
      renderAll();
    }).catch(function (err) {
      errEl.textContent = explain(err);
    }).then(function () { setBusy(false); refreshAdminMeta(); });
  }

  function removeEntry(t) {
    if (!ui.owner || ui.busy) return;
    ui.confirmId = null;
    setBusy(true, 'Removing…');
    if (errEl) { errEl.textContent = ''; noticeEl.textContent = ''; }
    mutate(function (cur) {
      return { data: { nextId: cur.nextId, quotes: cur.quotes.filter(function (e) { return e.t !== t; }) } };
    }, 'Remove entry').then(function (out) {
      state = normalize(out.data);
      if (noticeEl) noticeEl.textContent = 'Entry removed.';
      renderAll();
    }).catch(function (err) {
      if (errEl) errEl.textContent = explain(err);
    }).then(function () { setBusy(false); renderList(); });
  }

  /* ---------- owner sign in ---------- */
  function renderFooter() {
    signinToggle.hidden = ui.owner;
    signinEl.hidden = ui.owner || !ui.showSignin;
    if (ui.owner || !ui.showSignin) return;
    if (signinEl.childNodes.length) return;

    var tokenEl = h('input', { id: 'f-token', type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' });
    var msgEl = h('p', { class: 'error', role: 'alert' });
    var btn = h('button', {
      type: 'button', class: 'btn', text: 'Sign in',
      onclick: function () {
        var t = tokenEl.value.trim();
        if (!t) { msgEl.textContent = 'Paste your token first.'; return; }
        msgEl.textContent = '';
        btn.disabled = true; btn.textContent = 'Checking…';
        verify(t).then(function () {
          store(TOKEN_KEY, t);
          tokenEl.value = '';
          enterOwner();
        }).catch(function (err) {
          msgEl.textContent = (err && err.status === 401) ? 'GitHub rejected that token.' : (err && err.message === 'no-push') ? 'That token cannot write to ' + REPO + '.' : 'Could not check the token. Is REPO set correctly in the page?';
          ui.token = '';
        }).then(function () { btn.disabled = false; btn.textContent = 'Sign in'; });
      }
    });
    signinEl.appendChild(h('div', { class: 'field' }, [
      h('label', { for: 'f-token', text: 'GitHub token' }), tokenEl,
      h('span', { class: 'help', text: 'Stays in this browser only. Anyone without it can read the collection but cannot add to it.' })
    ]));
    signinEl.appendChild(msgEl);
    signinEl.appendChild(btn);
  }

  function verify(token) {
    ui.token = token;
    return api('/repos/' + REPO).then(function (r) {
      if (!r.permissions || !r.permissions.push) throw new Error('no-push');
    });
  }

  function enterOwner() {
    ui.owner = true;
    buildAdmin();
    renderFooter();
    // Owners read straight from the repo so a fresh save never looks stale.
    api(filePath() + '?ref=' + encodeURIComponent(BRANCH) + '&t=' + Date.now()).then(function (f) {
      state = normalize(JSON.parse(fromB64(f.content)));
      renderAll();
    }).catch(function () { renderAll(); });
    renderAll();
  }

  function signOut() {
    store(TOKEN_KEY, null);
    ui.token = ''; ui.owner = false; ui.showSignin = false; ui.confirmId = null; ui.editT = null;
    signinEl.textContent = '';
    buildAdmin(); renderFooter(); renderAll();
  }

  function renderAll() {
    renderCrown();
    renderPage();
    renderControls();
    renderList();
    refreshAdminMeta();
  }

  function applyRoute(scroll) {
    var r = parseHash();
    ui.view = r.view; ui.srcKey = r.key; ui.idx = 0; ui.confirmId = null; ui.editT = null;
    renderAll();
    if (scroll) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () { applyRoute(true); });

  /* ---------- start ---------- */
  (function () { var r = parseHash(); ui.view = r.view; ui.srcKey = r.key; })();
  renderAll();
  renderFooter();

  fetch(FILE + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('load');
    return r.json();
  }).then(function (d) {
    if (!ui.owner) state = normalize(d);
    ui.loading = false;
    renderAll();
  }).catch(function () {
    ui.loading = false; ui.loadError = true;
    renderAll();
  });

  var saved = read(TOKEN_KEY);
  if (saved) {
    verify(saved).then(enterOwner).catch(function (err) {
      if (err && (err.status === 401 || err.message === 'no-push')) store(TOKEN_KEY, null);
      ui.token = '';
    });
  }
})();
