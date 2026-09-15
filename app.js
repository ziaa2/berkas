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

// ====== Render library ======
async function renderGrid() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('emptyState');
  const items = await dbGetAll();
  grid.innerHTML = '';
  empty.classList.toggle('hidden', items.length > 0);

  const icons = { video: '▶', pdf: '▤', comic: '▥', other: '▢' };

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-icon">${icons[item.type] || icons.other}</div>
      <div class="card-name">${escapeHtml(item.name)}</div>
      <div class="card-meta">${fmtSize(item.size)}</div>
    `;
    card.addEventListener('click', () => openViewer(item.id));
    grid.appendChild(card);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ====== Add from local device ======
document.getElementById('btnAddLocal').addEventListener('click', () => {
  document.getElementById('localFileInput').click();
});

document.getElementById('localFileInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    const type = guessType(f.name, f.type || '');
    await dbPut({
      id: uid(),
      name: f.name,
      mime: f.type || '',
      type,
      size: f.size,
      blob: f,
      addedAt: Date.now()
    });
  }
  e.target.value = '';
  toast(files.length + ' berkas ditambahkan');
  renderGrid();
});

// ====== Add from Mega link ======
const megaModal = document.getElementById('megaModal');
document.getElementById('btnAddMega').addEventListener('click', () => {
  document.getElementById('megaUrlInput').value = '';
  document.getElementById('megaStatus').textContent = '';
  megaModal.classList.remove('hidden');
});
document.getElementById('megaCancel').addEventListener('click', () => {
  megaModal.classList.add('hidden');
});

document.getElementById('megaConfirm').addEventListener('click', async () => {
  const url = document.getElementById('megaUrlInput').value.trim();
  const statusEl = document.getElementById('megaStatus');
  if (!url) { statusEl.textContent = 'Tempel tautan dulu.'; return; }
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
    await dbPut({
      id: uid(),
      name: info.name,
      mime: '',
      type,
      size: info.size || blob.size,
      blob,
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
    const url = URL.createObjectURL(item.blob);
    activeObjectUrls.push(url);
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    v.autoplay = true;
    viewerBody.appendChild(v);
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

    // swipe/tap navigasi di gambar
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

// ====== Service worker (mode offline) ======
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ====== Init ======
renderGrid();
