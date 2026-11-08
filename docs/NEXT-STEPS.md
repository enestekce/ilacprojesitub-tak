# Ürün veri bağlantısı ve güvenlik sınırları

## İlaç kataloğu

Öncelikli yayın yolu GitHub Pages workflow'udur: her Pages derlemesinde TİTCK'nın en yeni ruhsat XLSX'i ve resmî KÜB/KT indeks tablosu çekilir; güvenli eşleşen PDF bağlantıları `data/catalog.json` içine konur. Yerel HTML önizlemesinde Actions çıktısı bulunmadığından yalnızca örnek adlar görünür.

TİTCK PDF'lerinin metnini sunucu tarafında çıkarmak ve ilaç kullanım/uyarı/alerji bölümlerini uygulama içinde göstermek için `api/` Node servisini HTTPS'e dağıtın ve `config.js` içinde `ILAC_API_BASE` ayarlayın. Pages statik yayın yapar; KÜB PDF metnini tek başına proxy etmez.

TİTCK'nın tarihli resmi liste sayfası: <https://titck.gov.tr/dinamikmodul/85>. Ürün listesi, tek başına KÜB/KT, yardımcı madde, GTIN/barkod veya tüm klinik alanların eksiksiz olduğu anlamına gelmez. Gerçek katalog sürümünde kaynağın çekilme tarihi, dosya özeti, her ürünün KÜB/KT URL'si ve alan doğrulama durumu saklanmalıdır.

## Görsel tanıma

- Türkçe OCR Tesseract.js aracılığıyla cihazın tarayıcısında çalışır; kütüphane ve Türkçe dil modeli ilk kullanımda CDN'den indirilir. Fotoğrafın OCR servisine gönderildiği iddia edilmez.
- OCR çıktısı yalnızca metindir. Marka, ürün formu, doz gücü veya ruhsat durumu kendi başına doğrulanmış olmaz.
- `BarcodeDetector` HTTPS ve tarayıcı desteğine bağlıdır. API yoksa ad yazarak arama veya fotoğraf OCR yedeği kullanılır.
- GTIN tanımlaması için katalog API'sinde barkod alanı gerekir. Sadece barkodun okunması ürünün özgünlüğünü veya kutu içeriğini doğrulamaz.

## Kimlik ve kişisel veriler

Başlangıç ekranı misafir ve cihaz içi demo seçeneği sunar. e‑Devlet düğmesi sadece gerçek entegrasyonun bu prototipte bulunmadığını açıklar. Gerçek giriş; kurum yetkisi, resmi protokol ve sunucu tarafı OpenID/OAuth akışı olmadan eklenmemelidir. TC kimlik numarası veya e‑Devlet parolası istemeyin.

Demo alerji/ilaç listesi tarayıcı `localStorage` alanında saklanır ve şifreli değildir. Üretim sağlık verisi için KVKK değerlendirmesi, açık rıza/aydınlatma, şifreli yerel saklama, hesap silme ve tehdit modeli ayrıca gerekir.

## Seslendirme

TTS, cihazdaki Web Speech seslerini kullanır. Bu yaklaşım internete bağlı bir TTS hizmeti değildir ve her cihazda aynı seslerin kurulu olacağını garanti etmez. Uzak TTS seçilirse kullanıcı metninin sunucuya aktarımı açıkça açıklanmalı, sağlık/alerji verileri ses isteğine eklenmemeli ve gizlilik/izin akışı kurulmalıdır.

