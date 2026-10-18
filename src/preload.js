const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Çeviri sözlüğü pencere açılırken bir kez alınır; dil değişince pencere yeniden yüklenir.
const { lang, dict } = ipcRenderer.sendSync('i18n');
const t = (str, vars) => {
  let out = dict[str] !== undefined ? dict[str] : str;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
};

const channels = ['wheel:open', 'wheel:mode', 'wheel:close', 'progress'];

contextBridge.exposeInMainWorld('shiftdrop', {
  platform: process.platform,
  lang,
  t,
  pathFor: (file) => webUtils.getPathForFile(file),
  options: (paths, mode) => ipcRenderer.invoke('options', { paths, mode }),
  perform: (paths, mode, id) => ipcRenderer.invoke('perform', { paths, mode, id }),
  setBusy: (v) => ipcRenderer.send('busy', v),
  dismiss: () => ipcRenderer.send('wheel:dismiss'),
  reveal: (p) => ipcRenderer.send('reveal', p),
  openPath: (p) => ipcRenderer.send('open-path', p),
  startDrag: (p) => ipcRenderer.send('start-drag', p),
  closeFloat: () => ipcRenderer.send('float:close'),
  bubbleEnter: (mode) => ipcRenderer.send('bubble:dragenter', { mode }),
  bubbleMove: (dy) => ipcRenderer.send('bubble:moveY', dy),
  bubbleMoved: () => ipcRenderer.send('bubble:moved'),
  on: (channel, fn) => { if (channels.includes(channel)) ipcRenderer.on(channel, (_e, d) => fn(d)); },
});
