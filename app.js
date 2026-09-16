// ====== IndexedDB helper ======
const DB_NAME = 'berkas_db';
const STORE = 'files';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.addedAt - a.addedAt));
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ====== Kategori (disimpan di localStorage, ringan & terpisah dari file blob) ======
const CAT_KEY = 'berkas_categories_v1';
function loadCategories() {
  try {
    const raw = localStorage.getItem(CAT_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  const def = [
    { id: 'c1', label: 'X', counter: 0 },
    { id: 'c2', label: 'PRN', counter: 0 },
    { id: 'c3', label: 'TT', counter: 0 }
  ];
  localStorage.setItem(CAT_KEY, JSON.stringify(def));
  return def;
}
function saveCategories(cats) {
  localStorage.setItem(CAT_KEY, JSON.stringify(cats));
}
let categories = loadCategories();

function getCategory(id) {
  return categories.find(c => c.id === id);
}

// ambil nama otomatis berikutnya untuk kategori, sekaligus naikkan & simpan counter-nya
function nextAutoName(catId) {
  const cat = getCategory(catId);
  cat.counter += 1;
  saveCategories(categories);
  return cat.label.toLowerCase() + cat.counter;
}

// ====== Util ======
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
}

function guessType(name, mime) {
  const ext = name.split('.').pop().toLowerCase();
  if (mime.startsWith('video/') || ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) return 'video';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'cbz' || ext === 'zip' || mime.includes('zip')) return 'comic';
  return 'other';
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ====== Thumbnail ======
function downscaleCanvasToDataUrl(sourceEl, maxW) {
  const w = sourceEl.videoWidth || sourceEl.naturalWidth || sourceEl.width;
  const h = sourceEl.videoHeight || sourceEl.naturalHeight || sourceEl.height;
  if (!w || !h) return null;
  const scale = Math.min(1, maxW / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceEl, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch (e) {
    console.warn('toDataURL gagal (kemungkinan canvas tainted)', e);
    return null;
  }
}

// elemen kerja HARUS ditempel ke DOM (walau disembunyikan) — banyak browser Android/WebView
// ogah men-decode frame video/gambar kalau elemennya cuma dibuat di memori tanpa dipasang ke halaman
function attachHidden(el) {
  el.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
  document.body.appendChild(el);
  return el;
}

function makeVideoThumb(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    attachHidden(v);
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      v.remove();
      resolve(result);
    };
    v.addEventListener('loadedmetadata', () => {
      try {
        v.currentTime = Math.min(1, (v.duration || 2) / 3) || 0.1;
      } catch (e) { finish(null); }
    });
    v.addEventListener('seeked', () => {
      // tunggu 2 frame render dulu — pas event 'seeked' ditembak, frame-nya kadang
      // belum benar-benar ke-render di beberapa browser Android, hasilnya capture kosong
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try { finish(downscaleCanvasToDataUrl(v, 320)); }
        catch (e) { finish(null); }
      }));
    });
    v.addEventListener('error', () => finish(null));
    v.load();
    setTimeout(() => finish(null), 8000); // jaga-jaga kalau macet
  });
}

function makeImageThumb(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    attachHidden(img);
    img.onload = () => {
      const result = downscaleCanvasToDataUrl(img, 320);
      URL.revokeObjectURL(url);
      img.remove();
      resolve(result);
    };
    img.onerror = () => { URL.revokeObjectURL(url); img.remove(); resolve(null); };
    img.src = url;
  });
}

async function makeThumb(type, blob) {
  try {
    if (type === 'video') return await makeVideoThumb(blob);
    if (type === 'comic') {
      const zip = await JSZip.loadAsync(blob);
      const first = Object.values(zip.files)
        .filter(f => !f.dir && /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];
      if (!first) return null;
      const imgBlob = await first.async('blob');
      return await makeImageThumb(imgBlob);
    }
  } catch (e) { console.warn('thumb gagal', e); }
  return null;
}

