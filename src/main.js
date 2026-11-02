const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, globalShortcut, clipboard, dialog, Notification } = require('electron');

// Yakalanmamış ana süreç hatası Electron'da kırmızı diyalog açar ve uygulamayı ölü bırakır.
// Günlüğe yaz, pencereyi yeniden kurma yolu diyalogla kesilmesin.
dialog.showErrorBox = (title, content) => { console.error(title + '\n' + content); };
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
process.on('uncaughtException', (err) => { console.error('ShiftDrop:', err && err.stack || err); });
process.on('unhandledRejection', (err) => { console.error('ShiftDrop:', err && err.stack || err); });
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { needsX11Relaunch } = require('./linux-launch');
const { createDragGesture, startEvdevWatch } = require('./evdev');

// sharp yüklüyse bile Electron+Linux için bu uyarıyı basar; N-API ikilisi çalışır, çıktıyı boğmasın.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, type, code, ctor) => {
  const warningCode = type && typeof type === 'object' ? type.code : code;
  if (warningCode === 'SharpElectronLinux') return;
  return emitWarning(warning, type, code, ctor);
};

const { optionsFor, perform } = require('./engine');
const i18n = require('./i18n');
const { t } = i18n;
const pkg = require('../package.json');

// Ozone platformu JS'ten değiştirilemez (appendSwitch Wayland çoktan seçildikten sonra yok sayılır).
// Wayland oturumunda kendimizi gerçek --ozone-platform=x11 argv'si ile yeniden başlatırız.
function relaunchWaylandOnX11() {
  if (!needsX11Relaunch({ platform: process.platform, env: process.env, argv: process.argv })) return false;
  const child = spawn(process.execPath, process.argv.slice(1).concat(['--ozone-platform=x11', '--enable-transparent-visuals']), {
    detached: true,
    stdio: 'inherit',
    env: process.env,
  });
  child.unref();
  console.error('ShiftDrop: Wayland oturumu XWayland üzerinden açılıyor (--ozone-platform=x11).');
  app.exit(0);
  return true;
}
const relaunching = relaunchWaylandOnX11();
if (process.platform === 'linux' && !relaunching) app.commandLine.appendSwitch('enable-transparent-visuals');

const WHEEL = 480;
const TOGGLE_SHORTCUT = 'CommandOrControl+Alt+Space';
const IS_WIN = process.platform === 'win32';
const isWayland = process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);
const ASSETS = path.join(__dirname, '..', 'assets');
// Oturum açılışında sessiz başla (otomatik başlatma bu bayrakla çağırır).
const HIDDEN = process.argv.includes('--hidden');

let wheel = null;
let bubble = null;
let tray = null;
let settings = { lang: null, bubble: isWayland, bubbleY: 0.5, keys: { convert: 'Shift', tools: 'Ctrl', actions: 'Alt' } };
let busy = false;
let hideTimer = null;
const drag = { mouseDown: false, active: false, start: null };
const floats = new Set();

// ---------- Ayarlar ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = {
      ...settings,
      ...saved,
      // Eski/eksik kayıtlarda tuş eşlemesi kaybolmasın.
      keys: { ...settings.keys, ...(saved.keys || {}) },
    };
  } catch { /* ilk açılış */ }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* yoksay */ }
}

// ---------- Pencereler ----------

const commonWeb = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false };

function windowAlive(win) {
  try { return !!win && !win.isDestroyed(); } catch { return false; }
}
function safeWebContents(win) {
  try {
    if (!windowAlive(win)) return null;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed()) return null;
    return wc;
  } catch { return null; }
}

function createWheel() {
  const win = new BrowserWindow({
    width: WHEEL, height: WHEEL, show: false, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, backgroundColor: '#00000000',
    type: process.platform === 'linux' ? 'utility' : undefined,
    webPreferences: commonWeb,
  });
  wheel = win;
  win.on('closed', () => { if (wheel === win) wheel = null; });
  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch { /* pencere hemen kapanmış olabilir */ }
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* yoksay */ }
  win.loadFile(path.join(__dirname, 'renderer', 'wheel.html')).catch((err) => console.error(err));
  return win;
}
function ensureWheel() {
  if (!windowAlive(wheel)) createWheel();
  return wheel;
}

