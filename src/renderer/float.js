const api = window.shiftdrop;
document.getElementById('preview').title = api.t('Sürükleyip istediğin yere bırak');
document.getElementById('reveal').title = api.t('Klasörde göster');
document.getElementById('close').title = api.t('Kapat');
const params = new URLSearchParams(location.search);
const file = params.get('file');
if (!file) { api.closeFloat(); }
else {
const name = file.split(/[\\/]/).pop();
const ext = (name.split('.').pop() || '').toLowerCase();
const url = params.get('href') || ('file://' + encodeURI(file).replace(/#/g, '%23').replace(/\?/g, '%3F'));
document.getElementById('name').textContent = name;
document.title = name;
const pv = document.getElementById('preview');
if (['png','jpg','jpeg','webp','gif','avif','bmp','svg','ico'].includes(ext)) {
  const img = document.createElement('img');
  img.alt = '';
  img.src = url;
  pv.replaceChildren(img);
} else if (['mp4','webm','mov','mkv','m4v'].includes(ext)) {
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  pv.replaceChildren(video);
} else {
  const cat = ['mp3','wav','m4a','flac','ogg','opus','aiff','wma'].includes(ext) ? 'audio' : ext === 'pdf' ? 'pdf' : ['zip','tar','gz','rar','7z'].includes(ext) ? 'archive' : 'document';
  const wrap = document.createElement('div');
  const big = document.createElement('div');
  big.className = 'big';
  big.innerHTML = window.icon(cat, 64);
  const extEl = document.createElement('div');
  extEl.className = 'ext';
  extEl.textContent = ext.toUpperCase();
  wrap.append(big, extEl);
  pv.replaceChildren(wrap);
}
pv.addEventListener('dragstart', (e) => { e.preventDefault(); api.startDrag(file); });
pv.addEventListener('dblclick', () => api.openPath(file));
document.getElementById('reveal').innerHTML = window.icon('folder', 14);
document.getElementById('close').innerHTML = window.icon('x', 14);
document.getElementById('reveal').onclick = () => api.reveal(file);
document.getElementById('close').onclick = () => api.closeFloat();
}