// ====== PIN kunci (hash-nya doang yang disimpan, PIN aslinya ga pernah nempel di file manapun) ======
const PIN_KEY = 'berkas_pin_hash';
const SESSION_KEY = 'berkas_unlocked';
let lockMode = 'unlock';
let tempPin = null;

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function showApp() {
  document.getElementById('lockScreen').classList.add('hidden');
  document.getElementById('appRoot').classList.remove('hidden');
  renderTabs();
  renderGrid();
}
function showLock(mode, msg) {
  lockMode = mode;
  document.getElementById('appRoot').classList.add('hidden');
  document.getElementById('lockScreen').classList.remove('hidden');
  document.getElementById('lockMsg').textContent = msg;
  const input = document.getElementById('lockInput');
  input.value = '';
  document.getElementById('lockError').textContent = '';
  setTimeout(() => input.focus(), 50);
}

function initLock() {
  const hash = localStorage.getItem(PIN_KEY);
  if (!hash) { showLock('setup', 'Buat PIN baru'); return; }
  if (sessionStorage.getItem(SESSION_KEY) === '1') { showApp(); return; }
  showLock('unlock', 'Masukkan PIN');
}

async function handleLockSubmit() {
  const val = document.getElementById('lockInput').value;
  const errEl = document.getElementById('lockError');
  if (!val || val.length < 4) { errEl.textContent = 'Minimal 4 digit/karakter.'; return; }

  if (lockMode === 'setup') {
    tempPin = val;
    showLock('setup-confirm', 'Ulangi PIN tadi');
    return;
  }
  if (lockMode === 'setup-confirm') {
    if (val !== tempPin) { tempPin = null; showLock('setup', 'Tidak cocok — buat PIN baru lagi'); return; }
    localStorage.setItem(PIN_KEY, await sha256Hex(val));
    sessionStorage.setItem(SESSION_KEY, '1');
    tempPin = null;
    showApp();
    toast('PIN dibuat');
    return;
  }
  if (lockMode === 'unlock') {
    if (await sha256Hex(val) === localStorage.getItem(PIN_KEY)) {
      sessionStorage.setItem(SESSION_KEY, '1');
      showApp();
    } else {
      errEl.textContent = 'PIN salah.';
    }
    return;
  }
  if (lockMode === 'change-old') {
    if (await sha256Hex(val) !== localStorage.getItem(PIN_KEY)) { errEl.textContent = 'PIN lama salah.'; return; }
    showLock('change-new', 'Masukkan PIN baru');
    return;
  }
  if (lockMode === 'change-new') {
    tempPin = val;
    showLock('change-confirm', 'Ulangi PIN baru');
    return;
  }
  if (lockMode === 'change-confirm') {
    if (val !== tempPin) { tempPin = null; showLock('change-new', 'Tidak cocok — masukkan PIN baru lagi'); return; }
    localStorage.setItem(PIN_KEY, await sha256Hex(val));
    tempPin = null;
    showApp();
    toast('PIN diganti');
    return;
  }
}

document.getElementById('lockSubmit').addEventListener('click', handleLockSubmit);
document.getElementById('lockInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleLockSubmit();
});
document.getElementById('btnLock').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  initLock();
});
document.getElementById('btnChangePin').addEventListener('click', () => {
  showLock('change-old', 'Masukkan PIN lama');
});

// ====== Panel: Koleksi (X/PRN/TT) vs Komik (terpisah) ======
let activeView = 'koleksi';
document.getElementById('viewKoleksi').addEventListener('click', () => {
  activeView = 'koleksi';
  document.getElementById('viewKoleksi').classList.add('active');
  document.getElementById('viewKomik').classList.remove('active');
  document.getElementById('tabs').classList.remove('hidden');
  renderGrid();
});
document.getElementById('viewKomik').addEventListener('click', () => {
  activeView = 'komik';
  document.getElementById('viewKomik').classList.add('active');
  document.getElementById('viewKoleksi').classList.remove('active');
  document.getElementById('tabs').classList.add('hidden');
  renderGrid();
});

// ====== Tabs kategori ======
let activeTab = 'all';