function bubbleBounds() {
  const { workArea: wa } = screen.getPrimaryDisplay();
  const w = 64; const h = 132;
  return { x: wa.x + wa.width - w, y: Math.round(wa.y + (wa.height - h) * settings.bubbleY), width: w, height: h };
}

function createBubble() {
  const win = new BrowserWindow({
    ...bubbleBounds(), show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, focusable: false, hasShadow: false, backgroundColor: '#00000000',
    type: process.platform === 'linux' ? 'utility' : undefined,
    webPreferences: commonWeb,
  });
  bubble = win;
  win.on('closed', () => { if (bubble === win) bubble = null; });
  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch { /* yoksay */ }
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* yoksay */ }
  win.loadFile(path.join(__dirname, 'renderer', 'bubble.html')).catch((err) => console.error(err));
  win.once('ready-to-show', () => {
    try { if (settings.bubble && windowAlive(win)) win.showInactive(); } catch (err) { console.error(err); }
  });
  return win;
}
function ensureBubble() {
  if (!windowAlive(bubble)) createBubble();
  return bubble;
}

function setBubble(on) {
  settings.bubble = on;
  saveSettings();
  const show = () => {
    const win = ensureBubble();
    if (!windowAlive(win)) return;
    if (on) { win.setBounds(bubbleBounds()); win.showInactive(); }
    else win.hide();
  };
  try { show(); }
  catch (err) {
    console.error(err);
    try { if (windowAlive(bubble)) bubble.destroy(); } catch { /* yoksay */ }
    bubble = null;
    if (on) { try { show(); } catch (e2) { console.error(e2); } }
  }
  buildTray();
}

function centerOn(pt) {
  if (!windowAlive(wheel)) return;
  const { workArea: wa } = screen.getDisplayNearestPoint(pt);
  // Çark imlecin tam ortasında açılır; ekran kenarındaysa içeri kaydırılır.
  const x = Math.max(wa.x, Math.min(pt.x - WHEEL / 2, wa.x + wa.width - WHEEL));
  const y = Math.max(wa.y, Math.min(pt.y - WHEEL / 2, wa.y + wa.height - WHEEL));
  wheel.setBounds({ x: Math.round(x), y: Math.round(y), width: WHEEL, height: WHEEL });
}

function cursorForGesture() {
  try {
    const pt = screen.getCursorScreenPoint();
    // XWayland, imleç bir Wayland penceresindeyken konumu güncellemez; (0,0) o kaçırmadır.
    if (pt && (Math.abs(pt.x) > 1 || Math.abs(pt.y) > 1)) return pt;
  } catch { /* ekran yok */ }
  const { workArea: wa } = screen.getPrimaryDisplay();
  return { x: wa.x + wa.width - Math.round(WHEEL * 0.75), y: wa.y + Math.round(wa.height / 2) };
}

function openWheel(mode, source, point) {
  clearTimeout(hideTimer);
  // showInactive XWayland'de pencereyi senkron kapatabiliyor; hemen ardından webContents
  // erişimi "Object has been destroyed" fırlatır. Yoksa çarkı bir kez yeniden kur.
  const run = () => {
    const win = ensureWheel();
    if (!windowAlive(win)) return false;
    let visible = false;
    try { visible = win.isVisible(); } catch { return false; }
    if (!visible) {
      centerOn(point || cursorForGesture());
      if (!windowAlive(wheel)) return false;
      wheel.showInactive();
      if (!windowAlive(wheel)) return false;
    }
    const wc = safeWebContents(wheel);
    if (!wc) return false;
    wc.send(visible ? 'wheel:mode' : 'wheel:open', visible ? { mode } : { mode, source, keys: settings.keys });
    return true;
  };
  try { if (run()) return; } catch (err) { console.error('Çark açılamadı:', err); }
  try { if (windowAlive(wheel)) wheel.destroy(); } catch { /* yoksay */ }
  wheel = null;
  try { run(); } catch (err) { console.error('Çark yeniden kurulamadı:', err); }
}

function closeWheel(force = false) {
  if (!windowAlive(wheel)) return;
  try {
    if (!wheel.isVisible() || (busy && !force)) return;
    safeWebContents(wheel)?.send('wheel:close');
  } catch (err) { console.error(err); return; }
  clearTimeout(hideTimer);
  const win = wheel;
  hideTimer = setTimeout(() => {
    try { if (windowAlive(win)) win.hide(); } catch (err) { console.error(err); }
  }, 200); // kapanış animasyonu
}

