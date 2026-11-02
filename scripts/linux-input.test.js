// Wayland başlatma kararı ve evdev jest ayrıştırıcısı. Electron gerekmez.
const assert = require('assert');
const { needsX11Relaunch, isWaylandSession, argvHasOzoneX11 } = require('../src/linux-launch');
const { createDragGesture, decodeInputEvents, EVENT_SIZE, EV_KEY, EV_REL, BTN_LEFT } = require('../src/evdev');

assert.strictEqual(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' }), true);
assert.strictEqual(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' }), true);
assert.strictEqual(isWaylandSession({ XDG_SESSION_TYPE: 'x11' }), false);
assert.strictEqual(argvHasOzoneX11(['--ozone-platform=x11']), true);
assert.strictEqual(argvHasOzoneX11(['--ozone-platform', 'x11']), true);
assert.strictEqual(argvHasOzoneX11(['--ozone-platform=wayland']), false);

assert.strictEqual(needsX11Relaunch({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, argv: ['shiftdrop'] }), true);
assert.strictEqual(needsX11Relaunch({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' }, argv: ['shiftdrop', '--ozone-platform=x11'] }), false);
assert.strictEqual(needsX11Relaunch({ platform: 'linux', env: { XDG_SESSION_TYPE: 'x11' }, argv: ['shiftdrop'] }), false);
assert.strictEqual(needsX11Relaunch({ platform: 'win32', env: { XDG_SESSION_TYPE: 'wayland' }, argv: [] }), false);

const buf = Buffer.alloc(EVENT_SIZE * 2);
buf.writeUInt16LE(EV_KEY, 16);
buf.writeUInt16LE(42, 18); // KEY_LEFTSHIFT
buf.writeInt32LE(1, 20);
buf.writeUInt16LE(EV_REL, EVENT_SIZE + 16);
buf.writeUInt16LE(0, EVENT_SIZE + 18);
buf.writeInt32LE(3, EVENT_SIZE + 20);
const decoded = decodeInputEvents(buf);
assert.strictEqual(decoded.length, 2);
assert.deepStrictEqual(decoded[0], { type: EV_KEY, code: 42, value: 1 });

const keys = { convert: 'Shift', tools: 'Ctrl', actions: 'Alt' };
const g = createDragGesture();
assert.strictEqual(g.feed(EV_KEY, BTN_LEFT, 1, keys), null);
assert.strictEqual(g.feed(EV_KEY, 42, 1, keys), null); // sürükleme yokken Shift çark açmaz
assert.strictEqual(g.feed(EV_REL, 0, 30, keys)?.open, 'convert');
const g2 = createDragGesture();
g2.feed(EV_KEY, BTN_LEFT, 1, keys);
g2.feed(EV_REL, 0, 30, keys);
assert.deepStrictEqual(g2.feed(EV_KEY, BTN_LEFT, 0, keys), { release: true });
const g3 = createDragGesture();
g3.feed(EV_KEY, BTN_LEFT, 1, keys);
g3.feed(EV_REL, 1, 20, keys);
assert.strictEqual(g3.feed(EV_KEY, 29, 1, keys)?.open, 'tools');
assert.deepStrictEqual(g3.feed(EV_KEY, 1, 1, keys), { escape: true });

console.log('linux-input: ok');
