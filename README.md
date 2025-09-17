# SVG'den PDF'e Dönüştürücü

## Proje Açıklaması

Bu proje, SVG (Scalable Vector Graphics) dosyalarını PDF formatlarına dönüştüren bir web uygulamasıdır. Kullanıcılar, web arayüzü aracılığıyla SVG dosyalarını yükleyebilir ve bu dosyaları PDF veya DXF formatında indirebilirler.

## Özellikler

- SVG dosyalarını PDF formatına dönüştürme
- Kullanıcı dostu web arayüzü
- Gerçek zamanlı dönüşüm
- SVG renk ve boyut özelliklerini koruma

## Kurulum

### Gereksinimler

- Node.js (v12 veya üzeri)
- npm (Node Package Manager)

### Adımlar

1. Projeyi klonlayın:
   ```bash
   git clone https://github.com/KULLANICI_ADI/svg-to-pdf-converter.git
   cd svg-to-pdf-converter
   ```

2. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```

3. Uygulamayı başlatın:
   ```bash
   npm start
   ```

4. Tarayıcınızda aşağıdaki adresi açın:
   ```
   http://localhost:3000
   ```

## Kullanım

1. Web arayüzünde "Dosya Seç" butonuna tıklayın ve bir SVG dosyası seçin.
2. Dönüştürmek istediğiniz formatı seçin (PDF veya DXF).
3. "Dönüştür" butonuna tıklayın.
4. Dönüştürme işlemi tamamlandığında, dönüştürülen dosya otomatik olarak indirilecektir.

## Teknolojiler

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js, Express.js
- **Dönüşüm Kütüphaneleri**: 
  - SVG'den PDF'e: svg-to-pdfkit, pdfkit
- **Parsing**: xml2js

## Proje Yapısı

```
├── server.js           # Ana sunucu dosyası ve API endpoint'leri
├── index.html          # Web arayüzü
├── package.json        # Proje bağımlılıkları ve betikleri
└── .gitignore          # Git tarafından yok sayılacak dosyalar
```

## Katkıda Bulunma

1. Bu depoyu fork edin
2. Yeni bir özellik dalı oluşturun (`git checkout -b yeni-ozellik`)
3. Değişikliklerinizi commit edin (`git commit -am 'Yeni özellik: Açıklama'`)
4. Dalınıza push yapın (`git push origin yeni-ozellik`)
5. Bir Pull Request oluşturun

## Lisans

Bu proje [MIT Lisansı](LICENSE) altında lisanslanmıştır.

## İletişim

Sorularınız veya önerileriniz için lütfen bir issue açın veya doğrudan iletişime geçin.