// Sürükleme bırakıldıktan sonra kısa bekle: çarka bırakıldıysa renderer "busy" bildirir.
function scheduleCloseCheck(delay = 500) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (!busy && !drag.active) closeWheel(); }, delay);
}

// ---------- Genel klavye/fare dinleme (X11) ----------

function startHooks() {
  let uIOhook; let K;
  try { ({ uIOhook, UiohookKey: K } = require('uiohook-napi')); } catch (e) {
    console.warn('uiohook-napi yüklenemedi:', e.message);
    return false;
  }
  const keyMode = (code) => {
    const map = {
      Shift: [K.Shift, K.ShiftRight], Ctrl: [K.Ctrl, K.CtrlRight], Alt: [K.Alt, K.AltRight], Super: [K.Meta, K.MetaRight],
    };
    for (const [mode, name] of Object.entries(settings.keys)) if ((map[name] || []).includes(code)) return mode;
    return null;
  };

  uIOhook.on('keydown', (e) => {
    if (e.keycode === K.Escape && windowAlive(wheel) && !busy) {
      try { if (wheel.isVisible()) closeWheel(); } catch (err) { console.error(err); }
      return;
    }
    const mode = keyMode(e.keycode);
    // Tangerine gibi: dosyayı sürüklemeye başla, sonra tuşa dokun. Tuş bırakılsa da çark açık kalır.
    if (mode && drag.active) openWheel(mode, 'key');
  });
  uIOhook.on('mousedown', (e) => {
    if (e.button !== 1) return;
    drag.mouseDown = true;
    drag.start = { x: e.x, y: e.y };
  });
  uIOhook.on('mousemove', (e) => {
    if (drag.mouseDown && !drag.active && Math.hypot(e.x - drag.start.x, e.y - drag.start.y) > 6) drag.active = true;
  });
  uIOhook.on('mouseup', (e) => {
    if (e.button !== 1) return;
    drag.mouseDown = false;
    if (drag.active) { drag.active = false; scheduleCloseCheck(); }
  });
  try { uIOhook.start(); } catch (e) { console.warn('uiohook başlatılamadı:', e.message); return false; }
  return true;
}

// Wayland istemcilerinin olayı XRecord'a düşmez. Oturum /dev/input okuyabiliyorsa jesti buradan kur.
let stopEvdev = () => {};
function startEvdev() {
  if (!isWayland) return 0;
  const gesture = createDragGesture();
  const watch = startEvdevWatch((type, code, value) => {
    const action = gesture.feed(type, code, value, settings.keys);
    if (!action || !wheel || wheel.isDestroyed()) return;
    if (action.escape) { if (windowAlive(wheel) && !busy) { try { if (wheel.isVisible()) closeWheel(); } catch { /* yoksay */ } } return; }
    if (action.release) { scheduleCloseCheck(); return; }
    if (action.open) openWheel(action.open, 'key', cursorForGesture());
  });
  stopEvdev = watch.stop;
  return watch.devices;
}

// ---------- Dosya eylemleri (Alt çarkı) ----------

const fileUrl = (p) => pathToFileURL(p).href;
// Renderer'dan gelen yolları son bırakılan/işlenen dosyalarla sınırla.
const trustedPaths = new Set();
function trustPaths(paths) {
  for (const p of paths || []) if (p && typeof p === 'string') trustedPaths.add(path.resolve(p));
}
function isTrustedPath(p) {
  if (!p || typeof p !== 'string') return false;
  const resolved = path.resolve(p);
  if (trustedPaths.has(resolved)) return true;
  // Çıktı dosyaları kaynakla aynı klasörde uniquePath ile üretilir; üst klasör güvenilir olsun.
  for (const trusted of trustedPaths) {
    const dir = path.dirname(trusted);
    if (resolved === dir || resolved.startsWith(dir + path.sep)) return true;
  }
  return false;
}

