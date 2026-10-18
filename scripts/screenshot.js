// Geliştirme: uygulamayı açar, çarkı sahte sürükleme olaylarıyla farklı durumlarda gösterip ekran görüntüsü alır.
// Kullanım: electron scripts/screenshot.js <çıktı-klasörü> <örnek-dosya>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
require('../src/main.js');

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('screenshot.js')) + 1);
const out = args[0] || 'shots';
const sample = args[1];
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  await wait(700);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
  console.log('shot', name);
}

const fakeDrag = (type, mime, x, y, mods = {}) => `(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['x'], 'ornek', { type: '${mime}' }));
  document.dispatchEvent(new DragEvent('${type}', { dataTransfer: dt, clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true, ...${JSON.stringify(mods)} }));
})()`;

app.whenReady().then(async () => {
  await wait(1500);
  const wheel = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('wheel.html'));
  const bubble = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('bubble.html'));
  const js = (s) => wheel.webContents.executeJavaScript(s);
  wheel.webContents.on('console-message', (e) => console.log('[wheel]', e.message || ''));

  const open = async (mode, mime, hx, hy, mods) => {
    wheel.showInactive();
    wheel.webContents.send('wheel:open', { mode, source: 'key', keys: { convert: 'Shift', tools: 'Ctrl', actions: 'Alt' } });
    await wait(100);
    await js(fakeDrag('dragenter', mime, 240, 240));
    await wait(200);
    await js(fakeDrag('dragover', mime, hx, hy, mods || {}));
  };

  await open('convert', 'image/png', 240, 60);
  await shot(wheel, '1-donustur-gorsel');
  await js(fakeDrag('dragover', 'image/png', 400, 240, { ctrlKey: true }));
  await wait(400);
  await js(fakeDrag('dragover', 'image/png', 400, 240, { ctrlKey: true }));
  await shot(wheel, '2-araclar-gorsel');
  await js(fakeDrag('dragover', 'image/png', 120, 330, { altKey: true }));
  await wait(400);
  await js(fakeDrag('dragover', 'image/png', 120, 330, { altKey: true }));
  await shot(wheel, '3-eylemler');

  wheel.webContents.send('wheel:close'); await wait(300);
  await open('convert', 'video/mp4', 380, 160);
  await shot(wheel, '4-donustur-video');

  wheel.webContents.send('wheel:close'); await wait(300);
  await open('convert', 'application/pdf', 100, 160);
  await shot(wheel, '5-donustur-pdf');

  if (sample) {
    // Gerçek dönüşüm: bırakma sonrası akışı doğrudan çalıştır
    await js(`st.paths = [${JSON.stringify(sample)}]; st.mode = 'convert'; loadOptions(st.paths).then(() => run(st.data.items.find((i) => i.id === 'webp')))`);
    await wait(150);
    await shot(wheel, '6-ilerleme');
    await wait(1500);
    await shot(wheel, '7-sonuc');
  }

  wheel.webContents.send('wheel:close'); await wait(300);
  wheel.showInactive();
  wheel.webContents.send('wheel:open', { mode: 'convert', source: 'shortcut', keys: { convert: 'Shift', tools: 'Ctrl', actions: 'Alt' } });
  await shot(wheel, '8-bekleme');

  bubble.showInactive();
  await shot(bubble, '9-balon');
  app.exit(0);
});
