// Çark: sürüklenen dosyanın türüne göre seçenekleri halka şeklinde gösterir.
const api = window.shiftdrop;
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const segG = $('segments');

const C = 240;          // merkez
const R1 = 98;          // iç yarıçap
const R2 = 214;         // dış yarıçap
const INSET = 6;        // yuvarlak köşe için içeri çekme (stroke-width / 2)
const PAGE = 8;
const NS = 'http://www.w3.org/2000/svg';

const t = api.t;
const MODE_NAME = { convert: t('Dönüştür'), tools: t('Araçlar'), actions: t('Eylemler') };
const MODE_VERB = { convert: t('Dönüştürülüyor'), tools: t('İşleniyor'), actions: t('Yapılıyor') };
const MOD_FLAG = { Shift: 'shiftKey', Ctrl: 'ctrlKey', Alt: 'altKey', Super: 'metaKey' };

const st = {
  mode: 'convert',
  keys: { convert: 'Shift', tools: 'Ctrl', actions: 'Alt' },
  phase: 'closed',      // closed | drag | pick | busy | done
  source: 'key',
  paths: null,          // bırakmadan sonra gerçek yollar
  guess: null,          // bırakmadan önce MIME'dan tahmin edilen sahte yollar
  data: null,           // { title, cat, items }
  page: 0,
  hover: -1,            // dilim indeksi, -2 = merkez
  mods: {},
  dwell: null,
  leaveTimer: null,
  doneTimer: null,
  result: null,
};

