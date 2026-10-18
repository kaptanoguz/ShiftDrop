const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, globalShortcut, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { optionsFor, perform } = require('./engine');

// Linux: Wayland pencerelerin konumlanmasına izin vermez, bu yüzden XWayland (X11) üzerinden çalışıyoruz.
// Saydam pencereler için de bu bayrak gerekir.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

const WHEEL = 480;
const TOGGLE_SHORTCUT = 'CommandOrControl+Alt+Space';
const IS_WIN = process.platform === 'win32';
const isWayland = process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);
const ASSETS = path.join(__dirname, '..', 'assets');

let wheel = null;
let bubble = null;
let tray = null;
let settings = { bubble: isWayland, bubbleY: 0.5, keys: { convert: 'Shift', tools: 'Ctrl', actions: 'Alt' } };
let busy = false;
let hideTimer = null;
const drag = { mouseDown: false, active: false, start: null };
const floats = new Set();

// ---------- Ayarlar ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { /* ilk açılış */ }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* yoksay */ }
}

// ---------- Pencereler ----------

const commonWeb = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false };

function createWheel() {
  wheel = new BrowserWindow({
    width: WHEEL, height: WHEEL, show: false, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, backgroundColor: '#00000000',
    type: process.platform === 'linux' ? 'utility' : undefined,
    webPreferences: commonWeb,
  });
  wheel.setAlwaysOnTop(true, 'screen-saver');
  wheel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  wheel.loadFile(path.join(__dirname, 'renderer', 'wheel.html'));
}

function bubbleBounds() {
  const { workArea: wa } = screen.getPrimaryDisplay();
  const w = 64; const h = 132;
  return { x: wa.x + wa.width - w, y: Math.round(wa.y + (wa.height - h) * settings.bubbleY), width: w, height: h };
}

function createBubble() {
  bubble = new BrowserWindow({
    ...bubbleBounds(), show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, focusable: false, hasShadow: false, backgroundColor: '#00000000',
    type: process.platform === 'linux' ? 'utility' : undefined,
    webPreferences: commonWeb,
  });
  bubble.setAlwaysOnTop(true, 'screen-saver');
  bubble.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubble.loadFile(path.join(__dirname, 'renderer', 'bubble.html'));
  bubble.once('ready-to-show', () => settings.bubble && bubble.showInactive());
}

function setBubble(on) {
  settings.bubble = on;
  saveSettings();
  if (on) { bubble.setBounds(bubbleBounds()); bubble.showInactive(); } else bubble.hide();
  buildTray();
}

function centerOn(pt) {
  const { workArea: wa } = screen.getDisplayNearestPoint(pt);
  // Çark imlecin tam ortasında açılır; ekran kenarındaysa içeri kaydırılır.
  const x = Math.max(wa.x, Math.min(pt.x - WHEEL / 2, wa.x + wa.width - WHEEL));
  const y = Math.max(wa.y, Math.min(pt.y - WHEEL / 2, wa.y + wa.height - WHEEL));
  wheel.setBounds({ x: Math.round(x), y: Math.round(y), width: WHEEL, height: WHEEL });
}

function openWheel(mode, source) {
  clearTimeout(hideTimer);
  if (!wheel.isVisible()) {
    centerOn(screen.getCursorScreenPoint());
    wheel.showInactive();
    wheel.webContents.send('wheel:open', { mode, source, keys: settings.keys });
  } else {
    wheel.webContents.send('wheel:mode', { mode });
  }
}

function closeWheel(force = false) {
  if (!wheel.isVisible() || (busy && !force)) return;
  wheel.webContents.send('wheel:close');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => wheel.hide(), 200); // kapanış animasyonu
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
    if (e.keycode === K.Escape && wheel.isVisible() && !busy) { closeWheel(); return; }
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

// ---------- Dosya eylemleri (Alt çarkı) ----------

