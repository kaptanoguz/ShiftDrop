// Dönüşüm ve dosya araçları motoru. Electron'a bağlı değildir; düz Node ile de çalışır (testler bunu kullanır).
// Her şey yerelde çalışır: ffmpeg (paketle gelir), sharp, pdf-lib ve varsa sistemdeki LibreOffice / poppler / ghostscript.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const IS_WIN = process.platform === 'win32';

// Paketlenmiş uygulamada ikili dosyalar app.asar.unpacked altındadır.
const unpacked = (p) => (p ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) : p);
const FFMPEG = unpacked(require('ffmpeg-static'));

let sharp = null;
try { sharp = require('sharp'); } catch { /* sharp yoksa görseller ffmpeg ile yapılır */ }
const { PDFDocument, degrees } = require('pdf-lib');

// ---------- Yardımcılar ----------

const whichCache = new Map();
function which(cmd) {
  if (whichCache.has(cmd)) return whichCache.get(cmd);
  const extra = IS_WIN
    ? ['C:\\Program Files\\7-Zip', 'C:\\Program Files\\LibreOffice\\program', path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')]
    : ['/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/libreoffice/program'];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean).concat(extra);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  let found = null;
  for (const d of dirs) for (const e of exts) {
    const p = path.join(d, cmd + e);
    if (!found && fs.existsSync(p)) found = p;
  }
  whichCache.set(cmd, found);
  return found;
}
const soffice = () => which('soffice') || which('libreoffice') ||
  ['/Applications/LibreOffice.app/Contents/MacOS/soffice', 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'].find((p) => fs.existsSync(p)) || null;

function run(cmd, args, { onStderr, timeout = 0, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd });
    let out = '';
    let err = '';
    let timer = timeout ? setTimeout(() => proc.kill('SIGKILL'), timeout) : null;
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err = (err + d).slice(-6000); onStderr && onStderr(d.toString()); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').pop() || `${path.basename(cmd)} çıkış kodu ${code}`));
    });
  });
}

function ffmpeg(args, onProgress) {
  let duration = 0;
  return run(FFMPEG, ['-hide_banner', '-y', ...args], {
    onStderr: (s) => {
      const dm = s.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (dm) duration = +dm[1] * 3600 + +dm[2] * 60 + +dm[3];
      const tm = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (tm && duration && onProgress) onProgress(Math.min(0.99, (+tm[1] * 3600 + +tm[2] * 60 + +tm[3]) / duration));
    },
  });
}

async function mediaDuration(src) {
  // ffmpeg -i çıktı dosyası olmadan hata koduyla döner; süreyi stderr'den okuyoruz.
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-i', src]);
    let s = '';
    p.stderr.on('data', (d) => { s += d; });
    p.on('close', () => {
      const m = s.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      resolve(m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0);
    });
  });
}

const extOf = (p) => {
  const b = path.basename(p).toLowerCase();
  if (b.endsWith('.tar.gz')) return 'tar.gz';
  return path.extname(b).slice(1);
};
const baseOf = (p) => path.basename(p).replace(/\.tar\.gz$/i, '').replace(/\.[^.]+$/, '');

function uniquePath(dir, base, ext) {
  const name = (i) => path.join(dir, `${base}${i ? ` (${i})` : ''}${ext ? `.${ext}` : ''}`);
  let i = 0;
  while (fs.existsSync(name(i))) i++;
  return name(i);
}
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shiftdrop-'));
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

// ---------- Kategoriler ----------

const CATS = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'tif', 'tiff', 'avif', 'bmp', 'gif', 'svg', 'ico'],
  video: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'm4v', 'flv', 'mpg', 'mpeg', '3gp', 'ts'],
  audio: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'oga', 'opus', 'aiff', 'aif', 'wma', 'aac'],
  pdf: ['pdf'],
  document: ['docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'markdown', 'html', 'htm', 'epub'],
  slides: ['pptx', 'ppt', 'odp', 'key'],
  sheet: ['xlsx', 'xls', 'ods', 'csv', 'tsv'],
  subtitle: ['srt', 'vtt', 'ass'],
  archive: ['zip', 'tar', 'gz', 'tgz', 'tar.gz', 'rar', '7z'],
};
function categoryOf(file) {
  const ext = extOf(file);
  for (const [cat, list] of Object.entries(CATS)) if (list.includes(ext)) return cat;
  return 'other';
}

const CAT_TITLE = {
  image: 'Görsel', video: 'Video', audio: 'Ses', pdf: 'PDF', document: 'Belge', slides: 'Sunum',
  sheet: 'Tablo', subtitle: 'Altyazı', archive: 'Arşiv', other: 'Dosya', mixed: 'Dosyalar',
};

const norm = (e) => ({ jpeg: 'jpg', tif: 'tiff', htm: 'html', markdown: 'md', aif: 'aiff', oga: 'ogg', tgz: 'tar.gz' }[e] || e);

// ---------- Dönüştürme hedefleri (Shift) ----------