function openTerminal(dir) {
  const candidates = [
    ['x-terminal-emulator', ['--working-directory', dir]], ['gnome-terminal', ['--working-directory', dir]], ['ptyxis', ['--working-directory', dir]],
    ['kgx', ['--working-directory', dir]], ['konsole', ['--workdir', dir]], ['xfce4-terminal', ['--working-directory', dir]],
    ['tilix', ['-w', dir]], ['kitty', ['--directory', dir]], ['alacritty', ['--working-directory', dir]], ['wezterm', ['start', '--cwd', dir]],
    ['foot', ['-D', dir]], ['xterm', []],
  ];
  if (process.platform === 'darwin') { spawn('open', ['-a', 'Terminal', dir], { detached: true }); return; }
  if (IS_WIN) {
    // Windows Terminal varsa onu, yoksa klasik komut istemini aç.
    const wt = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe');
    if (fs.existsSync(wt)) spawn(wt, ['-d', dir], { detached: true, stdio: 'ignore' }).unref();
    else spawn('cmd.exe', ['/c', 'start', 'cmd.exe'], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const dirs = (process.env.PATH || '').split(':');
  const found = candidates.find(([c]) => dirs.some((d) => fs.existsSync(path.join(d, c))));
  if (!found) throw new Error(t('Terminal bulunamadı'));
  spawn(found[0], found[1], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
}

function moveFile(src, destDir) {
  const dest = path.join(destDir, path.basename(src));
  if (fs.existsSync(dest)) throw new Error(t('{name} hedefte zaten var', { name: path.basename(src) }));
  try { fs.renameSync(src, dest); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
  return dest;
}

function uniqueCopy(src, destDir) {
  const ext = path.extname(src);
  const base = path.basename(src, ext);
  let dest = path.join(destDir, path.basename(src));
  for (let i = 1; fs.existsSync(dest); i++) dest = path.join(destDir, `${base} ${t('kopya')}${i > 1 ? ` ${i}` : ''}${ext}`);
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

async function pickFolder(title) {
  const r = await dialog.showOpenDialog({ title, defaultPath: app.getPath('home'), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}

async function runAction(paths, id) {
  const ok = (out, note) => ({ ok: true, src: paths[0], out, note });
  switch (id) {
    case 'float': paths.forEach(openFloat); return [ok(null, t('Yüzdürüldü'))];
    case 'copy': {
      const uris = paths.map(fileUrl);
      if (process.platform === 'linux') {
        // Ardışık writeBuffer Linux'ta önceki hedefi siler. Nautilus/Cinnamon için GNOME
        // biçimi yeterli; düz metin yolu da yazılsın diye önce text, sonra tek buffer.
        clipboard.write({ text: paths.join('\n') });
        clipboard.writeBuffer('x-special/gnome-copied-files', Buffer.from(`copy\n${uris.join('\n')}`));
      } else if (IS_WIN) {
        // Gezgin'in "yapıştır" ile tanıdığı dosya listesi (CF_HDROP) için PowerShell kullanıyoruz.
        const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
        await new Promise((resolve, reject) => {
          const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -Path ${list}`], { windowsHide: true });
          ps.on('error', reject);
          ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error(t('Panoya kopyalanamadı')))));
        });
      } else clipboard.writeText(paths.join('\n'));
      return [ok(null, t('Panoya kopyalandı'))];
    }
    case 'path': clipboard.writeText(paths.join('\n')); return [ok(null, t('Yol kopyalandı'))];
    case 'terminal': openTerminal(fs.statSync(paths[0]).isDirectory() ? paths[0] : path.dirname(paths[0])); return [ok(null, t('Terminal açıldı'))];
    case 'reveal': shell.showItemInFolder(paths[0]); return [ok(null, t('Gösterildi'))];
    case 'trash': for (const p of paths) await shell.trashItem(p); return [ok(null, t('Çöpe atıldı'))];
    case 'move': case 'duplicate': {
      const dir = await pickFolder(t(id === 'move' ? 'Nereye taşınsın?' : 'Kopyası nereye konsun?'));
      if (!dir) return [{ ok: false, src: paths[0], error: t('Vazgeçildi'), cancelled: true }];
      return paths.map((p) => {
        try { return { ok: true, src: p, out: id === 'move' ? moveFile(p, dir) : uniqueCopy(p, dir) }; } catch (e) { return { ok: false, src: p, error: e.message }; }
      });
    }
    default: throw new Error(t('Bilinmeyen eylem'));
  }
}

// ---------- Yüzen dosya (Float) ----------

function openFloat(file) {
  trustPaths([file]);
  const pt = screen.getCursorScreenPoint();
  const win = new BrowserWindow({
    width: 240, height: 260, x: pt.x - 120 + floats.size * 24, y: pt.y - 130 + floats.size * 24,
    frame: false, transparent: true, resizable: true, alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    backgroundColor: '#00000000', minWidth: 160, minHeight: 180, webPreferences: commonWeb,
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, 'renderer', 'float.html'), { query: { file, href: fileUrl(file) } }).catch((err) => console.error(err));
  floats.add(win);
  win.on('closed', () => floats.delete(win));
}

// ---------- Tepsi ----------

function buildTray() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  if (!tray) {
    tray = new Tray(img);
    tray.setToolTip('ShiftDrop');
    // Windows'ta tepsi simgesine tıklamak menüyü açar; Linux'ta balonu açıp kapatır.
    tray.on('click', () => (IS_WIN ? tray.popUpContextMenu() : setBubble(!settings.bubble)));
  }
  const keyItems = (mode, label) => ({
    label,
    submenu: ['Shift', 'Ctrl', 'Alt', 'Super'].map((k) => ({
      label: k, type: 'radio', checked: settings.keys[mode] === k,
      click: () => {
        // Aynı tuş iki çarka atanmasın: yer değiştir.
        const other = Object.keys(settings.keys).find((m) => settings.keys[m] === k);
        if (other) settings.keys[other] = settings.keys[mode];
        settings.keys[mode] = k;
        saveSettings();
        buildTray();
      },
    })),
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'ShiftDrop', enabled: false },
    { label: hooksUseful ? t('Sürüklerken {c}: dönüştür · {t}: araçlar · {a}: eylemler', { c: settings.keys.convert, t: settings.keys.tools, a: settings.keys.actions }) : t('Tuşlar diğer uygulamalarda görünmez: sağ kenardaki balonu kullan'), enabled: false },
    { type: 'separator' },
    { label: t('Kenar balonu'), type: 'checkbox', checked: settings.bubble, click: (i) => setBubble(i.checked) },
    { label: t('Tuşlar'), submenu: [keyItems('convert', t('Dönüştür')), keyItems('tools', t('Araçlar')), keyItems('actions', t('Eylemler'))] },
    {
      label: t('Dil'),
      submenu: [['tr', 'Türkçe'], ['en', 'English']].map(([code, name]) => ({
        label: name, type: 'radio', checked: i18n.getLang() === code, click: () => setLanguage(code),
      })),
    },
    { label: t('Oturum açılınca başlat'), type: 'checkbox', checked: autostartEnabled(), click: (i) => setAutostart(i.checked) },
    { type: 'separator' },
    { label: t('Çıkış'), role: 'quit' },
  ]));
}

// Linux'ta setLoginItemSettings çalışmaz; XDG autostart dosyası yazıyoruz.
const autostartFile = () => path.join(app.getPath('home'), '.config', 'autostart', 'shiftdrop.desktop');
function autostartEnabled() {
  if (process.platform === 'linux') return fs.existsSync(autostartFile());
  const exe = process.env.PORTABLE_EXECUTABLE_FILE;
  return app.getLoginItemSettings(exe ? { path: exe, args: ['--hidden'] } : { args: ['--hidden'] }).openAtLogin;
}
function setAutostart(on) {
  if (process.platform !== 'linux') {
    // Taşınabilir exe her açılışta geçici bir klasöre açılır; asıl exe'nin yolunu kaydet.
    const exe = process.env.PORTABLE_EXECUTABLE_FILE;
    app.setLoginItemSettings(exe ? { openAtLogin: on, path: exe, args: ['--hidden'] } : { openAtLogin: on, args: ['--hidden'] });
    return;
  }
  if (!on) { fs.rmSync(autostartFile(), { force: true }); return; }
  const quote = (s) => /[\s"\\]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
  const exec = process.env.APPIMAGE
    ? quote(process.env.APPIMAGE)
    : app.isPackaged
      ? quote(process.execPath)
      : `${quote(process.execPath)} ${quote(path.join(__dirname, '..'))}`;
  fs.mkdirSync(path.dirname(autostartFile()), { recursive: true });
  const ozone = '--ozone-platform=x11 --enable-transparent-visuals';
  fs.writeFileSync(autostartFile(), `[Desktop Entry]\nType=Application\nName=ShiftDrop\nExec=${exec} ${ozone} --hidden\nX-GNOME-Autostart-enabled=true\n`);
}

// ---------- Dil ----------

// Sıra: kullanıcının seçtiği dil, derlemenin varsayılanı (Türkçe/İngilizce sürüm), sistem dili.
function initialLanguage() {
  if (settings.lang) return settings.lang;
  if (pkg.shiftdropLang) return pkg.shiftdropLang;
  return app.getLocale().toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

function setLanguage(code) {
  settings.lang = code;
  saveSettings();
  i18n.setLang(code);
  buildTray();
  for (const w of [wheel, bubble, ...floats]) {
    const wc = safeWebContents(w);
    try { if (wc && !wc.isCrashed()) wc.reload(); } catch (err) { console.error(err); }
  }
}

// ---------- IPC ----------

ipcMain.on('i18n', (e) => { e.returnValue = { lang: i18n.getLang(), dict: i18n.getLang() === 'en' ? i18n.EN : {} }; });

ipcMain.handle('options', (_e, { paths, mode }) => {
  if (Array.isArray(paths)) trustPaths(paths);
  return optionsFor(paths, mode);
});
ipcMain.on('busy', (_e, v) => { busy = !!v; if (!v) scheduleCloseCheck(900); });
ipcMain.on('wheel:dismiss', () => closeWheel());
ipcMain.on('reveal', (_e, p) => { if (isTrustedPath(p)) shell.showItemInFolder(p); });
ipcMain.on('open-path', (_e, p) => { if (isTrustedPath(p)) shell.openPath(p); });
ipcMain.on('float:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

// dragstart sırasında senkron olmalı; async getFileIcon jestini kaçırır (özellikle Windows).
ipcMain.on('start-drag', (e, file) => {
  if (!isTrustedPath(file) || !fs.existsSync(file)) { e.returnValue = false; return; }
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  try { e.sender.startDrag({ file, icon }); e.returnValue = true; } catch { e.returnValue = false; }
});

// Balon: üzerine dosya sürüklenince çarkı imlecin olduğu yerde aç.
ipcMain.on('bubble:dragenter', (_e, { mode }) => openWheel(mode, 'bubble'));
// Balona bırakılırsa dosya yollarını çarka ilet (aksi halde bırakma yutulur).
ipcMain.on('bubble:drop', (_e, { mode, paths }) => {
  if (!paths?.length) return;
  trustPaths(paths);
  busy = true; // mouseup kapanış yarışını kes
  openWheel(mode || 'convert', 'bubble');
  try { safeWebContents(wheel)?.send('wheel:files', { paths }); } catch (err) { console.error(err); }
});
ipcMain.on('bubble:moveY', (_e, dy) => {
  if (!windowAlive(bubble)) return;
  try {
    const b = bubble.getBounds();
    const { workArea: wa } = screen.getPrimaryDisplay();
    const y = Math.max(wa.y, Math.min(b.y + dy, wa.y + wa.height - b.height));
    bubble.setBounds({ ...b, y });
    settings.bubbleY = (y - wa.y) / Math.max(1, wa.height - b.height);
  } catch (err) { console.error(err); }
});
ipcMain.on('bubble:moved', saveSettings);

ipcMain.handle('perform', async (e, { paths, mode, id }) => {
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => !isTrustedPath(p))) {
    return [{ ok: false, src: paths?.[0], error: t('Geçersiz dosya yolu') }];
  }
  const send = (p) => !e.sender.isDestroyed() && e.sender.send('progress', p);
  if (mode === 'actions') {
    try {
      const results = await runAction(paths, id);
      for (const r of results) if (r.ok && r.out) trustPaths([r.out]);
      return results;
    } catch (err) { return [{ ok: false, src: paths[0], error: err?.message || String(err) }]; }
  }
  const results = await perform(paths, mode, id, send);
  for (const r of results) if (r.ok && r.out) trustPaths([].concat(r.out));
  return results;
});

// ---------- Başlangıç ----------

let hooksOk = false;
// X11'de XRecord diğer uygulamaları görür. Wayland'de görmez; balon asıl yoldur.
let hooksUseful = false;

// İkinci kopya hiçbir şey kurmadan çıkar; çalışan kopya 'second-instance' olayını alır.
const isPrimary = relaunching || app.requestSingleInstanceLock();
if (!isPrimary) app.quit();

// Penceresi olmayan bir tepsi uygulaması: elle açılınca çalıştığını haber ver, yoksa hiçbir şey olmamış gibi görünür.
function announce() {
  if (!Notification.isSupported()) return;
  const body = hooksUseful
    ? t('Tepside çalışıyor. Bir dosyayı sürüklerken {c} tuşuna dokun.', { c: settings.keys.convert })
    : t('Sağ kenardaki balona dosya sürükle. {s} çarkı da açar.', { s: 'Ctrl+Alt+Space' });
  new Notification({ title: 'ShiftDrop', body, icon: path.join(ASSETS, 'icon.png') }).show();
}

// Zaten açıkken tekrar başlatılırsa (menüden, Gear Lever'dan…) yeni kopya kapanır; çalışan kopya çarkı gösterir.
app.on('second-instance', () => {
  openWheel('convert', 'shortcut');
  announce();
});

if (IS_WIN) app.setAppUserModelId('app.shiftdrop');

function runWindowReviveTest() {
  const failures = [];
  const check = (name, cond) => { console.log(cond ? 'ok  ' : 'FAIL', name); if (!cond) failures.push(name); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    for (let i = 0; i < 3; i++) {
      if (windowAlive(wheel)) wheel.destroy();
      openWheel('convert', 'shortcut');
      await wait(250);
      let visible = false;
      try { visible = windowAlive(wheel) && wheel.isVisible(); } catch { visible = false; }
      check('shortcut revive ' + i, visible);
      closeWheel(true);
      await wait(280);
      if (windowAlive(bubble)) bubble.destroy();
      setBubble(true);
      await wait(250);
      let bubbleUp = false;
      try { bubbleUp = windowAlive(bubble) && bubble.isVisible(); } catch { bubbleUp = false; }
      check('bubble revive ' + i, bubbleUp);
      openWheel('convert', 'bubble');
      await wait(200);
      check('bubble opens wheel ' + i, windowAlive(wheel));
      closeWheel(true);
    }
    const doomed = ensureWheel();
    doomed.once('show', () => { try { doomed.destroy(); } catch { /* yoksay */ } });
    openWheel('convert', 'bubble');
    await wait(250);
    let survived = false;
    try { survived = windowAlive(wheel) && wheel.isVisible(); } catch { survived = false; }
    check('show sırasında yok edilince yeniden kurulur', survived);
    console.log(failures.length ? 'E2E_FAIL ' + failures.join(', ') : 'E2E_OK');
    app.exit(failures.length ? 1 : 0);
  })().catch((err) => { console.error(err); app.exit(1); });
}

if (!relaunching) app.whenReady().then(() => {
  if (!isPrimary) return;
  loadSettings();
  i18n.setLang(initialLanguage());
  // Saydam pencere, X görseli hazır olmadan açılırsa görünmez kalır.
  const bootUi = () => {
    createWheel();
    createBubble();
    hooksOk = startHooks();
    const evdevDevices = startEvdev();
    hooksUseful = hooksOk && !isWayland;
    // Wayland'de kanca "başarılı" olsa da Nautilus'un tuşunu görmez. Tepsi de GNOME'da yoktur.
    if (isWayland || !hooksOk) setBubble(true);
    if (isWayland) {
      console.error(t('Wayland: diğer uygulamaların tuşları görünmez. Dosyayı sağ kenardaki balona sürükle. {s} çarkı açar.', { s: 'Ctrl+Alt+Space' }));
      if (evdevDevices) console.error(t('Çekirdek girdi aygıtı da dinleniyor; Shift jesti oturum izin verirse çalışır.'));
    }
    globalShortcut.register(TOGGLE_SHORTCUT, () => {
      try {
        if (windowAlive(wheel) && wheel.isVisible()) closeWheel(true);
        else openWheel('convert', 'shortcut');
      } catch (err) { console.error(err); }
    });
    buildTray();
    if (!HIDDEN) announce();
    screen.on('display-metrics-changed', () => {
      if (!windowAlive(bubble)) return;
      try { bubble.setBounds(bubbleBounds()); } catch (err) { console.error(err); }
    });
    if (process.env.SHIFTDROP_E2E === '1') runWindowReviveTest();
  };
  if (process.platform === 'linux') setTimeout(bootUi, 150);
  else bootUi();
});

// Tepsi uygulaması: son pencere kapanınca çıkma (Electron bu olaya argüman vermez).
app.on('window-all-closed', () => {});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { stopEvdev(); } catch { /* yoksay */ }
  try { require('uiohook-napi').uIOhook.stop(); } catch { /* yoksay */ }
});