const fileUrl = (p) => `file://${encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;

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
  if (!found) throw new Error('Terminal bulunamadı');
  spawn(found[0], found[1], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
}

function moveFile(src, destDir) {
  const dest = path.join(destDir, path.basename(src));
  if (fs.existsSync(dest)) throw new Error(`${path.basename(src)} hedefte zaten var`);
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
  for (let i = 1; fs.existsSync(dest); i++) dest = path.join(destDir, `${base} kopya${i > 1 ? ` ${i}` : ''}${ext}`);
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
    case 'float': paths.forEach(openFloat); return [ok(null, 'Yüzdürüldü')];
    case 'copy': {
      const uris = paths.map(fileUrl);
      if (process.platform === 'linux') {
        // GNOME/KDE dosya yöneticileri bu biçimi "yapıştır" olarak tanır.
        clipboard.writeBuffer('x-special/gnome-copied-files', Buffer.from(`copy\n${uris.join('\n')}`));
        clipboard.writeBuffer('text/uri-list', Buffer.from(uris.join('\r\n')));
      } else if (IS_WIN) {
        // Gezgin'in "yapıştır" ile tanıdığı dosya listesi (CF_HDROP) için PowerShell kullanıyoruz.
        const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
        await new Promise((resolve, reject) => {
          const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -Path ${list}`], { windowsHide: true });
          ps.on('error', reject);
          ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Panoya kopyalanamadı'))));
        });
      } else clipboard.writeText(paths.join('\n'));
      return [ok(null, 'Panoya kopyalandı')];
    }
    case 'path': clipboard.writeText(paths.join('\n')); return [ok(null, 'Yol kopyalandı')];
    case 'terminal': openTerminal(fs.statSync(paths[0]).isDirectory() ? paths[0] : path.dirname(paths[0])); return [ok(null, 'Terminal açıldı')];
    case 'reveal': shell.showItemInFolder(paths[0]); return [ok(null, 'Gösterildi')];
    case 'trash': for (const p of paths) await shell.trashItem(p); return [ok(null, 'Çöpe atıldı')];
    case 'move': case 'duplicate': {
      const dir = await pickFolder(id === 'move' ? 'Nereye taşınsın?' : 'Kopyası nereye konsun?');
      if (!dir) return [{ ok: false, src: paths[0], error: 'Vazgeçildi', cancelled: true }];
      return paths.map((p) => {
        try { return { ok: true, src: p, out: id === 'move' ? moveFile(p, dir) : uniqueCopy(p, dir) }; } catch (e) { return { ok: false, src: p, error: e.message }; }
      });
    }
    default: throw new Error('Bilinmeyen eylem');
  }
}

// ---------- Yüzen dosya (Float) ----------

function openFloat(file) {
  const pt = screen.getCursorScreenPoint();
  const win = new BrowserWindow({
    width: 240, height: 260, x: pt.x - 120 + floats.size * 24, y: pt.y - 130 + floats.size * 24,
    frame: false, transparent: true, resizable: true, alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    backgroundColor: '#00000000', minWidth: 160, minHeight: 180, webPreferences: commonWeb,
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, 'renderer', 'float.html'), { query: { file } });
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
    { label: hooksOk ? `Sürüklerken ${settings.keys.convert}: dönüştür · ${settings.keys.tools}: araçlar · ${settings.keys.actions}: eylemler` : 'Tuş algılama kapalı: kenar balonunu kullan', enabled: false },
    { type: 'separator' },
    { label: 'Kenar balonu', type: 'checkbox', checked: settings.bubble, click: (i) => setBubble(i.checked) },
    { label: 'Tuşlar', submenu: [keyItems('convert', 'Dönüştür'), keyItems('tools', 'Araçlar'), keyItems('actions', 'Eylemler')] },
    { label: 'Oturum açılınca başlat', type: 'checkbox', checked: autostartEnabled(), click: (i) => setAutostart(i.checked) },
    { type: 'separator' },
    { label: 'Çıkış', role: 'quit' },
  ]));
}

