const api = window.shiftdrop;
const file = new URLSearchParams(location.search).get('file');
const name = file.split(/[\\/]/).pop();
const ext = (name.split('.').pop() || '').toLowerCase();
const url = 'file://' + encodeURI(file).replace(/#/g, '%23').replace(/\?/g, '%3F');
document.getElementById('name').textContent = name;
document.title = name;
const pv = document.getElementById('preview');
if (['png','jpg','jpeg','webp','gif','avif','bmp','svg','ico'].includes(ext)) pv.innerHTML = `<img src="${url}" alt="">`;
else if (['mp4','webm','mov','mkv','m4v'].includes(ext)) pv.innerHTML = `<video src="${url}" muted loop autoplay playsinline></video>`;
else {
  const cat = ['mp3','wav','m4a','flac','ogg','opus','aiff','wma'].includes(ext) ? 'audio' : ext === 'pdf' ? 'pdf' : ['zip','tar','gz','rar','7z'].includes(ext) ? 'archive' : 'document';
  pv.innerHTML = `<div><div class="big">${window.icon(cat, 64)}</div><div class="ext">${ext.toUpperCase()}</div></div>`;
}
pv.addEventListener('dragstart', (e) => { e.preventDefault(); api.startDrag(file); });
pv.addEventListener('dblclick', () => api.openPath(file));
document.getElementById('reveal').innerHTML = window.icon('folder', 14);
document.getElementById('close').innerHTML = window.icon('x', 14);
document.getElementById('reveal').onclick = () => api.reveal(file);
document.getElementById('close').onclick = () => api.closeFloat();
