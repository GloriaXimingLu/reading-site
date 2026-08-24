/* Reading-tracker annotations: hearts on the index, highlight+comment on
 * article pages. All state lives in localStorage (rt:* keys) — no backend.
 * Export/import moves state between devices. */
(function () {
  'use strict';
  let LS;
  try { LS = window.localStorage; LS.getItem('rt:probe'); } catch (e) { return; }

  const HEARTS_KEY = 'rt:hearts';
  const getJSON = (k, d) => { try { return JSON.parse(LS.getItem(k)) || d; } catch (e) { return d; } };
  const setJSON = (k, v) => LS.setItem(k, JSON.stringify(v));
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  /* ---------------- hearts (index page) ---------------- */

  function initHearts() {
    const cards = document.querySelectorAll('.card[data-key]');
    if (!cards.length) return false;
    const favBox = el('section');
    favBox.id = 'favorites';
    const nav = document.querySelector('nav');
    if (nav) nav.parentNode.insertBefore(favBox, nav.nextSibling);

    function renderFavs() {
      const hs = getJSON(HEARTS_KEY, {});
      const hearted = [...document.querySelectorAll('.card[data-key]')]
        .filter(c => hs[c.dataset.key])
        .sort((a, b) => hs[b.dataset.key] - hs[a.dataset.key]);
      favBox.innerHTML = '';
      if (!hearted.length) { favBox.style.display = 'none'; return; }
      favBox.style.display = '';
      favBox.appendChild(el('h2', null, '❤ Favorites'));
      hearted.forEach(c => {
        const row = el('p', 'latest-row');
        const a = el('a', null, (c.querySelector('.title') || {}).textContent || c.dataset.key);
        a.href = '#' + c.id;
        row.appendChild(el('span', null, '❤ '));
        row.appendChild(a);
        const tut = c.querySelector('a.tut');
        if (tut) {
          row.appendChild(document.createTextNode(' · '));
          const t = el('a', null, '📖 tutorial');
          t.href = tut.getAttribute('href');
          row.appendChild(t);
        }
        favBox.appendChild(row);
      });
    }

    const hearts = getJSON(HEARTS_KEY, {});
    let idx = 0;
    cards.forEach(card => {
      const key = card.dataset.key;
      card.id = card.id || ('card-' + (idx++) + '-' + key.replace(/[^a-zA-Z0-9_-]/g, ''));
      const btn = el('button', 'heart-btn');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'favorite this paper');
      const sync = () => {
        const on = !!hearts[key];
        btn.textContent = on ? '❤' : '♡';
        btn.classList.toggle('hearted', on);
        card.classList.toggle('hearted-card', on);
      };
      btn.addEventListener('click', () => {
        if (hearts[key]) delete hearts[key]; else hearts[key] = Date.now();
        setJSON(HEARTS_KEY, hearts);
        sync();
        renderFavs();
      });
      sync();
      (card.querySelector('.card-head') || card).appendChild(btn);
    });
    renderFavs();
    return true;
  }

  /* ---------------- annotations (article pages) ---------------- */

  function initAnnotations() {
    const article = document.querySelector('article');
    if (!article) return false;
    // Key on the last two path segments ("tutorials/foo.html") rather than the
    // full path, so the same page keys identically whether served from the
    // deploy root, a project subpath, or a local preview — otherwise a synced
    // annotation would not find its page. Migrate any full-path key once.
    const KEY = 'rt:ann:' + location.pathname.split('/').filter(Boolean).slice(-2).join('/');
    const LEGACY_KEY = 'rt:ann:' + location.pathname;
    if (LEGACY_KEY !== KEY && LS.getItem(LEGACY_KEY) && !LS.getItem(KEY)) {
      LS.setItem(KEY, LS.getItem(LEGACY_KEY));
      LS.removeItem(LEGACY_KEY);
    }

    const load = () => getJSON(KEY, []);
    const save = anns => setJSON(KEY, anns);

    function textNodes() {
      const out = [];
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const p = n.parentElement;
          if (!p || p.closest('script, style, .ann-ui')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let n;
      while ((n = walker.nextNode())) out.push(n);
      return out;
    }

    function fullTextAndOffsets() {
      const nodes = textNodes();
      let text = '', offsets = [];
      for (const n of nodes) { offsets.push(text.length); text += n.data; }
      return { nodes, offsets, text };
    }

    function globalOffset(node, offset, ctx) {
      const i = ctx.nodes.indexOf(node);
      return i < 0 ? -1 : ctx.offsets[i] + offset;
    }

    function locate(ann, ctx) {
      let start = -1;
      if (ann.prefix || ann.suffix) {
        const probe = (ann.prefix || '') + ann.exact + (ann.suffix || '');
        const i = ctx.text.indexOf(probe);
        if (i >= 0) start = i + (ann.prefix || '').length;
      }
      if (start < 0) start = ctx.text.indexOf(ann.exact);
      return start < 0 ? null : [start, start + ann.exact.length];
    }

    function wrap(startG, endG, ann) {
      // Re-walk nodes each call: previous wraps change the node list.
      const ctx = fullTextAndOffsets();
      const segments = [];
      for (let i = 0; i < ctx.nodes.length; i++) {
        const nStart = ctx.offsets[i], nEnd = nStart + ctx.nodes[i].data.length;
        const s = Math.max(startG, nStart), e = Math.min(endG, nEnd);
        if (s < e) segments.push({ node: ctx.nodes[i], from: s - nStart, to: e - nStart });
      }
      for (const seg of segments) {
        let node = seg.node;
        if (node.parentElement.closest('mjx-container')) continue; // don't disturb MathJax internals
        if (seg.to < node.data.length) node.splitText(seg.to);
        if (seg.from > 0) node = node.splitText(seg.from);
        const mark = el('mark', 'ann' + (ann.note ? ' ann-note' : ''));
        mark.dataset.annId = ann.id;
        node.parentNode.insertBefore(mark, node);
        mark.appendChild(node);
      }
    }

    function applyAll() {
      document.querySelectorAll('mark.ann').forEach(m => {
        const parent = m.parentNode;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
        parent.normalize();
      });
      const anns = load();
      for (const ann of anns) {
        const ctx = fullTextAndOffsets();
        const span = locate(ann, ctx);
        ann._orphan = !span;
        if (span) wrap(span[0], span[1], ann);
      }
      updateBadge(anns);
      return anns;
    }

    /* ---- UI: toolbar on selection ---- */
    const toolbar = el('div', 'ann-toolbar ann-ui');
    const hlBtn = el('button', null, '🖍 Highlight');
    const cmBtn = el('button', null, '💬 Comment');
    toolbar.append(hlBtn, cmBtn);
    toolbar.style.display = 'none';
    document.body.appendChild(toolbar);

    let pendingRange = null;
    let dragging = false;
    let selTimer = null;

    function hideToolbar() { toolbar.style.display = 'none'; pendingRange = null; }

    // On touch devices the OS draws its own selection callout ("Copy / Look
    // Up") next to the selection, which overlaps or hides a floating toolbar.
    // Pin ours to the bottom of the viewport instead: always the same place,
    // never in a fight with the native UI, and a large tap target.
    const coarsePointer = window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;

    function placeToolbar(rect) {
      toolbar.style.display = 'flex';
      if (coarsePointer) {
        toolbar.classList.add('ann-toolbar-docked');
        toolbar.style.top = toolbar.style.left = '';
        return;
      }
      toolbar.style.visibility = 'hidden';   // measure before positioning
      const tw = toolbar.offsetWidth, th = toolbar.offsetHeight;
      const margin = 8;
      // Prefer above the selection; flip below when there is no room (or when a
      // touch UI is likely occupying that space with its own selection callout).
      let top = rect.top - th - 10;
      if (top < margin) top = rect.bottom + 12;
      const maxTop = window.innerHeight - th - margin;
      top = Math.min(Math.max(top, margin), Math.max(margin, maxTop));
      let left = rect.left + rect.width / 2 - tw / 2;
      left = Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - tw - margin));
      toolbar.style.top = (window.scrollY + top) + 'px';
      toolbar.style.left = (window.scrollX + left) + 'px';
      toolbar.style.visibility = '';
    }

    function syncToolbar() {
      if (dragging) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { hideToolbar(); return; }
      const range = sel.getRangeAt(0);
      if (!article.contains(range.commonAncestorContainer)) { hideToolbar(); return; }
      if (!range.toString().trim()) { hideToolbar(); return; }
      pendingRange = range.cloneRange();
      placeToolbar(range.getBoundingClientRect());
    }

    // Never let a later request postpone an earlier one. selectionchange fires
    // asynchronously, so on desktop it lands just *after* mouseup — without
    // this, its longer settle delay would cancel mouseup's immediate sync and
    // the toolbar would lag ~350ms behind the mouse release.
    let selDeadline = Infinity;
    function scheduleSync(delay) {
      const when = Date.now() + delay;
      if (selTimer !== null && selDeadline <= when) return;
      clearTimeout(selTimer);
      selDeadline = when;
      selTimer = setTimeout(() => { selTimer = null; selDeadline = Infinity; syncToolbar(); }, delay);
    }

    // Touch devices do not fire mouseup for text selection, and iOS/Android
    // adjust the range after the finger lifts (drag handles, word snapping) —
    // so selectionchange is the primary signal, with a delay long enough to
    // settle. Mouse events stay as the fast path on desktop.
    document.addEventListener('selectionchange', () => scheduleSync(dragging ? 0 : 320));

    // `dragging` suppresses the toolbar mid-drag. It must only ever be set by a
    // real mouse: iOS emits a synthetic mousedown on long-press with no
    // matching mouseup, which would latch this true and hide the toolbar
    // forever. Pointer events give us the input type; touch clears it outright.
    function endDrag() { dragging = false; }
    document.addEventListener('pointerdown', e => {
      if (e.pointerType && e.pointerType !== 'mouse') { dragging = false; return; }
      if (e.target instanceof Element && e.target.closest('.ann-ui')) return;
      dragging = true;
    }, true);
    document.addEventListener('pointerup', endDrag, true);
    document.addEventListener('pointercancel', endDrag, true);
    document.addEventListener('touchstart', endDrag, { passive: true, capture: true });
    document.addEventListener('mouseup', e => {
      dragging = false;
      if (e.target instanceof Element && e.target.closest('.ann-ui')) return;
      scheduleSync(0);
    });
    document.addEventListener('touchend', e => {
      dragging = false;
      if (e.target instanceof Element && e.target.closest('.ann-ui')) return;
      scheduleSync(280);
    }, { passive: true });
    // Belt and braces: if a selection exists but nothing has shown the toolbar
    // (an event sequence we did not anticipate), recover within a second.
    setInterval(() => {
      if (toolbar.style.display === 'none' && !dragging) {
        const s = window.getSelection();
        if (s && !s.isCollapsed && s.rangeCount &&
            article.contains(s.getRangeAt(0).commonAncestorContainer) &&
            s.toString().trim()) syncToolbar();
      }
    }, 1000);
    window.addEventListener('resize', () => scheduleSync(150));

    function annFromRange(range) {
      const ctx = fullTextAndOffsets();
      const s = globalOffset(range.startContainer, range.startOffset, ctx);
      const e = globalOffset(range.endContainer, range.endOffset, ctx);
      if (s < 0 || e < 0 || e <= s) return null;
      return {
        id: 'a' + Date.now() + Math.floor(Math.random() * 1e4),
        exact: ctx.text.slice(s, e),
        prefix: ctx.text.slice(Math.max(0, s - 40), s),
        suffix: ctx.text.slice(e, e + 40),
        note: '',
        ts: new Date().toISOString(),
      };
    }

    function addAnnotation(withNote) {
      const range = pendingRange || lockedRange;
      if (!range) return;
      const ann = annFromRange(range);
      lockedRange = null;
      hideToolbar();
      window.getSelection().removeAllRanges();
      if (!ann) return;
      const anns = load();
      anns.push(ann);
      save(anns);
      applyAll();
      if (withNote) openPopover(ann.id);
    }
    // Touching a button clears the document selection before 'click' fires, and
    // the resulting selectionchange would null pendingRange. Snapshot the range
    // as the press begins so the tap still has something to act on. (Not
    // preventDefault on touchstart — that suppresses the click on iOS.)
    let lockedRange = null;
    [hlBtn, cmBtn].forEach(btn => {
      const lock = () => { if (pendingRange) lockedRange = pendingRange.cloneRange(); };
      btn.addEventListener('pointerdown', lock);
      btn.addEventListener('touchstart', lock, { passive: true });
      btn.addEventListener('mousedown', ev => ev.preventDefault());
    });
    hlBtn.addEventListener('click', () => addAnnotation(false));
    cmBtn.addEventListener('click', () => addAnnotation(true));

    /* ---- popover for viewing/editing a note ---- */
    const pop = el('div', 'ann-popover ann-ui');
    pop.style.display = 'none';
    const popQuote = el('p', 'ann-quote');
    const popText = document.createElement('textarea');
    popText.placeholder = 'Add a note…';
    const popSave = el('button', 'primary', 'Save');
    const popDel = el('button', null, 'Delete');
    const popClose = el('button', null, 'Close');
    const popBtns = el('div', 'ann-popover-btns');
    popBtns.append(popSave, popDel, popClose);
    pop.append(popQuote, popText, popBtns);
    document.body.appendChild(pop);
    let popTarget = null;

    function openPopover(annId, nearEl) {
      const anns = load();
      const ann = anns.find(a => a.id === annId);
      if (!ann) return;
      popTarget = annId;
      popQuote.textContent = '“' + ann.exact.slice(0, 160) + (ann.exact.length > 160 ? '…' : '') + '”';
      popText.value = ann.note || '';
      pop.style.display = 'block';
      const anchor = nearEl || document.querySelector('mark[data-ann-id="' + annId + '"]');
      const r = anchor ? anchor.getBoundingClientRect() : { top: 80, bottom: 100, left: 12 };
      const margin = 8;
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let top = r.bottom + 8;
      if (top + ph > window.innerHeight - margin) {
        // no room below: try above, else pin inside the viewport
        top = r.top - ph - 8;
        if (top < margin) top = Math.max(margin, window.innerHeight - ph - margin);
      }
      const left = Math.min(Math.max(r.left, margin), Math.max(margin, window.innerWidth - pw - margin));
      pop.style.top = (window.scrollY + top) + 'px';
      pop.style.left = (window.scrollX + left) + 'px';
      // Focusing immediately on touch pops the keyboard over the popover before
      // it is positioned; let layout settle first.
      setTimeout(() => popText.focus({ preventScroll: true }), 50);
    }
    function closePopover() { pop.style.display = 'none'; popTarget = null; }

    popSave.addEventListener('click', () => {
      const anns = load();
      const ann = anns.find(a => a.id === popTarget);
      if (ann) { ann.note = popText.value.trim(); save(anns); applyAll(); }
      closePopover();
    });
    popDel.addEventListener('click', () => {
      save(load().filter(a => a.id !== popTarget));
      applyAll();
      closePopover();
    });
    popClose.addEventListener('click', closePopover);

    document.addEventListener('click', e => {
      if (!(e.target instanceof Element)) return;
      const mark = e.target.closest('mark.ann');
      if (mark) { openPopover(mark.dataset.annId, mark); return; }
      if (!e.target.closest('.ann-ui')) closePopover();
    });

    /* ---- side panel ---- */
    const fab = el('button', 'ann-fab ann-ui', '✎');
    document.body.appendChild(fab);
    const panel = el('div', 'ann-panel ann-ui');
    panel.style.display = 'none';
    document.body.appendChild(panel);

    function updateBadge(anns) {
      fab.textContent = anns.length ? `✎ ${anns.length}` : '✎';
    }

    function renderPanel() {
      const anns = load();
      panel.innerHTML = '';
      panel.appendChild(el('h3', null, 'Annotations on this page'));
      if (!anns.length) panel.appendChild(el('p', 'ann-empty', 'Select text to highlight or comment.'));
      anns.forEach(ann => {
        const row = el('div', 'ann-row' + (ann._orphan ? ' orphan' : ''));
        row.appendChild(el('p', 'ann-quote', '“' + ann.exact.slice(0, 90) + (ann.exact.length > 90 ? '…' : '') + '”' + (ann._orphan ? ' (text changed — not shown)' : '')));
        if (ann.note) row.appendChild(el('p', 'ann-note-text', ann.note));
        row.addEventListener('click', () => {
          const mark = document.querySelector('mark[data-ann-id="' + ann.id + '"]');
          if (mark) { mark.scrollIntoView({ behavior: 'smooth', block: 'center' }); openPopover(ann.id, mark); }
        });
        panel.appendChild(row);
      });
      panel.appendChild(buildTransferRow());
    }
    fab.addEventListener('click', () => {
      const show = panel.style.display === 'none';
      if (show) renderPanel();
      panel.style.display = show ? 'block' : 'none';
    });

    applyAll();
    return true;
  }

  /* ---------------- export / import (all rt:* state) ---------------- */

  /* ---- cross-device transfer via URL fragment ----
   * localStorage is per-browser, so laptop notes never reach a phone. The
   * fragment (#...) is never transmitted to the server, so a sync link carries
   * annotations between your own devices without publishing them on the public
   * site. */
  const SYNC_PREFIX = '#rtsync=';

  function encodeState() {
    const dump = {};
    for (let i = 0; i < LS.length; i++) {
      const k = LS.key(i);
      if (k && k.startsWith('rt:')) dump[k] = getJSON(k, null);
    }
    const json = JSON.stringify(dump);
    // base64url of UTF-8 bytes
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function mergeDump(dump) {
    let added = 0;
    for (const [k, v] of Object.entries(dump || {})) {
      if (!k.startsWith('rt:')) continue;
      if (k === HEARTS_KEY) {
        const cur = getJSON(k, {});
        for (const [id, ts] of Object.entries(v || {})) if (!cur[id]) { cur[id] = ts; added++; }
        setJSON(k, cur);
      } else if (Array.isArray(v)) {
        const cur = getJSON(k, []);
        const ids = new Set(cur.map(a => a && a.id));
        const fresh = v.filter(a => a && !ids.has(a.id));
        added += fresh.length;
        setJSON(k, cur.concat(fresh));
      }
    }
    return added;
  }

  function flashSynced(added) {
    const note = el('div', 'ann-flash', Number(added)
      ? `Synced ${added} item${Number(added) === 1 ? '' : 's'} to this device.`
      : 'Already up to date on this device.');
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 4000);
  }

  function consumeSyncLink(viaHashChange) {
    try {
      const pending = sessionStorage.getItem('rt:synced');
      if (pending !== null) { sessionStorage.removeItem('rt:synced'); flashSynced(pending); }
    } catch (e) {}
    const h = location.hash || '';
    if (!h.startsWith(SYNC_PREFIX)) return;
    try {
      const b64 = h.slice(SYNC_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      const added = mergeDump(JSON.parse(new TextDecoder().decode(bytes)));
      history.replaceState(null, '', location.pathname + location.search);
      if (viaHashChange) {
        // Adding only a #fragment is a same-document navigation, so nothing
        // re-renders. Reload (the payload is already stripped) to draw the
        // imported annotations, carrying the confirmation across.
        try { sessionStorage.setItem('rt:synced', String(added)); } catch (e) {}
        location.reload();
        return;
      }
      flashSynced(added);
    } catch (e) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function buildTransferRow() {
    const row = el('div', 'ann-transfer');
    const sync = el('button', 'primary', '⇄ Send to my other device');
    sync.title = 'Share a private link carrying these annotations. The data rides in the URL fragment, so it never reaches a server.';
    sync.addEventListener('click', () => {
      const url = location.origin + location.pathname + SYNC_PREFIX + encodeState();
      const label = sync.textContent;
      const done = txt => { sync.textContent = txt; setTimeout(() => { sync.textContent = label; }, 2500); };
      // On a phone the share sheet is the natural route (AirDrop, Messages,
      // Notes); on a laptop fall back to the clipboard.
      if (navigator.share) {
        navigator.share({ title: 'Reading annotations', url })
          .then(() => done('✓ Sent'))
          .catch(() => { /* user dismissed the sheet */ });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => done('✓ Link copied'),
          () => window.prompt('Copy this link:', url));
      } else {
        window.prompt('Copy this link:', url);
      }
    });
    row.appendChild(sync);

    const paste = el('button', null, '⇤ Receive');
    paste.title = 'Paste a sync link sent from another device';
    paste.addEventListener('click', () => {
      const pasted = window.prompt('Paste the sync link from your other device:');
      if (!pasted) return;
      const i = pasted.indexOf(SYNC_PREFIX);
      if (i < 0) { alert('That does not look like a sync link.'); return; }
      location.hash = pasted.slice(i);   // hashchange handler imports and reloads
    });
    row.appendChild(paste);
    const exp = el('button', null, '⇩ Export all');
    exp.addEventListener('click', () => {
      const dump = {};
      for (let i = 0; i < LS.length; i++) {
        const k = LS.key(i);
        if (k && k.startsWith('rt:')) dump[k] = getJSON(k, null);
      }
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const a = el('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'reading-annotations.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    const impLabel = el('label', 'ann-import', '⇧ Import');
    const impInput = document.createElement('input');
    impInput.type = 'file';
    impInput.accept = 'application/json';
    impInput.style.display = 'none';
    impLabel.appendChild(impInput);
    impInput.addEventListener('change', () => {
      const f = impInput.files && impInput.files[0];
      if (!f) return;
      f.text().then(txt => {
        const dump = JSON.parse(txt);
        for (const [k, v] of Object.entries(dump)) {
          if (!k.startsWith('rt:')) continue;
          if (k === HEARTS_KEY) setJSON(k, Object.assign(getJSON(k, {}), v));
          else if (Array.isArray(v)) {
            const cur = getJSON(k, []);
            const ids = new Set(cur.map(a => a.id));
            setJSON(k, cur.concat(v.filter(a => a && !ids.has(a.id))));
          } else setJSON(k, v);
        }
        location.reload();
      }).catch(() => alert('Could not read that file.'));
    });
    row.append(exp, impLabel);
    return row;
  }

  function initIndexPanel() {
    // On the index, the ✎ button offers export/import (hearts live here).
    if (!document.querySelector('.card[data-key]')) return;
    const fab = el('button', 'ann-fab ann-ui', '✎');
    document.body.appendChild(fab);
    const panel = el('div', 'ann-panel ann-ui');
    panel.style.display = 'none';
    panel.appendChild(el('h3', null, 'Your reading data'));
    panel.appendChild(el('p', 'ann-empty', 'Hearts and page annotations are stored in this browser. Export to back up or move devices.'));
    panel.appendChild(buildTransferRow());
    document.body.appendChild(panel);
    fab.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
  }

  window.addEventListener('hashchange', () => consumeSyncLink(true));

  function init() {
    consumeSyncLink(false);     // must precede rendering so merged items show
    const isIndex = initHearts();
    const isArticle = initAnnotations();
    if (isIndex && !isArticle) initIndexPanel();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
