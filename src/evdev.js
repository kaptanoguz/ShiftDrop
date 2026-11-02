// Wayland uygulamalarının tuş/fare olayları XWayland'in XRecord kancasına düşmez.
// Oturum sahibine logind'in verdiği /dev/input erişimi varsa aynı jesti çekirdekten okuruz.
// Yalnızca değiştirici tuşlar, sol tık ve göreli hareket tutulur; diğer tuşlar kaydedilmez.
const fs = require('fs');

const EV_KEY = 1;
const EV_REL = 2;
const EVENT_SIZE = 24; // linux/input.h, 64-bit timeval
const KEY = {
  Shift: [42, 54],
  Ctrl: [29, 97],
  Alt: [56, 100],
  Super: [125, 126],
};
const KEY_ESC = 1;
const BTN_LEFT = 0x110;
const DRAG_THRESHOLD = 6;

function createDragGesture() {
  const held = { Shift: false, Ctrl: false, Alt: false, Super: false };
  let down = false;
  let drag = false;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;

  const modeFor = (keys) => {
    for (const [mode, name] of Object.entries(keys || {})) if (held[name]) return mode;
    return null;
  };

  function feed(type, code, value, keys) {
    if (type === EV_KEY && code === KEY_ESC && value === 1) return { escape: true };
    if (type === EV_KEY && code === BTN_LEFT) {
      if (value === 1) { down = true; drag = false; sx = x; sy = y; return null; }
      if (value === 0) { const was = drag; down = false; drag = false; return was ? { release: true } : null; }
    }
    if (type === EV_KEY && value !== 2) {
      for (const [name, codes] of Object.entries(KEY)) {
        if (codes.includes(code)) held[name] = value !== 0;
      }
      if (value === 1 && drag) {
        const mode = modeFor(keys);
        if (mode) return { open: mode };
      }
      return null;
    }
    if (type === EV_REL && (code === 0 || code === 1)) {
      if (code === 0) x += value;
      else y += value;
      if (down && !drag && Math.hypot(x - sx, y - sy) > DRAG_THRESHOLD) {
        drag = true;
        const mode = modeFor(keys);
        if (mode) return { open: mode };
      }
    }
    return null;
  }

  return { feed };
}

function decodeInputEvents(buffer) {
  const events = [];
  const n = buffer.length - (buffer.length % EVENT_SIZE);
  for (let o = 0; o < n; o += EVENT_SIZE) {
    events.push({
      type: buffer.readUInt16LE(o + 16),
      code: buffer.readUInt16LE(o + 18),
      value: buffer.readInt32LE(o + 20),
    });
  }
  return events;
}

function deviceHasKeysOrAxes(name) {
  try {
    const hex = fs.readFileSync(`/sys/class/input/${name}/device/capabilities/ev`, 'utf8').trim();
    const bits = BigInt(`0x${hex}`);
    return (bits & ((1n << 1n) | (1n << 2n))) !== 0n; // EV_KEY veya EV_REL
  } catch { return false; }
}

function startEvdevWatch(onEvent) {
  let dir;
  try { dir = fs.readdirSync('/dev/input'); } catch { return { devices: 0, stop() {} }; }
  const fds = [];
  const buf = Buffer.alloc(EVENT_SIZE * 64);
  let timer = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    for (const fd of fds) { try { fs.closeSync(fd); } catch { /* kapalı */ } }
    fds.length = 0;
  };
  for (const name of dir) {
    if (!/^event\d+$/.test(name) || !deviceHasKeysOrAxes(name)) continue;
    try { fds.push(fs.openSync(`/dev/input/${name}`, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)); } catch { /* izin yok */ }
  }
  if (!fds.length) return { devices: 0, stop() {} };
  // Engelleyen okuma libuv havuzunu kilitler; kısa aralıkla yalnızca hazır olaylar alınır.
  timer = setInterval(() => {
    for (const fd of fds) {
      try {
        const n = fs.readSync(fd, buf, 0, buf.length, null);
        if (n > 0) for (const ev of decodeInputEvents(buf.subarray(0, n))) onEvent(ev.type, ev.code, ev.value);
      } catch (err) {
        if (err.code !== 'EAGAIN' && err.code !== 'EWOULDBLOCK') { /* aygıt koptu */ }
      }
    }
  }, 16);
  if (timer.unref) timer.unref();
  return { devices: fds.length, stop };
}

module.exports = { createDragGesture, decodeInputEvents, startEvdevWatch, EVENT_SIZE, EV_KEY, EV_REL, BTN_LEFT };
