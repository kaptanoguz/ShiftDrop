// Wayland oturumunda Electron, JS çalışmadan ozone platformunu seçer.
// app.commandLine.appendSwitch('ozone-platform') bu noktada yok sayılır; pencere
// konumlandırılamaz ve XRecord kancası diğer uygulamaların tuşunu görmez.
// Bayrak gerçek argv'de olmalıdır.

function isWaylandSession(env = process.env) {
  return (env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' || !!env.WAYLAND_DISPLAY;
}

function argvHasOzoneX11(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ozone-platform=x11') return true;
    if (argv[i] === '--ozone-platform' && argv[i + 1] === 'x11') return true;
  }
  return false;
}

function needsX11Relaunch({ platform, env, argv }) {
  if (platform !== 'linux') return false;
  if (!isWaylandSession(env)) return false;
  return !argvHasOzoneX11(argv);
}

module.exports = { isWaylandSession, argvHasOzoneX11, needsX11Relaunch };