// Linux'ta setLoginItemSettings çalışmaz; XDG autostart dosyası yazıyoruz.
const autostartFile = () => path.join(app.getPath('home'), '.config', 'autostart', 'shiftdrop.desktop');
function autostartEnabled() {
  if (process.platform === 'linux') return fs.existsSync(autostartFile());
  const exe = process.env.PORTABLE_EXECUTABLE_FILE;
  return app.getLoginItemSettings(exe ? { path: exe } : undefined).openAtLogin;
}
function setAutostart(on) {
  if (process.platform !== 'linux') {
    // Taşınabilir exe her açılışta geçici bir klasöre açılır; asıl exe'nin yolunu kaydet.
    const exe = process.env.PORTABLE_EXECUTABLE_FILE;
    app.setLoginItemSettings(exe ? { openAtLogin: on, path: exe } : { openAtLogin: on });
    return;
  }
  if (!on) { fs.rmSync(autostartFile(), { force: true }); return; }
  const exec = process.env.APPIMAGE || (app.isPackaged ? process.execPath : `${process.execPath} ${path.join(__dirname, '..')}`);
  fs.mkdirSync(path.dirname(autostartFile()), { recursive: true });
  fs.writeFileSync(autostartFile(), `[Desktop Entry]\nType=Application\nName=ShiftDrop\nExec=${exec}\nX-GNOME-Autostart-enabled=true\n`);
}

// ---------- IPC ----------

ipcMain.handle('options', (_e, { paths, mode }) => optionsFor(paths, mode));
ipcMain.on('busy', (_e, v) => { busy = v; if (!v) scheduleCloseCheck(900); });
ipcMain.on('wheel:dismiss', () => closeWheel());
ipcMain.on('reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.on('open-path', (_e, p) => shell.openPath(p));
ipcMain.on('float:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

ipcMain.on('start-drag', async (e, file) => {
  let icon;
  try { icon = await app.getFileIcon(file, { size: 'normal' }); } catch { /* yoksay */ }
  if (!icon || icon.isEmpty()) icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  e.sender.startDrag({ file, icon });
});

// Balon: üzerine dosya sürüklenince çarkı imlecin olduğu yerde aç.
ipcMain.on('bubble:dragenter', (_e, { mode }) => openWheel(mode, 'bubble'));
ipcMain.on('bubble:moveY', (_e, dy) => {
  const b = bubble.getBounds();
  const { workArea: wa } = screen.getPrimaryDisplay();
  const y = Math.max(wa.y, Math.min(b.y + dy, wa.y + wa.height - b.height));
  bubble.setBounds({ ...b, y });
  settings.bubbleY = (y - wa.y) / Math.max(1, wa.height - b.height);
});
ipcMain.on('bubble:moved', saveSettings);

ipcMain.handle('perform', async (e, { paths, mode, id }) => {
  const send = (p) => !e.sender.isDestroyed() && e.sender.send('progress', p);
  if (mode === 'actions') {
    try { return await runAction(paths, id); } catch (err) { return [{ ok: false, src: paths[0], error: err.message }]; }
  }
  return perform(paths, mode, id, send);
});

// ---------- Başlangıç ----------

let hooksOk = false;

if (!app.requestSingleInstanceLock()) app.quit();

if (IS_WIN) app.setAppUserModelId('app.shiftdrop');

app.whenReady().then(() => {
  loadSettings();
  createWheel();
  createBubble();
  hooksOk = startHooks();
  if (!hooksOk && !settings.bubble) settings.bubble = true;
  // Yedek: kısayol çarkı imlecin altında açar; dosyayı sonra üzerine bırakabilirsin.
  globalShortcut.register(TOGGLE_SHORTCUT, () => (wheel.isVisible() ? closeWheel(true) : openWheel('convert', 'shortcut')));
  buildTray();
  screen.on('display-metrics-changed', () => bubble.setBounds(bubbleBounds()));
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { require('uiohook-napi').uIOhook.stop(); } catch { /* yoksay */ }
});
