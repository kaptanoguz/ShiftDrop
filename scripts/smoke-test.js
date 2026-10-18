// Motoru Electron olmadan dener: örnek dosyalar üretir, her çarktaki her seçeneği çalıştırır.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { optionsFor, perform, FFMPEG, soffice } = require('../src/engine');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftdrop-test-'));
const f = (n) => path.join(dir, n);
const ff = (...a) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...a]);

ff('-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', f('foto.png'));
ff('-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', f('foto2.jpg'));
ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-pix_fmt', 'yuv420p', '-shortest', f('klip.mp4'));
ff('-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', f('ses.wav'));
fs.writeFileSync(f('notlar.md'), '# Başlık\n\nBir **kalın** ve *italik* paragraf.\n\n- bir\n- iki\n');
fs.writeFileSync(f('tablo.csv'), 'ad,yas\nAli,30\nAyşe,25\n');
fs.writeFileSync(f('altyazi.srt'), '1\n00:00:00,000 --> 00:00:01,500\nMerhaba dünya\n\n2\n00:00:02,000 --> 00:00:03,000\nİkinci satır\n');
execFileSync('zip', ['-q', '-j', f('paket.zip'), f('notlar.md'), f('tablo.csv')]);

const cases = [
  [['foto.png'], ['convert', 'tools']],
  [['klip.mp4'], ['convert', 'tools']],
  [['ses.wav'], ['convert', 'tools']],
  [['notlar.md'], ['convert']],
  [['tablo.csv'], ['convert']],
  [['altyazi.srt'], ['convert']],
  [['paket.zip'], ['convert']],
  [['foto.png', 'foto2.jpg'], ['tools']],
];

(async () => {
  let pass = 0; let fail = 0; let skip = 0;
  const run = async (files, mode, id) => {
    const res = await perform(files.map(f), mode, id);
    for (const r of res) {
      if (r.ok && fs.existsSync(r.out)) { pass++; console.log(`  ok   ${mode}/${id}  ${path.basename(r.src)} → ${path.basename(r.out)}`); } else if (/gerekli/.test(r.error || '')) { skip++; console.log(`  skip ${mode}/${id}  ${r.error}`); } else { fail++; console.log(`  FAIL ${mode}/${id}  ${path.basename(r.src)}: ${r.error}`); }
    }
  };
  for (const [files, modes] of cases) {
    for (const mode of modes) {
      const { items } = optionsFor(files.map(f), mode);
      for (const it of items) await run(files, mode, it.id);
    }
  }
  // Belgeden üretilen PDF ile PDF çarkını da dene
  const pdf = fs.readdirSync(dir).find((n) => /^notlar.*\.pdf$/.test(n));
  if (pdf) {
    for (const mode of ['convert', 'tools']) for (const it of optionsFor([f(pdf)], mode).items) await run([pdf], mode, it.id);
  }
  console.log(`\n${pass} başarılı, ${fail} başarısız, ${skip} atlandı  (LibreOffice: ${soffice() ? 'var' : 'yok'})  ${dir}`);
  process.exit(fail ? 1 : 0);
})();