const CONVERT_TARGETS = {
  image: [['png', 'Kayıpsız'], ['jpg', 'Küçük'], ['webp', 'Web'], ['avif', 'En verimli'], ['pdf', 'Belge'], ['tiff', 'Baskı'], ['gif', 'Uyumlu'], ['bmp', 'Ham'], ['ico', 'Simge']],
  video: [['mp4', 'H.264'], ['mov', 'QuickTime'], ['mkv', 'Matroska'], ['webm', 'VP9'], ['gif', 'Animasyon'], ['mp3', 'Sesi çıkar'], ['avi', 'Eski'], ['wmv', 'Windows']],
  audio: [['mp3', '192 kbps'], ['m4a', 'AAC'], ['wav', 'Kayıpsız'], ['flac', 'Kayıpsız'], ['ogg', 'Vorbis'], ['opus', 'Konuşma'], ['aiff', 'Apple'], ['wma', 'Windows']],
  pdf: [['docx', 'Word'], ['png', '300 DPI'], ['jpg', '300 DPI'], ['txt', 'Metin'], ['md', 'Markdown'], ['html', 'Web'], ['odt', 'OpenDoc'], ['epub', 'E-kitap']],
  document: [['pdf', 'Yazdır'], ['docx', 'Word'], ['odt', 'OpenDoc'], ['md', 'Markdown'], ['txt', 'Metin'], ['html', 'Web'], ['rtf', 'Zengin'], ['epub', 'E-kitap']],
  slides: [['pdf', 'Belge'], ['pptx', 'PowerPoint'], ['odp', 'Impress'], ['png', 'Slaytlar'], ['jpg', 'Slaytlar']],
  sheet: [['xlsx', 'Excel'], ['ods', 'Calc'], ['csv', 'Virgül'], ['tsv', 'Sekme'], ['pdf', 'Yazdır'], ['html', 'Web']],
  subtitle: [['srt', 'SubRip'], ['vtt', 'WebVTT'], ['ass', 'SSA'], ['txt', 'Sadece metin']],
  archive: [['zip', 'Evrensel'], ['tar.gz', 'Unix'], ['tar', 'Sıkıştırmasız'], ['extract', 'Klasöre aç']],
};

// ---------- Araçlar (Ctrl) ----------

const TOOLS = {
  image: [['compress', 'Sıkıştır', 'Aynı format', 'compress'], ['half', 'Yarıya indir', '%50', 'resize'], ['fit1080', '1080 px', 'Sığdır', 'resize'],
    ['rotate', 'Döndür', '90°', 'rotate'], ['flip', 'Aynala', 'Yatay', 'flip'], ['square', 'Kare kırp', 'Ortadan', 'crop'],
    ['gray', 'Gri ton', 'Siyah-beyaz', 'gray'], ['strip', 'Meta sil', 'EXIF/GPS', 'shield']],
  video: [['compress', 'Sıkıştır', 'CRF 28', 'compress'], ['720p', '720p', 'Küçült', 'resize'], ['mute', 'Sessiz', 'Sesi at', 'mute'],
    ['rotate', 'Döndür', '90°', 'rotate'], ['speed2', '2× hız', 'Hızlandır', 'speed'], ['reverse', 'Tersine', 'Geri sar', 'reverse'],
    ['split2', 'Böl', '2 parça', 'split'], ['thumb', 'Kare al', 'Orta kare', 'image']],
  audio: [['compress', 'Sıkıştır', '128 kbps', 'compress'], ['normalize', 'Normalize', 'Ses seviyesi', 'wave'], ['trimsilence', 'Sessizlik kırp', 'Baş/son', 'scissors'],
    ['mono', 'Mono', 'Tek kanal', 'wave'], ['speed2', '2× hız', 'Hızlandır', 'speed'], ['reverse', 'Tersine', 'Geri sar', 'reverse'],
    ['split2', 'Böl', '2 parça', 'split'], ['fade', 'Fade', 'Giriş/çıkış', 'wave']],
  pdf: [['compress', 'Sıkıştır', 'Ghostscript', 'compress'], ['splitpages', 'Sayfalara böl', 'Her sayfa', 'split'], ['rotate', 'Döndür', '90°', 'rotate'],
    ['reversepages', 'Ters sırala', 'Sayfalar', 'reverse'], ['firstpage', 'Kapak', 'İlk sayfa PNG', 'image'], ['strip', 'Meta sil', 'Yazar vb.', 'shield']],
};

// ---------- Seçenek listesi ----------

