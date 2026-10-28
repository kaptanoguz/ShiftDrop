// Kurulum dosyalarını derler. Kullanım: node scripts/build.js <linux|win> <tr|en>
// Dil, uygulamanın varsayılan dili olur (tepsi menüsünden yine değiştirilebilir) ve dosya adlarına yansır.
const builder = require('electron-builder');

const [platform = 'linux', lang = 'tr'] = process.argv.slice(2);
const names = {
  tr: { setup: 'ShiftDrop-Kurulum-${version}.${ext}', portable: 'ShiftDrop-Tasinabilir-${version}.${ext}', appimage: 'ShiftDrop-${version}-TR.${ext}', deb: 'shiftdrop_${version}_tr_${arch}.${ext}' },
  en: { setup: 'ShiftDrop-Setup-${version}.${ext}', portable: 'ShiftDrop-Portable-${version}.${ext}', appimage: 'ShiftDrop-${version}-EN.${ext}', deb: 'shiftdrop_${version}_en_${arch}.${ext}' },
}[lang];
if (!names) throw new Error(`Bilinmeyen dil: ${lang}`);

builder.build({
  targets: platform === 'win' ? builder.Platform.WINDOWS.createTarget(null, builder.Arch.x64) : builder.Platform.LINUX.createTarget(['AppImage', 'deb'], builder.Arch.x64),
  publish: 'never',
  config: {
    extraMetadata: { shiftdropLang: lang },
    nsis: { artifactName: names.setup },
    portable: { artifactName: names.portable },
    linux: { artifactName: names.appimage },
    deb: { artifactName: names.deb },
  },
}).then((files) => console.log(files.join('\n'))).catch((e) => { console.error(e); process.exit(1); });
