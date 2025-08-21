# 🕸️ Spider Map – Sosyal Donatı Erişim ve Mesafe Analizi Haritası

Spider Map, özellikle kentsel dönüşüm ve sosyal altyapı planlaması gibi çalışmalarda kullanılmak üzere geliştirilmiş interaktif bir harita uygulamasıdır. Kullanıcıya, bir parselin çevresindeki sosyal donatı noktalarına olan mesafeleri **örümcek ağı** şeklinde görselleştirme imkânı sunar.

## 🔍 Temel Özellikler

- 📍 **Parsel merkezli mesafe analizi**: Seçilen parselin etrafındaki donatı noktalarına (okul, park, ibadet alanı, sağlık tesisi, su kaynağı vb.) olan mesafeler hesaplanır ve görselleştirilir.
- 📊 **Kategorisel yoğunluk grafiği**: Çevredeki donatıların türlerine göre dağılımı interaktif pie chart olarak gösterilir.
- 🎯 **Mesafe ağırlıklı analiz**: Donatıların mesafelerine göre etki ağırlıkları hesaplanarak alternatif bir grafik sunulur.
- 💾 **Excel çıktısı alma**: Analiz edilen veriler Excel formatında indirilebilir.
- 🎨 **Harita stil değiştirme**: Mapbox üzerinden farklı harita temaları arasında geçiş yapılabilir.
- 🔎 **Parsel arama ve gezinme**: Parsel merkezleri arasında kolayca gezinilebilir ve belirli parseller aranabilir.
- 🖼️ **Popup bilgi kutuları**: Donatı noktalarına sağ tıklandığında detaylı bilgi gösterilir.

## ⌨️ Klavye Kısayolları

Harita üzerinde gezinmeyi ve analiz özelliklerini hızlıca kullanabilmek için aşağıdaki kısayollar tanımlanmıştır:

⬅️ Sol Parsel → 1 veya NumPad 7
En yakın soldaki parsele gider.

➡️ Sağ Parsel → 3 veya NumPad 9
En yakın sağdaki parsele gider.

📊 Yakın Çevre Analizi → H
Çevredeki donatıları gösteren Yakın Çevre Analizi panelini açar/kapatır.

🔍 Yakınlaştır (Zoom In) → +
Haritayı yakınlaştırır.

🔎 Uzaklaştır (Zoom Out) → -
Haritayı uzaklaştırır.

## 🌐 Uygulamayı Deneyin

🔗 Canlı harita:  
👉 [https://atakanerdogan001.github.io/spider-map/](https://atakanerdogan001.github.io/spider-map/)

## 📁 Dosya Yapısı

- data/
  - donatilar.geojson # Sosyal donatı noktaları
  - parseller.geojson # Parsel çokgenleri
- main.js # Tüm interaktif harita fonksiyonları
- index.html # Arayüz ve layout
- style.css # Temel stil dosyası
- README.md # Bu dokümantasyon


## 🛠️ Kullanılan Teknolojiler

- [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) – Harita motoru
- [Turf.js](https://turfjs.org/) – Coğrafi analizler (mesafe, merkez vb.)
- [Chart.js + ChartDataLabels](https://www.chartjs.org/) – Grafik görselleştirme
- [XLSX.js](https://github.com/SheetJS/sheetjs) – Excel çıktısı alma

## 💡 Geliştirme Notları

- Kategorisel grafik ve mesafe ağırlıklı grafik ayrı ayrı oluşturulabilir.
- Harita hareket ettikçe analiz merkezi otomatik güncellenir.
- Harita üzerindeki veriler `.geojson` formatında olup kolayca güncellenebilir.

## 📩 Katkı ve Geri Bildirim

Proje geri bildirimlere ve önerilere açık. Pull request ya da issue açabilirsiniz.

---