function renderTabs() {
  const tabsEl = document.getElementById('tabs');
  tabsEl.innerHTML = '';

  const allTab = document.createElement('div');
  allTab.className = 'tab' + (activeTab === 'all' ? ' active' : '');
  allTab.textContent = 'Semua';
  allTab.addEventListener('click', () => { activeTab = 'all'; renderTabs(); renderGrid(); });
  tabsEl.appendChild(allTab);

  categories.forEach(cat => {
    const t = document.createElement('div');
    t.className = 'tab' + (activeTab === cat.id ? ' active' : '');
    t.innerHTML = `<span>${escapeHtml(cat.label)}</span><span class="edit" data-id="${cat.id}">✎</span>`;
    t.querySelector('span:first-child').addEventListener('click', () => {
      activeTab = cat.id; renderTabs(); renderGrid();
    });
    t.querySelector('.edit').addEventListener('click', (e) => {
      e.stopPropagation();
      const name = prompt('Nama kategori baru:', cat.label);
      if (name && name.trim()) {
        cat.label = name.trim();
        saveCategories(categories);
        renderTabs();
        renderGrid();
      }
    });
    tabsEl.appendChild(t);
  });
}

function renderCatPicker(container, onPick) {
  container.innerHTML = '';
  let selected = null;
  categories.forEach(cat => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = cat.label;
    b.addEventListener('click', () => {
      selected = cat.id;
      [...container.children].forEach(c => c.classList.remove('selected'));
      b.classList.add('selected');
      onPick(selected);
    });
    container.appendChild(b);
  });
}

// ====== Render library ======
async function renderGrid() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('emptyState');
  let items = await dbGetAll();
  if (activeView === 'komik') {
    items = items.filter(i => i.type === 'comic');
  } else {
    items = items.filter(i => i.type !== 'comic');
    if (activeTab !== 'all') items = items.filter(i => i.category === activeTab);
  }
  grid.innerHTML = '';
  empty.classList.toggle('hidden', items.length > 0);

  const icons = { video: '▶', pdf: '▤', comic: '▥', other: '▢' };

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'card';
    const thumbHtml = item.thumb
      ? `<img src="${item.thumb}" alt="">`
      : `<span class="card-icon">${icons[item.type] || icons.other}</span>`;
    card.innerHTML = `
      <div class="card-delete-action">🗑</div>
      <div class="card-inner">
        <div class="card-thumb">${thumbHtml}</div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(item.name)}</div>
          <div class="card-meta">${fmtSize(item.size)}</div>
        </div>
      </div>
    `;
    const inner = card.querySelector('.card-inner');
    const deleteBtn = card.querySelector('.card-delete-action');
    attachSwipeToDelete(card, inner, deleteBtn, item.id);
    grid.appendChild(card);
  }
}

// geser kartu ke kiri buat menyingkap tombol hapus, sambil tetap bisa tap biasa buat buka viewer
const SWIPE_OPEN_OFFSET = -74;
function attachSwipeToDelete(card, inner, deleteBtn, id) {
  let startX = null;
  let baseX = 0;
  let currentX = 0;
  let dragged = false;

  inner.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    baseX = card.classList.contains('swiped') ? SWIPE_OPEN_OFFSET : 0;
    dragged = false;
    inner.style.transition = 'none';
  }, { passive: true });

  inner.addEventListener('touchmove', (e) => {
    if (startX === null) return;
    const dx = e.touches[0].clientX - startX;
    if (Math.abs(dx) > 6) dragged = true;
    currentX = Math.max(SWIPE_OPEN_OFFSET, Math.min(0, baseX + dx));
    inner.style.transform = `translateX(${currentX}px)`;
  }, { passive: true });

  inner.addEventListener('touchend', () => {
    if (startX === null) return;
    inner.style.transition = '';
    if (currentX < SWIPE_OPEN_OFFSET / 2) {
      card.classList.add('swiped');
      inner.style.transform = `translateX(${SWIPE_OPEN_OFFSET}px)`;
    } else {
      card.classList.remove('swiped');
      inner.style.transform = '';
    }
    startX = null;
  });

  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Hapus berkas ini?')) return;
    await dbDelete(id);
    toast('Berkas dihapus');
    renderGrid();
  });

  // tap: kalau kartu lagi kesingkap (habis swipe), tap di mana aja nutup dulu; kalau normal, buka viewer
  inner.addEventListener('click', (e) => {
    if (dragged) { dragged = false; return; }
    if (card.classList.contains('swiped')) {
      card.classList.remove('swiped');
      inner.style.transform = '';
      return;
    }
    openViewer(id);
  });
}

