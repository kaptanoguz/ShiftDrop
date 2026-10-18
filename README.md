# ShiftDrop

Linux ve Windows için [Tangerine](https://tangerineformac.com/) tarzı bir dönüştürücü. Bir dosyayı sürüklemeye başla, bir tuşa dokun: imlecin etrafında bir çark açılır, dosyayı istediğin dilime bırakırsın. Her şey bilgisayarında çalışır, hiçbir dosya bir yere yüklenmez.

| Sürüklerken dokun | Çark | Örnekler |
|---|---|---|
| **Shift** | Dönüştür | PNG, JPG, WebP, AVIF, PDF, MP4, WebM, GIF, MP3, DOCX, XLSX… |
| **Ctrl** | Araçlar | Sıkıştır, yarıya indir, döndür, kare kırp, sessize al, 2× hız, böl, birleştir, ZIP |
| **Alt** | Eylemler | Yüzdür, panoya kopyala, taşı, çoğalt, yolu kopyala, terminal, göster, çöpe at |

Tuşu basılı tutman gerekmez: dokunup bırakınca çark açık kalır, dosyayı bırakana ya da **Esc**'ye basana kadar durur. Çark açıkken başka bir tuşa dokunarak çarklar arasında geçebilirsin. Merkeze bırakmak vazgeçmek demektir. Sekizden fazla seçenek varsa **Diğer** dilimi üzerinde biraz bekle ya da fare tekerleğini çevir.

Dönüşüm bitince çarkın ortasında bir sonuç kartı belirir. Kartı doğrudan başka bir pencereye sürükleyebilir, **Klasörde göster** ya da **Aç** diyebilirsin. Çıktılar her zaman kaynak dosyanın yanına yazılır, hiçbir şeyin üzerine yazılmaz (`foto (1).webp` gibi).

## Kurulum

Hazır kurulum dosyaları [Releases](https://github.com/kaptanoguz/ShiftDrop/releases) sayfasında. `main` dalına her kod gönderiminde GitHub Actions bunları yeniden derleyip `package.json`'daki sürüm numarasıyla oraya ekler.

### Windows

- **ShiftDrop-Kurulum-1.0.0.exe**: Kurulum sihirbazı. Masaüstü ve Başlat menüsü kısayolu oluşturur, yönetici izni istemez.
- **ShiftDrop-Tasinabilir-1.0.0.exe**: Kurulum gerektirmez, çift tıklayınca çalışır.

Uygulama imzasız olduğu için ilk açılışta SmartScreen "Windows bilgisayarınızı korudu" uyarısı çıkabilir. **Ek bilgi → Yine de çalıştır** ile açabilirsin. ShiftDrop görev çubuğunun sağındaki simge alanında çalışır, menüsü oradan açılır.

### Linux (AppImage)

```bash
chmod +x ShiftDrop-1.0.0.AppImage
./ShiftDrop-1.0.0.AppImage
```

### Kaynaktan

Node.js 20 veya üstü gerekir.

```bash
unzip shiftdrop-kaynak.zip && cd shiftdrop
npm install
npm start          # çalıştır
npm test           # motoru Electron olmadan dener
npm run dist:linux # dist/ altına AppImage üretir
npm run dist:win   # Windows kurulum ve taşınabilir exe (Linux'ta wine gerekir)
```

### İsteğe bağlı sistem araçları

Görsel, video, ses, altyazı ve ZIP işlemleri kutudan çıktığı gibi çalışır (ffmpeg uygulamayla gelir). Şunlar ise sistemde kuruluysa açılır.

Windows'ta [LibreOffice](https://www.libreoffice.org/download/) ve [7-Zip](https://www.7-zip.org/) normal kurulumla yeterli; poppler ve Ghostscript için `bin` klasörlerini PATH'e eklemen gerekir. Linux'ta:

```bash
sudo apt install libreoffice poppler-utils ghostscript p7zip-full
```

- **LibreOffice**: Word, ODT, RTF, EPUB, sunum ve tablo dönüşümleri, PDF'ten DOCX'e
- **poppler-utils**: PDF'ten 300 DPI PNG/JPG ve metin, kapak sayfası
- **ghostscript**: PDF sıkıştırma
- **p7zip**: RAR ve 7z açma

## Windows

Sürüklerken basılan tuşlar sistem genelinde algılanır, ek izin gerekmez. Shift, Ctrl ve Alt Gezgin'de bırakma davranışını değiştirse de ShiftDrop dosyayı her zaman kopyalama olarak alır ve kaynağa dokunmaz. **Kopyala** eylemi dosyaları Gezgin'de Ctrl+V ile yapıştırılabilecek şekilde panoya koyar, **Terminal** varsa Windows Terminal'i açar. Oturum açılınca başlatma tepsi menüsünden açılır.

## X11 ve Wayland

- **X11**: Sürüklerken basılan tuşlar sistem genelinde algılanır, çark imlecin olduğu yerde açılır.
- **Wayland**: Wayland güvenlik gereği diğer uygulamalardaki tuşları dinlemeye izin vermez. Bu yüzden ekranın sağ kenarında küçük bir **mandalina balonu** görünür. Dosyayı balonun üzerine sürükle, çark orada açılır. Çark açıkken Shift, Ctrl ve Alt yine çalışır, çünkü imleç artık ShiftDrop'un üzerindedir. Balonu kenar boyunca yukarı aşağı taşıyabilirsin.

Balonu X11'de de tepsi menüsünden açabilirsin. Tepsi menüsünden tuş atamaları değiştirilebilir ve uygulamanın oturum açılınca başlaması sağlanabilir. Yedek kısayol: **Ctrl+Alt+Boşluk**, çarkı imlecin altında açar; dosyayı sonra üzerine bırakıp dilime tıklarsın.

## Bilinen sınırlar

- Uygulama Wayland'de de XWayland üzerinden çalışır, çünkü pencereyi imlecin yanına konumlandırmanın tek yolu bu.
- HEIC kodlaması yok (okuması sistemdeki kütüphanelere bağlı); Pages ve Keynote dosyaları desteklenmiyor.
- Kırpma ve kesme aralığı seçme gibi ayar isteyen araçlar yok; "Böl" dosyayı ortadan ikiye ayırır.

## Proje yapısı

```
src/main.js         Ana süreç: genel tuş dinleme, pencereler, tepsi, dosya eylemleri
src/engine.js       Dönüşüm ve araç motoru (Electron'dan bağımsız)
src/preload.js      Arayüzle ana süreç arasındaki köprü
src/renderer/       Çark, kenar balonu ve yüzen dosya penceresi
scripts/            Duman testi ve ekran görüntüsü betiği
```