// ---------- MIME → tahmini uzantı (bırakmadan önce dosya adı bilinmez) ----------

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heic',
  'image/tiff': 'tiff', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/webm': 'webm', 'video/x-msvideo': 'avi', 'video/x-ms-wmv': 'wmv',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
  'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff', 'audio/x-ms-wma': 'wma',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/msword': 'doc',
  'application/vnd.oasis.opendocument.text': 'odt', 'application/rtf': 'rtf', 'text/rtf': 'rtf', 'text/plain': 'txt', 'text/markdown': 'md',
  'text/x-markdown': 'md', 'text/html': 'html', 'application/epub+zip': 'epub',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods', 'text/csv': 'csv', 'text/tab-separated-values': 'tsv',
  'application/x-subrip': 'srt', 'text/vtt': 'vtt',
  'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'application/x-tar': 'tar', 'application/gzip': 'tar.gz',
  'application/x-compressed-tar': 'tar.gz', 'application/vnd.rar': 'rar', 'application/x-rar-compressed': 'rar', 'application/x-7z-compressed': '7z',
};
function guessExt(mime) {
  if (MIME_EXT[mime]) return MIME_EXT[mime];
  if (/^image\//.test(mime)) return 'png';
  if (/^video\//.test(mime)) return 'mp4';
  if (/^audio\//.test(mime)) return 'mp3';
  return '';
}

function guessFromDrag(dt) {
  const files = [...(dt.items || [])].filter((i) => i.kind === 'file');
  if (!files.length) return null;
  const exts = files.map((i) => guessExt(i.type));
  if (exts.some((e) => !e)) return { count: files.length, paths: null };
  return { count: files.length, paths: exts.map((e, i) => `/tahmin/dosya${i}.${e}`) };
}

// ---------- Geometri ----------

const rad = (deg) => (deg * Math.PI) / 180;
const pt = (r, deg) => [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))];

function sectorPath(a0, a1) {
  // Açısal boşluğu yarıçapa göre piksel cinsinden sabit tut, köşe yuvarlaması için içeri çek.
  const gapOuter = ((INSET + 3) / R2) * (180 / Math.PI);
  const gapInner = ((INSET + 3) / R1) * (180 / Math.PI);
  const r1 = R1 + INSET; const r2 = R2 - INSET;
  const [x0, y0] = pt(r2, a0 + gapOuter); const [x1, y1] = pt(r2, a1 - gapOuter);
  const [x2, y2] = pt(r1, a1 - gapInner); const [x3, y3] = pt(r1, a0 + gapInner);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0} A${r2} ${r2} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r1} ${r1} 0 ${large} 0 ${x3} ${y3} Z`;
}

function visibleItems() {
  const items = st.data?.items || [];
  if (items.length <= PAGE) return items;
  const per = PAGE - 1;
  const pages = Math.ceil(items.length / per);
  const page = st.page % pages;
  return [...items.slice(page * per, page * per + per), { id: '__more', label: t('Diğer'), hint: `${page + 1}/${pages}`, icon: 'more', more: true }];
}

function hitTest(x, y) {
  const dx = x - C; const dy = y - C;
  const r = Math.hypot(dx, dy);
  if (r < R1) return -2;
  if (r > R2 + 14) return -1;
  const n = visibleItems().length;
  if (!n) return -1;
  const step = 360 / n;
  let a = (Math.atan2(dy, dx) * 180) / Math.PI + 90 + step / 2; // 0° = üstteki dilimin ortası
  a = ((a % 360) + 360) % 360;
  return Math.floor(a / step);
}

// ---------- Çizim ----------

function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

function render(anim = 'open') {
  segG.innerHTML = '';
  const items = visibleItems();
  if (!items.length) {
    // Tür bilinmiyor ya da dosya bekleniyor: kesik çizgili halka
    svg('circle', { cx: C, cy: C, r: (R1 + R2) / 2, class: 'placeholder-disc', 'stroke-width': R2 - R1, fill: 'none', stroke: 'currentColor' }, segG).style.opacity = 0;
    svg('circle', { cx: C, cy: C, r: R2 - 10, class: 'placeholder' }, segG);
    svg('circle', { cx: C, cy: C, r: R1 + 10, class: 'placeholder' }, segG);
  }
  const n = items.length;
  const step = 360 / Math.max(n, 1);
  items.forEach((it, i) => {
    const mid = -90 + i * step;
    const a0 = mid - step / 2; const a1 = mid + step / 2;
    const g = svg('g', { class: `seg${it.more ? ' more' : ''}`, 'data-i': i }, segG);
    g.style.setProperty('--i', i);
    g.style.setProperty('--dx', `${Math.cos(rad(mid)) * 8}px`);
    g.style.setProperty('--dy', `${Math.sin(rad(mid)) * 8}px`);
    svg('path', { class: 'bg', d: n === 1 ? ringPath() : sectorPath(a0, a1) }, g);
    const [lx, ly] = pt((R1 + R2) / 2, mid);
    if (it.icon) {
      const ic = svg('g', { class: 'glyph', transform: `translate(${lx - 11} ${ly - 27})`, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      ic.innerHTML = window.ICONS[it.icon] || '';
      text(g, it.label, lx, ly + 10, 'label small');
      text(g, it.hint, lx, ly + 25, 'hint');
    } else {
      text(g, it.label, lx, ly + 3, `label${it.label.length > 5 ? ' small' : ''}`);
      text(g, it.hint, lx, ly + 20, 'hint');
    }
  });
  stage.classList.remove('swap');
  if (anim === 'swap') { void stage.offsetWidth; stage.classList.add('swap'); }
  renderModes();
  renderPages();
  setHover(st.hover, true);
}

function ringPath() {
  const r1 = R1 + INSET; const r2 = R2 - INSET;
  return `M${C - r2} ${C} a${r2} ${r2} 0 1 0 ${2 * r2} 0 a${r2} ${r2} 0 1 0 ${-2 * r2} 0 M${C - r1} ${C} a${r1} ${r1} 0 1 1 ${2 * r1} 0 a${r1} ${r1} 0 1 1 ${-2 * r1} 0`;
}

function text(parent, str, x, y, cls) {
  const t = svg('text', { x, y, class: cls, 'text-anchor': 'middle' }, parent);
  t.textContent = str;
  return t;
}

function renderModes() {
  $('modes').innerHTML = Object.keys(MODE_NAME)
    .map((m) => `<span class="mode${m === st.mode ? ' active' : ''}"><kbd>${st.keys[m]}</kbd></span>`).join('');
  $('title').textContent = st.data && !st.data.items.length && st.phase !== 'pick' ? t('Bırak') : MODE_NAME[st.mode];
  const cat = st.data?.cat || 'other';
  const icon = $('catIcon');
  if (!st.data) { icon.className = 'logo'; icon.innerHTML = window.TANGERINE; } else { icon.className = ''; icon.innerHTML = window.icon(cat, 30); }
  let sub;
  if (st.phase === 'pick' && !st.paths) sub = t('Dosyayı buraya bırak');
  else if (!st.data) sub = t('Dosya bekleniyor');
  else if (!st.data.items.length) sub = t(st.paths ? 'Bu tür için seçenek yok' : 'sonra seç');
  else if (st.paths && st.paths.length === 1) sub = st.paths[0].split(/[\\/]/).pop();
  else sub = st.data.title;
  $('subtitle').textContent = sub;
}

function renderPages() {
  const items = st.data?.items || [];
  const pages = items.length > PAGE ? Math.ceil(items.length / (PAGE - 1)) : 0;
  $('pages').innerHTML = pages ? Array.from({ length: pages }, (_, i) => `<i class="${i === st.page % pages ? 'on' : ''}"></i>`).join('') : '';
}

function setHover(i, force = false) {
  if (i === st.hover && !force) return;
  st.hover = i;
  const segs = segG.querySelectorAll('.seg');
  segs.forEach((s) => s.classList.toggle('hover', +s.dataset.i === i));
  segG.classList.toggle('has-hover', i >= 0);
  stage.classList.toggle('center-hot', i === -2 && st.phase === 'drag');
  // "Diğer" üzerinde biraz bekleyince sonraki sayfa
  clearTimeout(st.dwell);
  const it = visibleItems()[i];
  if (it && it.more) st.dwell = setTimeout(() => { st.page++; st.hover = -1; render('swap'); }, 650);
}

// ---------- Veri ----------

async function loadOptions(paths) {
  st.data = await api.options(paths, st.mode);
  st.page = 0;
}

async function refresh(anim) {
  const paths = st.paths || st.guess;
  if (paths) await loadOptions(paths);
  else if (st.guessCount) st.data = { title: `${st.guessCount} dosya`, cat: st.guessCount > 1 ? 'mixed' : 'other', items: [] };
  else st.data = null;
  render(anim);
}

async function setMode(mode) {
  if (mode === st.mode || !MODE_NAME[mode]) return;
  st.mode = mode;
  st.hover = -1;
  await refresh('swap');
}

// ---------- Aç / kapat ----------

function resetState() {
  Object.assign(st, { paths: null, guess: null, guessCount: 0, data: null, page: 0, hover: -1, mods: {}, result: null });
  clearTimeout(st.doneTimer); clearTimeout(st.leaveTimer); clearTimeout(st.dwell);
}

api.on('wheel:open', async ({ mode, source, keys }) => {
  resetState();
  st.keys = keys || st.keys;
  st.mode = mode;
  st.source = source;
  st.phase = source === 'shortcut' ? 'pick' : 'drag';
  stage.className = 'opening';
  render();
  requestAnimationFrame(() => { stage.className = 'open'; });
});
api.on('wheel:mode', ({ mode }) => { if (st.phase === 'drag' || st.phase === 'pick') setMode(mode); });
api.on('wheel:close', () => {
  stage.classList.add('closing');
  setTimeout(() => { stage.className = 'closed'; st.phase = 'closed'; resetState(); segG.innerHTML = ''; }, 190);
});

function dismiss() { api.dismiss(); }

// ---------- Sürükle-bırak ----------

function readModifiers(e) {
  // Tuşa yeni basıldıysa çarkı değiştir (bırakınca değişmez, Tangerine gibi).
  for (const [mode, key] of Object.entries(st.keys)) {
    const down = !!e[MOD_FLAG[key]];
    if (down && !st.mods[mode]) setMode(mode);
    st.mods[mode] = down;
  }
}

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  clearTimeout(st.leaveTimer);
  if (st.phase === 'closed' || st.phase === 'busy' || st.phase === 'done') return;
  if (!st.paths) {
    const g = guessFromDrag(e.dataTransfer);
    if (g && (g.count !== st.guessCount || (g.paths || []).join() !== (st.guess || []).join())) {
      st.guessCount = g.count;
      st.guess = g.paths;
      refresh(st.data ? 'swap' : 'open');
    }
  }
});

// Kaynağın izin verdiği işlemlerden "kopyala"yı seç: Shift basılıyken dosya yöneticisi yalnızca "taşı" önerebilir.
function dropEffectFor(dt) {
  const a = (dt.effectAllowed || 'all').toLowerCase();
  if (a === 'all' || a === 'uninitialized' || a.includes('copy')) return 'copy';
  if (a.includes('link')) return 'link';
  return 'move';
}

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (st.phase === 'busy' || st.phase === 'done') { e.dataTransfer.dropEffect = 'none'; return; }
  e.dataTransfer.dropEffect = dropEffectFor(e.dataTransfer);
  readModifiers(e);
  setHover(hitTest(e.clientX, e.clientY));
});

document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget) return;
  if (e.clientX > 0 && e.clientY > 0 && e.clientX < 480 && e.clientY < 480) return;
  setHover(-1);
  // Pencereden çıkıp geri gelmezse kapan (Wayland balonu gibi genel fare dinlemesi olmayan durumlar için).
  clearTimeout(st.leaveTimer);
  st.leaveTimer = setTimeout(() => { if (st.phase === 'drag') dismiss(); }, 1400);
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (st.phase === 'busy' || st.phase === 'done') return;
  const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean);
  if (!paths.length) { dismiss(); return; }
  const hit = hitTest(e.clientX, e.clientY);
  const items = visibleItems();
  const known = !!st.guess && items.length;
  st.paths = paths;

  if (known && hit >= 0 && items[hit] && !items[hit].more) {
    // Tahmin doğruysa seçilen dilimin kimliği gerçek listede de vardır.
    await loadOptions(paths);
    const chosen = items[hit];
    const real = st.data.items.find((x) => x.id === chosen.id);
    if (real) { run(real); return; }
  }
  if (known && hit === -2 && st.phase === 'drag') { dismiss(); return; } // merkeze bırakmak = vazgeç

  // Tür önceden bilinmiyordu ya da merkez dışına bırakıldı: bırak, sonra tıklayarak seç.
  st.phase = 'pick';
  api.setBusy(true); // seçim yapılana kadar açık kalsın
  await refresh('swap');
});

// Seçim aşamasında fareyle tıklama
document.addEventListener('mousemove', (e) => { if (st.phase === 'pick' && st.paths) setHover(hitTest(e.clientX, e.clientY)); });
document.addEventListener('mouseleave', () => { if (st.phase === 'pick') setHover(-1); });
document.addEventListener('click', (e) => {
  if (st.phase !== 'pick') return;
  const hit = hitTest(e.clientX, e.clientY);
  const it = visibleItems()[hit];
  if (it && it.more) { st.page++; st.hover = -1; render('swap'); return; }
  if (it && st.paths) { run(it); return; }
  if (hit === -2 && st.paths) {
    // Merkeze tıklamak modlar arasında dolaşır
    const order = Object.keys(MODE_NAME);
    setMode(order[(order.indexOf(st.mode) + 1) % order.length]);
    return;
  }
  if (hit === -1) { api.setBusy(false); dismiss(); }
});
document.addEventListener('wheel', (e) => {
  if (st.phase !== 'pick' && st.phase !== 'drag') return;
  const items = st.data?.items || [];
  const pages = Math.ceil(items.length / (PAGE - 1));
  if (items.length > PAGE) { st.page = (st.page + (e.deltaY > 0 ? 1 : pages - 1)) % pages; render('swap'); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && st.phase !== 'busy') { api.setBusy(false); dismiss(); }
});

// ---------- Çalıştır ----------

async function run(item) {
  st.phase = 'busy';
  api.setBusy(true);
  stage.classList.add('busy');
  setProgress(0);
  $('busyLabel').textContent = MODE_VERB[st.mode];
  $('pct').textContent = st.mode === 'actions' ? '…' : '0%';
  let results;
  try {
    results = await api.perform(st.paths, st.mode, item.id);
  } catch (err) {
    results = [{ ok: false, error: err.message }];
  }
  stage.classList.remove('busy');
  if (results.length && results.every((r) => r.cancelled)) { st.phase = 'drag'; api.setBusy(false); dismiss(); return; }
  showResult(results, item);
}

api.on('progress', (p) => {
  if (st.phase !== 'busy') return;
  setProgress(p);
  $('pct').textContent = `${Math.round(p * 100)}%`;
});

function setProgress(p) {
  const len = 2 * Math.PI * 84;
  $('progress').style.strokeDashoffset = `${len * (1 - Math.max(0.02, p))}`;
}

const fileName = (p) => (p || '').split(/[\\/]/).pop();

function showResult(results, item) {
  st.phase = 'done';
  const ok = results.filter((r) => r.ok);
  const fails = results.filter((r) => !r.ok);
  const outs = ok.map((r) => r.out).filter(Boolean);
  const card = $('result');
  card.className = '';
  st.result = outs[0] || null;

  if (!ok.length) {
    card.classList.add('error');
    $('resultIcon').innerHTML = window.icon('x', 28);
    $('resultName').textContent = t('Olmadı');
    $('resultMeta').textContent = fails[0]?.error || t('Bilinmeyen hata');
    $('btnReveal').textContent = t('Kaynağı göster');
    st.result = st.paths[0];
  } else {
    $('resultIcon').innerHTML = window.icon('check', 28);
    $('btnReveal').textContent = t('Klasörde göster');
    if (!outs.length) {
      card.classList.add('noout');
      $('resultName').textContent = ok[0].note || t('Tamam');
      $('resultMeta').textContent = st.paths.length > 1 ? t('{n} dosya', { n: st.paths.length }) : fileName(st.paths[0]);
    } else {
      $('resultName').textContent = outs.length > 1 ? t('{n} dosya hazır', { n: outs.length }) : fileName(outs[0]);
      const extra = fails.length ? ` · ${t('{n} hata', { n: fails.length })}: ${fails[0].error}` : '';
      $('resultMeta').textContent = (outs.length > 1 ? fileName(outs[0]) + ' …' : item.label + (item.hint ? ` · ${item.hint}` : '')) + extra;
    }
    burst();
  }
  stage.classList.add('done');
  card.setAttribute('draggable', st.result && ok.length ? 'true' : 'false');
  armDoneTimer(3200);
}

function armDoneTimer(ms) {
  clearTimeout(st.doneTimer);
  st.doneTimer = setTimeout(() => { api.setBusy(false); }, ms);
}
$('result').addEventListener('mouseenter', () => { clearTimeout(st.doneTimer); api.setBusy(true); });
$('result').addEventListener('mouseleave', () => { if (st.phase === 'done') armDoneTimer(1400); });
$('btnReveal').addEventListener('click', (e) => { e.stopPropagation(); if (st.result) api.reveal(st.result); api.setBusy(false); });
$('btnOpen').addEventListener('click', (e) => { e.stopPropagation(); if (st.result) api.openPath(st.result); api.setBusy(false); });
$('result').addEventListener('dragstart', (e) => {
  e.preventDefault();
  if (st.result) api.startDrag(st.result);
});

function burst() {
  const b = $('burst');
  b.innerHTML = '';
  for (let i = 0; i < 14; i++) {
    const el = document.createElement('i');
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
    const d = 120 + Math.random() * 70;
    el.style.setProperty('--x', `${Math.cos(a) * d}px`);
    el.style.setProperty('--y', `${Math.sin(a) * d}px`);
    el.style.animationDelay = `${Math.random() * 60}ms`;
    if (i % 5 === 0) el.className = 'leaf';
    b.appendChild(el);
  }
}

// Sabit HTML metinlerini çevir
document.documentElement.lang = api.lang;
for (const id of ['btnOpen', 'resultHint']) $(id).textContent = t($(id).textContent);