// ====== Tambah dari perangkat ======
let pendingLocalCategory = null;
const localCatModal = document.getElementById('localCatModal');

document.getElementById('btnAddLocal').addEventListener('click', () => {
  pendingLocalCategory = null;
  if (activeView === 'komik') {
    document.getElementById('localFileInput').click();
    return;
  }
  renderCatPicker(document.getElementById('localCatPick'), (catId) => {
    pendingLocalCategory = catId;
    localCatModal.classList.add('hidden');
    document.getElementById('localFileInput').click();
  });
  localCatModal.classList.remove('hidden');
});
document.getElementById('localCatCancel').addEventListener('click', () => {
  localCatModal.classList.add('hidden');
});

document.getElementById('localFileInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  const catId = pendingLocalCategory;
  if (files.length === 0) return;
  showLoading(`Memproses 1/${files.length}…`);
  let i = 0;
  for (const f of files) {
    i++;
    showLoading(`Memproses ${i}/${files.length}: ${f.name}`);
    const type = guessType(f.name, f.type || '');
    const thumb = await makeThumb(type, f);
    const isComic = type === 'comic';
    const useCat = isComic ? null : catId;
    const name = useCat ? nextAutoName(useCat) + guessExt(f.name) : f.name;
    await dbPut({
      id: uid(),
      name,
      originalName: f.name,
      mime: f.type || '',
      type,
      category: useCat,
      size: f.size,
      blob: f,
      thumb,
      addedAt: Date.now()
    });
  }
  e.target.value = '';
  hideLoading();
  toast(files.length + ' berkas ditambahkan');
  renderGrid();
});