function optionsFor(paths, mode) {
  const cats = [...new Set(paths.map(categoryOf))];
  const cat = cats.length === 1 ? cats[0] : 'mixed';
  const ext = paths.length === 1 ? norm(extOf(paths[0])) : null;
  const title = paths.length > 1 ? `${paths.length} ${CAT_TITLE[cat] === 'Dosyalar' ? 'dosya' : CAT_TITLE[cat].toLowerCase()}` : CAT_TITLE[cat];

  if (mode === 'convert') {
    const list = (CONVERT_TARGETS[cat] || []).filter(([t]) => t !== ext);
    const items = list.map(([t, hint]) => ({
      id: t, label: t === 'extract' ? 'Aç' : t.toUpperCase(), hint, icon: t === 'extract' ? 'unzip' : null,
    }));
    return { title, cat, items };
  }

  if (mode === 'tools') {
    const items = (TOOLS[cat] || []).map(([id, label, hint, icon]) => ({ id, label, hint, icon }));
    const mergeable = paths.length > 1 && ['pdf', 'image', 'video', 'audio'].includes(cat);
    if (mergeable) items.unshift({ id: 'merge', label: 'Birleştir', hint: cat === 'image' ? 'Tek PDF' : 'Tek dosya', icon: 'merge' });
    items.push({ id: 'zip', label: 'ZIP', hint: 'Arşivle', icon: 'zip' });
    return { title, cat, items: items.slice(0, 16) };
  }

  // Dosya eylemleri (Alt): main süreçte çalışır, burada sadece liste var.
  return {
    title, cat,
    items: [
      { id: 'float', label: 'Yüzdür', hint: 'Üstte tut', icon: 'float' },
      { id: 'copy', label: 'Kopyala', hint: 'Panoya', icon: 'copy' },
      { id: 'move', label: 'Taşı…', hint: 'Klasöre', icon: 'move' },
      { id: 'duplicate', label: 'Çoğalt…', hint: 'Kopyasını koy', icon: 'duplicate' },
      { id: 'path', label: 'Yolu kopyala', hint: 'Metin', icon: 'link' },
      { id: 'terminal', label: 'Terminal', hint: 'Bu klasörde', icon: 'terminal' },
      { id: 'reveal', label: 'Göster', hint: 'Dosya yöneticisi', icon: 'folder' },
      { id: 'trash', label: 'Çöpe at', hint: 'Geri alınabilir', icon: 'trash' },
    ],
  };
}

// ---------- Görseller ----------

async function imageConvert(src, to, dir, base) {
  if (to === 'pdf') return imagesToPdf([src], dir, base);
  const out = uniquePath(dir, base, to);
  const viaFfmpeg = () => ffmpeg(['-i', src, '-frames:v', '1', ...(to === 'ico' ? ['-vf', "scale='min(256,iw)':'min(256,ih)':force_original_aspect_ratio=decrease"] : []), out]);
  if (!sharp || ['bmp', 'ico'].includes(to)) { await viaFfmpeg(); return out; }
  try {
    let img = sharp(src, { animated: to === 'gif' || to === 'webp' }).rotate();
    if (to === 'jpg') img = img.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true });
    else if (to === 'png') img = img.png({ compressionLevel: 9 });
    else if (to === 'webp') img = img.webp({ quality: 85 });
    else if (to === 'avif') img = img.avif({ quality: 60 });
    else if (to === 'tiff') img = img.tiff({ compression: 'lzw' });
    else if (to === 'gif') img = img.gif();
    await img.toFile(out);
  } catch (e) {
    rm(out);
    await viaFfmpeg(); // ör. HEIC: sharp çözemezse ffmpeg dene
  }
  return out;
}

