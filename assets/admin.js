/* Espace de gestion : albums, envoi de photos, légendes, ordre, réglages. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const root = $('root');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => String(n).replace('.', ',');
  const plural = (n, one, many) => n + ' ' + (n > 1 ? (many || one + 's') : one);
  const MAX_BYTES = 30 * 1024 * 1024;
  const SITE_URL = new URL('./', location.href).href;

  const ICON = {
    handle: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/></svg>',
  };

  const state = { data: null, uploading: 0 };
  let view = null;

  /* ───────── Utilitaires ───────── */

  let toastTimer;
  function toast(message, isError) {
    const t = $('toast');
    t.textContent = message;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); }, isError ? 5000 : 2800);
  }

  function fail(err) {
    if (err && err.auth) {
      API.logout();
      return renderLogin(err.message);
    }
    toast((err && err.message) || 'Une erreur est survenue.', true);
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  function thumb(p, width) {
    if (p._preview) return '<img src="' + esc(p._preview) + '" alt="" loading="lazy">';
    const fb = API.imgFallback(p, width);
    return '<img src="' + esc(API.img(p, width)) + '"' + (fb ? ' data-fb="' + esc(fb) + '"' : '') + ' alt="" loading="lazy">';
  }

  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.fb) return;
    const fb = img.dataset.fb;
    delete img.dataset.fb;
    img.src = fb;
  }, true);

  const findAlbum = (id) => state.data.albums.find((a) => a.id === id);
  const coverId = (a) => (a.photos.some((p) => p.id === a.cover) ? a.cover : (a.photos[0] ? a.photos[0].id : ''));
  const albumMeta = (a) => [a.date, plural(a.photos.length, 'photo')].filter(Boolean).join(' · ');

  /** Petite fenêtre de dialogue. Renvoie le formulaire si l'utilisateur valide, sinon null. */
  function modal(opts) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'modal';
      d.innerHTML = '<form method="dialog">'
        + '<div class="modal-body"><h2>' + esc(opts.title) + '</h2>' + (opts.text ? '<p>' + esc(opts.text) + '</p>' : '') + (opts.body || '') + '</div>'
        + '<div class="modal-actions">'
        + '<button class="btn ' + (opts.danger ? 'danger solid' : 'primary') + '" value="ok" type="submit">' + esc(opts.ok || 'Valider') + '</button>'
        + '<button class="btn" value="cancel" type="submit" formnovalidate>Annuler</button>'
        + '</div></form>';
      document.body.appendChild(d);
      const form = d.querySelector('form');
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        if (d.open) d.close();
        d.remove();
        resolve(value);
      };
      // Valider avec la touche Entrée compte comme « OK » ; seuls « Annuler » et Échap annulent.
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        finish(e.submitter && e.submitter.value === 'cancel' ? null : form);
      });
      d.addEventListener('cancel', () => finish(null));
      d.addEventListener('close', () => finish(null));
      d.showModal();
      const first = d.querySelector('input, textarea, select');
      if (first) first.focus();
    });
  }

  /* ───────── Connexion ───────── */

  function renderLogin(message) {
    root.innerHTML = '<div class="login"><div class="panel login-card fade">'
      + '<h1>Espace de gestion</h1>'
      + '<p class="muted">Entrez votre mot de passe pour gérer vos albums et vos photos.</p>'
      + '<form id="login-form">'
      + '<div class="field"><label for="pw">Mot de passe</label><input type="password" id="pw" autocomplete="current-password" required></div>'
      + '<button class="btn primary block" type="submit">Entrer</button>'
      + '<p class="error" id="login-error">' + esc(message || '') + '</p>'
      + '</form>'
      + (API.demo ? '<p class="hint muted">Mode démonstration : le mot de passe est <strong>demo</strong>.</p>' : '')
      + '<p style="margin-top:14px"><a class="back" href="./">← Retour au site</a></p>'
      + '</div></div>';
    $('pw').focus();
    $('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Vérification…';
      $('login-error').textContent = '';
      try {
        await API.login($('pw').value);
        start();
      } catch (err) {
        $('login-error').textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'Entrer';
      }
    });
  }

  /* ───────── Structure de la page ───────── */

  function renderShell() {
    root.innerHTML = '<header class="adm-top"><div class="wrap">'
      + '<a class="brand" href="#/albums">Gestion du site</a>'
      + '<nav class="adm-nav"><a href="#/albums" data-nav="albums">Albums</a><a href="#/reglages" data-nav="reglages">Réglages</a><a href="#/aide" data-nav="aide">Aide</a></nav>'
      + '<span class="spacer"></span>'
      + '<a class="btn small" href="./" target="_blank" rel="noopener">' + ICON.external + 'Voir le site</a>'
      + '<button class="btn small" type="button" id="logout">Se déconnecter</button>'
      + '</div></header>'
      + '<main class="wrap adm-main" id="view"></main>';
    view = $('view');
    $('logout').addEventListener('click', () => {
      API.logout();
      renderLogin();
    });
    view.addEventListener('click', onViewClick);
  }

  async function start() {
    if (!API.isLoggedIn()) return renderLogin();
    renderShell();
    view.innerHTML = '<div class="state"><div class="loader"></div><p class="muted">Chargement de vos albums…</p></div>';
    try {
      state.data = (await API.admin('adminData')).data;
      route();
    } catch (err) {
      if (err.auth) return fail(err);
      view.innerHTML = '<div class="state"><p class="serif">Impossible de charger les albums.</p><p class="muted">' + esc(err.message) + '</p>'
        + '<button class="btn" type="button" onclick="location.reload()">Réessayer</button></div>';
    }
  }

  function route() {
    if (!state.data || !view) return;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const page = parts[0] || 'albums';
    root.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === page || (page === 'album' && a.dataset.nav === 'albums')));
    window.scrollTo(0, 0);
    if (page === 'album') {
      const album = findAlbum(parts[1]);
      if (album) return renderAlbum(album);
      location.hash = '#/albums';
      return;
    }
    if (page === 'reglages') return renderSettings();
    if (page === 'aide') return renderHelp();
    renderAlbums();
  }

  /* ───────── Liste des albums ───────── */

  function renderAlbums() {
    const albums = state.data.albums;
    view.innerHTML = '<div class="view-head"><div><h1>Mes albums</h1>'
      + (albums.length ? '<p class="muted">Cliquez sur un album pour y ajouter des photos. Pour changer l\'ordre des albums sur le site, attrapez la poignée ⠿ et faites glisser.</p>' : '')
      + '</div><div class="row">'
      + '<button class="btn" type="button" data-act="refresh">' + ICON.refresh + 'Actualiser</button>'
      + '<button class="btn primary" type="button" data-act="new-album">' + ICON.plus + 'Nouvel album</button>'
      + '</div></div>'
      + (albums.length
        ? '<div class="alist" id="alist">' + albums.map(albumRow).join('') + '</div>'
        : '<div class="panel empty-panel"><h2>Bienvenue !</h2><p class="muted">Vous n\'avez pas encore d\'album. Commencez par en créer un, puis ajoutez-y vos photos.</p>'
          + '<button class="btn primary" type="button" data-act="new-album">' + ICON.plus + 'Créer mon premier album</button></div>');

    if (window.Sortable && $('alist')) {
      Sortable.create($('alist'), {
        handle: '.handle',
        animation: 180,
        onEnd: async (evt) => {
          if (evt.oldIndex === evt.newIndex) return;
          const ids = Array.from($('alist').children).map((el) => el.dataset.id);
          state.data.albums.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
          try {
            await API.admin('reorderAlbums', { ids: ids });
            toast('Ordre des albums enregistré.');
          } catch (err) { fail(err); }
        },
      });
    }
  }

  function albumRow(a) {
    const cover = a.photos.find((p) => p.id === coverId(a));
    const href = '#/album/' + encodeURIComponent(a.id);
    return '<div class="arow" data-id="' + esc(a.id) + '">'
      + '<span class="handle" title="Glisser pour changer l\'ordre">' + ICON.handle + '</span>'
      + '<a class="arow-main" href="' + href + '">'
      + (cover ? thumb(cover, 200) : '<span class="ph"></span>')
      + '<div class="info"><h3>' + esc(a.title) + '</h3><span class="meta">' + esc(albumMeta(a)) + '</span></div>'
      + '</a>'
      + (a.hidden ? '<span class="tag">Masqué</span>' : '')
      + '<a class="btn small open-btn" href="' + href + '">Ouvrir</a>'
      + '</div>';
  }

  async function newAlbum() {
    const form = await modal({
      title: 'Nouvel album',
      ok: 'Créer l\'album',
      body: '<div class="fields">'
        + '<div class="field"><label for="na-title">Titre de l\'album</label><input type="text" id="na-title" name="title" required maxlength="120" placeholder="ex. : Vacances en Bretagne"></div>'
        + '<div class="field"><label for="na-date">Date ou période <span class="muted">(facultatif)</span></label><input type="text" id="na-date" name="date" maxlength="80" placeholder="ex. : Été 2025"></div>'
        + '<div class="field"><label for="na-desc">Description <span class="muted">(facultatif)</span></label><textarea id="na-desc" name="description" rows="3" maxlength="3000" placeholder="Quelques mots pour raconter cet album…"></textarea></div>'
        + '</div>',
    });
    if (!form) return;
    const value = (name) => form.querySelector('[name="' + name + '"]').value.trim();
    toast('Création de l\'album…');
    try {
      const r = await API.admin('createAlbum', { title: value('title'), date: value('date'), description: value('description') });
      state.data.albums.unshift(r.album);
      location.hash = '#/album/' + encodeURIComponent(r.album.id);
      toast('Album créé. Ajoutez-y maintenant vos photos !');
    } catch (err) { fail(err); }
  }

  async function refresh() {
    toast('Actualisation…');
    try {
      state.data = (await API.admin('adminData')).data;
      route();
      toast('Albums à jour.');
    } catch (err) { fail(err); }
  }

  /* ───────── Un album ───────── */

  function renderAlbum(a) {
    const drive = API.folderUrl(a.id);
    view.innerHTML = '<p style="margin-bottom:18px"><a class="back" href="#/albums">← Mes albums</a></p>'
      + '<div class="album-edit" data-album="' + esc(a.id) + '">'
      + '<section class="panel"><div class="fields">'
      + '<div class="field"><label for="f-title">Titre de l\'album</label><input type="text" class="big" id="f-title" data-field="title" maxlength="120" value="' + esc(a.title) + '"></div>'
      + '<div class="fields-2">'
      + '<div class="field"><label for="f-date">Date ou période</label><input type="text" id="f-date" data-field="date" maxlength="80" value="' + esc(a.date) + '" placeholder="ex. : Été 2025"></div>'
      + '<div class="field"><span class="field-label">Visibilité</span><label class="switch"><input type="checkbox" id="f-visible"' + (a.hidden ? '' : ' checked') + '><span id="f-visible-text"></span></label></div>'
      + '</div>'
      + '<div class="field"><label for="f-desc">Description</label><textarea id="f-desc" data-field="description" rows="3" maxlength="3000" placeholder="Quelques mots pour raconter cet album…">' + esc(a.description) + '</textarea></div>'
      + '</div>'
      + '<div class="edit-foot"><span class="status" id="album-status">Les modifications sont enregistrées automatiquement.</span><div class="row">'
      + (drive ? '<a class="btn small" href="' + esc(drive) + '" target="_blank" rel="noopener">Ouvrir dans Google Drive</a>' : '')
      + '<a class="btn small" id="see-album" href="./#/album/' + encodeURIComponent(a.id) + '" target="_blank" rel="noopener">' + ICON.external + 'Voir sur le site</a>'
      + '<button class="btn small danger" type="button" data-act="delete-album">' + ICON.trash + 'Supprimer l\'album</button>'
      + '</div></div></section>'
      + '<section>'
      + '<div class="section-head"><h2>Photos <span class="muted" id="photo-count"></span></h2><p class="muted">Faites glisser les photos pour changer leur ordre. Les légendes s\'enregistrent toutes seules.</p></div>'
      + '<label class="drop" id="drop"><input type="file" id="file-input" multiple accept="image/*,.heic,.heif" hidden>'
      + ICON.upload + '<strong>Ajouter des photos</strong><span>Faites-les glisser ici depuis votre ordinateur, ou cliquez pour les choisir.</span></label>'
      + '<div class="upload-box" id="upload-box" hidden><div class="progress"><i id="upload-bar"></i></div><p id="upload-text"></p><p class="errors" id="upload-errors"></p></div>'
      + '<div class="pgrid" id="pgrid"></div>'
      + '</section></div>';

    renderPhotos(a);
    updateVisibility(a);

    // Titre, date, description : enregistrement automatique.
    const status = (text, cls) => { const s = $('album-status'); s.textContent = text; s.className = 'status' + (cls ? ' ' + cls : ''); };
    const save = debounce(async (field, value) => {
      if (field === 'title' && !value) return status('Le titre ne peut pas être vide.', 'err');
      try {
        await API.admin('updateAlbum', { id: a.id, [field]: value });
        a[field] = value;
        status('✓ Enregistré', 'ok');
      } catch (err) {
        status('Pas enregistré : ' + err.message, 'err');
        fail(err);
      }
    }, 900);
    view.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        status('Enregistrement…');
        save(input.dataset.field, input.value.trim());
      });
    });

    $('f-visible').addEventListener('change', async (e) => {
      const hidden = !e.target.checked;
      try {
        await API.admin('updateAlbum', { id: a.id, hidden: hidden });
        a.hidden = hidden;
        updateVisibility(a);
        toast(hidden ? 'Album masqué : la famille ne le voit plus.' : 'Album visible par la famille.');
      } catch (err) {
        e.target.checked = !hidden;
        fail(err);
      }
    });

    // Envoi de photos : clic ou glisser-déposer.
    const drop = $('drop');
    $('file-input').addEventListener('change', (e) => {
      uploadFiles(a, e.target.files);
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadFiles(a, e.dataTransfer.files);
    });

    // Légendes.
    const grid = $('pgrid');
    const saveCaption = {};
    grid.addEventListener('input', (e) => {
      if (e.target.tagName !== 'TEXTAREA') return;
      const card = e.target.closest('.pcard');
      const id = card.dataset.id;
      if (!saveCaption[id]) {
        saveCaption[id] = debounce(async (value, el) => {
          try {
            await API.admin('updatePhoto', { id: id, caption: value });
            const p = a.photos.find((x) => x.id === id);
            if (p) p.caption = value;
            const ok = el.querySelector('.saved');
            ok.classList.add('show');
            setTimeout(() => ok.classList.remove('show'), 1800);
          } catch (err) { fail(err); }
        }, 900);
      }
      saveCaption[id](e.target.value.trim(), card);
    });

    // Ordre des photos.
    if (window.Sortable) {
      Sortable.create(grid, {
        animation: 180,
        filter: 'textarea, button',
        preventOnFilter: false,
        delay: 200,
        delayOnTouchOnly: true,
        onEnd: async (evt) => {
          if (evt.oldIndex === evt.newIndex) return;
          const ids = Array.from(grid.children).map((el) => el.dataset.id);
          a.photos.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));
          updateBadges(a);
          try {
            await API.admin('reorderPhotos', { ids: ids });
            toast('Ordre des photos enregistré.');
          } catch (err) { fail(err); }
        },
      });
    }
  }

  function updateVisibility(a) {
    $('f-visible-text').textContent = a.hidden ? 'Masqué : la famille ne le voit pas' : 'Visible par la famille';
    $('see-album').hidden = a.hidden;
  }

  function isShowing(a) {
    const el = view && view.querySelector('.album-edit');
    return !!el && el.dataset.album === a.id;
  }

  function photoCard(a, p) {
    return '<div class="pcard" data-id="' + esc(p.id) + '">'
      + '<div class="thumb">' + thumb(p, 480) + '<span class="pill cover"' + (p.id === coverId(a) ? '' : ' hidden') + '>Couverture</span>'
      + (p.n ? '<span class="pill score" title="' + plural(p.n, 'vote') + '">★ ' + fmt(p.r) + ' · ' + p.n + '</span>' : '') + '</div>'
      + '<div class="cap"><textarea rows="2" maxlength="2000" placeholder="Ajouter une légende…" aria-label="Légende">' + esc(p.caption) + '</textarea><span class="saved">✓ Enregistré</span></div>'
      + '<div class="actions">'
      + '<button type="button" data-act="cover" title="Utiliser comme photo de couverture de l\'album">Couverture</button>'
      + '<button type="button" data-act="move" title="Déplacer vers un autre album">Déplacer</button>'
      + '<button type="button" class="danger" data-act="delete-photo">Supprimer</button>'
      + '</div></div>';
  }

  function renderPhotos(a) {
    $('pgrid').innerHTML = a.photos.map((p) => photoCard(a, p)).join('');
    $('photo-count').textContent = '(' + a.photos.length + ')';
  }

  function updateBadges(a) {
    const cover = coverId(a);
    $('pgrid').querySelectorAll('.pcard').forEach((card) => { card.querySelector('.pill.cover').hidden = card.dataset.id !== cover; });
    $('photo-count').textContent = '(' + a.photos.length + ')';
  }

  /* ───────── Envoi des photos ───────── */

  function measure(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight, url: url, img: im });
      im.onerror = () => { URL.revokeObjectURL(url); resolve({ w: 0, h: 0, url: '' }); };
      im.src = url;
    });
  }

  function shrink(im, w, h) {
    const scale = Math.min(1, 7000 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
  }

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('fichier illisible'));
      r.readAsDataURL(blob);
    });
  }

  async function prepare(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let type = file.type || ({ heic: 'image/heic', heif: 'image/heif', png: 'image/png', webp: 'image/webp' }[ext] || 'image/jpeg');
    let name = file.name;
    const dims = await measure(file);
    let blob = file;
    if (file.size > MAX_BYTES) {
      if (!dims.w) throw new Error('photo trop lourde (plus de 30 Mo)');
      blob = await shrink(dims.img, dims.w, dims.h);
      type = 'image/jpeg';
      name = name.replace(/\.[^.]+$/, '') + '.jpg';
    }
    return {
      payload: { name: name, mimeType: type, data: await toBase64(blob), w: dims.w, h: dims.h },
      preview: dims.url,
    };
  }

  async function uploadFiles(a, fileList) {
    const all = Array.from(fileList || []);
    const files = all.filter((f) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
    if (!files.length) return toast('Ces fichiers ne sont pas des photos.', true);

    const box = $('upload-box');
    const bar = $('upload-bar');
    const text = $('upload-text');
    const errorsEl = $('upload-errors');
    const errors = [];
    const batch = Date.now();
    let done = 0;
    let added = 0;
    box.hidden = false;
    errorsEl.textContent = '';
    state.uploading++;

    const progress = () => {
      bar.style.width = Math.round(done / files.length * 100) + '%';
      text.textContent = 'Envoi en cours : ' + done + ' sur ' + plural(files.length, 'photo') + '… Gardez cette page ouverte.';
    };
    progress();

    const queue = files.map((f, i) => ({ file: f, i: i }));
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        try {
          const prepared = await prepare(item.file);
          const r = await API.admin('upload', Object.assign({ albumId: a.id }, prepared.payload));
          const p = r.photo;
          p._preview = prepared.preview;
          p._batch = batch;
          p._i = item.i;
          a.photos.push(p);
          added++;
          if (isShowing(a)) {
            $('pgrid').insertAdjacentHTML('beforeend', photoCard(a, p).replace('class="pcard"', 'class="pcard is-new"'));
            updateBadges(a);
          }
        } catch (err) {
          if (err.auth) { queue.length = 0; fail(err); }
          errors.push(item.file.name + ' : ' + err.message);
        }
        done++;
        if (isShowing(a)) progress();
      }
    };
    await Promise.all([worker(), worker()]);
    state.uploading--;

    // Les nouvelles photos vont à la fin de l'album, dans l'ordre où elles ont été choisies.
    if (added) {
      const old = a.photos.filter((p) => p._batch !== batch);
      const fresh = a.photos.filter((p) => p._batch === batch).sort((x, y) => x._i - y._i);
      fresh.forEach((p) => { delete p._batch; delete p._i; });
      a.photos = old.concat(fresh);
      try { await API.admin('reorderPhotos', { ids: a.photos.map((p) => p.id) }); } catch (err) { /* l'ordre par date sera utilisé */ }
      if (isShowing(a)) renderPhotos(a);
    }

    if (!isShowing(a)) {
      toast(added ? plural(added, 'photo ajoutée', 'photos ajoutées') + ' à « ' + a.title + ' ».' : 'Aucune photo n\'a pu être ajoutée.', !added);
      return;
    }
    bar.style.width = '100%';
    text.textContent = added
      ? '✓ ' + plural(added, 'photo ajoutée', 'photos ajoutées') + ' à l\'album.'
      : 'Aucune photo n\'a pu être ajoutée.';
    const skipped = all.length - files.length;
    errorsEl.textContent = (errors.length ? 'Non envoyées — ' + errors.join(' · ') : '')
      + (skipped ? (errors.length ? ' · ' : '') + plural(skipped, 'fichier ignoré', 'fichiers ignorés') + ' (pas des photos).' : '');
  }

  window.addEventListener('beforeunload', (e) => {
    if (state.uploading) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ───────── Actions (boutons) ───────── */

  async function onViewClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'new-album') return newAlbum();
    if (act === 'refresh') return refresh();
    if (act === 'copy-link') return copyLink();

    const albumEl = btn.closest('.album-edit');
    const a = albumEl && findAlbum(albumEl.dataset.album);
    if (!a) return;
    if (act === 'delete-album') return deleteAlbum(a);

    const card = btn.closest('.pcard');
    const p = card && a.photos.find((x) => x.id === card.dataset.id);
    if (!p) return;
    if (act === 'cover') return setCover(a, p);
    if (act === 'move') return movePhoto(a, p, card);
    if (act === 'delete-photo') return deletePhoto(a, p, card);
  }

  async function setCover(a, p) {
    try {
      await API.admin('updateAlbum', { id: a.id, cover: p.id });
      a.cover = p.id;
      updateBadges(a);
      toast('Photo de couverture choisie.');
    } catch (err) { fail(err); }
  }

  async function movePhoto(a, p, card) {
    const others = state.data.albums.filter((x) => x.id !== a.id);
    if (!others.length) return toast('Créez d\'abord un autre album pour pouvoir y déplacer cette photo.', true);
    const form = await modal({
      title: 'Déplacer la photo',
      text: 'Vers quel album voulez-vous déplacer cette photo ?',
      ok: 'Déplacer',
      body: '<div class="field"><label for="mv-to">Album</label><select id="mv-to" name="to">'
        + others.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.title) + '</option>').join('') + '</select></div>',
    });
    if (!form) return;
    const target = findAlbum(form.querySelector('[name="to"]').value);
    try {
      await API.admin('movePhoto', { id: p.id, toAlbumId: target.id });
      a.photos = a.photos.filter((x) => x !== p);
      target.photos.push(p);
      card.remove();
      updateBadges(a);
      toast('Photo déplacée vers « ' + target.title + ' ».');
    } catch (err) { fail(err); }
  }

  async function deletePhoto(a, p, card) {
    const ok = await modal({
      title: 'Supprimer cette photo ?',
      text: 'Elle disparaîtra du site et ira dans la corbeille de votre Google Drive, où elle reste récupérable pendant 30 jours.',
      ok: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await API.admin('deletePhoto', { id: p.id });
      a.photos = a.photos.filter((x) => x !== p);
      card.remove();
      updateBadges(a);
      toast('Photo supprimée.');
    } catch (err) { fail(err); }
  }

  async function deleteAlbum(a) {
    const ok = await modal({
      title: 'Supprimer l\'album « ' + a.title + ' » ?',
      text: 'L\'album et ses ' + plural(a.photos.length, 'photo') + ' disparaîtront du site. Ils iront dans la corbeille de votre Google Drive, où ils restent récupérables pendant 30 jours.',
      ok: 'Supprimer l\'album',
      danger: true,
    });
    if (!ok) return;
    try {
      await API.admin('deleteAlbum', { id: a.id });
      state.data.albums = state.data.albums.filter((x) => x !== a);
      location.hash = '#/albums';
      toast('Album supprimé.');
    } catch (err) { fail(err); }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(SITE_URL);
      toast('Lien copié ! Collez-le dans un e-mail ou un message.');
    } catch (err) {
      const input = $('share-url');
      if (input) { input.focus(); input.select(); }
      toast('Sélectionnez le lien puis faites Ctrl + C pour le copier.');
    }
  }

  /* ───────── Réglages ───────── */

  function renderSettings() {
    const s = state.data.settings;
    const folder = state.data.albumsFolder ? API.folderUrl(state.data.albumsFolder) : '';
    view.innerHTML = '<div class="view-head"><div><h1>Réglages</h1><p class="muted">Le texte de la page d\'accueil, le lien à partager et votre mot de passe.</p></div></div>'
      + '<div class="stack" style="max-width:780px">'
      + '<section class="panel"><h2>Page d\'accueil</h2><div class="fields" style="margin-top:16px">'
      + '<div class="field"><label for="s-title">Titre du site</label><input type="text" class="big" id="s-title" data-setting="title" maxlength="120" value="' + esc(s.title) + '"></div>'
      + '<div class="field"><label for="s-sub">Sous-titre</label><input type="text" id="s-sub" data-setting="subtitle" maxlength="200" value="' + esc(s.subtitle) + '"><span class="hint">Écrit en petites lettres sous le titre.</span></div>'
      + '<div class="field"><label for="s-intro">Petit mot d\'accueil</label><textarea id="s-intro" data-setting="intro" rows="4" maxlength="3000" placeholder="Facultatif">' + esc(s.intro) + '</textarea></div>'
      + '<span class="status" id="settings-status">Les modifications sont enregistrées automatiquement.</span>'
      + '</div></section>'
      + '<section class="panel"><h2>Partager le site</h2><p class="muted">Envoyez ce lien à la famille, par e-mail, SMS ou WhatsApp.</p>'
      + '<div class="row" style="margin-top:16px;flex-wrap:nowrap"><input type="text" readonly id="share-url" value="' + esc(SITE_URL) + '">'
      + '<button class="btn primary" type="button" data-act="copy-link" style="white-space:nowrap">Copier le lien</button></div></section>'
      + '<section class="panel"><h2>Mot de passe</h2><p class="muted">Le mot de passe pour entrer dans cet espace de gestion.</p>'
      + '<form id="pw-form" class="fields" style="margin-top:16px"><div class="fields-2">'
      + '<div class="field"><label for="pw1">Nouveau mot de passe</label><input type="password" id="pw1" minlength="4" required autocomplete="new-password"></div>'
      + '<div class="field"><label for="pw2">Le même, encore une fois</label><input type="password" id="pw2" minlength="4" required autocomplete="new-password"></div>'
      + '</div><div><button class="btn" type="submit">Changer le mot de passe</button></div></form></section>'
      + (folder ? '<section class="panel"><h2>Google Drive</h2><p class="muted">Toutes les photos sont rangées dans votre Google Drive, dans le dossier « Site photo de famille › Albums ». Chaque sous-dossier est un album.</p>'
        + '<div class="row" style="margin-top:16px"><a class="btn" href="' + esc(folder) + '" target="_blank" rel="noopener">' + ICON.external + 'Ouvrir le dossier des albums</a></div></section>' : '')
      + '</div>';

    const status = (text, cls) => { const el = $('settings-status'); el.textContent = text; el.className = 'status' + (cls ? ' ' + cls : ''); };
    const save = debounce(async (key, value) => {
      if (key === 'title' && !value) return status('Le titre ne peut pas être vide.', 'err');
      try {
        const r = await API.admin('saveSettings', { settings: { [key]: value } });
        state.data.settings = r.settings;
        status('✓ Enregistré', 'ok');
      } catch (err) {
        status('Pas enregistré : ' + err.message, 'err');
        fail(err);
      }
    }, 900);
    view.querySelectorAll('[data-setting]').forEach((input) => {
      input.addEventListener('input', () => {
        status('Enregistrement…');
        save(input.dataset.setting, input.value.trim());
      });
    });

    $('pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('pw1').value.trim();
      if (pw !== $('pw2').value.trim()) return toast('Les deux mots de passe ne sont pas identiques.', true);
      try {
        await API.admin('changePassword', { newPassword: pw });
        await API.login(pw);
        e.target.reset();
        toast('Mot de passe changé. Notez-le bien !');
      } catch (err) { fail(err); }
    });
  }

  /* ───────── Aide ───────── */

  function renderHelp() {
    const steps = [
      ['Créer un album', 'Dans « Albums », cliquez sur « Nouvel album », donnez-lui un titre (par exemple « Noël 2025 »), puis cliquez sur « Créer l\'album ».'],
      ['Ajouter des photos', 'Ouvrez l\'album, puis faites glisser vos photos depuis votre ordinateur dans le grand cadre « Ajouter des photos ». Vous pouvez aussi cliquer dessus pour les choisir : pour en prendre plusieurs, gardez la touche Ctrl enfoncée en cliquant, ou faites Ctrl + A pour prendre tout un dossier. Gardez la page ouverte pendant l\'envoi.'],
      ['Écrire une légende', 'Cliquez sous une photo, sur « Ajouter une légende… », et écrivez. Pas besoin de bouton « Enregistrer » : c\'est automatique.'],
      ['Changer l\'ordre', 'Attrapez une photo avec la souris et faites-la glisser à sa nouvelle place. Pour les albums, c\'est pareil, avec la poignée ⠿ à gauche de chaque album.'],
      ['Choisir la photo de couverture', 'Sous la photo qui doit représenter l\'album sur la page d\'accueil, cliquez sur « Couverture ».'],
      ['Préparer un album en secret', 'Dans l\'album, décochez « Visible par la famille ». L\'album reste caché jusqu\'à ce que vous le recochiez.'],
      ['Supprimer', 'Les photos et albums supprimés vont dans la corbeille de votre Google Drive : vous avez 30 jours pour changer d\'avis.'],
      ['Partager le site', 'Dans « Réglages », cliquez sur « Copier le lien », puis collez-le dans un e-mail ou un message pour la famille.'],
      ['Ajouter des photos depuis Google Drive', 'Vous pouvez aussi déposer des photos directement dans Google Drive, dans le dossier « Site photo de famille › Albums ». Chaque dossier qui s\'y trouve devient un album. Elles apparaissent sur le site en quelques minutes, ou tout de suite avec le bouton « Actualiser ».'],
    ];
    view.innerHTML = '<div class="help"><div class="view-head"><div><h1>Mode d\'emploi</h1><p class="muted">Tout ce qu\'il faut savoir, en quelques étapes.</p></div></div>'
      + steps.map((s, i) => '<div class="step"><span class="num">' + (i + 1) + '</span><div><h3>' + esc(s[0]) + '</h3><p>' + esc(s[1]) + '</p></div></div>').join('')
      + '<div class="step"><span class="num">?</span><div><h3>Un souci ?</h3><p>Cliquez sur « Actualiser » dans la page « Albums ». Si le problème continue, appelez votre fils : il saura quoi faire.</p></div></div>'
      + '</div>';
  }

  /* ───────── Démarrage ───────── */

  window.addEventListener('hashchange', route);
  start();
})();