function guessExt(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

// ====== Tambah dari tautan Mega ======
const megaModal = document.getElementById('megaModal');
let pendingMegaCategory = null;

document.getElementById('btnAddMega').addEventListener('click', () => {
  document.getElementById('megaUrlInput').value = '';
  document.getElementById('megaStatus').textContent = '';
  pendingMegaCategory = null;
  const catPickEl = document.getElementById('megaCatPick');
  if (activeView === 'komik') {
    catPickEl.classList.add('hidden');
  } else {
    catPickEl.classList.remove('hidden');
    renderCatPicker(catPickEl, (catId) => { pendingMegaCategory = catId; });
  }
  megaModal.classList.remove('hidden');
});
document.getElementById('megaCancel').addEventListener('click', () => {
  megaModal.classList.add('hidden');
});

document.getElementById('megaConfirm').addEventListener('click', async () => {
  const url = document.getElementById('megaUrlInput').value.trim();
  const statusEl = document.getElementById('megaStatus');
  if (!url) { statusEl.textContent = 'Tempel tautan dulu.'; return; }
  if (activeView !== 'komik' && !pendingMegaCategory) { statusEl.textContent = 'Pilih kategori dulu.'; return; }
  if (!window.mega || !window.mega.File) {
    statusEl.textContent = 'Pustaka Mega belum siap. Coba lagi (butuh koneksi internet saat pertama kali).';
    return;
  }
  statusEl.textContent = 'Mengambil info berkas…';
  try {
    const mainFile = window.mega.File.fromURL(url);
    let info = await mainFile.loadAttributes();
    if (!info) throw new Error('Berkas tidak ditemukan / tautan tidak valid.');
    if (info.children) {
      const firstChild = info.find(n => !n.children, true);
      if (!firstChild) throw new Error('Folder ini kosong.');
      info = firstChild;
    }
    statusEl.textContent = `Mengunduh "${info.name}" (${fmtSize(info.size)})…`;

    const chunks = [];
    await new Promise((resolve, reject) => {
      const stream = info.download();
      stream.on('data', (d) => chunks.push(d));
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    const blob = new Blob(chunks);
    const type = guessType(info.name, '');
    statusEl.textContent = 'Membuat thumbnail…';
    const thumb = await makeThumb(type, blob);
    const isComic = type === 'comic';
    const useCat = isComic ? null : pendingMegaCategory;
    const name = useCat ? nextAutoName(useCat) + guessExt(info.name) : info.name;

    await dbPut({
      id: uid(),
      name,
      originalName: info.name,
      mime: '',
      type,
      category: useCat,
      size: info.size || blob.size,
      blob,
      thumb,
      addedAt: Date.now()
    });
    statusEl.textContent = '';
    megaModal.classList.add('hidden');
    toast('Berhasil diambil dari Mega');
    renderGrid();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Gagal mengambil dari Mega: ' + (err.message || err) +
      '. Jika terus gagal, unduh manual lalu tambah lewat "+ Perangkat".';
  }
});

// ====== Viewer ======
const viewerEl = document.getElementById('viewer');
const viewerBody = document.getElementById('viewerBody');
const viewerTitle = document.getElementById('viewerTitle');
let currentViewingId = null;
let activeObjectUrls = [];

function revokeActiveUrls() {
  activeObjectUrls.forEach(u => URL.revokeObjectURL(u));
  activeObjectUrls = [];
}

async function openViewer(id) {
  const item = await dbGet(id);
  if (!item) return;
  currentViewingId = id;
  viewerTitle.textContent = item.name;
  viewerBody.innerHTML = '';
  revokeActiveUrls();

  if (item.type === 'video') {
    await openVideoViewer(item);
  } else if (item.type === 'pdf') {
    const url = URL.createObjectURL(item.blob);
    activeObjectUrls.push(url);
    const f = document.createElement('iframe');
    f.src = url;
    viewerBody.appendChild(f);
  } else if (item.type === 'comic') {
    await openComicReader(item);
  } else {
    viewerBody.innerHTML = '<p class="muted">Jenis berkas tidak dikenali.</p>';
  }

  viewerEl.classList.remove('hidden');
}

// video player: loop otomatis + navigasi ke video lain di kategori yang sama
async function openVideoViewer(item) {
  const all = await dbGetAll();
  const siblings = (item.category ? all.filter(i => i.category === item.category && i.type === 'video') : all.filter(i => i.type === 'video'))
    .sort((a, b) => a.addedAt - b.addedAt);
  let idx = siblings.findIndex(i => i.id === item.id);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;';
  wrap.innerHTML = `
    <div id="vidTouchArea" style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;">
      <video id="mainVideo" controls autoplay loop playsinline></video>
    </div>
    <div class="video-nav">
      <button id="vidPrev" class="btn btn-ghost">‹ Sebelumnya</button>
      <span id="vidCount" class="muted"></span>
      <button id="vidNext" class="btn btn-ghost">Berikutnya ›</button>
    </div>
  `;
  viewerBody.innerHTML = '';
  viewerBody.appendChild(wrap);

  const videoEl = wrap.querySelector('#mainVideo');
  const countEl = wrap.querySelector('#vidCount');

  // swipe kiri/kanan di area video buat pindah ke video sebelumnya/berikutnya
  let vidTouchStartX = null;
  const touchArea = wrap.querySelector('#vidTouchArea');
  touchArea.addEventListener('touchstart', (e) => {
    vidTouchStartX = e.changedTouches[0].clientX;
  });
  touchArea.addEventListener('touchend', (e) => {
    if (vidTouchStartX === null) return;
    const dx = e.changedTouches[0].clientX - vidTouchStartX;
    if (Math.abs(dx) > 60) {
      if (dx < 0 && idx < siblings.length - 1) load(idx + 1);
      else if (dx > 0 && idx > 0) load(idx - 1);
    }
    vidTouchStartX = null;
  });

  function load(i) {
    idx = i;
    const cur = siblings[idx];
    const url = URL.createObjectURL(cur.blob);
    activeObjectUrls.push(url);
    videoEl.src = url;
    viewerTitle.textContent = cur.name;
    countEl.textContent = siblings.length > 1 ? (idx + 1) + ' / ' + siblings.length : '';
    currentViewingId = cur.id;
  }
  wrap.querySelector('#vidPrev').addEventListener('click', () => { if (idx > 0) load(idx - 1); });
  wrap.querySelector('#vidNext').addEventListener('click', () => { if (idx < siblings.length - 1) load(idx + 1); });

  load(idx);
}

function closeViewer() {
  viewerEl.classList.add('hidden');
  viewerBody.innerHTML = '';
  revokeActiveUrls();
  currentViewingId = null;
}
document.getElementById('viewerClose').addEventListener('click', closeViewer);

document.getElementById('viewerDelete').addEventListener('click', async () => {
  if (!currentViewingId) return;
  if (!confirm('Hapus berkas ini?')) return;
  await dbDelete(currentViewingId);
  closeViewer();
  toast('Berkas dihapus');
  renderGrid();
});

// ====== Comic (cbz/zip) reader - dibaca langsung dari zip tanpa ekstrak ke disk ======
async function openComicReader(item) {
  viewerBody.innerHTML = '<p class="muted">Membuka komik…</p>';
  try {
    const zip = await JSZip.loadAsync(item.blob);
    const imgEntries = Object.values(zip.files)
      .filter(f => !f.dir && /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    if (imgEntries.length === 0) {
      viewerBody.innerHTML = '<p class="muted">Tidak ada halaman gambar di dalam berkas ini.</p>';
      return;
    }

    let page = 0;
    const wrap = document.createElement('div');
    wrap.className = 'comic-reader';
    wrap.innerHTML = `
      <div class="comic-page-wrap"><img id="comicImg"></div>
      <div class="comic-nav">
        <button id="comicPrev" class="btn btn-ghost">‹ Sebelumnya</button>
        <span id="comicCount"></span>
        <button id="comicNext" class="btn btn-ghost">Berikutnya ›</button>
      </div>
    `;
    viewerBody.innerHTML = '';
    viewerBody.appendChild(wrap);

    const imgEl = wrap.querySelector('#comicImg');
    const countEl = wrap.querySelector('#comicCount');

    async function showPage(i) {
      page = Math.max(0, Math.min(imgEntries.length - 1, i));
      const blob = await imgEntries[page].async('blob');
      const url = URL.createObjectURL(blob);
      activeObjectUrls.push(url);
      imgEl.src = url;
      countEl.textContent = (page + 1) + ' / ' + imgEntries.length;
    }
    wrap.querySelector('#comicPrev').addEventListener('click', () => showPage(page - 1));
    wrap.querySelector('#comicNext').addEventListener('click', () => showPage(page + 1));

    let touchStartX = null;
    wrap.querySelector('.comic-page-wrap').addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].clientX;
    });
    wrap.querySelector('.comic-page-wrap').addEventListener('touchend', (e) => {
      if (touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 40) showPage(dx < 0 ? page + 1 : page - 1);
      touchStartX = null;
    });

    showPage(0);
  } catch (err) {
    console.error(err);
    viewerBody.innerHTML = '<p class="muted">Gagal membuka berkas komik: ' + (err.message || err) + '</p>';
  }
}

// ====== Loading overlay ======
function showLoading(text) {
  document.getElementById('loadingText').textContent = text || 'Memproses…';
  document.getElementById('loadingOverlay').classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

// ====== Mode true black ======
const TRUEBLACK_KEY = 'berkas_true_black';
function applyTrueBlack(on) {
  document.body.classList.toggle('true-black', on);
}
function initTrueBlack() {
  const on = localStorage.getItem(TRUEBLACK_KEY) === '1';
  document.getElementById('trueBlackToggle').checked = on;
  applyTrueBlack(on);
}
document.getElementById('trueBlackToggle').addEventListener('change', (e) => {
  localStorage.setItem(TRUEBLACK_KEY, e.target.checked ? '1' : '0');
  applyTrueBlack(e.target.checked);
});

// ====== Modal pengaturan ======
document.getElementById('btnSettings').addEventListener('click', () => {
  document.getElementById('backupStatus').textContent = '';
  document.getElementById('settingsModal').classList.remove('hidden');
});
document.getElementById('settingsClose').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.add('hidden');
});

