(function () {
  'use strict';

  /* ======= EDIT THESE TWO LINES ======= */
  var REPO = 'donlarj8-bot/commentarii';
  var BRANCH = 'main';
  /* ==================================== */

  var FILE = 'quotes.json';
  var TOKEN_KEY = 'commentarii-token';

  var state = { nextId: 1, quotes: [] };
  var ui = {
    search: '', source: '', newestFirst: true,
    owner: false, token: '', busy: false, confirmId: null, editT: null,
    loading: true, loadError: false, showSignin: false
  };

  /* ---------- storage (guarded) ---------- */
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }

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
        '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>');
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
  var crown = h('div', { class: 'crown' });
  var hero = h('header', { class: 'hero' }, [
    h('div', { class: 'hero-inner' }, [
      crown,
      h('h1', { text: 'COMMENTARII' }),
      h('p', { class: 'sub', text: 'Lines worth keeping from the books I read and the people I listen to.' }),
      h('p', { class: 'epi' }, ['Veni, vidi, legi.', h('span', { text: 'I came, I saw, I read.' })])
    ]),
    h('div', { class: 'meander', 'aria-hidden': 'true' })
  ]);

  var adminEl = h('section', { class: 'admin', hidden: true, 'aria-label': 'Add an entry' });
  var searchEl = h('input', {
    type: 'search', placeholder: 'Search quotes and sources', autocomplete: 'off',
    'aria-label': 'Search quotes and sources',
    oninput: function (e) { ui.search = e.target.value; renderList(); }
  });
  var sourceSel = h('select', {
    'aria-label': 'Filter by source',
    onchange: function (e) { ui.source = e.target.value; renderList(); }
  });
  var sortBtn = h('button', {
    type: 'button', class: 'link-btn',
    onclick: function () { ui.newestFirst = !ui.newestFirst; renderList(); }
  });
  var countEl = h('p', { class: 'count-line', 'aria-live': 'polite' });
  var listEl = h('div', { class: 'entries' });

  var main = h('main', { class: 'wrap' }, [
    adminEl,
    h('div', { class: 'controls' }, [searchEl, sourceSel, sortBtn]),
    countEl,
    listEl
  ]);

  var signinEl = h('div', { class: 'signin', hidden: true });
  var signinToggle = h('button', {
    type: 'button', class: 'link-btn', text: 'Owner sign in',
    onclick: function () { ui.showSignin = !ui.showSignin; renderFooter(); }
  });
  var foot = h('footer', { class: 'foot' }, [signinToggle, signinEl]);

  app.textContent = '';
  app.appendChild(hero);
  app.appendChild(main);
  app.appendChild(foot);

  /* ---------- hero count ---------- */
  function renderCrown() {
    var total = state.quotes.length;
    var t = total === 0 ? '0' : toRoman(total);
    crown.textContent = '';
    crown.innerHTML = wreathSvg();
    crown.appendChild(h('span', {
      class: 'count', text: t, role: 'img',
      style: 'font-size:' + (t.length <= 3 ? '1.9rem' : t.length <= 5 ? '1.35rem' : '1rem'),
      'aria-label': total + (total === 1 ? ' entry' : ' entries')
    }));
  }

  /* ---------- list ---------- */
  function uniqueSources() {
    var seen = {};
    state.quotes.forEach(function (e) { if (e.s) seen[e.s] = true; });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); });
  }

  function renderControls() {
    var sources = uniqueSources();
    if (ui.source && sources.indexOf(ui.source) === -1) ui.source = '';
    sourceSel.textContent = '';
    sourceSel.appendChild(h('option', { value: '', text: 'All sources' }));
    sources.forEach(function (s) {
      var o = h('option', { value: s, text: s });
      if (s === ui.source) o.selected = true;
      sourceSel.appendChild(o);
    });
    sourceSel.hidden = sources.length === 0;
  }

  function visible() {
    var term = ui.search.trim().toLowerCase();
    var list = state.quotes.filter(function (e) {
      if (ui.source && e.s !== ui.source) return false;
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
    if (e.s) {
      meta.push(h('button', {
        type: 'button', class: 'link-btn source', text: e.s,
        title: 'Show only entries from this source',
        onclick: function () { ui.source = e.s; renderControls(); renderList(); }
      }));
    }
    meta.push(h('time', { class: 'when', datetime: e.t, text: fmtDate(e.t) }));
    if (ui.owner) {
      if (ui.confirmId === e.t) {
        meta.push(h('button', { type: 'button', class: 'link-btn remove danger', text: 'Confirm remove', onclick: function () { removeEntry(e.t); } }));
        meta.push(h('button', { type: 'button', class: 'link-btn', text: 'Keep', onclick: function () { ui.confirmId = null; renderList(); } }));
      } else {
        meta.push(h('button', {
          type: 'button', class: 'link-btn', text: 'Edit', 'aria-label': 'Edit entry ' + e.n,
          style: 'margin-left:auto;color:var(--muted);font-size:0.95rem',
          onclick: function () { ui.editT = e.t; ui.confirmId = null; renderList(); }
        }));
        meta.push(h('button', {
          type: 'button', class: 'link-btn remove', text: 'Remove', 'aria-label': 'Remove entry ' + e.n,
          style: 'margin-left:0',
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
    sortBtn.textContent = ui.newestFirst ? 'Newest first' : 'Oldest first';
    sortBtn.setAttribute('aria-label', 'Sort order: ' + sortBtn.textContent + '. Press to reverse.');
    listEl.textContent = '';

    if (ui.loading) { countEl.textContent = ''; listEl.style.border = '0'; listEl.appendChild(h('p', { class: 'empty', text: 'Loading the collection…' })); return; }
    if (ui.loadError) { countEl.textContent = ''; listEl.style.border = '0'; listEl.appendChild(h('p', { class: 'empty', text: 'The collection could not be loaded. Refresh the page to try again.' })); return; }

    var items = visible();
    var filtering = ui.search.trim() || ui.source;
    if (state.quotes.length === 0) {
      countEl.textContent = '';
      listEl.style.border = '0';
      listEl.appendChild(h('p', { class: 'empty', text: ui.owner ? 'The record is empty. Add your first line in the box above.' : 'Nothing is written here yet. Check back soon.' }));
      return;
    }
    listEl.style.border = '';
    countEl.textContent = filtering
      ? items.length + ' of ' + state.quotes.length + ' entries match'
      : state.quotes.length + (state.quotes.length === 1 ? ' entry' : ' entries');
    if (items.length === 0) {
      listEl.appendChild(h('p', { class: 'empty', text: 'No entries match. Try a different word or clear the source filter.' }));
      return;
    }
    items.forEach(function (e) { listEl.appendChild(entryEl(e)); });
  }

  /* ---------- admin ---------- */
  var qEl, sEl, previewEl, errEl, noticeEl, addBtn, datalistEl;

  function refreshAdminMeta() {
    if (!ui.owner || !previewEl) return;
    previewEl.textContent = 'Saved as No. ' + state.nextId + ', dated ' + fmtDate(new Date()) + '.';
    datalistEl.textContent = '';
    uniqueSources().forEach(function (s) { datalistEl.appendChild(h('option', { value: s })); });
  }

  function buildAdmin() {
    adminEl.textContent = '';
    if (!ui.owner) { adminEl.hidden = true; return; }
    adminEl.hidden = false;

    qEl = h('textarea', {
      id: 'f-quote', rows: '4', maxlength: '4000', placeholder: 'Paste or write the line here',
      onkeydown: function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') addEntry(); }
    });
    sEl = h('input', { id: 'f-source', type: 'text', list: 'f-sources', maxlength: '200', autocomplete: 'off', placeholder: 'Book, person, podcast or talk' });
    datalistEl = h('datalist', { id: 'f-sources' });
    previewEl = h('p', { class: 'preview' });
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

  function removeEntry(t) {
    if (!ui.owner || ui.busy) return;
    ui.confirmId = null;
    errEl.textContent = ''; noticeEl.textContent = '';
    setBusy(true, 'Removing…');
    mutate(function (cur) {
      return { data: { nextId: cur.nextId, quotes: cur.quotes.filter(function (e) { return e.t !== t; }) } };
    }, 'Remove entry').then(function (out) {
      state = normalize(out.data);
      noticeEl.textContent = 'Entry removed.';
      renderAll();
    }).catch(function (err) {
      errEl.textContent = explain(err);
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
    ui.token = ''; ui.owner = false; ui.showSignin = false; ui.confirmId = null;
    signinEl.textContent = '';
    buildAdmin(); renderFooter(); renderList();
  }

  function renderAll() {
    renderCrown(); renderControls(); renderList(); refreshAdminMeta();
  }

  /* ---------- start ---------- */
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
