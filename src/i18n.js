// Basit çeviri: kaynak metin Türkçedir, İngilizce karşılığı bu sözlükten gelir.
// t('{n} dosya', { n: 3 }) → "3 dosya" ya da "3 files". Sözlükte olmayan metin olduğu gibi döner.
const EN = {
  // Kategoriler
  'Görsel': 'Image', 'Video': 'Video', 'Ses': 'Audio', 'PDF': 'PDF', 'Belge': 'Document', 'Sunum': 'Slides',
  'Tablo': 'Spreadsheet', 'Altyazı': 'Subtitle', 'Arşiv': 'Archive', 'Dosya': 'File', 'Dosyalar': 'Files',
  '{n} dosya': '{n} files', '{n} görsel': '{n} images', '{n} video': '{n} videos', '{n} ses': '{n} audio files',
  '{n} pdf': '{n} PDFs', '{n} belge': '{n} documents', '{n} sunum': '{n} presentations', '{n} tablo': '{n} spreadsheets',
  '{n} altyazı': '{n} subtitles', '{n} arşiv': '{n} archives',

  // Dönüştürme ipuçları
  'Kayıpsız': 'Lossless', 'Küçük': 'Small', 'Web': 'Web', 'En verimli': 'Most efficient', 'Baskı': 'Print', 'Uyumlu': 'Compatible',
  'Ham': 'Raw', 'Simge': 'Icon', 'Animasyon': 'Animated', 'Sesi çıkar': 'Extract audio', 'Eski': 'Legacy', 'Konuşma': 'Speech',
  'Metin': 'Text', 'E-kitap': 'E-book', 'Yazdır': 'Print', 'Zengin': 'Rich text', 'Slaytlar': 'Slides', 'Virgül': 'Comma',
  'Sekme': 'Tab', 'Sadece metin': 'Text only', 'Evrensel': 'Universal', 'Sıkıştırmasız': 'Uncompressed', 'Klasöre aç': 'To a folder',
  'Aç': 'Open',

  // Araçlar
  'Sıkıştır': 'Compress', 'Aynı format': 'Same format', 'Yarıya indir': 'Halve', 'Sığdır': 'Fit', 'Döndür': 'Rotate',
  'Aynala': 'Mirror', 'Yatay': 'Horizontal', 'Kare kırp': 'Square crop', 'Ortadan': 'Centered', '%50': '50%', 'Gri ton': 'Grayscale',
  'Siyah-beyaz': 'Black & white', 'Meta sil': 'Strip metadata', 'Küçült': 'Downscale', 'Sessiz': 'Mute', 'Sesi at': 'Remove audio',
  '2× hız': '2× speed', 'Hızlandır': 'Speed up', 'Tersine': 'Reverse', 'Geri sar': 'Play backwards', 'Böl': 'Split',
  '2 parça': '2 parts', 'Kare al': 'Frame', 'Orta kare': 'Middle frame', 'Ses seviyesi': 'Loudness', 'Sessizlik kırp': 'Trim silence',
  'Baş/son': 'Start/end', 'Tek kanal': 'Single channel', 'Giriş/çıkış': 'In/out', 'Sayfalara böl': 'Split pages',
  'Her sayfa': 'Every page', 'Ters sırala': 'Reverse order', 'Sayfalar': 'Pages', 'Kapak': 'Cover', 'İlk sayfa PNG': 'First page PNG',
  'Yazar vb.': 'Author etc.', 'Birleştir': 'Merge', 'Tek PDF': 'One PDF', 'Tek dosya': 'One file', 'Arşivle': 'Archive',

  // Eylemler
  'Yüzdür': 'Float', 'Üstte tut': 'Keep on top', 'Kopyala': 'Copy', 'Panoya': 'To clipboard', 'Taşı…': 'Move…',
  'Klasöre': 'To a folder', 'Çoğalt…': 'Duplicate…', 'Kopyasını koy': 'Put a copy', 'Yolu kopyala': 'Copy path',
  'Terminal': 'Terminal', 'Bu klasörde': 'In this folder', 'Göster': 'Reveal', 'Dosya yöneticisi': 'File manager',
  'Çöpe at': 'Trash', 'Geri alınabilir': 'Undoable',
  'Yüzdürüldü': 'Floating', 'Panoya kopyalandı': 'Copied to clipboard', 'Yol kopyalandı': 'Path copied',
  'Terminal açıldı': 'Terminal opened', 'Gösterildi': 'Revealed', 'Çöpe atıldı': 'Moved to trash', 'Vazgeçildi': 'Cancelled',
  'Nereye taşınsın?': 'Move to where?', 'Kopyası nereye konsun?': 'Put the copy where?',
  'Panoya kopyalanamadı': 'Could not copy to clipboard', 'Terminal bulunamadı': 'No terminal found',
  '{name} hedefte zaten var': '{name} already exists there',

  // Çıktı dosya adı ekleri
  'sikistirilmis': 'compressed', 'yarim': 'half', 'dondurulmus': 'rotated', 'aynali': 'mirrored', 'kare': 'square',
  'gri': 'gray', 'temiz': 'clean', 'sessiz': 'muted', 'ters': 'reversed', 'kirpilmis': 'trimmed', 'birlesik': 'merged',
  'kapak': 'cover', 'karesi': 'frame', 'sayfalar': 'pages', 'Arsiv': 'Archive', 'kopya': 'copy',

  // Hatalar
  '{tool} çıkış kodu {code}': '{tool} exit code {code}',
  'Görsel araçları için sharp gerekli': 'sharp is required for image tools',
  'Süre okunamadı': 'Could not read the duration', 'Bilinmeyen araç': 'Unknown tool',
  'PDF → görsel için poppler-utils (pdftoppm) gerekli': 'poppler-utils (pdftoppm) is required for PDF → image',
  'poppler-utils (pdftoppm) gerekli': 'poppler-utils (pdftoppm) is required',
  'PDF sıkıştırma için Ghostscript (gs) gerekli': 'Ghostscript (gs) is required for PDF compression',
  'Bu dönüşüm için LibreOffice gerekli (sudo apt install libreoffice)': 'LibreOffice is required for this conversion (libreoffice.org)',
  'LibreOffice çıktı üretmedi': 'LibreOffice produced no output',
  'RAR/7z için p7zip veya unrar gerekli': 'p7zip or unrar is required for RAR/7z',
  'Bilinmeyen arşiv türü': 'Unknown archive type', 'Bu dosya türü desteklenmiyor': 'This file type is not supported',
  'Bu dosya için araç yok': 'No tools for this file', 'Bilinmeyen eylem': 'Unknown action', 'Bilinmeyen hata': 'Unknown error',

  // Çark
  'Dönüştür': 'Convert', 'Araçlar': 'Tools', 'Eylemler': 'Actions',
  'Dönüştürülüyor': 'Converting', 'İşleniyor': 'Processing', 'Yapılıyor': 'Working',
  'Diğer': 'More', 'Bırak': 'Drop', 'Dosyayı buraya bırak': 'Drop a file here', 'Dosya bekleniyor': 'Waiting for a file',
  'Bu tür için seçenek yok': 'No options for this type', 'sonra seç': 'then choose',
  'Olmadı': 'That didn’t work', 'Kaynağı göster': 'Show source', 'Klasörde göster': 'Show in folder', 'Tamam': 'Done',
  '{n} dosya hazır': '{n} files ready', '{n} hata': '{n} failed',
  'Sürükleyip istediğin yere bırak': 'Drag it wherever you like', 'Dosyayı buraya sürükle': 'Drag a file here', 'Kapat': 'Close',

  // Tepsi
  'Sürüklerken {c}: dönüştür · {t}: araçlar · {a}: eylemler': 'While dragging, {c}: convert · {t}: tools · {a}: actions',
  'Tuş algılama kapalı: kenar balonunu kullan': 'Key detection is off: use the edge bubble',
  'Kenar balonu': 'Edge bubble', 'Tuşlar': 'Keys', 'Oturum açılınca başlat': 'Start at login', 'Çıkış': 'Quit',
  'Dil': 'Language',
  'Tepside çalışıyor. Bir dosyayı sürüklerken {c} tuşuna dokun.': 'Running in the tray. While dragging a file, tap {c}.',
  'Tepside çalışıyor. Dosyayı ekranın sağ kenarındaki balona sürükle.': 'Running in the tray. Drag a file onto the bubble at the right edge of the screen.',
};

let lang = 'tr';

function setLang(l) { lang = l === 'en' ? 'en' : 'tr'; }
function getLang() { return lang; }

function t(str, vars) {
  let out = lang === 'en' && EN[str] !== undefined ? EN[str] : str;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

module.exports = { t, setLang, getLang, EN };