// ====== Backup & restore ======
function backupFileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `berkas-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}

// kumpulkan semua berkas + kategori jadi satu file zip (berkas asli + manifest.json berisi metadata)
async function buildBackupZip(onProgress) {
  const zip = new JSZip();
  const items = await dbGetAll();
  const manifest = { version: 1, exportedAt: Date.now(), categories, items: [] };
  let i = 0;
  for (const item of items) {
    i++;
    if (onProgress) onProgress(i, items.length);
    const fileName = 'files/' + item.id + '_' + item.name;
    zip.file(fileName, item.blob);
    manifest.items.push({
      id: item.id, name: item.name, originalName: item.originalName, mime: item.mime,
      type: item.type, category: item.category, size: item.size, thumb: item.thumb,
      addedAt: item.addedAt, fileName
    });
  }
  zip.file('manifest.json', JSON.stringify(manifest));
  return zip.generateAsync({ type: 'blob' });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

document.getElementById('btnBackupDownload').addEventListener('click', async () => {
  const statusEl = document.getElementById('backupStatus');
  showLoading('Menyiapkan cadangan…');
  try {
    const blob = await buildBackupZip((done, total) => showLoading(`Menyiapkan cadangan… (${done}/${total})`));
    triggerDownload(blob, backupFileName());
    statusEl.textContent = 'Cadangan diunduh ke folder Download HP kamu.';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Gagal membuat cadangan: ' + (err.message || err);
  } finally {
    hideLoading();
  }
});

document.getElementById('btnBackupShare').addEventListener('click', async () => {
  const statusEl = document.getElementById('backupStatus');
  showLoading('Menyiapkan cadangan…');
  try {
    const blob = await buildBackupZip((done, total) => showLoading(`Menyiapkan cadangan… (${done}/${total})`));
    const filename = backupFileName();
    const file = new File([blob], filename, { type: 'application/zip' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Cadangan Berkas' });
      statusEl.textContent = '';
    } else {
      statusEl.textContent = 'Berbagi file tidak didukung di browser ini — diunduh saja.';
      triggerDownload(blob, filename);
    }
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      console.error(err);
      statusEl.textContent = 'Gagal berbagi cadangan: ' + (err.message || err);
    }
  } finally {
    hideLoading();
  }
});

document.getElementById('btnRestore').addEventListener('click', () => {
  document.getElementById('restoreFileInput').click();
});

document.getElementById('restoreFileInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const statusEl = document.getElementById('backupStatus');
  if (!confirm('Pulihkan cadangan ini? Berkas yang sudah ada tetap aman, hanya berkas dari cadangan yang ditambahkan/ditimpa.')) return;
  showLoading('Membaca cadangan…');
  try {
    const zip = await JSZip.loadAsync(file);
    const manifestEntry = zip.file('manifest.json');
    if (!manifestEntry) throw new Error('Bukan file cadangan Berkas yang valid.');
    const manifest = JSON.parse(await manifestEntry.async('string'));
    if (Array.isArray(manifest.categories) && manifest.categories.length) {
      categories = manifest.categories;
      saveCategories(categories);
    }
    const total = (manifest.items || []).length;
    let i = 0;
    for (const meta of manifest.items || []) {
      i++;
      showLoading(`Memulihkan… (${i}/${total})`);
      const entry = zip.file(meta.fileName);
      if (!entry) continue;
      const blob = await entry.async('blob');
      await dbPut({
        id: meta.id, name: meta.name, originalName: meta.originalName, mime: meta.mime,
        type: meta.type, category: meta.category, size: meta.size, blob,
        thumb: meta.thumb, addedAt: meta.addedAt
      });
    }
    statusEl.textContent = `Cadangan dipulihkan (${total} berkas).`;
    renderTabs();
    renderGrid();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Gagal memulihkan cadangan: ' + (err.message || err);
  } finally {
    hideLoading();
  }
});

// ====== Service worker (mode offline) ======
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ====== Init ======
initTrueBlack();
initLock();
