# İlaç Rehberi katalog API'si

Statik GitHub Pages ön yüzü tek başına TİTCK listesini indiremez veya sunamaz. Bu Node.js servisi TİTCK'nın tarihli XLSX listesini ve resmi KÜB/KT belge indeksini indirir. Ürün eşleşmesi güvenliyse istenen TİTCK PDF'lerini indirip metne çevirir; bölümleri `data/official-sections.json` içinde önbelleğe alır.

## Yerelde çalıştırma

Node.js 22.14+ gerekir. `api` klasöründe `npm install`, ardından `npx playwright install chromium --with-deps --only-shell` çalıştırıp `npm start` deyin. İlk açılışta güncel ruhsat listesi ve TİTCK KÜB/KT indeksini indirir. Ürün bulunduğunda resmi PDF'leri istek üzerine indirip ilgili bölümleri çıkarır.

## Render'a dağıtım

1. Proje dosyalarını GitHub deposunun köküne gönderin.
2. Render'da **New → Blueprint** seçip bu deponun kökünü bağlayın; `api/render.yaml` servis kökünü `api/` olarak tanımlar.
3. `ALLOWED_ORIGINS` değişkenine tam Pages adresinizi yazın (ör. `https://kullanici.github.io` veya proje yolu içermeyen origin `https://kullanici.github.io`).
4. API'nin HTTPS URL'sini `config.js` içindeki `ILAC_API_BASE` değerine yazıp frontend'i GitHub Pages'te yayınlayın. Bu API bağlantısı, TİTCK PDF'lerinin GitHub Pages tarayıcı güvenlik sınırlarını aşmadan sunucu tarafında okunması için gereklidir.

Veri diski `DATA_DIR` altında saklanır. Ücretsiz, uykuya geçen servisler ilk sorguda gecikebilir ve kalıcı disk sunmayabilir; Render'ın o anki plan koşullarını, ücretini ve disk desteğini kontrol edin. Render hesabı veya repo bağlantısı burada yok; dış hizmete dağıtım yapılmadı.

## Uç noktalar

- `GET /health`: veri yüklenme durumu, kayıt sayısı, son güncelleme tarihi.
- `GET /api/stats`: Excel sayfalarının kayıt sayıları ve kaynak metadata'sı.
- `GET /api/sheets`: resmi dosyadaki sayfalar ve satır sayıları.
- `GET /api/medicines/search?q=parol&page=1&limit=20`: alanların tamamında Türkçe duyarsız arama.
- `GET /api/medicines/:id`: bir ürün/satır kaydı.
- `GET /api/medicines/:id/official-info`: ad, etken madde, doz ve firma eşleşmesi yeterli güvene ulaşırsa TİTCK KÜB/KT PDF'lerinden kullanım amacı (KÜB 4.1), kullanım (KT 3/KÜB 4.2), kontrendikasyonlar (4.3), uyarılar (4.4), etkileşimler (4.5), gebelik/emzirme (4.6), yan etkiler (4.8) ve yardımcı maddeleri (6.1) çıkarır.
- `GET /api/metadata`: XLSX kaynak adresi, tarih etiketi ve SHA-256.

KÜB/KT eşleştirmesinde ürün adı, güç, etken madde ve ruhsat sahibi sinyalleri kullanılır; eşleşme düşük güvenliyse belge gösterilmez. PDF metin çıkarımı başarısızsa resmi belgeye bağlantı verilir. Alerji kontrolü yalnızca kayıtlı alerji adlarının resmi belge metniyle doğrudan eşleşmesini işaretler; çapraz reaksiyon kararı vermez ve “eşleşme yok” güvenlik onayı değildir. API haftada bir KÜB/KT indeksini ve ruhsat XLSX'ini yeniler. Arşivdeki “aktif” ayrımı TİTCK Excel sayfa adına dayanır; güncel eczane stoku veya SGK ödemesi anlamına gelmez.

Yönetim için `POST /download` gibi herkese açık uç nokta bulunmaz. Otomatik güncelleme haftada bir çalışır. `ALLOWED_ORIGINS=*` varsayılan değildir; Render kurulumu ön yüz origin'ini belirtmelidir.

