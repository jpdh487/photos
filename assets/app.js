/* Galerie publique : accueil, albums, visionneuse et notes. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => String(n).replace('.', ',');
  const plural = (n, word) => n + ' ' + word + (n > 1 ? 's' : '');
  const albumHash = (a) => '#/album/' + encodeURIComponent(a.id);
  const photoHash = (a, p) => albumHash(a) + '/' + encodeURIComponent(p.id);

  const ICON = {
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8l2.83 5.73 6.32.92-4.57 4.46 1.08 6.3L12 17.24 6.34 20.2l1.08-6.3L2.85 9.45l6.32-.92z"/></svg>',
  };

  const state = { data: null, view: '', album: null, sort: 'album', scroll: {}, lastHash: '', pendingRefresh: false };

  /* ───────── Petits utilitaires ───────── */

  let toastTimer;
  function toast(message, isError) {
    const t = $('toast');
    t.textContent = message;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); }, 2800);
  }

  function imgTag(p, width, eager, alt) {
    const fb = API.imgFallback(p, width);
    return '<img src="' + esc(API.img(p, width)) + '"' + (fb ? ' data-fb="' + esc(fb) + '"' : '')
      + ' alt="' + esc(alt) + '" loading="' + (eager ? 'eager' : 'lazy') + '" decoding="async">';
  }

  // Images déjà en mémoire : on les affiche tout de suite, sans fondu.
  function markLoaded(root) {
    root.querySelectorAll('img').forEach((img) => { if (img.complete && img.naturalWidth) img.classList.add('loaded'); });
  }

  document.addEventListener('load', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    img.classList.add('loaded');
    fixAspect(img);
  }, true);

  // Si Google Drive refuse une adresse d'image, on essaie l'autre.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.fb) return;
    const fb = img.dataset.fb;
    delete img.dataset.fb;
    img.src = fb;
  }, true);

  // Corrige la mise en page si les vraies proportions d'une photo diffèrent de celles annoncées.
  function fixAspect(img) {
    const tile = img.parentElement;
    if (!tile || !tile.classList.contains('tile') || !img.naturalWidth || !state.album) return;
    const real = img.naturalWidth / img.naturalHeight;
    const current = parseFloat(tile.style.getPropertyValue('--ar')) || 1.5;
    if (Math.abs(real - current) / current < 0.03) return;
    tile.style.setProperty('--ar', real.toFixed(4));
    const p = state.album.photos.find((x) => x.id === tile.dataset.id);
    if (p) { p.w = img.naturalWidth; p.h = img.naturalHeight; }
  }

  function albumMeta(a) {
    return [a.date, plural(a.photos.length, 'photo')].filter(Boolean).join(' · ');
  }

  function sortedPhotos(album) {
    if (state.sort !== 'top') return album.photos;
    return album.photos.slice().sort((a, b) => (b.r || 0) - (a.r || 0) || (b.n || 0) - (a.n || 0));
  }

  function footer() {
    return '<footer class="footer wrap"><span>© ' + new Date().getFullYear() + ' · ' + esc(state.data.settings.title) + '</span>'
      + '<a href="admin.html">Espace gestion</a></footer>';
  }

  /* ───────── Navigation ───────── */

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    return parts[0] === 'album' ? { album: parts[1], photo: parts[2] } : {};
  }

  function route(force) {
    if (!state.data) return;
    const previous = state.lastHash;
    state.lastHash = location.hash;
    const r = parseHash();

    if (r.album) {
      const album = state.data.albums.find((a) => a.id === r.album);
      if (!album) return showView('missing', renderMissing, force);
      showView('album:' + album.id, () => renderAlbum(album), force);
      if (r.photo) Lightbox.open(album, r.photo, previous === albumHash(album));
      else Lightbox.hide();
    } else {
      Lightbox.hide();
      showView('home', renderHome, force);
    }
  }

  function showView(key, render, force) {
    const same = state.view === key;
    if (same && !force) return;
    const y = window.scrollY;
    if (state.view && !same) state.scroll[state.view] = y;
    state.view = key;
    render();
    markLoaded(app);
    window.scrollTo(0, same ? y : (key === 'home' ? state.scroll.home || 0 : 0));
  }

  /* ───────── Pages ───────── */

  function renderHome() {
    const s = state.data.settings;
    const albums = state.data.albums;
    state.album = null;
    document.title = s.title;
    app.innerHTML =
      '<header class="hero wrap fade">'
      + '<h1>' + esc(s.title) + '</h1>'
      + (s.subtitle ? '<p class="eyebrow">' + esc(s.subtitle) + '</p>' : '')
      + '<div class="ornament"></div>'
      + (s.intro ? '<p class="intro">' + esc(s.intro) + '</p>' : '')
      + '</header>'
      + '<main class="wrap">'
      + (albums.length
        ? '<div class="albums">' + albums.map(albumCard).join('') + '</div>'
        : '<p class="empty">Les premiers albums arrivent bientôt.</p>')
      + '</main>'
      + footer();
  }

  function albumCard(a, i) {
    const cover = a.photos.find((p) => p.id === a.cover) || a.photos[0];
    return '<a class="album-card fade" style="--d:' + Math.min(i, 8) * 70 + 'ms" href="' + albumHash(a) + '">'
      + '<div class="cover">' + (cover ? imgTag(cover, 520 * dpr, i < 6, a.title) : '') + '</div>'
      + '<h2>' + esc(a.title) + '</h2>'
      + '<p class="eyebrow">' + esc(albumMeta(a)) + '</p>'
      + '</a>';
  }

  function renderAlbum(album) {
    const s = state.data.settings;
    const rated = album.photos.some((p) => p.n);
    const folder = API.folderUrl(album.id);
    state.album = album;
    if (!rated) state.sort = 'album';
    document.title = album.title + ' · ' + s.title;
    app.innerHTML =
      '<div class="wrap">'
      + '<nav class="topbar"><a class="brand" href="#/">' + esc(s.title) + '</a><a class="back" href="#/">← Tous les albums</a></nav>'
      + '<header class="album-head fade">'
      + '<p class="eyebrow">' + esc(albumMeta(album)) + '</p>'
      + '<h1>' + esc(album.title) + '</h1>'
      + (album.description ? '<p class="desc">' + esc(album.description) + '</p>' : '')
      + '</header>'
      + '<div class="toolbar fade" style="--d:120ms">'
      + (rated
        ? '<div class="seg" role="group" aria-label="Ordre des photos">'
          + '<button type="button" data-sort="album" aria-pressed="' + (state.sort === 'album') + '">Ordre de l\'album</button>'
          + '<button type="button" data-sort="top" aria-pressed="' + (state.sort === 'top') + '">Les mieux notées</button></div>'
        : '<span></span>')
      + (folder ? '<a class="link-btn" href="' + esc(folder) + '" target="_blank" rel="noopener">' + ICON.download + 'Télécharger tout l\'album</a>' : '')
      + '</div>'
      + '<div class="jgrid" id="grid">' + gridHTML(album) + '</div>'
      + '</div>'
      + footer();
  }

  function gridHTML(album) {
    return sortedPhotos(album).map((p, i) => {
      const ar = p.w && p.h ? p.w / p.h : 1.5;
      return '<a class="tile" href="' + photoHash(album, p) + '" data-id="' + esc(p.id) + '" style="--ar:' + ar.toFixed(4) + '">'
        + imgTag(p, ar * 380 * dpr, i < 8, p.caption || 'Photo ' + (i + 1) + ' — ' + album.title)
        + (p.n ? '<span class="badge">★ ' + fmt(p.r) + '</span>' : '')
        + '</a>';
    }).join('');
  }

  function renderMissing() {
    state.album = null;
    app.innerHTML = '<div class="state"><p class="serif">Cet album n\'existe plus.</p><a class="btn" href="#/">Voir tous les albums</a></div>';
  }

  function renderError(err) {
    app.innerHTML = '<div class="state"><p class="serif">Les photos n\'ont pas pu être chargées.</p>'
      + '<p class="muted">' + esc(err.message) + '</p>'
      + '<button class="btn" type="button" onclick="location.reload()">Réessayer</button></div>';
  }

  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b || !state.album) return;
    state.sort = b.dataset.sort;
    app.querySelectorAll('[data-sort]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('grid').innerHTML = gridHTML(state.album);
    markLoaded($('grid'));
  });

  /* ───────── Visionneuse ───────── */

  const Lightbox = (function () {
    const el = $('lb');
    const stage = $('lb-stage');
    const frame = $('lb-frame');
    const lo = $('lb-lo');
    const hi = $('lb-hi');
    const starsEl = $('lb-stars');
    let album = null;
    let list = [];
    let index = 0;
    let isOpen = false;
    let fromGrid = false;
    let lastFocus = null;

    function open(a, photoId, cameFromGrid) {
      const l = sortedPhotos(a);
      const i = l.findIndex((p) => p.id === photoId);
      if (i < 0) {
        history.replaceState(null, '', albumHash(a));
        state.lastHash = location.hash;
        return hide();
      }
      album = a;
      list = l;
      if (!isOpen) {
        isOpen = true;
        fromGrid = cameFromGrid;
        lastFocus = document.activeElement;
        el.hidden = false;
        document.documentElement.classList.add('lb-lock');
        void el.offsetWidth; // force le navigateur à afficher l'état initial avant le fondu
        el.classList.add('open');
        $('lb-close').focus({ preventScroll: true });
      }
      show(i);
    }

    function show(i) {
      index = i;
      const p = list[i];
      $('lb-count').textContent = (i + 1) + ' / ' + list.length;
      $('lb-prev').disabled = i === 0;
      $('lb-next').disabled = i === list.length - 1;
      $('lb-caption').textContent = p.caption || '';
      $('lb-dl').href = API.download(p);
      renderStars(p);

      // D'abord la miniature déjà chargée (instantané), puis la version haute définition par-dessus.
      const tileImg = app.querySelector('.tile[data-id="' + CSS.escape(p.id) + '"] img');
      hi.classList.remove('loaded');
      hi.removeAttribute('src');
      lo.onload = () => { if (list[index] === p && !(p.w && p.h)) layout(); };
      lo.src = tileImg && tileImg.classList.contains('loaded') ? tileImg.currentSrc : API.img(p, 600);
      layout();
      const width = (parseFloat(frame.style.width) || 1200) * dpr;
      hi.dataset.fb = API.imgFallback(p, width);
      hi.alt = p.caption || '';
      hi.src = API.img(p, width);

      [list[i - 1], list[i + 1]].forEach((n) => { if (n) new Image().src = API.img(n, width); });
    }

    function layout() {
      if (!isOpen || !list[index]) return;
      const p = list[index];
      const ar = p.w && p.h ? p.w / p.h : (lo.naturalWidth ? lo.naturalWidth / lo.naturalHeight : 1.5);
      const cs = getComputedStyle(stage);
      const W = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const H = stage.clientHeight;
      const w = Math.max(50, Math.min(W, H * ar));
      frame.style.width = Math.round(w) + 'px';
      frame.style.height = Math.round(w / ar) + 'px';
    }

    function go(delta) {
      const i = index + delta;
      if (!isOpen || i < 0 || i >= list.length) return;
      history.replaceState(null, '', photoHash(album, list[i]));
      state.lastHash = location.hash;
      show(i);
    }

    function close() {
      if (!isOpen) return;
      if (fromGrid) {
        history.back();
      } else {
        history.replaceState(null, '', albumHash(album));
        route();
      }
    }

    function hide() {
      if (!isOpen) return;
      isOpen = false;
      el.classList.remove('open');
      document.documentElement.classList.remove('lb-lock');
      setTimeout(() => {
        if (isOpen) return;
        el.hidden = true;
        lo.removeAttribute('src');
        hi.removeAttribute('src');
      }, 260);
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
      const tile = list[index] && app.querySelector('.tile[data-id="' + CSS.escape(list[index].id) + '"]');
      if (tile) {
        const r = tile.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) tile.scrollIntoView({ block: 'center' });
      }
      if (state.pendingRefresh) {
        state.pendingRefresh = false;
        setTimeout(() => route(true), 0);
      }
    }

    function renderStars(p) {
      const mine = API.myRating(p.id);
      starsEl.classList.remove('preview');
      starsEl.innerHTML = [1, 2, 3, 4, 5].map((n) =>
        '<button type="button" data-n="' + n + '" class="' + (n <= mine ? 'on' : '') + '" aria-pressed="' + (n === mine) + '"'
        + ' aria-label="' + n + ' étoile' + (n > 1 ? 's' : '') + '" title="' + (n === mine ? 'Retirer ma note' : n + ' / 5') + '">' + ICON.star + '</button>'
      ).join('');
      $('lb-score').textContent = p.n
        ? fmt(p.r) + ' / 5 · ' + plural(p.n, 'vote')
        : 'Notez cette photo';
    }

    function updateBadge(p) {
      const tile = app.querySelector('.tile[data-id="' + CSS.escape(p.id) + '"]');
      if (!tile) return;
      let badge = tile.querySelector('.badge');
      if (!p.n) { if (badge) badge.remove(); return; }
      if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; tile.appendChild(badge); }
      badge.textContent = '★ ' + fmt(p.r);
    }

    starsEl.addEventListener('mouseover', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      starsEl.classList.add('preview');
      starsEl.querySelectorAll('button').forEach((x) => x.classList.toggle('hover', +x.dataset.n <= +b.dataset.n));
    });
    starsEl.addEventListener('mouseleave', () => starsEl.classList.remove('preview'));

    starsEl.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const p = list[index];
      const stars = +b.dataset.n === API.myRating(p.id) ? 0 : +b.dataset.n;
      starsEl.classList.remove('preview');
      starsEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', +x.dataset.n <= stars));
      try {
        const r = await API.rate(p.id, stars);
        if (r.n) { p.r = r.r; p.n = r.n; } else { delete p.r; delete p.n; }
        API.saveCache(state.data);
        if (list[index] === p) renderStars(p);
        updateBadge(p);
        toast(stars ? 'Merci pour votre note !' : 'Votre note a été retirée.');
      } catch (err) {
        if (list[index] === p) renderStars(p);
        toast(err.message, true);
      }
    });

    $('lb-close').addEventListener('click', close);
    $('lb-prev').addEventListener('click', () => go(-1));
    $('lb-next').addEventListener('click', () => go(1));
    stage.addEventListener('click', (e) => { if (e.target === stage) close(); });

    document.addEventListener('keydown', (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    });

    // Sur téléphone : glisser à gauche/droite pour changer de photo, vers le bas pour fermer.
    let sx = null;
    let sy = 0;
    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } else sx = null;
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      else if (dy > 90 && dy > Math.abs(dx) * 1.5) close();
    }, { passive: true });

    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 80); });

    return { open: open, hide: hide, isOpen: () => isOpen };
  })();

  /* ───────── Démarrage ───────── */

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', () => route());
  if (API.demo) document.body.insertAdjacentHTML('beforeend', '<div class="demo-flag">Mode démonstration</div>');

  // Affichage immédiat avec la dernière version connue, puis mise à jour silencieuse.
  const cached = API.cachedData();
  const cachedJson = JSON.stringify(cached);
  if (cached) {
    state.data = cached;
    route();
  }
  API.loadData().then((data) => {
    const changed = JSON.stringify(data) !== cachedJson;
    state.data = data;
    if (!cached) return route();
    if (!changed) return;
    if (Lightbox.isOpen()) state.pendingRefresh = true;
    else route(true);
  }).catch((err) => {
    if (!state.data) renderError(err);
    else console.warn(err);
  });
})();
