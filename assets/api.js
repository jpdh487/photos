/*
 * Communication avec le serveur (Google Apps Script) + mode démonstration.
 * Partagé par la galerie (app.js) et l'espace de gestion (admin.js).
 */
window.API = (function () {
  'use strict';

  const API_URL = String((window.SITE_CONFIG || {}).apiUrl || '').trim();
  const DEMO = !API_URL;
  const P = 'photos:';

  const store = {
    get(key, def) {
      try { const v = localStorage.getItem(P + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set(key, value) {
      try { localStorage.setItem(P + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    del(key) {
      try { localStorage.removeItem(P + key); } catch (e) { /* stockage indisponible */ }
    },
  };

  async function call(payload, useGet) {
    if (DEMO) return Object.assign({ ok: true }, await Demo.handle(payload));
    let res;
    try {
      res = useGet
        ? await fetch(API_URL + '?action=' + encodeURIComponent(payload.action) + '&t=' + Date.now())
        // Pas d'en-tête Content-Type : la requête reste « simple » et passe sans problème chez Google.
        : await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
    } catch (e) {
      throw new Error('Connexion impossible. Vérifiez votre connexion internet puis réessayez.');
    }
    let json;
    try { json = await res.json(); } catch (e) { throw new Error('Le serveur a répondu de façon inattendue. Réessayez dans un instant.'); }
    if (!json.ok) {
      const err = new Error(json.error || 'Erreur inconnue.');
      err.auth = !!json.auth;
      throw err;
    }
    return json;
  }

  /* ───────── Adresses des images (servies directement par Google Drive) ───────── */

  const step = (w) => Math.min(2560, Math.max(200, Math.ceil(w / 200) * 200));

  function img(p, width) {
    const w = step(width);
    if (p.src) return p.src;
    if (p.demo) return 'https://picsum.photos/id/' + p.demo + '/' + w + '/' + Math.round(w * p.h / p.w);
    return 'https://lh3.googleusercontent.com/d/' + p.id + '=w' + w;
  }

  function imgFallback(p, width) {
    if (p.src || p.demo) return '';
    return 'https://drive.google.com/thumbnail?id=' + p.id + '&sz=w' + step(width);
  }

  function download(p) {
    if (p.src) return p.src;
    if (p.demo) return 'https://picsum.photos/id/' + p.demo + '/' + p.w + '/' + p.h;
    return 'https://drive.google.com/uc?export=download&id=' + p.id;
  }

  function folderUrl(id) {
    return DEMO ? '' : 'https://drive.google.com/drive/folders/' + id;
  }

  /* ───────── Données publiques (avec copie locale pour un affichage instantané) ───────── */

  const DATA_KEY = 'data:' + (DEMO ? 'demo' : API_URL.slice(-24));

  async function loadData() {
    const r = await call({ action: 'data' }, true);
    store.set(DATA_KEY, r.data);
    return r.data;
  }

  /* ───────── Notes ───────── */

  function visitorId() {
    let v = store.get('visitor', '');
    if (!v) {
      v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
      store.set('visitor', v);
    }
    return v;
  }

  function myRating(photoId) {
    return store.get('ratings', {})[photoId] || 0;
  }

  async function rate(photoId, stars) {
    const r = await call({ action: 'rate', photoId: photoId, visitorId: visitorId(), stars: stars });
    const mine = store.get('ratings', {});
    if (stars) mine[photoId] = stars; else delete mine[photoId];
    store.set('ratings', mine);
    return { r: r.r, n: r.n };
  }

  /* ───────── Espace de gestion ───────── */

  async function login(password) {
    await call({ action: 'login', password: password });
    store.set('admin', password);
  }

  function admin(action, payload) {
    return call(Object.assign({}, payload, { action: action, password: store.get('admin', '') }));
  }

  /* ───────── Mode démonstration (aucun serveur : tout reste dans ce navigateur) ───────── */

  const Demo = (function () {
    const KEY = 'demo-db:v1';
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const uid = () => 'demo-' + Math.random().toString(36).slice(2, 10);
    const fail = (msg, auth) => { const e = new Error(msg); e.auth = !!auth; throw e; };
    let db = null;

    function seed() {
      const albums = [
        ['Été au bord de la mer', 'Juillet 2025', 'Deux semaines face à l\'océan : marées, pique-niques et grandes balades sur le sentier côtier.',
          [[1050, 3, 2, 'Le premier matin, la mer était d\'huile'], [1053, 3, 2], [1011, 2, 3, 'En kayak avant le déjeuner'], [1019, 3, 2], [1016, 3, 2], [1015, 16, 9, 'La vue depuis la falaise'], [1039, 2, 3], [1043, 3, 2], [1044, 3, 2], [1036, 3, 2], [1037, 2, 3], [1051, 3, 2]]],
        ['Balades en montagne', 'Automne 2024', 'Les couleurs de l\'automne, les refuges et les pique-niques au sommet.',
          [[1018, 16, 9, 'Au-dessus des nuages'], [1022, 3, 2], [1029, 2, 3], [1031, 3, 2], [1033, 3, 2], [1035, 2, 3, 'La cascade du lac'], [1038, 3, 2], [1040, 3, 2], [1041, 3, 2]]],
        ['Noël en famille', 'Décembre 2024', 'Tout le monde réuni à la maison pour les fêtes.',
          [[1060, 3, 2, 'Le café du matin de Noël'], [1062, 2, 3], [1063, 3, 2], [1064, 3, 2], [1068, 3, 2], [1069, 2, 3], [1070, 3, 2], [1073, 3, 2]]],
        ['Le jardin au fil des saisons', '2023 – 2025', '',
          [[1080, 3, 2, 'Les premières fraises'], [1081, 2, 3], [1082, 3, 2], [1083, 3, 2], [1084, 3, 2], [10, 3, 2], [11, 3, 2], [12, 2, 3], [13, 3, 2], [14, 3, 2]]],
      ];
      const ratings = {};
      let n = 7;
      const rnd = () => (n = (n * 9301 + 49297) % 233280) / 233280;
      return {
        settings: { title: 'Nos photos de famille', subtitle: 'Les souvenirs à partager', intro: 'Bienvenue ! Choisissez un album, cliquez sur une photo pour l\'agrandir, notez vos préférées et téléchargez celles qui vous plaisent.' },
        albums: albums.map(([title, date, description, photos], ai) => ({
          id: 'demo-album-' + ai, title: title, date: date, description: description, hidden: false, cover: '',
          photos: photos.map(([pic, rw, rh, caption], pi) => {
            const id = 'demo-' + ai + '-' + pi;
            const votes = Math.floor(rnd() * 5);
            if (votes) {
              ratings[id] = {};
              for (let v = 0; v < votes; v++) ratings[id]['v' + v] = 3 + Math.floor(rnd() * 3);
            }
            return { id: id, name: 'IMG_' + (1000 + pi) + '.jpg', demo: pic, w: 1800, h: Math.round(1800 * rh / rw), caption: caption || '' };
          }),
        })),
        ratings: ratings,
      };
    }

    function load() {
      if (!db) db = store.get(KEY, null) || seed();
      return db;
    }
    function save() {
      if (!store.set(KEY, db)) console.warn('Démo : stockage local plein, les changements ne survivront pas au rechargement.');
    }

    function withRatings(p) {
      const votes = Object.values(db.ratings[p.id] || {});
      if (votes.length) {
        p.r = Math.round(votes.reduce((s, v) => s + v, 0) / votes.length * 10) / 10;
        p.n = votes.length;
      }
      return p;
    }

    function shrink(base64, type) {
      return new Promise((resolve) => {
        const im = new Image();
        im.onload = () => {
          const scale = Math.min(1, 1400 / Math.max(im.naturalWidth, im.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(im.naturalWidth * scale);
          c.height = Math.round(im.naturalHeight * scale);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        im.onerror = () => resolve('');
        im.src = 'data:' + type + ';base64,' + base64;
      });
    }

    function findPhoto(id) {
      for (const a of db.albums) {
        const i = a.photos.findIndex((p) => p.id === id);
        if (i >= 0) return { album: a, index: i };
      }
      return fail('Photo introuvable.');
    }

    async function handle(req) {
      load();
      await sleep(req.action === 'upload' ? 500 : 150);
      if (req.action === 'data') {
        return {
          data: {
            settings: clone(db.settings),
            albums: db.albums.filter((a) => !a.hidden && a.photos.length).map((a) => ({
              id: a.id, title: a.title, description: a.description, date: a.date,
              cover: a.photos.some((p) => p.id === a.cover) ? a.cover : a.photos[0].id,
              photos: a.photos.map((p) => withRatings({ id: p.id, w: p.w, h: p.h, caption: p.caption, demo: p.demo, src: p.src })),
            })),
          },
        };
      }
      if (req.action === 'rate') {
        const votes = db.ratings[req.photoId] || (db.ratings[req.photoId] = {});
        if (req.stars) votes[visitorId()] = req.stars; else delete votes[visitorId()];
        save();
        const p = withRatings({ id: req.photoId });
        return { r: p.r || 0, n: p.n || 0 };
      }

      if (req.password !== 'demo') fail('Mot de passe incorrect. En démonstration, le mot de passe est « demo ».', true);
      const album = (id) => db.albums.find((a) => a.id === id) || fail('Album introuvable.');

      switch (req.action) {
        case 'login':
          return {};
        case 'adminData':
          return { data: { settings: clone(db.settings), albumsFolder: '', albums: db.albums.map((a) => Object.assign(clone(a), { photos: a.photos.map((p) => withRatings(clone(p))) })) } };
        case 'saveSettings':
          ['title', 'subtitle', 'intro'].forEach((k) => { if (k in req.settings) db.settings[k] = String(req.settings[k]).trim(); });
          save();
          return { settings: clone(db.settings) };
        case 'changePassword':
          return fail('En démonstration, le mot de passe reste « demo ».');
        case 'createAlbum': {
          const title = String(req.title || '').trim();
          if (!title) fail('Donnez un titre à l\'album.');
          const a = { id: uid(), title: title, date: String(req.date || '').trim(), description: String(req.description || '').trim(), hidden: false, cover: '', photos: [] };
          db.albums.unshift(a);
          save();
          return { album: clone(a) };
        }
        case 'updateAlbum': {
          const a = album(req.id);
          ['title', 'description', 'date', 'hidden', 'cover'].forEach((k) => { if (k in req) a[k] = req[k]; });
          break;
        }
        case 'reorderAlbums':
          db.albums.sort((x, y) => req.ids.indexOf(x.id) - req.ids.indexOf(y.id));
          break;
        case 'deleteAlbum':
          db.albums = db.albums.filter((a) => a.id !== req.id);
          break;
        case 'upload': {
          const a = album(req.albumId);
          const src = await shrink(req.data, req.mimeType);
          if (!src) fail('Ce format de photo ne peut pas être affiché en démonstration.');
          const p = { id: uid(), name: req.name, w: req.w || 1200, h: req.h || 800, caption: '', src: src };
          a.photos.push(p);
          save();
          return { photo: clone(p) };
        }
        case 'updatePhoto': {
          const { album: a, index } = findPhoto(req.id);
          a.photos[index].caption = String(req.caption || '').trim();
          break;
        }
        case 'reorderPhotos':
          db.albums.forEach((a) => a.photos.sort((x, y) => req.ids.indexOf(x.id) - req.ids.indexOf(y.id)));
          break;
        case 'movePhoto': {
          const { album: from, index } = findPhoto(req.id);
          const [p] = from.photos.splice(index, 1);
          album(req.toAlbumId).photos.push(p);
          break;
        }
        case 'deletePhoto': {
          const { album: a, index } = findPhoto(req.id);
          a.photos.splice(index, 1);
          break;
        }
        default:
          fail('Action inconnue.');
      }
      save();
      return {};
    }

    return {
      handle: handle,
      reset() { store.del(KEY); db = null; },
    };
  })();

  return {
    demo: DEMO,
    img: img,
    imgFallback: imgFallback,
    download: download,
    folderUrl: folderUrl,
    cachedData: () => store.get(DATA_KEY, null),
    saveCache: (data) => store.set(DATA_KEY, data),
    loadData: loadData,
    myRating: myRating,
    rate: rate,
    isLoggedIn: () => !!store.get('admin', ''),
    login: login,
    logout: () => store.del('admin'),
    admin: admin,
    resetDemo: Demo.reset,
  };
})();
