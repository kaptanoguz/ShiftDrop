const api = window.shiftdrop;
document.getElementById('tab').title = api.t('Dosyayı buraya sürükle');
document.getElementById('logo').innerHTML = window.LOGO;
const modeFrom = (e) => (e.ctrlKey ? 'tools' : e.altKey ? 'actions' : 'convert');
let sent = false;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  document.body.classList.add('hot');
  if (!sent) { sent = true; api.bubbleEnter(modeFrom(e)); }
});
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) { document.body.classList.remove('hot'); sent = false; } });
document.addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('hot'); sent = false; });

// Balonu kenar boyunca yukarı/aşağı taşı
let lastY = null;
document.addEventListener('mousedown', (e) => { lastY = e.screenY; });
document.addEventListener('mousemove', (e) => {
  if (lastY === null) return;
  api.bubbleMove(e.screenY - lastY);
  lastY = e.screenY;
});
document.addEventListener('mouseup', () => { if (lastY !== null) api.bubbleMoved(); lastY = null; });