async function imagesToPdf(srcs, dir, base) {
  const doc = await PDFDocument.create();
  for (const src of srcs) {
    const buf = sharp ? await sharp(src).rotate().png().toBuffer() : fs.readFileSync(src);
    const img = await doc.embedPng(buf);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const out = uniquePath(dir, base, 'pdf');
  fs.writeFileSync(out, await doc.save());
  return out;
}

async function imageTool(src, tool, dir, base) {
  const ext = norm(extOf(src));
  const keepExt = ['png', 'jpg', 'webp', 'avif', 'tiff', 'gif'].includes(ext) ? ext : 'png';
  const suffix = { compress: 'sikistirilmis', half: 'yarim', fit1080: '1080', rotate: 'dondurulmus', flip: 'aynali', square: 'kare', gray: 'gri', strip: 'temiz' }[tool];
  const out = uniquePath(dir, `${base}-${suffix}`, keepExt);
  if (!sharp) throw new Error('Görsel araçları için sharp gerekli');
  const meta = await sharp(src).metadata();
  let img = sharp(src).rotate();
  switch (tool) {
    case 'half': img = img.resize(Math.max(1, Math.round((meta.width || 2) / 2))); break;
    case 'fit1080': img = img.resize(1080, 1080, { fit: 'inside', withoutEnlargement: true }); break;
    case 'rotate': img = img.rotate(90); break;
    case 'flip': img = img.flop(); break;
    case 'square': { const s = Math.min(meta.width, meta.height); img = img.resize(s, s, { fit: 'cover', position: 'centre' }); break; }
    case 'gray': img = img.grayscale(); break;
    default: break;
  }
  const q = tool === 'compress' ? 70 : 90;
  if (keepExt === 'jpg') img = img.jpeg({ quality: q, mozjpeg: true });
  else if (keepExt === 'png') img = img.png(tool === 'compress' ? { palette: true, quality: 80, compressionLevel: 9 } : { compressionLevel: 9 });
  else if (keepExt === 'webp') img = img.webp({ quality: q });
  else if (keepExt === 'avif') img = img.avif({ quality: tool === 'compress' ? 45 : 60 });
  // sharp varsayılan olarak meta veriyi atar; "strip" ayrıca bir şey gerektirmez.
  await img.toFile(out);
  return out;
}

// ---------- Video / Ses ----------

const VIDEO_TO = {
  mp4: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'],
  mov: ['-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'],
  mkv: ['-c:v', 'libx264', '-crf', '21', '-c:a', 'aac', '-b:a', '192k'],
  webm: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus', '-b:a', '128k'],
  avi: ['-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'libmp3lame', '-b:a', '192k'],
  wmv: ['-c:v', 'wmv2', '-b:v', '4M', '-c:a', 'wmav2', '-b:a', '192k'],
  gif: ['-vf', 'fps=15,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0'],
  mp3: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'],
};
const AUDIO_TO = {
  mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'],
  m4a: ['-c:a', 'aac', '-b:a', '192k'],
  wav: ['-c:a', 'pcm_s16le'],
  flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis', '-q:a', '5'],
  opus: ['-c:a', 'libopus', '-b:a', '128k'],
  aiff: ['-c:a', 'pcm_s16be'],
  wma: ['-c:a', 'wmav2', '-b:a', '192k'],
};

async function videoConvert(src, to, dir, base, onProgress) {
  const out = uniquePath(dir, base, to);
  await ffmpeg(['-i', src, ...VIDEO_TO[to], out], onProgress);
  return out;
}
async function audioConvert(src, to, dir, base, onProgress) {
  const out = uniquePath(dir, base, to);
  await ffmpeg(['-i', src, '-vn', ...AUDIO_TO[to], out], onProgress);
  return out;
}

async function splitMedia(src, dir, base, isVideo, onProgress) {
  const dur = await mediaDuration(src);
  if (!dur) throw new Error('Süre okunamadı');
  const ext = isVideo ? 'mp4' : extOf(src);
  const half = dur / 2;
  const a = uniquePath(dir, `${base}-1`, ext);
  await ffmpeg(['-i', src, '-t', `${half}`, ...(isVideo ? VIDEO_TO.mp4.slice(0, 8) : []), ...(isVideo ? ['-c:a', 'aac'] : []), a], (p) => onProgress(p / 2));
  const b = uniquePath(dir, `${base}-2`, ext);
  await ffmpeg(['-ss', `${half}`, '-i', src, ...(isVideo ? VIDEO_TO.mp4.slice(0, 8) : []), ...(isVideo ? ['-c:a', 'aac'] : []), b], (p) => onProgress(0.5 + p / 2));
  return [a, b];
}

async function videoTool(src, tool, dir, base, onProgress) {
  const h264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  const outExt = 'mp4';
  const name = (s) => uniquePath(dir, `${base}-${s}`, outExt);
  switch (tool) {
    case 'compress': { const o = name('sikistirilmis'); await ffmpeg(['-i', src, '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', o], onProgress); return o; }
    case '720p': { const o = name('720p'); await ffmpeg(['-i', src, '-vf', 'scale=-2:720', ...h264, '-c:a', 'aac', '-b:a', '160k', o], onProgress); return o; }
    case 'mute': { const o = name('sessiz'); await ffmpeg(['-i', src, '-an', '-c:v', 'copy', o], onProgress); return o; }
    case 'rotate': { const o = name('dondurulmus'); await ffmpeg(['-i', src, '-vf', 'transpose=1', ...h264, '-c:a', 'copy', o], onProgress); return o; }
    case 'speed2': { const o = name('2x'); await ffmpeg(['-i', src, '-filter_complex', '[0:v]setpts=0.5*PTS[v];[0:a]atempo=2.0[a]', '-map', '[v]', '-map', '[a]?', ...h264, '-c:a', 'aac', o], onProgress).catch(() => ffmpeg(['-i', src, '-vf', 'setpts=0.5*PTS', '-an', ...h264, o], onProgress)); return o; }
    case 'reverse': { const o = name('ters'); await ffmpeg(['-i', src, '-vf', 'reverse', '-af', 'areverse', ...h264, '-c:a', 'aac', o], onProgress).catch(() => ffmpeg(['-i', src, '-vf', 'reverse', '-an', ...h264, o], onProgress)); return o; }
    case 'split2': return splitMedia(src, dir, base, true, onProgress);
    case 'thumb': { const dur = await mediaDuration(src); const o = uniquePath(dir, `${base}-kare`, 'png'); await ffmpeg(['-ss', `${dur / 2}`, '-i', src, '-frames:v', '1', o]); return o; }
    default: throw new Error('Bilinmeyen araç');
  }
}

async function audioTool(src, tool, dir, base, onProgress) {
  const ext = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus'].includes(norm(extOf(src))) ? norm(extOf(src)) : 'mp3';
  const codec = AUDIO_TO[ext];
  const name = (s, e = ext) => uniquePath(dir, `${base}-${s}`, e);
  const af = (filter, s) => async () => { const o = name(s); await ffmpeg(['-i', src, '-vn', '-af', filter, ...codec, o], onProgress); return o; };
  switch (tool) {
    case 'compress': { const o = name('sikistirilmis', 'mp3'); await ffmpeg(['-i', src, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', o], onProgress); return o; }
    case 'normalize': return af('loudnorm=I=-16:TP=-1.5:LRA=11', 'normalize')();
    case 'trimsilence': return af('silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse', 'kirpilmis')();
    case 'mono': return af('pan=mono|c0=0.5*c0+0.5*c1', 'mono')();
    case 'speed2': return af('atempo=2.0', '2x')();
    case 'reverse': return af('areverse', 'ters')();
    case 'fade': { const d = await mediaDuration(src); const f = Math.min(3, d / 4); return af(`afade=t=in:d=${f},afade=t=out:st=${Math.max(0, d - f)}:d=${f}`, 'fade')(); }
    case 'split2': return splitMedia(src, dir, base, false, onProgress);
    default: throw new Error('Bilinmeyen araç');
  }
}

async function concatMedia(srcs, dir, base, isVideo, onProgress) {
  const out = uniquePath(dir, `${base}-birlesik`, isVideo ? 'mp4' : 'mp3');
  const inputs = srcs.flatMap((s) => ['-i', s]);
  if (isVideo) {
    // Farklı çözünürlükleri ilk videoya göre eşitle.
    const parts = srcs.map((_, i) => `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a]aresample=48000[a${i}];`).join('');
    const chain = srcs.map((_, i) => `[v${i}][a${i}]`).join('');
    await ffmpeg([...inputs, '-filter_complex', `${parts}${chain}concat=n=${srcs.length}:v=1:a=1[v][a]`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out], onProgress)
      .catch(async () => {
        // Sessiz videolar için yalnızca görüntüyü birleştir.
        const vparts = srcs.map((_, i) => `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];`).join('');
        await ffmpeg([...inputs, '-filter_complex', `${vparts}${srcs.map((_, i) => `[v${i}]`).join('')}concat=n=${srcs.length}:v=1:a=0[v]`, '-map', '[v]', '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', out], onProgress);
      });
  } else {
    await ffmpeg([...inputs, '-filter_complex', `${srcs.map((_, i) => `[${i}:a]`).join('')}concat=n=${srcs.length}:v=0:a=1[a]`, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '192k', out], onProgress);
  }
  return out;
}

// ---------- PDF ----------

async function pdfToImages(src, to, dir, base) {
  const pdftoppm = which('pdftoppm');
  const tmp = tmpDir();
  try {
    if (pdftoppm) {
      await run(pdftoppm, [to === 'png' ? '-png' : '-jpeg', '-r', '300', src, path.join(tmp, 'p')]);
    } else if (soffice()) {
      // poppler yoksa yalnızca ilk sayfa LibreOffice ile alınabilir.
      await run(soffice(), ['--headless', '--convert-to', to, '--outdir', tmp, src], { timeout: 180000 });
    } else throw new Error('PDF → görsel için poppler-utils (pdftoppm) gerekli');
    const files = fs.readdirSync(tmp).sort();
    if (files.length === 1) {
      const out = uniquePath(dir, base, to);
      fs.copyFileSync(path.join(tmp, files[0]), out);
      return out;
    }
    const folder = uniquePath(dir, `${base} (${to.toUpperCase()})`, '');
    fs.mkdirSync(folder);
    files.forEach((f, i) => fs.copyFileSync(path.join(tmp, f), path.join(folder, `${base}-${String(i + 1).padStart(3, '0')}.${to}`)));
    return folder;
  } finally { rm(tmp); }
}

async function pdfToText(src, to, dir, base) {
  const out = uniquePath(dir, base, to);
  const pdftotext = which('pdftotext');
  if (pdftotext) { await run(pdftotext, ['-layout', '-enc', 'UTF-8', src, out]); return out; }
  return officeConvert(src, 'txt', dir, base, ['--infilter=writer_pdf_import']).then((o) => { fs.renameSync(o, out); return out; });
}

async function pdfTool(paths, tool, dir, base) {
  const src = paths[0];
  const load = async () => PDFDocument.load(fs.readFileSync(src), { ignoreEncryption: true });
  switch (tool) {
    case 'compress': {
      const gs = which('gs') || which('gswin64c') || which('gswin32c');
      if (!gs) throw new Error('PDF sıkıştırma için Ghostscript (gs) gerekli');
      const out = uniquePath(dir, `${base}-sikistirilmis`, 'pdf');
      await run(gs, ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dPDFSETTINGS=/ebook', '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${out}`, src]);
      return out;
    }
    case 'splitpages': {
      const doc = await load();
      const folder = uniquePath(dir, `${base} (sayfalar)`, '');
      fs.mkdirSync(folder);
      for (let i = 0; i < doc.getPageCount(); i++) {
        const one = await PDFDocument.create();
        const [p] = await one.copyPages(doc, [i]);
        one.addPage(p);
        fs.writeFileSync(path.join(folder, `${base}-${String(i + 1).padStart(3, '0')}.pdf`), await one.save());
      }
      return folder;
    }
    case 'rotate': case 'reversepages': case 'strip': {
      const doc = await load();
      let target = doc;
      if (tool === 'rotate') doc.getPages().forEach((p) => p.setRotation(degrees((p.getRotation().angle + 90) % 360)));
      if (tool === 'reversepages') {
        target = await PDFDocument.create();
        const idx = doc.getPageIndices().reverse();
        (await target.copyPages(doc, idx)).forEach((p) => target.addPage(p));
      }
      if (tool === 'strip') {
        ['setTitle', 'setAuthor', 'setSubject', 'setCreator', 'setProducer'].forEach((m) => doc[m](''));
        doc.setKeywords([]);
      }
      const suffix = { rotate: 'dondurulmus', reversepages: 'ters', strip: 'temiz' }[tool];
      const out = uniquePath(dir, `${base}-${suffix}`, 'pdf');
      fs.writeFileSync(out, await target.save());
      return out;
    }
    case 'firstpage': {
      const pdftoppm = which('pdftoppm');
      if (!pdftoppm) throw new Error('poppler-utils (pdftoppm) gerekli');
      const out = uniquePath(dir, `${base}-kapak`, 'png');
      await run(pdftoppm, ['-png', '-r', '200', '-f', '1', '-l', '1', '-singlefile', src, out.replace(/\.png$/, '')]);
      return out;
    }
    case 'merge': {
      const merged = await PDFDocument.create();
      for (const p of paths) {
        const d = await PDFDocument.load(fs.readFileSync(p), { ignoreEncryption: true });
        (await merged.copyPages(d, d.getPageIndices())).forEach((pg) => merged.addPage(pg));
      }
      const out = uniquePath(dir, `${base}-birlesik`, 'pdf');
      fs.writeFileSync(out, await merged.save());
      return out;
    }
    default: throw new Error('Bilinmeyen araç');
  }
}

// ---------- Ofis belgeleri (LibreOffice) ----------

const LO_FILTER = {
  csv: 'csv:Text - txt - csv (StarCalc):44,34,76,1',
  tsv: 'csv:Text - txt - csv (StarCalc):9,34,76,1',
  txt: 'txt:Text (encoded):UTF8',
  html: 'html',
  epub: 'epub',
};

async function officeConvert(src, to, dir, base, extra = []) {
  const lo = soffice();
  if (!lo) throw new Error('Bu dönüşüm için LibreOffice gerekli (sudo apt install libreoffice)');
  const tmp = tmpDir();
  try {
    // Ayrı bir profil klasörü: açık bir LibreOffice penceresi olsa bile çakışmasın.
    const profile = `-env:UserInstallation=${pathToFileURL(path.join(os.tmpdir(), 'shiftdrop-lo-profile')).href}`;
    await run(lo, [profile, '--headless', ...extra, '--convert-to', LO_FILTER[to] || to, '--outdir', tmp, src], { timeout: 240000 });
    const produced = fs.readdirSync(tmp).filter((f) => !f.startsWith('.'));
    if (!produced.length) throw new Error('LibreOffice çıktı üretmedi');
    const out = uniquePath(dir, base, to);
    fs.copyFileSync(path.join(tmp, produced[0]), out);
    return out;
  } finally { rm(tmp); }
}

// Basit Markdown → HTML (başlık, kalın, italik, kod, bağlantı, liste, alıntı, paragraf).
function markdownToHtml(md, title) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  const lines = md.replace(/\r/g, '').split('\n');
  let html = '';
  let list = null;
  let para = [];
  let code = null;
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>\n`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>\n`; list = null; } };
  for (const line of lines) {
    if (code !== null) {
      if (/^```/.test(line)) { html += `<pre><code>${esc(code)}</code></pre>\n`; code = null; } else code += `${line}\n`;
      continue;
    }
    let m;
    if (/^```/.test(line)) { flushPara(); closeList(); code = ''; } else if ((m = line.match(/^(#{1,6})\s+(.*)/))) { flushPara(); closeList(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>\n`; } else if ((m = line.match(/^\s*[-*+]\s+(.*)/))) { flushPara(); if (list !== 'ul') { closeList(); html += '<ul>\n'; list = 'ul'; } html += `<li>${inline(m[1])}</li>\n`; } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (list !== 'ol') { closeList(); html += '<ol>\n'; list = 'ol'; } html += `<li>${inline(m[1])}</li>\n`; } else if ((m = line.match(/^>\s?(.*)/))) { flushPara(); closeList(); html += `<blockquote>${inline(m[1])}</blockquote>\n`; } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); closeList(); html += '<hr>\n'; } else if (!line.trim()) { flushPara(); closeList(); } else para.push(line.trim());
  }
  flushPara(); closeList();
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(title)}</title>\n<style>body{font:16px/1.65 system-ui,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;color:#222}code{background:#f3f1ee;padding:2px 5px;border-radius:4px}pre{background:#f3f1ee;padding:14px;border-radius:8px;overflow:auto}blockquote{border-left:3px solid #ff8a1f;margin:0;padding-left:14px;color:#555}</style></head>\n<body>\n${html}</body></html>\n`;
}

async function documentConvert(src, to, dir, base) {
  const from = norm(extOf(src));
  const text = () => fs.readFileSync(src, 'utf8');
  if (from === 'md' || from === 'txt') {
    if (to === 'txt' || to === 'md') { const o = uniquePath(dir, base, to); fs.writeFileSync(o, text()); return o; }
    const html = from === 'md' ? markdownToHtml(text(), base) : markdownToHtml(text().split('\n').map((l) => l.replace(/^([#>*-])/, '\\$1')).join('\n\n'), base);
    if (to === 'html') { const o = uniquePath(dir, base, 'html'); fs.writeFileSync(o, html); return o; }
    // Diğer hedefler: önce HTML, sonra LibreOffice
    const tmp = tmpDir();
    try {
      const h = path.join(tmp, `${base}.html`);
      fs.writeFileSync(h, html);
      return await officeConvert(h, to, dir, base, to === 'pdf' ? ['--infilter=HTML (StarWriter)'] : ['--infilter=HTML (StarWriter)']);
    } finally { rm(tmp); }
  }
  if (to === 'md') {
    const pandoc = which('pandoc');
    const out = uniquePath(dir, base, 'md');
    if (pandoc) { await run(pandoc, [src, '-t', 'gfm', '-o', out]); return out; }
    const txt = await officeConvert(src, 'txt', dir, `${base}.tmp`);
    fs.renameSync(txt, out);
    return out;
  }
  return officeConvert(src, to, dir, base);
}

async function pdfConvert(src, to, dir, base) {
  if (to === 'png' || to === 'jpg') return pdfToImages(src, to, dir, base);
  if (to === 'txt' || to === 'md') return pdfToText(src, to, dir, base);
  // docx/odt/html/epub: LibreOffice'in Draw PDF içe aktarıcısı ile Writer'a
  return officeConvert(src, to, dir, base, ['--infilter=writer_pdf_import']);
}

async function slidesConvert(src, to, dir, base) {
  if (to === 'png' || to === 'jpg') {
    const tmp = tmpDir();
    try {
      const pdf = await officeConvert(src, 'pdf', tmp, base);
      return await pdfToImages(pdf, to, dir, base);
    } finally { rm(tmp); }
  }
  return officeConvert(src, to, dir, base);
}

// ---------- Altyazı ----------

async function subtitleConvert(src, to, dir, base) {
  const out = uniquePath(dir, base, to);
  if (to === 'txt') {
    const raw = fs.readFileSync(src, 'utf8').replace(/\r/g, '');
    const lines = raw.split('\n').filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^WEBVTT/.test(l) && !/^(NOTE|STYLE)/.test(l))
      .map((l) => (l.startsWith('Dialogue:') ? l.split(',').slice(9).join(',') : l))
      .filter((l) => !/^\[(Script Info|V4\+? Styles|Events)\]/.test(l) && !/^(Format|Style|Title|ScriptType|PlayRes|WrapStyle|ScaledBorder|YCbCr):/.test(l))
      .map((l) => l.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').replace(/\\N/g, ' '));
    fs.writeFileSync(out, `${lines.join('\n')}\n`);
    return out;
  }
  await ffmpeg(['-i', src, out]);
  return out;
}

// ---------- Arşivler ----------

// tar.exe olmayan eski Windows sürümleri için yedek
const psq = (p) => `'${p.replace(/'/g, "''")}'`;
const powershell = (cmd) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]);

async function extractArchive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const ext = extOf(src);
  if (ext === 'zip') {
    // Windows 10+ ile gelen tar (libarchive) zip de açar.
    if (IS_WIN && which('tar')) await run(which('tar'), ['-xf', src, '-C', dest]);
    else if (IS_WIN) await powershell(`Expand-Archive -LiteralPath ${psq(src)} -DestinationPath ${psq(dest)} -Force`);
    else if (which('unzip')) await run(which('unzip'), ['-q', '-o', src, '-d', dest]);
    else await run(which('python3') || 'python3', ['-m', 'zipfile', '-e', src, dest]);
  } else if (['tar', 'gz', 'tgz', 'tar.gz'].includes(ext)) {
    if (ext === 'gz' && !/\.tar\.gz$/i.test(src)) {
      // Tek dosyalık .gz
      const out = path.join(dest, path.basename(src).replace(/\.gz$/i, ''));
      await new Promise((res, rej) => fs.createReadStream(src).pipe(require('zlib').createGunzip()).pipe(fs.createWriteStream(out)).on('finish', res).on('error', rej));
    } else await run(which('tar') || 'tar', ['-xf', src, '-C', dest]);
  } else if (ext === 'rar' || ext === '7z') {
    const tool = which('7z') || which('7zz') || which('unrar') || which('bsdtar') || (IS_WIN ? which('tar') : null);
    if (!tool) throw new Error('RAR/7z için p7zip veya unrar gerekli');
    const name = path.basename(tool).replace(/\.exe$/i, '').toLowerCase();
    if (name === 'unrar') await run(tool, ['x', '-o+', src, `${dest}${path.sep}`]);
    else if (name === 'bsdtar' || name === 'tar') await run(tool, ['-xf', src, '-C', dest]);
    else await run(tool, ['x', '-y', `-o${dest}`, src]);
  } else throw new Error('Bilinmeyen arşiv türü');
}

async function makeArchive(items, out, kind) {
  const cwd = path.dirname(items[0]);
  const names = items.map((p) => path.relative(cwd, p));
  if (kind === 'zip') {
    // Windows'un tar'ı -a ile uzantıya bakıp zip üretir.
    if (IS_WIN && which('tar')) await run(which('tar'), ['-a', '-cf', out, ...names], { cwd });
    else if (IS_WIN) await powershell(`Compress-Archive -LiteralPath ${items.map(psq).join(',')} -DestinationPath ${psq(out)}`);
    else if (which('zip')) await run(which('zip'), ['-r', '-q', out, ...names], { cwd });
    else {
      const py = 'import sys,os,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED)\nfor n in sys.argv[2:]:\n  if os.path.isdir(n):\n    for r,_,fs in os.walk(n):\n      for f in fs: z.write(os.path.join(r,f))\n  else: z.write(n)\nz.close()';
      await run(which('python3') || 'python3', ['-c', py, out, ...names], { cwd });
    }
  } else {
    await run(which('tar') || 'tar', [kind === 'tar.gz' ? '-czf' : '-cf', out, ...names], { cwd });
  }
  return out;
}

async function archiveConvert(src, to, dir, base) {
  if (to === 'extract') {
    const dest = uniquePath(dir, base, '');
    await extractArchive(src, dest);
    return dest;
  }
  const tmp = tmpDir();
  try {
    await extractArchive(src, tmp);
    const entries = fs.readdirSync(tmp).map((n) => path.join(tmp, n));
    return await makeArchive(entries, uniquePath(dir, base, to), to);
  } finally { rm(tmp); }
}

// ---------- Ana giriş ----------

async function convertOne(src, to, onProgress) {
  const dir = path.dirname(src);
  const base = baseOf(src);
  switch (categoryOf(src)) {
    case 'image': return imageConvert(src, to, dir, base);
    case 'video': return videoConvert(src, to, dir, base, onProgress);
    case 'audio': return audioConvert(src, to, dir, base, onProgress);
    case 'pdf': return pdfConvert(src, to, dir, base);
    case 'document': return documentConvert(src, to, dir, base);
    case 'slides': return slidesConvert(src, to, dir, base);
    case 'sheet': return officeConvert(src, to, dir, base);
    case 'subtitle': return subtitleConvert(src, to, dir, base);
    case 'archive': return archiveConvert(src, to, dir, base);
    default: throw new Error('Bu dosya türü desteklenmiyor');
  }
}

async function toolOne(src, tool, onProgress) {
  const dir = path.dirname(src);
  const base = baseOf(src);
  switch (categoryOf(src)) {
    case 'image': return imageTool(src, tool, dir, base);
    case 'video': return videoTool(src, tool, dir, base, onProgress);
    case 'audio': return audioTool(src, tool, dir, base, onProgress);
    case 'pdf': return pdfTool([src], tool, dir, base);
    default: throw new Error('Bu dosya için araç yok');
  }
}

// Bir eylemi tüm dosyalara uygular. onProgress(genel 0..1). Sonuç: [{ ok, src, out | error }]
async function perform(paths, mode, id, onProgress = () => {}) {
  const first = paths[0];
  const dir = path.dirname(first);
  const base = baseOf(first);
  const cat = categoryOf(first);
  const single = async (fn) => {
    try { const out = await fn((p) => onProgress(p)); onProgress(1); return [{ ok: true, src: first, out }]; } catch (e) { return [{ ok: false, src: first, error: e.message }]; }
  };

  // Birden çok dosyayı tek çıktıya indiren işlemler
  if (mode === 'tools' && id === 'zip') {
    return single(() => makeArchive(paths, uniquePath(dir, paths.length === 1 ? base : 'Arsiv', 'zip'), 'zip'));
  }
  if (mode === 'tools' && id === 'merge') {
    if (cat === 'pdf') return single(() => pdfTool(paths, 'merge', dir, base));
    if (cat === 'image') return single(() => imagesToPdf(paths, dir, `${base}-birlesik`));
    return single((p) => concatMedia(paths, dir, base, cat === 'video', p));
  }
  if (mode === 'convert' && id === 'pdf' && paths.length > 1 && paths.every((p) => categoryOf(p) === 'image')) {
    return single(() => imagesToPdf(paths, dir, base));
  }

  const results = [];
  for (let i = 0; i < paths.length; i++) {
    const prog = (p) => onProgress((i + p) / paths.length);
    try {
      const out = mode === 'convert' ? await convertOne(paths[i], id, prog) : await toolOne(paths[i], id, prog);
      for (const o of [].concat(out)) results.push({ ok: true, src: paths[i], out: o });
    } catch (e) {
      results.push({ ok: false, src: paths[i], error: e.message });
    }
    prog(1);
  }
  return results;
}

module.exports = { optionsFor, perform, categoryOf, markdownToHtml, FFMPEG, which, soffice };
