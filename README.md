# İlaç Rehberi · Smart-OCR Vision

Eski HTML prototipinin erişilebilirlik akışını ve pembe-beyaz görünümünü koruyan, TİTCK'nın tarihli ruhsat listesini GitHub Actions ile alıp aranabilir statik kataloğa çeviren GitHub Pages sitesi.

## Ön yüz özellikleri

- Misafir veya cihaz içi demo modu; gerçek e‑Devlet/TC kimlik bilgisi istemez.
- Alerji notları, büyükçe dokunma alanları, kamera ve fotoğraf yükleme akışı.
- Kutu üzerindeki metni cihaz tarayıcısında okumak için Tesseract.js Türkçe OCR; OCR yalnızca metin çıkarır ve ürün doğrulamaz.
- HTTPS destekli tarayıcılarda BarcodeDetector; tarayıcıda destek yoksa OCR ve adla arama yedeği.
- 20 dilli sistem ses seçimi, hız ayarı ve ekran okuyucu live-region yedeği. Türkçe TİTCK katalog alanları Türkçe seslendirilir; uydurma otomatik çeviri gösterilmez.
- Tarama sırasında ilerleme animasyonu, fotoğraf/marka adı OCR'dan veya katalogdan eşleşince ürün kartı.
- API'ye bağlanınca tüm ruhsat listesi, kaynağın sayfa adına göre aktif kayıt filtresi, sayfalı katalog gezintisi ve kaynaktan gelen kayıt alanları.
- Actions, ruhsat XLSX'ine ek olarak TİTCK'nın resmî [KÜB/KT indeksini](https://titck.gov.tr/kubkt) indirip güvenli eşleşen belgelerin doğrudan bağlantılarını ürünlere ekler.
- Node API, talep edilen ürünün resmî KÜB/KT PDF'lerini istek üzerine metne çevirip kullanım amacı, kullanım talimatı, kontrendikasyonlar, uyarılar, etkileşimler, yan etkiler ve yardımcı maddeleri kaynak bölümleriyle gösterir.
- Alerji uyarısı kayıtlı alerjileri resmî belge metniyle doğrudan karşılaştırır. Eşleşme yok sonucu güvenli kullanım onayı değildir; çapraz reaksiyon klinik olarak değerlendirilmez.

## Tüm TİTCK listesini yayına alma

`api/` altındaki içe aktarıcı, TİTCK'nın [tarihli Ruhsatlı Beşeri Tıbbi Ürünler XLSX listesini](https://titck.gov.tr/dinamikmodul/85) indirir. Sayfalardaki tüm ürün satırlarını ve kaynak alanlarını `catalog.json` dosyasına aktarır. TİTCK sayfasında birden çok tarihli dosya bulunur; içe aktarıcı en yeni tarihli ruhsatlı beşeri tıbbi ürün XLSX bağlantısını seçer.

GitHub Pages statik dosyaları yayınlar; bu proje katalog üretimini Actions işine koyar. Kurulum:

1. Bu `outputs` klasörünü bir GitHub reposunun köküne koyup `main` dalına gönderin.
2. Depoda **Settings → Pages → Build and deployment → GitHub Actions** seçin.
3. `main` dalına gönderince veya **Actions → Build and publish medicine guide → Run workflow** çalıştırınca iş TİTCK kaynağını alır, tam katalog dosyasını üretir ve Pages'e yayınlar. Haftalık iş de yeni kaynak listesini çekip yayını günceller.
4. Yayınlanan sitede ilaç arama, kaynak kayıtlarını sayfalı listeleme ve resmî belge PDF bağlantıları statik katalogdan çalışır. Kullanım ve alerji bölümlerini uygulama içinde PDF'den açıp okumak için `api/README.md` ile Node API'yi HTTPS'e dağıtın ve `config.js` içindeki `ILAC_API_BASE` adresini ayarlayın.

Bu çalışma klasöründeki yerel önizleme, Pages derlemesi henüz çalışmadığı için yalnızca örnek listeyi gösterebilir. TİTCK'nın tam katalog ve KÜB/KT indeksi, repoya gönderilip GitHub Actions ilk başarılı derlemeyi bitirince yayınlanan sitede görünür. GitHub hesabında bu uygulama için bir depo bulunmadığından yeni depo açma/yayın işlemi bu klasörden yapılamadı.

## Bilgisayarda önizleme ve fotoğraf tarama

`index.html` dosyasını doğrudan `file://` ile açmak OCR web çalışanını ve kamerayı kısıtlayabilir. Node.js kuruluysa `start-preview.cmd` dosyasını çalıştırın ve tarayıcıda `http://localhost:4173` adresini açın. OCR motoru ve Türkçe dil modeli ilk kullanımda internetten indirilir. Bu yerel önizleme fotoğraftaki metni çıkarabilir; tam ilaç kataloğu yine GitHub Pages derlemesi tamamlanınca gelir.

## Sayıların doğru sunumu

22.000 ruhsat, 7.000–9.000 aktif satış veya 8.845 SGK geri ödeme rakamları kullanıcı mesajındaki üçüncü taraf kaynaklı yaklaşık iddialardır; uygulamada doğrulanmış sayaç olarak kullanılmıyor. API'nin ekranı yalnızca indirilen dosyanın tarihli kayıt satırı sayısını ve sayfa adlarını gösterir. “Aktif ürünler listesi” de o anda eczanede bulunduğunu/eczane satışını kanıtlamaz. SGK geri ödeme bilgisi TİTCK XLSX'te yoksa gösterilmez.

## Ürün bilgisi ve güvenlik sınırları

- KÜB/KT PDF metni çıkarımı TİTCK belgesinin düzenine bağlıdır. Tarama, eşleşme veya PDF metni başarısızsa uygulama tahmin yürütmek yerine resmî PDF bağlantısını verir.
- Barkodun okunması, kutunun orijinal olduğunu kanıtlamaz. GTIN alanı veri dosyasında yoksa barkod ürün eşleşmesi yapılamaz.
- OCR eşleşmesi bulanık metin eşleşmesidir. Sonuçta ürün ve kaynak sayfa görünür; sağlık uzmanına danışma uyarısı vardır.
- Alerji ekranı profili not eder ama henüz bileşim tabanlı klinik alerji motoru değildir.
- Kamera/OCR izni reddedilirse ürün adını yazabilir veya fotoğraf yükleyebilirsiniz.
- `localStorage` sağlık bilgileri şifreli değildir; paylaşılan cihazlara hassas bilgi girmeyin.
- e‑Devlet giriş düğmesi entegrasyon olmadığını açıklar. Uygulama e‑Devlet sayfasını taklit etmez, TC kimlik numarası/parola istemez. Resmi giriş için yetkili kurum entegrasyonu ve kimlik sağlayıcı akışı gerekir.

Her ekranda: **Bilgilendirme amaçlıdır; tıbbi tavsiye değildir.** Doz, tedavi ve ilaç değişikliği için eczacıya veya hekime danışın.

