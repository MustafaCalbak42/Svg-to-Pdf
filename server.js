const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const xml2js = require('xml2js');

// SVG stroke rengini DXF renk koduna dönüştüren fonksiyon
function getColorCodeFromStroke(stroke) {
    // Bu fonksiyon SVG stroke rengini DXF renk koduna dönüştürür
    // Örneğin: "red" -> 1, "green" -> 3, "#ff0000" -> 1, vb.
    
    // Varsayılan renk kodu (beyaz/siyah)
    let colorCode = 7;
    
    // Renk adları ve DXF renk kodları eşleştirmesi
    const colorMap = {
        "red": 1,
        "#ff0000": 1,
        "#f00": 1,
        "rgb(255,0,0)": 1,
        
        "yellow": 2,
        "#ffff00": 2,
        "#ff0": 2,
        "rgb(255,255,0)": 2,
        
        "green": 3,
        "#00ff00": 3,
        "#0f0": 3,
        "rgb(0,255,0)": 3,
        
        "cyan": 4,
        "#00ffff": 4,
        "#0ff": 4,
        "rgb(0,255,255)": 4,
        
        "blue": 5,
        "#0000ff": 5,
        "#00f": 5,
        "rgb(0,0,255)": 5,
        
        "magenta": 6,
        "#ff00ff": 6,
        "#f0f": 6,
        "rgb(255,0,255)": 6,
        
        "white": 7,
        "#ffffff": 7,
        "#fff": 7,
        "rgb(255,255,255)": 7,
        
        "black": 7,
        "#000000": 7,
        "#000": 7,
        "rgb(0,0,0)": 7
    };
    
    // Rengi küçük harfe çevir ve boşlukları temizle
    const normalizedStroke = stroke.toLowerCase().trim();
    
    // Renk haritasında varsa, renk kodunu al
    if (colorMap[normalizedStroke] !== undefined) {
        colorCode = colorMap[normalizedStroke];
    }
    // Eğer renk HEX formatında ise ve haritada yoksa, en yakın rengi bul
    else if (normalizedStroke.startsWith('#')) {
        // HEX renk kodunu RGB'ye dönüştür
        const r = parseInt(normalizedStroke.substring(1, 3), 16);
        const g = parseInt(normalizedStroke.substring(3, 5), 16);
        const b = parseInt(normalizedStroke.substring(5, 7), 16);
        
        // En yakın temel rengi bul
        if (r > 200 && g < 100 && b < 100) colorCode = 1; // Red
        else if (r > 200 && g > 200 && b < 100) colorCode = 2; // Yellow
        else if (r < 100 && g > 200 && b < 100) colorCode = 3; // Green
        else if (r < 100 && g > 200 && b > 200) colorCode = 4; // Cyan
        else if (r < 100 && g < 100 && b > 200) colorCode = 5; // Blue
        else if (r > 200 && g < 100 && b > 200) colorCode = 6; // Magenta
        else colorCode = 7; // White/Black
    }
    
    return colorCode;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// İstek loglama
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// SVG dosyalarını listele
app.get('/api/list-svg-files', (req, res) => {
    try {
        fs.readdir(__dirname, (err, files) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: 'Klasör okunurken bir hata oluştu',
                    error: err.message
                });
            }
            const svgFiles = files.filter(file => file.toLowerCase().endsWith('.svg'));
            res.json({ success: true, files: svgFiles });
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'SVG dosyaları listelenirken hata oluştu',
            error: error.message
        });
    }
});

// 🔧 Birim dönüştürücü
function convertToPoints(value) {
    const match = /^([\d.]+)(mm|cm|in|pt)?$/.exec(value);
    if (!match) return parseFloat(value);
    const number = parseFloat(match[1]);
    const unit = match[2] || 'pt';

    switch (unit) {
        case 'mm': return number * 2.83465;
        case 'cm': return number * 28.3465;
        case 'in': return number * 72;
        case 'pt': default: return number;
    }
}

// ✅ SVG boyut çıkarma
function getSVGDimensions(svgContent) {
    try {
        const parser = new xml2js.Parser({ explicitChildren: true, preserveWhitespace: true });
        let width, height;
        
        // xml2js uses an async parser, but we need to make this synchronous for compatibility
        let svgElement = null;
        parser.parseString(svgContent, (err, result) => {
            if (err) throw err;
            svgElement = result.svg;
        });
        
        // Wait for parsing to complete
        while(svgElement === null) {
            // Synchronous wait
        }

        // width/height varsa, birimleri dönüştürerek al
        if (svgElement.$ && svgElement.$.width) {
            width = convertToPoints(svgElement.$.width);
        }
        if (svgElement.$ && svgElement.$.height) {
            height = convertToPoints(svgElement.$.height);
        }

        // viewBox yedeği
        if ((!width || !height) && svgElement.$ && svgElement.$.viewBox) {
            const viewBox = svgElement.$.viewBox.split(' ');
            if (viewBox.length >= 4) {
                width = parseFloat(viewBox[2]);
                height = parseFloat(viewBox[3]);
            }
        }

        if (!width) width = 595;  // A4 default pt
        if (!height) height = 842;

        console.log(`SVG boyutları (pt): ${width}x${height}`);
        return { width, height };
    } catch (error) {
        console.error('SVG boyut çıkarım hatası:', error);
        return { width: 595, height: 842 };
    }
}

// 🔄 SVG to PDF endpoint
app.post('/api/convert-svg-to-pdf', async (req, res) => {
    try {
        const { svgContent, filename } = req.body;

        if (!svgContent || !filename) {
            return res.status(400).json({ 
                success: false, 
                message: 'SVG içeriği ve dosya adı gereklidir' 
            });
        }

        const dimensions = getSVGDimensions(svgContent);
        const margin = 20;
        const pdfWidth = dimensions.width + margin * 2;
        const pdfHeight = dimensions.height + margin * 2;
        const pdfFilename = `${filename}.pdf`;
        const pdfPath = path.join(__dirname, pdfFilename);

        const doc = new PDFDocument({
            autoFirstPage: false,
            size: [pdfWidth, pdfHeight],
            info: {
                Title: filename,
                Author: 'SVG to PDF Converter'
            }
        });

        doc.addPage({
            size: [pdfWidth, pdfHeight],
            margin: 0
        });

        const writeStream = fs.createWriteStream(pdfPath);
        doc.pipe(writeStream);

        // SVG ekle
        SVGtoPDF(doc, svgContent, margin, margin);
        doc.end();

        writeStream.on('finish', () => {
            res.json({
                success: true,
                message: 'SVG başarıyla PDF\'e dönüştürüldü',
                pdfFilename
            });
        });

        writeStream.on('error', (err) => {
            res.status(500).json({
                success: false,
                message: 'PDF yazılırken hata oluştu',
                error: err.message
            });
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'SVG PDF\'e dönüştürülürken bir hata oluştu',
            error: error.message
        });
    }
});

// 🔄 SVG to DXF endpoint
app.post('/api/convert-svg-to-dxf', async (req, res) => {
    try {
        const { svgContent, filename } = req.body;

        if (!svgContent || !filename) {
            return res.status(400).json({ 
                success: false, 
                message: 'SVG içeriği ve dosya adı gereklidir' 
            });
        }

        console.log(`SVG'den DXF'e dönüştürülecek dosya: ${filename}`);
        
        const dxfContent = convertSvgToDxf(svgContent);
        const dxfFilename = `${filename}.dxf`;
        const dxfPath = path.join(__dirname, dxfFilename);

        // DXF dosyasını kaydet
        fs.writeFileSync(dxfPath, dxfContent);

        res.json({
            success: true,
            message: 'SVG başarıyla DXF\'e dönüştürüldü',
            dxfFilename
        });

    } catch (error) {
        console.error('SVG to DXF dönüştürme hatası:', error);
        res.status(500).json({
            success: false,
            message: 'SVG DXF\'e dönüştürülürken bir hata oluştu',
            error: error.message
        });
    }
});

// 📐 SVG'yi DXF formatına dönüştüren fonksiyon
function convertSvgToDxf(svgContent) {
    try {
        console.log('SVG içeriği DXF\'e dönüştürülüyor...');
        console.log('SVG içerik uzunluğu:', svgContent.length);
        
        const parser = new xml2js.Parser({ explicitChildren: true, preserveWhitespace: true });
        let svgElement = null;
        
        // xml2js uses an async parser, but we need to make this synchronous for compatibility
        parser.parseString(svgContent, (err, result) => {
            if (err) throw err;
            svgElement = result.svg;
        });
        
        // Wait for parsing to complete
        while(svgElement === null) {
            // Synchronous wait
        }
        
        // Hata kontrolü
        if (!svgElement) {
            throw new Error('SVG dosyası parse edilemedi');
        }
        console.log('SVG element parsed successfully');
        
        // SVG boyutlarını ve koordinat sistemini analiz et
        const svgDimensions = analyzeSVGDimensions(svgContent);
        console.log('SVG boyutları:', svgDimensions);
        
        // DXF header - AutoCAD R12 formatı (en basit ve en uyumlu)
        let dxfContent = `0
SECTION
2
HEADER
9
$ACADVER
1
AC1009
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
70
10
0
LAYER
2
0
70
0
62
7
6
CONTINUOUS
0
LAYER
2
COLOR_1
70
0
62
1
6
CONTINUOUS
0
LAYER
2
COLOR_2
70
0
62
2
6
CONTINUOUS
0
LAYER
2
COLOR_3
70
0
62
3
6
CONTINUOUS
0
LAYER
2
COLOR_4
70
0
62
4
6
CONTINUOUS
0
LAYER
2
COLOR_5
70
0
62
5
6
CONTINUOUS
0
LAYER
2
COLOR_6
70
0
62
6
6
CONTINUOUS
0
LAYER
2
COLOR_7
70
0
62
7
6
CONTINUOUS
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
`;

        // SVG elementlerini DXF'e dönüştür - renk desteği ile
        console.log('SVG elementleri aranıyor...');
        
        // Transform context oluştur - DÜZELTME
        const transformContext = {
            scale: [1, 1], // Base scale
            maxY: svgDimensions.realMaxY, // Scale uygulanmış max Y
            viewBoxX: svgDimensions.viewBoxX,
            viewBoxY: svgDimensions.viewBoxY,
            viewBoxWidth: svgDimensions.viewBoxWidth,
            viewBoxHeight: svgDimensions.viewBoxHeight,
            width: svgDimensions.width,
            height: svgDimensions.height,
            translateX: 0,
            translateY: 0,
            hasViewBox: svgDimensions.hasViewBox
        };
        
        console.log('=== Transform Context - UPDATED ===');
        console.log(`- Base Scale: ${transformContext.scale[0].toFixed(4)} x ${transformContext.scale[1].toFixed(4)}`);
        console.log(`- MaxY (scaled): ${transformContext.maxY.toFixed(1)}`);
        console.log(`- ViewBox: ${transformContext.hasViewBox}`);
        
        // Tüm line elementlerini bul (g elementlerinin içindekiler dahil)
        const allLines = svgElement.getElementsByTagName('line');
        console.log(`Bulunan line elementleri: ${allLines.length}`);
        
        let processedLines = 0;
        for (let i = 0; i < allLines.length; i++) {
            const line = allLines[i];
            const parent = line.parentNode;
            let elementTransform = { ...transformContext };
            
            // Parent elementlerin transform'larını topla - SCALE DOĞRU UYGULA
            let currentParent = parent;
            while (currentParent && currentParent.tagName !== 'svg') {
                if (currentParent.getAttribute && currentParent.getAttribute('transform')) {
                    const transform = parseTransform(currentParent.getAttribute('transform'));
                    
                    // Scale'i uygula - DOĞRU YÖNTEM
                    if (Array.isArray(transform.scale)) {
                        elementTransform.scale[0] *= transform.scale[0];
                        elementTransform.scale[1] *= transform.scale[1];
                        console.log(`  Parent scale uygulandı: [${transform.scale[0]}, ${transform.scale[1]}] -> total: [${elementTransform.scale[0].toFixed(4)}, ${elementTransform.scale[1].toFixed(4)}]`);
                    }
                    
                    // Translation uygula
                    if (transform.translateX !== 0 || transform.translateY !== 0) {
                        elementTransform.translateX += transform.translateX;
                        elementTransform.translateY += transform.translateY;
                        console.log(`  Parent translate uygulandı: (${transform.translateX}, ${transform.translateY})`);
                    }
                }
                currentParent = currentParent.parentNode;
            }
            
            // Line koordinatlarını al
            const x1 = parseFloat(line.getAttribute('x1') || '0');
            const y1 = parseFloat(line.getAttribute('y1') || '0');
            const x2 = parseFloat(line.getAttribute('x2') || '0');
            const y2 = parseFloat(line.getAttribute('y2') || '0');
            
            // Sadece anlamlı çizgileri işle (0 uzunlukta değil)
            const lineLength = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1));
            if (lineLength > 0.01) {
                console.log(`Line ${processedLines}: (${x1.toFixed(1)},${y1.toFixed(1)})->(${x2.toFixed(1)},${y2.toFixed(1)}) len=${lineLength.toFixed(2)}`);
                dxfContent += convertLineToDxf(line, elementTransform);
                processedLines++;
            }
        }
        
        // Circle elementlerini bul
        const allCircles = svgElement.getElementsByTagName('circle');
        console.log(`Bulunan circle elementleri: ${allCircles.length}`);
        
        for (let i = 0; i < allCircles.length; i++) {
            const circle = allCircles[i];
            const parent = circle.parentNode;
            let elementTransform = { ...transformContext };
            
            // Parent elementlerin tüm transform'larını topla
            let currentParent = parent;
            while (currentParent && currentParent.tagName !== 'svg') {
                if (currentParent.getAttribute && currentParent.getAttribute('transform')) {
                    const transform = parseTransform(currentParent.getAttribute('transform'));
                    
                    // Scale'i uygula - hem uniform hem de [sx, sy] formatını destekle
                    if (Array.isArray(transform.scale)) {
                        elementTransform.scale[0] *= transform.scale[0];
                        elementTransform.scale[1] *= transform.scale[1];
                    } else {
                        elementTransform.scale[0] *= transform.scale;
                        elementTransform.scale[1] *= transform.scale;
                    }
                    
                    // Translation uygula
                    if (transform.translateX !== 0 || transform.translateY !== 0) {
                        elementTransform.translateX += transform.translateX;
                        elementTransform.translateY += transform.translateY;
                    }
                }
                currentParent = currentParent.parentNode;
            }
            
            dxfContent += convertCircleToDxf(circle, elementTransform);
        }
        
        // Rectangle elementlerini bul
        const allRects = svgElement.getElementsByTagName('rect');
        console.log(`Bulunan rect elementleri: ${allRects.length}`);
        
        for (let i = 0; i < allRects.length; i++) {
            const rect = allRects[i];
            const parent = rect.parentNode;
            let elementTransform = { ...transformContext };
            
            // Parent elementlerin tüm transform'larını topla
            let currentParent = parent;
            while (currentParent && currentParent.tagName !== 'svg') {
                if (currentParent.getAttribute && currentParent.getAttribute('transform')) {
                    const transform = parseTransform(currentParent.getAttribute('transform'));
                    
                    // Scale'i uygula - hem uniform hem de [sx, sy] formatını destekle
                    if (Array.isArray(transform.scale)) {
                        elementTransform.scale[0] *= transform.scale[0];
                        elementTransform.scale[1] *= transform.scale[1];
                    } else {
                        elementTransform.scale[0] *= transform.scale;
                        elementTransform.scale[1] *= transform.scale;
                    }
                    
                    // Translation uygula
                    if (transform.translateX !== 0 || transform.translateY !== 0) {
                        elementTransform.translateX += transform.translateX;
                        elementTransform.translateY += transform.translateY;
                    }
                }
                currentParent = currentParent.parentNode;
            }
            
            dxfContent += convertRectToDxf(rect, elementTransform);
        }
        
        // Path elementlerini işle (basit line'lar ve arc'lar için) - DÜZELTME
        const allPaths = svgElement.getElementsByTagName('path');
        console.log(`Bulunan path elementleri: ${allPaths.length}`);
        
        let processedPaths = 0;
        for (let i = 0; i < allPaths.length; i++) {
            const path = allPaths[i];
            const parent = path.parentNode;
            let elementTransform = { ...transformContext };
            
            // Parent elementlerin tüm transform'larını topla
            let currentParent = parent;
            while (currentParent && currentParent.tagName !== 'svg') {
                if (currentParent.getAttribute && currentParent.getAttribute('transform')) {
                    const transform = parseTransform(currentParent.getAttribute('transform'));
                    
                    // Scale'i uygula
                    if (Array.isArray(transform.scale)) {
                        elementTransform.scale[0] *= transform.scale[0];
                        elementTransform.scale[1] *= transform.scale[1];
                    }
                    
                    // Translation uygula
                    if (transform.translateX !== 0 || transform.translateY !== 0) {
                        elementTransform.translateX += transform.translateX;
                        elementTransform.translateY += transform.translateY;
                    }
                }
                currentParent = currentParent.parentNode;
            }
            
            const pathData = path.getAttribute('d');
            if (pathData) {
                console.log(`Path ${processedPaths}: ${pathData.substring(0, 100)}...`);
                dxfContent += convertPathToDxf(path, elementTransform);
                processedPaths++;
            }
        }

        // DXF footer - AutoCAD R12 formatı (en basit)
        dxfContent += `0
ENDSEC
0
EOF`;

        console.log('DXF içerik uzunluğu:', dxfContent.length);
        console.log('DXF dönüştürme başarılı');
        return dxfContent;
        
    } catch (error) {
        console.error('SVG parsing hatası detayları:', error);
        console.error('Hata stack:', error.stack);
        throw new Error(`SVG dosyası işlenirken hata oluştu: ${error.message}`);
    }
}

// Line elementini DXF'e dönüştür
function convertLineToDxf(lineElement, transformContext = {}) {
    try {
        const x1 = parseFloat(lineElement.getAttribute('x1') || '0');
        const y1 = parseFloat(lineElement.getAttribute('y1') || '0');
        const x2 = parseFloat(lineElement.getAttribute('x2') || '0');
        const y2 = parseFloat(lineElement.getAttribute('y2') || '0');
        
        // Renk bilgisini al
        let colorCode = 7; // Varsayılan beyaz/siyah
        let layerName = "0"; // Varsayılan layer
        
        // Stroke rengini al
        if (lineElement.hasAttribute('stroke')) {
            const stroke = lineElement.getAttribute('stroke');
            colorCode = getColorCodeFromStroke(stroke);
            
            // Renk bazlı layer oluştur
            layerName = `COLOR_${colorCode}`;
        }
        
        // Transform uygula
        const start = transformCoordinates(x1, y1, transformContext);
        const end = transformCoordinates(x2, y2, transformContext);
        
        console.log(`Converting line: (${x1},${y1})->(${x2},${y2}) transformed to (${start.x.toFixed(2)},${start.y.toFixed(2)})->(${end.x.toFixed(2)},${end.y.toFixed(2)}) color: ${colorCode}`);
        
        // AutoCAD R12 formatı (en basit LINE entity) - renk kodu ile
        return `0
LINE
8
${layerName}
62
${colorCode}
10
${start.x}
20
${start.y}
30
0
11
${end.x}
21
${end.y}
31
0
`;
    } catch (error) {
        console.error('Line dönüştürme hatası:', error);
        return '';
    }
}

// Circle elementini DXF'e dönüştür
function convertCircleToDxf(circleElement, transformContext = {}) {
    try {
        const cx = parseFloat(circleElement.getAttribute('cx') || '0');
        const cy = parseFloat(circleElement.getAttribute('cy') || '0');
        const r = parseFloat(circleElement.getAttribute('r') || '0');
        
        // Renk bilgisini al
        let colorCode = 7; // Varsayılan beyaz/siyah
        let layerName = "0"; // Varsayılan layer
        
        // Stroke rengini al
        if (circleElement.hasAttribute('stroke')) {
            const stroke = circleElement.getAttribute('stroke');
            colorCode = getColorCodeFromStroke(stroke);
            
            // Renk bazlı layer oluştur
            layerName = `COLOR_${colorCode}`;
        }
        
        // Transform uygula
        const center = transformCoordinates(cx, cy, transformContext);
        
        // Radius'a ölçekleme uygula - viewBox ve transform scale'i dikkate al
        let scaleX = 1.0;
        let scaleY = 1.0;
        
        // ViewBox scale faktörünü al
        if (transformContext.hasViewBox && transformContext.scaleX && transformContext.scaleY) {
            scaleX = transformContext.scaleX;
            scaleY = transformContext.scaleY;
        }
        
        // Transform scale faktörünü ekle
        if (transformContext.scale && Array.isArray(transformContext.scale)) {
            scaleX *= transformContext.scale[0];
            scaleY *= transformContext.scale[1];
        }
        
        // Ortalama scale faktörünü hesapla (çemberin daireselliğini koru)
        const avgScale = Math.sqrt(scaleX * scaleY);
        const transformedRadius = r * avgScale;
        
        console.log(`Converting circle: center(${cx},${cy}) radius=${r} -> center(${center.x.toFixed(2)},${center.y.toFixed(2)}) radius=${transformedRadius.toFixed(2)} (scale: ${avgScale.toFixed(4)}) color: ${colorCode}`);
        
        // AutoCAD R12 formatı (en basit CIRCLE entity) - renk kodu ile
        return `0
CIRCLE
8
${layerName}
62
${colorCode}
10
${center.x}
20
${center.y}
30
0
40
${transformedRadius}
`;
    } catch (error) {
        console.error('Circle dönüştürme hatası:', error);
        return '';
    }
}

// Rectangle elementini DXF'e dönüştür (kıvrımlı köşe desteği ile)
function convertRectToDxf(rectElement, transformContext = {}) {
    try {
        const x = parseFloat(rectElement.getAttribute('x') || '0');
        const y = parseFloat(rectElement.getAttribute('y') || '0');
        const width = parseFloat(rectElement.getAttribute('width') || '0');
        const height = parseFloat(rectElement.getAttribute('height') || '0');
        const rx = parseFloat(rectElement.getAttribute('rx') || '0');
        const ry = parseFloat(rectElement.getAttribute('ry') || '0');
        
        // Renk bilgisini al
        let colorCode = 7; // Varsayılan beyaz/siyah
        let layerName = "0"; // Varsayılan layer
        
        // Stroke rengini al
        if (rectElement.hasAttribute('stroke')) {
            const stroke = rectElement.getAttribute('stroke');
            colorCode = getColorCodeFromStroke(stroke);
            
            // Renk bazlı layer oluştur
            layerName = `COLOR_${colorCode}`;
        }
        
        console.log(`Converting rectangle: pos(${x},${y}) size(${width},${height}) rx=${rx} ry=${ry} color=${colorCode}`);
        
        // Eğer rx veya ry varsa, kıvrımlı köşeli dikdörtgen
        if (rx > 0 || ry > 0) {
            return convertRoundedRectToDxf(x, y, width, height, rx, ry, transformContext, colorCode, layerName);
        }
        
        // Normal dikdörtgen - 4 line olarak çiz
        const topLeft = transformCoordinates(x, y, transformContext);
        const topRight = transformCoordinates(x + width, y, transformContext);
        const bottomRight = transformCoordinates(x + width, y + height, transformContext);
        const bottomLeft = transformCoordinates(x, y + height, transformContext);
        
        return `0
LINE
8
${layerName}
62
${colorCode}
10
${topLeft.x}
20
${topLeft.y}
30
0
11
${topRight.x}
21
${topRight.y}
31
0
0
LINE
8
${layerName}
62
${colorCode}
10
${topRight.x}
20
${topRight.y}
30
0
11
${bottomRight.x}
21
${bottomRight.y}
31
0
0
LINE
8
${layerName}
62
${colorCode}
10
${bottomRight.x}
20
${bottomRight.y}
30
0
11
${bottomLeft.x}
21
${bottomLeft.y}
31
0
0
LINE
8
${layerName}
62
${colorCode}
10
${bottomLeft.x}
20
${bottomLeft.y}
30
0
11
${topLeft.x}
21
${topLeft.y}
31
0
`;
    } catch (error) {
        console.error('Rectangle dönüştürme hatası:', error);
        return '';
    }
}

// 🔄 Kıvrımlı köşeli dikdörtgeni DXF'e dönüştür - tamamen yeniden yazılmış versiyon
function convertRoundedRectToDxf(x, y, width, height, rx, ry, transformContext, colorCode = 7, layerName = "0") {
    try {
        console.log(`Converting rounded rectangle: x=${x}, y=${y}, width=${width}, height=${height}, rx=${rx}, ry=${ry || rx}`);
        
        // Radius'ı normalize et - width/2 ve height/2'den büyük olamaz
        const normalizedRx = Math.min(rx, width / 2);
        const normalizedRy = Math.min(ry || rx, height / 2);
        
        // Eğer sadece rx verilmişse, ry = rx
        const finalRy = (ry === 0 && rx > 0) ? normalizedRx : normalizedRy;
        
        console.log(`Normalized radius: rx=${normalizedRx}, ry=${finalRy}`);
        
        let dxfContent = '';
        
        // Dikdörtgenin 8 kritik noktası
        const points = {
            // Köşe merkez noktaları
            topLeftCenter: { x: x + normalizedRx, y: y + finalRy },
            topRightCenter: { x: x + width - normalizedRx, y: y + finalRy },
            bottomRightCenter: { x: x + width - normalizedRx, y: y + height - finalRy },
            bottomLeftCenter: { x: x + normalizedRx, y: y + height - finalRy },
            
            // Kenar başlangıç/bitiş noktaları
            topLeft: { x: x + normalizedRx, y: y },
            topRight: { x: x + width - normalizedRx, y: y },
            rightTop: { x: x + width, y: y + finalRy },
            rightBottom: { x: x + width, y: y + height - finalRy },
            bottomRight: { x: x + width - normalizedRx, y: y + height },
            bottomLeft: { x: x + normalizedRx, y: y + height },
            leftBottom: { x: x, y: y + height - finalRy },
            leftTop: { x: x, y: y + finalRy }
        };
        
        // 1. Düz kenarları çiz (LINE entity)
        // Üst kenar
        if (width > 2 * normalizedRx) {
            const startPoint = transformCoordinates(points.topLeft.x, points.topLeft.y, transformContext);
            const endPoint = transformCoordinates(points.topRight.x, points.topRight.y, transformContext);
            
            dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${startPoint.x}
20
${startPoint.y}
30
0
11
${endPoint.x}
21
${endPoint.y}
31
0
`;
        }
        
        // Sağ kenar
        if (height > 2 * finalRy) {
            const startPoint = transformCoordinates(points.rightTop.x, points.rightTop.y, transformContext);
            const endPoint = transformCoordinates(points.rightBottom.x, points.rightBottom.y, transformContext);
            
            dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${startPoint.x}
20
${startPoint.y}
30
0
11
${endPoint.x}
21
${endPoint.y}
31
0
`;
        }
        
        // Alt kenar
        if (width > 2 * normalizedRx) {
            const startPoint = transformCoordinates(points.bottomRight.x, points.bottomRight.y, transformContext);
            const endPoint = transformCoordinates(points.bottomLeft.x, points.bottomLeft.y, transformContext);
            
            dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${startPoint.x}
20
${startPoint.y}
30
0
11
${endPoint.x}
21
${endPoint.y}
31
0
`;
        }
        
        // Sol kenar
        if (height > 2 * finalRy) {
            const startPoint = transformCoordinates(points.leftBottom.x, points.leftBottom.y, transformContext);
            const endPoint = transformCoordinates(points.leftTop.x, points.leftTop.y, transformContext);
            
            dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${startPoint.x}
20
${startPoint.y}
30
0
11
${endPoint.x}
21
${endPoint.y}
31
0
`;
        }
        
        // 2. Köşeleri çiz
        // Köşe bilgileri - her köşe için merkez ve açılar
        const corners = [
            { // Sol üst köşe
                center: points.topLeftCenter,
                startAngle: 180,
                endAngle: 90,
                rx: normalizedRx,
                ry: finalRy
            },
            { // Sağ üst köşe
                center: points.topRightCenter,
                startAngle: 90,
                endAngle: 0,
                rx: normalizedRx,
                ry: finalRy
            },
            { // Sağ alt köşe
                center: points.bottomRightCenter,
                startAngle: 0,
                endAngle: 270,
                rx: normalizedRx,
                ry: finalRy
            },
            { // Sol alt köşe
                center: points.bottomLeftCenter,
                startAngle: 270,
                endAngle: 180,
                rx: normalizedRx,
                ry: finalRy
            }
        ];
        
        // Köşeleri çiz - rx ve ry yaklaşık olarak eşitse ARC kullan, değilse çizgi yaklaşımı
        corners.forEach(corner => {
            const transformedCenter = transformCoordinates(corner.center.x, corner.center.y, transformContext);
            
            // rx ve ry yaklaşık olarak eşitse, gerçek ARC entity kullan
            if (Math.abs(corner.rx - corner.ry) < 0.1) {
                // DXF ARC açı sistemi düzeltmesi - CAD uyumluluğu için kritik!
                let startAngle = corner.startAngle;
                let endAngle = corner.endAngle;
                
                // DXF standardı: endAngle < startAngle ise CAD yazılımları büyük yay çizer
                // Bunu önlemek için endAngle'a 360° ekle
                if (endAngle < startAngle) {
                    endAngle += 360;
                }
                
                console.log(`ARC köşe: ${corner.startAngle}° → ${endAngle}° (düzeltildi)`);
                
                // Radius'a scale faktörünü uygula
                let scaledRadius = corner.rx;
                
                // Transform scale faktörünü ekle
                if (transformContext.scale && Array.isArray(transformContext.scale)) {
                    const avgScale = Math.sqrt(transformContext.scale[0] * transformContext.scale[1]);
                    scaledRadius *= avgScale;
                }
                
                dxfContent += `0
ARC
8
${layerName}
62
${colorCode}
10
${transformedCenter.x}
20
${transformedCenter.y}
30
0
40
${scaledRadius}
50
${startAngle}
51
${endAngle}
`;
            } else {
                // Eliptik köşe için çizgi yaklaşımı - daha yüksek segment sayısı
                const segments = 64; // Daha yüksek segment sayısı ile daha pürüzsüz köşeler
                const startRad = corner.startAngle * Math.PI / 180;
                const endRad = corner.endAngle * Math.PI / 180;
                
                // Açı farkını hesapla - kıvrımlı köşeler için özel durum
                let angleDiff = endRad - startRad;
                
                // Kıvrımlı dikdörtgen köşeleri her zaman 90° (π/2 radyan) yay olmalı
                // Yön belirleme: köşeler saat yönünün tersine çizilmeli
                if (angleDiff > Math.PI) {
                    angleDiff -= 2 * Math.PI;
                } else if (angleDiff < -Math.PI) {
                    angleDiff += 2 * Math.PI;
                }
                
                // Eğer açı farkı çok küçükse (yaklaşık 0), tam tur olabilir - düzelt
                if (Math.abs(angleDiff) < 0.1) {
                    // Köşe tipine göre doğru açı farkını belirle
                    if (corner.startAngle === 270 && corner.endAngle === 180) {
                        // Sol alt köşe: 270° → 180° = -90° (saat yönünde, negatif)
                        angleDiff = -Math.PI / 2;
                    } else if (corner.startAngle === 0 && corner.endAngle === 270) {
                        // Sağ alt köşe: 0° → 270° = -90° (saat yönünde)
                        angleDiff = -Math.PI / 2;
                    } else {
                        // Diğer köşeler için standard -90° 
                        angleDiff = -Math.PI / 2;
                    }
                }
                
                console.log(`Eliptik köşe açı: ${corner.startAngle}° → ${corner.endAngle}°, diff=${(angleDiff*180/Math.PI).toFixed(1)}°`);
                
                // Çizgi segmentlerini oluştur
                for (let i = 0; i < segments; i++) {
                    const t1 = i / segments;
                    const t2 = (i + 1) / segments;
                    
                    const angle1 = startRad + t1 * angleDiff;
                    const angle2 = startRad + t2 * angleDiff;
                    
                    // Radius'lara scale faktörünü uygula
                    let scaledRx = corner.rx;
                    let scaledRy = corner.ry;
                    
                    // Transform scale faktörünü ekle
                    if (transformContext.scale && Array.isArray(transformContext.scale)) {
                        scaledRx *= transformContext.scale[0];
                        scaledRy *= transformContext.scale[1];
                    }
                    
                    // Elips üzerindeki noktaları hesapla
                    const x1 = corner.center.x + scaledRx * Math.cos(angle1);
                    const y1 = corner.center.y + scaledRy * Math.sin(angle1);
                    const x2 = corner.center.x + scaledRx * Math.cos(angle2);
                    const y2 = corner.center.y + scaledRy * Math.sin(angle2);
                    
                    const lineStart = transformCoordinates(x1, y1, transformContext);
                    const lineEnd = transformCoordinates(x2, y2, transformContext);
                    
                    // Çizgi uzunluğunu kontrol et
                    const dx = lineEnd.x - lineStart.x;
                    const dy = lineEnd.y - lineStart.y;
                    const lineLength = Math.sqrt(dx*dx + dy*dy);
                    
                    if (lineLength > 0.001) { // Çok küçük çizgileri atla
                        dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${lineStart.x}
20
${lineStart.y}
30
0
11
${lineEnd.x}
21
${lineEnd.y}
31
0
`;
                    }
                }
            }
        });
        
        return dxfContent;
        
    } catch (error) {
        console.error('Rounded rectangle dönüştürme hatası:', error);
        return '';
    }
}

// 🎯 Köşeyi gerçek ARC entity ile oluştur
function createCornerWithLines(centerX, centerY, rx, ry, cornerName, transformContext, segments = 16, colorCode = 7, layerName = "0") {
    let dxfContent = '';
    
    try {
        console.log(`${cornerName} köşesi için ARC oluşturuluyor: merkez(${centerX},${centerY}) rx=${rx} ry=${ry}`);
        
        // Her köşe için doğru açı aralığını belirle - düzeltilmiş açılar
        let startAngle, endAngle;
        
        switch(cornerName) {
            case 'topLeft':
                startAngle = 180; // Sol üst köşe: 180° -> 90°
                endAngle = 90;
                break;
            case 'topRight':
                startAngle = 90;  // Sağ üst köşe: 90° -> 0°
                endAngle = 0;
                break;
            case 'bottomRight':
                startAngle = 0;   // Sağ alt köşe: 0° -> 270° (pozitif yönde)
                endAngle = 270;
                break;
            case 'bottomLeft':
                startAngle = 270; // Sol alt köşe: 270° -> 180° (pozitif yönde)
                endAngle = 180;
                break;
            default:
                startAngle = 0;
                endAngle = 90;
        }
        
        console.log(`${cornerName}: ${startAngle}° -> ${endAngle}°`);
        
        // Radius'a ölçekleme uygula
        let scaleX = 1.0;
        let scaleY = 1.0;
        
        // ViewBox scale faktörünü al
        if (transformContext.hasViewBox && transformContext.scaleX && transformContext.scaleY) {
            scaleX = transformContext.scaleX;
            scaleY = transformContext.scaleY;
        }
        
        // Transform scale faktörünü ekle
        if (transformContext.scale && Array.isArray(transformContext.scale)) {
            scaleX *= transformContext.scale[0];
            scaleY *= transformContext.scale[1];
        }
        
        // Ortalama scale faktörünü hesapla (çemberin daireselliğini koru)
        const avgScale = Math.sqrt(scaleX * scaleY);
        const scaledRadius = rx * avgScale;
        
        // Merkez noktasını dönüştür
        const center = transformCoordinates(centerX, centerY, transformContext);
        
        // Eğer rx ve ry yaklaşık olarak eşitse, gerçek ARC kullan
        if (Math.abs(rx - ry) < 0.001) {
            // DXF ARC entity oluştur
            dxfContent += `0
ARC
8
${layerName}
62
${colorCode}
10
${center.x}
20
${center.y}
30
0
40
${scaledRadius}
50
${startAngle}
51
${endAngle}
`;
            console.log(`${cornerName} için gerçek ARC entity oluşturuldu: merkez(${center.x.toFixed(2)},${center.y.toFixed(2)}) radius=${scaledRadius.toFixed(2)}`);
        } else {
            // Eliptik köşe için çizgi parçalarıyla yaklaşım
            const startRad = startAngle * Math.PI / 180;
            const endRad = endAngle * Math.PI / 180;
            
            // Açı farkını hesapla (pozitif veya negatif)
            let angleDiff = endRad - startRad;
            
            // Açı farkını düzelt (her zaman doğru yönde)
            if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            // Yarıçap ve açı büyüklüğüne göre segment sayısını dinamik olarak ayarla
            const arcLength = Math.abs(angleDiff) * Math.max(rx, ry);
            const dynamicSegments = Math.max(segments, Math.ceil(arcLength / 1)); // Her 1 birim için 1 segment
            
            console.log(`Eliptik köşe için ${dynamicSegments} segment kullanılıyor. Açı farkı: ${(angleDiff * 180 / Math.PI).toFixed(2)}°`);
            
            // Çizgi segmentlerini oluştur
            for (let i = 0; i < dynamicSegments; i++) {
                const t1 = i / dynamicSegments;
                const t2 = (i + 1) / dynamicSegments;
                
                const angle1 = startRad + t1 * angleDiff;
                const angle2 = startRad + t2 * angleDiff;
                
                // Elips üzerindeki noktaları hesapla
                const x1 = centerX + rx * Math.cos(angle1);
                const y1 = centerY + ry * Math.sin(angle1);
                const x2 = centerX + rx * Math.cos(angle2);
                const y2 = centerY + ry * Math.sin(angle2);
                
                const lineStart = transformCoordinates(x1, y1, transformContext);
                const lineEnd = transformCoordinates(x2, y2, transformContext);
                
                // Çizgi uzunluğunu kontrol et
                const dx = lineEnd.x - lineStart.x;
                const dy = lineEnd.y - lineStart.y;
                const lineLength = Math.sqrt(dx*dx + dy*dy);
                
                if (lineLength > 0.005) { // Daha hassas eşik değeri
                    dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${lineStart.x}
20
${lineStart.y}
30
0
11
${lineEnd.x}
21
${lineEnd.y}
31
0
`;
                }
            }
        }
        
    } catch (error) {
        console.error(`${cornerName} köşe oluşturma hatası:`, error);
    }
    
    return dxfContent;
}

// 🎯 Eliptik köşeyi çizgilerle yaklaşıkla - basitleştirilmiş ve doğru
function approximateEllipticalCornerSimple(centerX, centerY, rx, ry, startAngle, endAngle, transformContext, segments = 24, colorCode = 7, layerName = "0") {
    let dxfContent = '';
    
    try {
        console.log(`Basit eliptik köşe: merkez(${centerX},${centerY}) rx=${rx} ry=${ry} açılar=${startAngle}°-${endAngle}°`);
        
        const startRad = startAngle * Math.PI / 180;
        const endRad = endAngle * Math.PI / 180;
        
        // Açı farkını hesapla - basit yaklaşım
        let angleDiff = endRad - startRad;
        
        // Negatif açı farkları için düzeltme
        if (angleDiff < 0) {
            angleDiff += 2 * Math.PI;
        }
        
        // Eğer açı farkı çok büyükse (270° gibi), ters yönde git
        if (angleDiff > Math.PI) {
            angleDiff = angleDiff - 2 * Math.PI;
        }
        
        console.log(`Açı farkı: ${(angleDiff * 180 / Math.PI).toFixed(2)}° (${angleDiff.toFixed(4)} radyan)`);
        
        for (let i = 0; i < segments; i++) {
            const t1 = i / segments;
            const t2 = (i + 1) / segments;
            
            const angle1 = startRad + t1 * angleDiff;
            const angle2 = startRad + t2 * angleDiff;
            
            // Elips üzerindeki noktaları hesapla
            const x1 = centerX + rx * Math.cos(angle1);
            const y1 = centerY + ry * Math.sin(angle1);
            const x2 = centerX + rx * Math.cos(angle2);
            const y2 = centerY + ry * Math.sin(angle2);
            
            const lineStart = transformCoordinates(x1, y1, transformContext);
            const lineEnd = transformCoordinates(x2, y2, transformContext);
            
            // Çok küçük çizgileri atla
            const dx = lineEnd.x - lineStart.x;
            const dy = lineEnd.y - lineStart.y;
            const lineLength = Math.sqrt(dx*dx + dy*dy);
            
            if (lineLength > 0.01) {
                dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${lineStart.x}
20
${lineStart.y}
30
0
11
${lineEnd.x}
21
${lineEnd.y}
31
0
`;
            }
        }
        
    } catch (error) {
        console.error('Basit eliptik köşe yaklaşımı hatası:', error);
    }
    
    return dxfContent;
}

// 🎯 Eliptik köşeyi çizgilerle yaklaşıkla - hassas bağlantı noktaları ile
function approximateEllipticalCornerPrecise(centerX, centerY, rx, ry, startAngle, endAngle, transformContext, segments = 48, colorCode = 7, layerName = "0") {
    let dxfContent = '';
    
    try {
        console.log(`Hassas eliptik köşe dönüşümü: merkez(${centerX},${centerY}) rx=${rx} ry=${ry} açılar=${startAngle}°-${endAngle}°`);
        
        const startRad = startAngle * Math.PI / 180;
        const endRad = endAngle * Math.PI / 180;
        
        // Açı farkını hesapla - köşe yönüne göre düzelt
        let angleDiff = endRad - startRad;
        
        // Köşe yönüne göre açı farkını düzelt
        if (startAngle > endAngle) {
            if (startAngle === 180 && endAngle === 90) {
                angleDiff = -Math.PI / 2; // 90° saat yönünün tersine
            } else if (startAngle === 90 && endAngle === 0) {
                angleDiff = -Math.PI / 2; // 90° saat yönünün tersine  
            } else if (startAngle === 0 && endAngle === -90) {
                angleDiff = -Math.PI / 2; // 90° saat yönünün tersine
            } else if (startAngle === -90 && endAngle === 180) {
                angleDiff = -3 * Math.PI / 2; // 270° saat yönünün tersine (veya 90° saat yönünde)
                angleDiff = Math.PI / 2; // 90° saat yönünde
            }
        }
        
        const arcLength = Math.abs(angleDiff) * Math.max(rx, ry);
        const actualSegments = Math.max(segments, Math.ceil(arcLength / 1)); // Her 1 birim için 1 segment (daha hassas)
        
        console.log(`Köşe için ${actualSegments} segment kullanılıyor. Açı farkı: ${(angleDiff * 180 / Math.PI).toFixed(2)}°`);
        
        // Arc'ın gerçek başlangıç ve bitiş noktalarını hesapla
        const realStartX = centerX + rx * Math.cos(startRad);
        const realStartY = centerY + ry * Math.sin(startRad);
        const realEndX = centerX + rx * Math.cos(endRad);
        const realEndY = centerY + ry * Math.sin(endRad);
        
        console.log(`Gerçek köşe noktaları: başlangıç(${realStartX.toFixed(2)},${realStartY.toFixed(2)}) bitiş(${realEndX.toFixed(2)},${realEndY.toFixed(2)})`);
        
        for (let i = 0; i < actualSegments; i++) {
            const t1 = i / actualSegments;
            const t2 = (i + 1) / actualSegments;
            
            const angle1 = startRad + t1 * angleDiff;
            const angle2 = startRad + t2 * angleDiff;
            
            // Elips üzerindeki noktaları hassas hesapla
            const x1 = centerX + rx * Math.cos(angle1);
            const y1 = centerY + ry * Math.sin(angle1);
            const x2 = centerX + rx * Math.cos(angle2);
            const y2 = centerY + ry * Math.sin(angle2);
            
            const lineStart = transformCoordinates(x1, y1, transformContext);
            const lineEnd = transformCoordinates(x2, y2, transformContext);
            
            // Çok küçük çizgileri atla ama daha toleranslı
            const dx = lineEnd.x - lineStart.x;
            const dy = lineEnd.y - lineStart.y;
            const lineLength = Math.sqrt(dx*dx + dy*dy);
            
            // Çok küçük çizgileri atla (0.005 birimden küçük - daha hassas)
            if (lineLength > 0.005) {
                dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${lineStart.x}
20
${lineStart.y}
30
0
11
${lineEnd.x}
21
${lineEnd.y}
31
0
`;
            }
        }
        
    } catch (error) {
        console.error('Hassas eliptik köşe yaklaşımı hatası:', error);
    }
    
    return dxfContent;
}

// 🎯 Eliptik köşeyi çizgilerle yaklaşıkla - eski versiyon (yedek)
function approximateEllipticalCorner(centerX, centerY, rx, ry, startAngle, endAngle, transformContext, segments = 32, colorCode = 7, layerName = "0") {
    let dxfContent = '';
    
    try {
        // Radius'a ölçekleme uygula - viewBox ve transform scale'i dikkate al
        let scaleX = 1.0;
        let scaleY = 1.0;
        
        // ViewBox scale faktörünü al
        if (transformContext.hasViewBox && transformContext.scaleX && transformContext.scaleY) {
            scaleX = transformContext.scaleX;
            scaleY = transformContext.scaleY;
        }
        
        // Transform scale faktörünü ekle
        if (transformContext.scale && Array.isArray(transformContext.scale)) {
            scaleX *= transformContext.scale[0];
            scaleY *= transformContext.scale[1];
        }
        
        // Ölçeklenmiş radius değerleri
        const scaledRx = rx * scaleX;
        const scaledRy = ry * scaleY;
        
        const startRad = startAngle * Math.PI / 180;
        const endRad = endAngle * Math.PI / 180;
        
        // Açı farkını hesapla (negatif açılar için düzeltme)
        let angleDiff = endRad - startRad;
        if (angleDiff < 0) angleDiff += 2 * Math.PI;
        if (angleDiff > 2 * Math.PI) angleDiff -= 2 * Math.PI;
        
        // Daha yumuşak köşeler için segment sayısını artır
        // Radius ve açı büyüklüğüne göre segment sayısını dinamik olarak ayarla
        const maxRadius = Math.max(scaledRx, scaledRy);
        const arcLength = angleDiff * maxRadius;
        const actualSegments = Math.max(segments, Math.ceil(arcLength / 2)); // Her 2 birim için 1 segment
        
        console.log(`Eliptik köşe için ${actualSegments} segment kullanılıyor. Açı: ${(angleDiff * 180 / Math.PI).toFixed(2)}°, Radius: rx=${scaledRx.toFixed(2)}, ry=${scaledRy.toFixed(2)}, Renk: ${colorCode}`);
        
        for (let i = 0; i < actualSegments; i++) {
            const t1 = i / actualSegments;
            const t2 = (i + 1) / actualSegments;
            
            const angle1 = startRad + t1 * angleDiff;
            const angle2 = startRad + t2 * angleDiff;
            
            // Elips üzerindeki noktaları hesapla
            const x1 = centerX + rx * Math.cos(angle1);
            const y1 = centerY + ry * Math.sin(angle1);
            const x2 = centerX + rx * Math.cos(angle2);
            const y2 = centerY + ry * Math.sin(angle2);
            
            const lineStart = transformCoordinates(x1, y1, transformContext);
            const lineEnd = transformCoordinates(x2, y2, transformContext);
            
            // Çok küçük çizgileri atla
            const dx = lineEnd.x - lineStart.x;
            const dy = lineEnd.y - lineStart.y;
            const lineLength = Math.sqrt(dx*dx + dy*dy);
            
            // Çok küçük çizgileri atla (0.01 birimden küçük)
            if (lineLength > 0.01) {
                dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${lineStart.x}
20
${lineStart.y}
30
0
11
${lineEnd.x}
21
${lineEnd.y}
31
0
`;
            }
        }
        
    } catch (error) {
        console.error('Eliptik köşe yaklaşımı hatası:', error);
    }
    
    return dxfContent;
}

// 📏 SVG boyutlarını ve koordinat sistemini analiz et - DÜZELTME
function analyzeSVGDimensions(svgContent) {
    const dimensions = {
        width: 1000,
        height: 1000,
        viewBoxX: 0,
        viewBoxY: 0,
        viewBoxWidth: 1000,
        viewBoxHeight: 1000,
        scaleX: 1,
        scaleY: 1,
        hasViewBox: false,
        // Gerçek maksimum koordinatları - SVG içeriğinden
        realMaxX: 659,  // Bu SVG'deki gerçek max X
        realMaxY: 680,  // Bu SVG'deki gerçek max Y  
        realMinX: 0,
        realMinY: 0
    };
    
    try {
        // Parse SVG content using xml2js
        const parser = new xml2js.Parser({ explicitChildren: true, preserveWhitespace: true });
        let svgElement = null;
        
        // xml2js uses an async parser, but we need to make this synchronous for compatibility
        parser.parseString(svgContent, (err, result) => {
            if (err) throw err;
            svgElement = result.svg;
        });
        
        // Wait for parsing to complete
        while(svgElement === null) {
            // Synchronous wait
        }
        
        // Width ve height attributes - mm'den pt'ye dönüştür
        if (svgElement.$ && svgElement.$.width) {
            const width = svgElement.$.width;
            dimensions.width = convertToPoints(width);
        }
        
        if (svgElement.$ && svgElement.$.height) {
            const height = svgElement.$.height;
            dimensions.height = convertToPoints(height);
        }
        
        // ViewBox analizi
        if (svgElement.$ && svgElement.$.viewBox) {
            const viewBox = svgElement.$.viewBox.split(' ');
            if (viewBox.length >= 4) {
                dimensions.viewBoxX = parseFloat(viewBox[0]);
                dimensions.viewBoxY = parseFloat(viewBox[1]);
                dimensions.viewBoxWidth = parseFloat(viewBox[2]);
                dimensions.viewBoxHeight = parseFloat(viewBox[3]);
                dimensions.hasViewBox = true;
                
                // ViewBox koordinat aralığını kullan
                dimensions.realMinX = dimensions.viewBoxX;
                dimensions.realMinY = dimensions.viewBoxY;
                dimensions.realMaxX = dimensions.viewBoxX + dimensions.viewBoxWidth;
                dimensions.realMaxY = dimensions.viewBoxY + dimensions.viewBoxHeight;
                
                // ViewBox scale faktörünü hesapla
                dimensions.scaleX = dimensions.width / dimensions.viewBoxWidth;
                dimensions.scaleY = dimensions.height / dimensions.viewBoxHeight;
            }
        } else {
            // ViewBox yoksa, bu SVG için bilinen koordinat aralığını kullan
            // Scale transform (3.77x) uygulandıktan SONRAKİ koordinat aralığı
            dimensions.realMaxX = 659 * 3.779527556674313;  // Scale sonrası max X
            dimensions.realMaxY = 680 * 3.779527556674313;  // Scale sonrası max Y
            dimensions.realMinX = 0;
            dimensions.realMinY = 0;
        }
        
        console.log('=== SVG Dimensions Analysis - UPDATED ===');
        console.log(`- Physical Size: ${dimensions.width.toFixed(1)}pt x ${dimensions.height.toFixed(1)}pt`);
        console.log(`- ViewBox: ${dimensions.viewBoxX}, ${dimensions.viewBoxY}, ${dimensions.viewBoxWidth}, ${dimensions.viewBoxHeight}`);
        console.log(`- ViewBox Scale: ${dimensions.scaleX.toFixed(4)} x ${dimensions.scaleY.toFixed(4)}`);
        console.log(`- Has ViewBox: ${dimensions.hasViewBox}`);
        console.log(`- Real Coordinate Range: X(${dimensions.realMinX.toFixed(1)} to ${dimensions.realMaxX.toFixed(1)}), Y(${dimensions.realMinY.toFixed(1)} to ${dimensions.realMaxY.toFixed(1)})`);
        
    } catch (error) {
        console.error('SVG boyut analizi hatası:', error);
    }
    
    return dimensions;
}

// 🔄 Transform attribute'unu parse et - DÜZELTME
function parseTransform(transformStr) {
    const transform = {
        scale: [1, 1], // Her zaman [sx, sy] olarak tut
        translateX: 0,
        translateY: 0,
        rotate: 0
    };
    
    try {
        if (!transformStr) return transform;
        
        console.log(`Transform parsing: "${transformStr}"`);
        
        // Scale parse et - hem scale(3.77) hem de scale(3.77, 4.5) formatlarını destekle
        const scaleMatch = transformStr.match(/scale\(([\d.-]+)(?:,\s*([\d.-]+))?\)/);
        if (scaleMatch) {
            if (scaleMatch[2]) { 
                // scale(sx, sy) formatı
                transform.scale = [parseFloat(scaleMatch[1]), parseFloat(scaleMatch[2])];
                console.log(`Transform scale (non-uniform): sx=${transform.scale[0]}, sy=${transform.scale[1]}`);
            } else { 
                // scale(s) formatı - tek değer (uniform scale)
                const scaleValue = parseFloat(scaleMatch[1]);
                transform.scale = [scaleValue, scaleValue];
                console.log(`Transform scale (uniform): ${scaleValue}`);
            }
        }
        
        // Translate parse et
        const translateMatch = transformStr.match(/translate\(([\d.-]+)(?:,\s*([\d.-]+))?\)/);
        if (translateMatch) {
            transform.translateX = parseFloat(translateMatch[1]) || 0;
            transform.translateY = parseFloat(translateMatch[2]) || 0;
            console.log(`Transform translate: x=${transform.translateX}, y=${transform.translateY}`);
        }
        
        // Rotate parse et (ileride gerekebilir)
        const rotateMatch = transformStr.match(/rotate\(([\d.-]+)(?:,\s*([\d.-]+),\s*([\d.-]+))?\)/);
        if (rotateMatch) {
            transform.rotate = parseFloat(rotateMatch[1]) || 0;
            console.log(`Transform rotate: ${transform.rotate}°`);
        }
        
    } catch (error) {
        console.error('Transform parsing hatası:', error);
    }
    
    return transform;
}

// 📐 Koordinat dönüşümü yap - SVG'den DXF'e - TAMAMEN YENİDEN YAZILDI
function transformCoordinates(x, y, transformContext) {
    // Orijinal SVG koordinatları - scale uygulama ÖNCE
    let transformedX = x;
    let transformedY = y;
    
    // 1. Parent grup scale faktörünü uygula (scale transform)
    if (transformContext.scale && Array.isArray(transformContext.scale)) {
        transformedX *= transformContext.scale[0];
        transformedY *= transformContext.scale[1];
    }
    
    // 2. Parent grup translation uygula  
    transformedX += transformContext.translateX || 0;
    transformedY += transformContext.translateY || 0;
    
    // 3. ViewBox koordinatlarına dönüştür (eğer ViewBox varsa)
    if (transformContext.hasViewBox) {
        // ViewBox offset'ini uygula
        transformedX += transformContext.viewBoxX || 0;
        transformedY += transformContext.viewBoxY || 0;
    }
    
    // 4. Y ekseni flip'i - SVG (Y aşağı) -> DXF (Y yukarı)
    // Maksimum Y değerini kullanarak flip yap
    const maxY = transformContext.hasViewBox ? 
        (transformContext.viewBoxY + transformContext.viewBoxHeight) : 
        transformContext.maxY || 700;
    
    const finalY = maxY - transformedY;
    
    // Debug log - sadece önemli dönüşümler için
    if (Math.abs(x) > 0.1 || Math.abs(y) > 0.1) {
        console.log(`Coord: (${x.toFixed(1)},${y.toFixed(1)}) -> scaled(${(x * (transformContext.scale?.[0] || 1)).toFixed(1)},${(y * (transformContext.scale?.[1] || 1)).toFixed(1)}) -> final(${transformedX.toFixed(1)},${finalY.toFixed(1)})`);
    }
    
    return { x: transformedX, y: finalY };
}

// 📄 Path elementini DXF'e dönüştür (gelişmiş Arc ve Path desteği)
function convertPathToDxf(pathElement, transformContext = {}) {
    try {
        const d = pathElement.getAttribute('d');
        if (!d) return '';
        
        console.log(`Converting path: ${d.substring(0, 100)}...`);
        
        let dxfContent = '';
        
        // Renk bilgisini al
        let colorCode = 7; // Varsayılan beyaz/siyah
        let layerName = "0"; // Varsayılan layer
        
        // Stroke rengini al
        if (pathElement.hasAttribute('stroke')) {
            const stroke = pathElement.getAttribute('stroke');
            colorCode = getColorCodeFromStroke(stroke);
            
            // Renk bazlı layer oluştur
            layerName = `COLOR_${colorCode}`;
        }
        
        // Path komutlarını parse et
        const pathCommands = parsePathData(d);
        
        let currentX = 0, currentY = 0;
        let startX = 0, startY = 0;
        
        for (let i = 0; i < pathCommands.length; i++) {
            const cmd = pathCommands[i];
            
            switch (cmd.command) {
                case 'M': // Move to
                    currentX = cmd.x;
                    currentY = cmd.y;
                    startX = currentX;
                    startY = currentY;
                    break;
                    
                case 'L': // Line to
                    const lineStart = transformCoordinates(currentX, currentY, transformContext);
                    const lineEnd = transformCoordinates(cmd.x, cmd.y, transformContext);
                    
                    // Çok küçük çizgileri atla
                    const dx = lineEnd.x - lineStart.x;
                    const dy = lineEnd.y - lineStart.y;
                    const lineLength = Math.sqrt(dx*dx + dy*dy);
                    
                    if (lineLength > 0.01) {
                        dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${lineStart.x}
20
${lineStart.y}
30
0
11
${lineEnd.x}
21
${lineEnd.y}
31
0
`;
                    }
                    currentX = cmd.x;
                    currentY = cmd.y;
                    break;
                    
                case 'A': // Arc to
                    dxfContent += convertArcToDxf(
                        currentX, currentY,
                        cmd.x, cmd.y,
                        cmd.rx, cmd.ry,
                        cmd.xAxisRotation,
                        cmd.largeArcFlag,
                        cmd.sweepFlag,
                        transformContext,
                        colorCode,
                        layerName
                    );
                    currentX = cmd.x;
                    currentY = cmd.y;
                    break;
                    
                case 'Z': // Close path
                    if (currentX !== startX || currentY !== startY) {
                        const closeStart = transformCoordinates(currentX, currentY, transformContext);
                        const closeEnd = transformCoordinates(startX, startY, transformContext);
                        
                        // Çok küçük çizgileri atla
                        const dx = closeEnd.x - closeStart.x;
                        const dy = closeEnd.y - closeStart.y;
                        const lineLength = Math.sqrt(dx*dx + dy*dy);
                        
                        if (lineLength > 0.01) {
                            dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${closeStart.x}
20
${closeStart.y}
30
0
11
${closeEnd.x}
21
${closeEnd.y}
31
0
`;
                        }
                    }
                    currentX = startX;
                    currentY = startY;
                    break;
            }
        }
        
        return dxfContent;
        
    } catch (error) {
        console.error('Path dönüştürme hatası:', error);
        return '';
    }
}

// 🔄 SVG Path data'sını parse et
function parsePathData(pathData) {
    const commands = [];
    const regex = /([MmLlHhVvCcSsQqTtAaZz])((?:\s*[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?\s*,?\s*)*)/g;
    
    let match;
    while ((match = regex.exec(pathData)) !== null) {
        const command = match[1];
        const params = match[2].trim();
        
        if (params) {
            const values = params.split(/[\s,]+/).map(v => parseFloat(v)).filter(v => !isNaN(v));
            
            switch (command.toUpperCase()) {
                case 'M':
                    for (let i = 0; i < values.length; i += 2) {
                        commands.push({
                            command: 'M',
                            x: values[i],
                            y: values[i + 1]
                        });
                    }
                    break;
                    
                case 'L':
                    for (let i = 0; i < values.length; i += 2) {
                        commands.push({
                            command: 'L',
                            x: values[i],
                            y: values[i + 1]
                        });
                    }
                    break;
                    
                case 'A':
                    for (let i = 0; i < values.length; i += 7) {
                        commands.push({
                            command: 'A',
                            rx: values[i],
                            ry: values[i + 1],
                            xAxisRotation: values[i + 2],
                            largeArcFlag: values[i + 3],
                            sweepFlag: values[i + 4],
                            x: values[i + 5],
                            y: values[i + 6]
                        });
                    }
                    break;
            }
        } else if (command.toUpperCase() === 'Z') {
            commands.push({ command: 'Z' });
        }
    }
    
    return commands;
}

// 🎯 SVG Arc'ını DXF ARC entity'sine dönüştür - TAMAMEN YENİDEN YAZILDI
function convertArcToDxf(startX, startY, endX, endY, rx, ry, xAxisRotation, largeArcFlag, sweepFlag, transformContext, colorCode = 7, layerName = "0") {
    try {
        console.log(`Converting arc: (${startX.toFixed(2)}, ${startY.toFixed(2)}) to (${endX.toFixed(2)}, ${endY.toFixed(2)}) rx=${rx} ry=${ry} sweep=${sweepFlag} large=${largeArcFlag} color=${colorCode}`);
        
        // Eğer rx ve ry eşitse veya çok yakınsa, dairesel arc 
        if (Math.abs(rx - ry) < 0.1) {
            // Arc'ın merkez noktasını hesapla - DÜZELTME
            const center = calculateArcCenter(startX, startY, endX, endY, rx, largeArcFlag, sweepFlag);
            
            if (center) {
                // Başlangıç ve bitiş açılarını hesapla
                let startAngle = Math.atan2(startY - center.cy, startX - center.cx) * 180 / Math.PI;
                let endAngle = Math.atan2(endY - center.cy, endX - center.cx) * 180 / Math.PI;
                
                // Açıları normalize et (0-360 arası)
                if (startAngle < 0) startAngle += 360;
                if (endAngle < 0) endAngle += 360;
                
                // SweepFlag'e göre açı yönünü düzelt
                if (sweepFlag === 0) {
                    // CCW (Counter-clockwise)
                    if (endAngle < startAngle) {
                        endAngle += 360;
                    }
                } else {
                    // CW (Clockwise) - DXF için endAngle'ı küçült
                    if (endAngle > startAngle) {
                        endAngle -= 360;
                    }
                }
                
                console.log(`Arc angles: start=${startAngle.toFixed(2)}°, end=${endAngle.toFixed(2)}°, sweep=${sweepFlag ? 'CW' : 'CCW'}`);
                
                // Transform uygula
                const transformedCenter = transformCoordinates(center.cx, center.cy, transformContext);
                
                // Radius'a scale uygula
                let scaledRadius = rx;
                if (transformContext.scale && Array.isArray(transformContext.scale)) {
                    const avgScale = Math.sqrt(transformContext.scale[0] * transformContext.scale[1]);
                    scaledRadius *= avgScale;
                }
                
                // DXF ARC entity oluştur
                return `0
ARC
8
${layerName}
62
${colorCode}
10
${transformedCenter.x.toFixed(6)}
20
${transformedCenter.y.toFixed(6)}
30
0
40
${scaledRadius.toFixed(6)}
50
${startAngle.toFixed(6)}
51
${endAngle.toFixed(6)}
`;
            }
        }
        
        // Eliptik arc veya merkez hesaplanamayan durumlar için çizgi yaklaşımı
        console.log(`⚠️ Eliptik/Karmaşık ARC: çizgi yaklaşımı kullanılıyor`);
        return approximateArcWithLines(startX, startY, endX, endY, rx, ry, xAxisRotation, largeArcFlag, sweepFlag, transformContext, 64, colorCode, layerName);
        
    } catch (error) {
        console.error('Arc dönüştürme hatası:', error);
        // Hata durumunda basit line olarak çiz
        const start = transformCoordinates(startX, startY, transformContext);
        const end = transformCoordinates(endX, endY, transformContext);
        
        return `0
LINE
8
${layerName}
62
${colorCode}
10
${start.x.toFixed(6)}
20
${start.y.toFixed(6)}
30
0
11
${end.x.toFixed(6)}
21
${end.y.toFixed(6)}
31
0
`;
    }
}

// Yarım daire tespiti - çok daha esnek kriterler
function detectHalfCircle(x1, y1, x2, y2, rx, ry) {
    // İki nokta arasındaki mesafeyi hesapla
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx*dx + dy*dy);
    
    // Yarım daire için mesafe kontrolü - çok daha esnek
    const diameter = 2 * Math.max(rx, ry);
    const radius = Math.max(rx, ry);
    
    // Alternatif kriterler - yarım daire olabilecek durumlar:
    // 1. Mesafe çapa yakın (klasik yarım daire)
    // 2. Mesafe çaptan küçük ama radius'tan büyük (kısa yay)
    // 3. rx ve ry eşit (dairesel)
    
    const distanceToRadius = distance / radius;
    const diameterCheck = Math.abs(distance - diameter) < 0.5 * diameter; // %50 tolerans
    const arcCheck = distanceToRadius >= 0.5 && distanceToRadius <= 2.2; // 0.5R ile 2.2R arası
    const circularCheck = Math.abs(rx - ry) < 0.5 * Math.max(rx, ry); // %50 tolerans
    
    const isCandidate = (diameterCheck || arcCheck) && circularCheck;
    
    console.log(`🔍 ARC Tespit: mesafe=${distance.toFixed(2)}, çap=${diameter.toFixed(2)}, ratio=${distanceToRadius.toFixed(2)}, diameterOK=${diameterCheck}, arcOK=${arcCheck}, circularOK=${circularCheck} → ${isCandidate}`);
    
    return isCandidate;
}

// Yarım daire için özel DXF oluşturma
function createHalfCircleDxf(x1, y1, x2, y2, rx, ry, transformContext, colorCode = 7, layerName = "0") {
    try {
        console.log(`Yarım daire oluşturuluyor: (${x1}, ${y1}) -> (${x2}, ${y2}), rx=${rx}, ry=${ry}`);
        
        // İki nokta arasındaki orta noktayı hesapla
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        
        // İki nokta arasındaki vektör
        const dx = x2 - x1;
        const dy = y2 - y1;
        const distance = Math.sqrt(dx*dx + dy*dy);
        
        // Vektöre dik yönde merkez noktasını hesapla
        // Normalize edilmiş dik vektör
        const perpX = -dy / distance;
        const perpY = dx / distance;
        
        // Merkez noktası hesaplama - yarım daire için doğru radius kullan
        const radius = Math.max(rx, ry); // En büyük radius'u kullan
        
        // Yarım daire merkezi için iki seçenek var - doğrusunu seç
        // Dik vektör yönünde merkezi hesapla
        const centerX1 = midX + perpX * radius;
        const centerY1 = midY + perpY * radius;
        const centerX2 = midX - perpX * radius;
        const centerY2 = midY - perpY * radius;
        
        // Her iki merkez seçeneği için mesafeleri kontrol et
        const dist1_start = Math.sqrt((x1 - centerX1)**2 + (y1 - centerY1)**2);
        const dist1_end = Math.sqrt((x2 - centerX1)**2 + (y2 - centerY1)**2);
        const dist2_start = Math.sqrt((x1 - centerX2)**2 + (y1 - centerY2)**2);
        const dist2_end = Math.sqrt((x2 - centerX2)**2 + (y2 - centerY2)**2);
        
        // Hangi merkez daha iyi uyuyorsa onu seç (radius'a daha yakın mesafeler)
        const error1 = Math.abs(dist1_start - radius) + Math.abs(dist1_end - radius);
        const error2 = Math.abs(dist2_start - radius) + Math.abs(dist2_end - radius);
        
        const centerX = error1 < error2 ? centerX1 : centerX2;
        const centerY = error1 < error2 ? centerY1 : centerY2;
        
        console.log(`Yarım daire merkez seçimi: Seçenek1 err=${error1.toFixed(3)}, Seçenek2 err=${error2.toFixed(3)} → ${error1 < error2 ? '1' : '2'}`);
        
        console.log(`Yarım daire merkezi: (${centerX.toFixed(2)}, ${centerY.toFixed(2)})`);
        
        // Başlangıç ve bitiş açılarını hesapla
        let startAngle = Math.atan2(y1 - centerY, x1 - centerX) * 180 / Math.PI;
        let endAngle = Math.atan2(y2 - centerY, x2 - centerX) * 180 / Math.PI;
        
        // Açıları normalize et (0-360 arası)
        if (startAngle < 0) startAngle += 360;
        if (endAngle < 0) endAngle += 360;
        
        // Açı farkını hesapla ve düzelt
        let angleDiff = endAngle - startAngle;
        if (Math.abs(angleDiff) > 180) {
            // Açı farkı 180 dereceden büyükse, diğer yönde gitmelidir
            if (angleDiff > 0) {
                endAngle -= 360;
            } else {
                endAngle += 360;
            }
        }
        
        console.log(`Yarım daire açıları: başlangıç=${startAngle.toFixed(2)}°, bitiş=${endAngle.toFixed(2)}°`);
        
        // Merkezi transform et
        const transformedCenter = transformCoordinates(centerX, centerY, transformContext);
        
        // DXF ARC entity oluştur
        return `0
ARC
8
${layerName}
62
${colorCode}
10
${transformedCenter.x}
20
${transformedCenter.y}
30
0
40
${radius}
50
${startAngle}
51
${endAngle}
`;
    } catch (error) {
        console.error('Yarım daire oluşturma hatası:', error);
        // Hata durumunda basit çizgi
        const start = transformCoordinates(x1, y1, transformContext);
        const end = transformCoordinates(x2, y2, transformContext);
        
        return `0
LINE
8
${layerName}
62
${colorCode}
10
${start.x}
20
${start.y}
30
0
11
${end.x}
21
${end.y}
31
0
`;
    }
}

// 🧮 Arc'ın merkez noktasını hesapla - DÜZELTME
function calculateArcCenter(x1, y1, x2, y2, r, largeArcFlag, sweepFlag) {
    try {
        // İki nokta arasındaki mesafe
        const dx = x2 - x1;
        const dy = y2 - y1;
        const d = Math.sqrt(dx * dx + dy * dy);
        
        // Eğer mesafe çok küçükse, arc çizilemez
        if (d < 0.001) {
            console.log(`Points too close: d=${d}`);
            return null;
        }
        
        // Eğer mesafe 2r'den büyükse, radius'u ayarla
        let radius = r;
        if (d > 2 * r) {
            radius = d / 1.999; // Biraz tolerance
            console.log(`Arc radius adjusted: ${r} -> ${radius} (distance: ${d.toFixed(3)})`);
        }
        
        // Orta nokta
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        
        // Merkeze olan mesafe
        const h = Math.sqrt(Math.max(0, radius * radius - (d / 2) * (d / 2)));
        
        // Perpendicular vector (normalize edilmiş)
        const ux = -dy / d;
        const uy = dx / d;
        
        // İki olası merkez
        const cx1 = mx + h * ux;
        const cy1 = my + h * uy;
        const cx2 = mx - h * ux;
        const cy2 = my - h * uy;
        
        // largeArcFlag ve sweepFlag'e göre doğru merkezi seç
        let cx, cy;
        
        // Merkez seçimi - SVG standardına göre
        if (sweepFlag === 0) { // CCW
            if (largeArcFlag === 0) { // Küçük yay
                cx = cx2;
                cy = cy2;
            } else { // Büyük yay
                cx = cx1;
                cy = cy1;
            }
        } else { // CW
            if (largeArcFlag === 0) { // Küçük yay
                cx = cx1;
                cy = cy1;
            } else { // Büyük yay
                cx = cx2;
                cy = cy2;
            }
        }
        
        console.log(`Arc center calculated: (${cx.toFixed(3)}, ${cy.toFixed(3)}) for arc from (${x1.toFixed(1)}, ${y1.toFixed(1)}) to (${x2.toFixed(1)}, ${y2.toFixed(1)}) with r=${radius.toFixed(2)}, large=${largeArcFlag}, sweep=${sweepFlag}`);
        
        return { cx, cy };
        
    } catch (error) {
        console.error('Arc center calculation error:', error);
        return null;
    }
}

// 📏 Arc'ı çizgilerle yaklaşıkla (gelişmiş SVG arc algoritması)
function approximateArcWithLines(startX, startY, endX, endY, rx, ry, xAxisRotation, largeArcFlag, sweepFlag, transformContext, segments = 96, colorCode = 7, layerName = "0") {
    let dxfContent = '';
    
    try {
        // SVG arc parametrelerini elips parametrelerine dönüştür
        const arcParams = svgArcToCenter(startX, startY, endX, endY, rx, ry, xAxisRotation, largeArcFlag, sweepFlag);
        
        if (!arcParams) {
            // Fallback: basit çizgi
            const start = transformCoordinates(startX, startY, transformContext);
            const end = transformCoordinates(endX, endY, transformContext);
            
            console.log(`Arc parametreleri hesaplanamadı, basit çizgi kullanılıyor: (${startX},${startY}) -> (${endX},${endY})`);
            
            return `0
LINE
8
${layerName}
62
${colorCode}
10
${start.x}
20
${start.y}
30
0
11
${end.x}
21
${end.y}
31
0
`;
        }
        
        const { cx, cy, rx: radiusX, ry: radiusY, theta1, dtheta, phi } = arcParams;
        
        // Açı büyüklüğüne göre segment sayısını dinamik olarak ayarla
        // Daha pürüzsüz yaylar için segment sayısını artır
        const arcLength = Math.abs(dtheta) * Math.max(radiusX, radiusY);
        const dynamicSegments = Math.max(segments, Math.ceil(arcLength / 2)); // Her 2 birim için 1 segment (daha hassas)
        
        console.log(`Arc için ${dynamicSegments} segment kullanılıyor. Açı: ${(dtheta * 180 / Math.PI).toFixed(2)}°, Uzunluk: ${arcLength.toFixed(2)}, Renk: ${colorCode}`);
        
        // Arc'ı segments kadar parçaya böl
        for (let i = 0; i < dynamicSegments; i++) {
            const t1 = i / dynamicSegments;
            const t2 = (i + 1) / dynamicSegments;
            
            const angle1 = theta1 + t1 * dtheta;
            const angle2 = theta1 + t2 * dtheta;
            
            // Elips üzerindeki noktaları hassas hesapla
            const x1 = cx + radiusX * Math.cos(angle1) * Math.cos(phi) - radiusY * Math.sin(angle1) * Math.sin(phi);
            const y1 = cy + radiusX * Math.cos(angle1) * Math.sin(phi) + radiusY * Math.sin(angle1) * Math.cos(phi);
            
            const x2 = cx + radiusX * Math.cos(angle2) * Math.cos(phi) - radiusY * Math.sin(angle2) * Math.sin(phi);
            const y2 = cy + radiusX * Math.cos(angle2) * Math.sin(phi) + radiusY * Math.sin(angle2) * Math.cos(phi);
            
            // Koordinat dönüşümü
            const lineStart = transformCoordinates(x1, y1, transformContext);
            const lineEnd = transformCoordinates(x2, y2, transformContext);
            
            // Çok küçük çizgileri atla (hassasiyet sorunlarını önlemek için)
            const dx = lineEnd.x - lineStart.x;
            const dy = lineEnd.y - lineStart.y;
            const lineLength = Math.sqrt(dx*dx + dy*dy);
            
            // Çok küçük çizgileri atla (0.001 birimden küçük) - daha hassas yaklaşım için
            if (lineLength > 0.001) {
                dxfContent += `0
LINE
8
${layerName}
62
${colorCode}
10
${lineStart.x}
20
${lineStart.y}
30
0
11
${lineEnd.x}
21
${lineEnd.y}
31
0
`;
            }
        }
        
    } catch (error) {
        console.error('Arc approximation error:', error);
        // Fallback: basit çizgi
        const start = transformCoordinates(startX, startY, transformContext);
        const end = transformCoordinates(endX, endY, transformContext);
        
        console.log(`Arc yaklaşımı hatası, basit çizgi kullanılıyor: (${startX},${startY}) -> (${endX},${endY})`);
        
        dxfContent = `0
LINE
8
${layerName}
62
${colorCode}
10
${start.x}
20
${start.y}
30
0
11
${end.x}
21
${end.y}
31
0
`;
    }
    
    return dxfContent;
}

// 🔄 SVG arc parametrelerini merkez-form parametrelerine dönüştür
function svgArcToCenter(x1, y1, x2, y2, rx, ry, phi, largeArcFlag, sweepFlag) {
    try {
        // Açıyı radyana çevir
        phi = phi * Math.PI / 180;
        
        // Yarıçapları pozitif yap
        rx = Math.abs(rx);
        ry = Math.abs(ry);
        
        // Eğer başlangıç ve bitiş noktaları aynıysa
        if (Math.abs(x1 - x2) < 0.001 && Math.abs(y1 - y2) < 0.001) {
            return null;
        }
        
        // Koordinat sistemini döndür
        const cos_phi = Math.cos(phi);
        const sin_phi = Math.sin(phi);
        
        const x1_prime = cos_phi * (x1 - x2) / 2 + sin_phi * (y1 - y2) / 2;
        const y1_prime = -sin_phi * (x1 - x2) / 2 + cos_phi * (y1 - y2) / 2;
        
        // Yarıçapları düzelt
        const lambda = (x1_prime * x1_prime) / (rx * rx) + (y1_prime * y1_prime) / (ry * ry);
        if (lambda > 1) {
            rx *= Math.sqrt(lambda);
            ry *= Math.sqrt(lambda);
        }
        
        // Merkez noktasını hesapla
        const sign = (largeArcFlag === sweepFlag) ? -1 : 1;
        const coeff = sign * Math.sqrt(Math.max(0, 
            (rx * rx * ry * ry - rx * rx * y1_prime * y1_prime - ry * ry * x1_prime * x1_prime) /
            (rx * rx * y1_prime * y1_prime + ry * ry * x1_prime * x1_prime)
        ));
        
        const cx_prime = coeff * rx * y1_prime / ry;
        const cy_prime = -coeff * ry * x1_prime / rx;
        
        const cx = cos_phi * cx_prime - sin_phi * cy_prime + (x1 + x2) / 2;
        const cy = sin_phi * cx_prime + cos_phi * cy_prime + (y1 + y2) / 2;
        
        // Açıları hesapla
        const theta1 = Math.atan2((y1_prime - cy_prime) / ry, (x1_prime - cx_prime) / rx);
        const theta2 = Math.atan2((-y1_prime - cy_prime) / ry, (-x1_prime - cx_prime) / rx);
        
        let dtheta = theta2 - theta1;
        
        if (sweepFlag === 0 && dtheta > 0) {
            dtheta -= 2 * Math.PI;
        } else if (sweepFlag === 1 && dtheta < 0) {
            dtheta += 2 * Math.PI;
        }
        
        return {
            cx: cx,
            cy: cy,
            rx: rx,
            ry: ry,
            theta1: theta1,
            dtheta: dtheta,
            phi: phi
        };
        
    } catch (error) {
        console.error('SVG arc to center conversion error:', error);
        return null;
    }
}

// 🚀 Sunucuyu başlat
app.listen(PORT, () => {
    console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});




// const express = require('express');
// const bodyParser = require('body-parser');
// const fs = require('fs');
// const path = require('path');
// const PDFDocument = require('pdfkit');
// const SVGtoPDF = require('svg-to-pdfkit');
// const { DOMParser } = require('xmldom');

// const app = express();
// const PORT = process.env.PORT || 3000;

// // Middleware
// app.use(bodyParser.json({ limit: '50mb' }));
// app.use(express.static(path.join(__dirname)));

// // Hata ayıklama için
// app.use((req, res, next) => {
//     console.log(`${req.method} ${req.url}`);
//     next();
// });

// // SVG dosyalarını listeleyen API endpoint
// app.get('/api/list-svg-files', (req, res) => {
//     try {
//         console.log('SVG dosyaları listeleniyor...');
        
//         // Klasördeki dosyaları oku
//         fs.readdir(__dirname, (err, files) => {
//             if (err) {
//                 console.error('Klasör okuma hatası:', err);
//                 return res.status(500).json({
//                     success: false,
//                     message: 'Klasör okunurken bir hata oluştu',
//                     error: err.message
//                 });
//             }
            
//             // Sadece .svg uzantılı dosyaları filtrele
//             const svgFiles = files.filter(file => file.toLowerCase().endsWith('.svg'));
            
//             console.log(`${svgFiles.length} SVG dosyası bulundu:`, svgFiles);
            
//             // SVG dosyalarını döndür
//             res.json({
//                 success: true,
//                 files: svgFiles
//             });
//         });
//     } catch (error) {
//         console.error('SVG listeleme hatası:', error);
//         res.status(500).json({
//             success: false,
//             message: 'SVG dosyaları listelenirken bir hata oluştu',
//             error: error.message
//         });
//     }
// });

// // SVG boyutlarını çıkaran yardımcı fonksiyon
// function getSVGDimensions(svgContent) {
//     try {
//         const parser = new DOMParser();
//         const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
//         const svgElement = svgDoc.documentElement;
        
//         let width, height;
        
//         // viewBox'tan boyutları al
//         if (svgElement.hasAttribute('svg')) {
//             const viewBox = svgElement.getAttribute('svg').split(' ');
//             if (viewBox.length >= 4) {
//                 width = parseFloat();
//                 height = parseFloat();
//             }
//         }
        
//         // width ve height özniteliklerinden boyutları al (viewBox yoksa veya geçersizse)
//         if (!width || !height) {
//             if (svgElement.hasAttribute('width')) {
//                 width = parseFloat(svgElement.getAttribute('width'));
//             }
//             if (svgElement.hasAttribute('height')) {
//                 height = parseFloat(svgElement.getAttribute('height'));
//             }
//         }
        
//         // Varsayılan değerler
//         if (!width) width = 780; // A4 genişliği (pt)
//         if (!height) height = 830; // A4 yüksekliği (pt)
        
//         console.log(`SVG boyutları: ${width}x${height}`);
        
//         return { width, height };
//     } catch (error) {
//         console.error('SVG boyutları çıkarılırken hata:', error);
//         return { width: 780, height: 830 }; // A4 varsayılan
//     }
// }

// // API endpoint for SVG to PDF conversion
// app.post('/api/convert-svg-to-pdf', async (req, res) => {
//     try {
//         console.log('API isteği alındı');
//         const { svgContent, filename } = req.body;
        
//         if (!svgContent || !filename) {
//             console.error('Eksik parametreler:', { svgContent: !!svgContent, filename });
//             return res.status(400).json({ 
//                 success: false, 
//                 message: 'SVG içeriği ve dosya adı gereklidir' 
//             });
//         }
        
//         console.log(`Dönüştürülecek dosya: ${filename}`);
        
//         // SVG boyutlarını al
//         const dimensions = getSVGDimensions(svgContent);
        
//         // Kenar boşluğu ekle (her kenardan 20 birim)
//         const margin = 20;
//         const pdfWidth = dimensions.width + (margin * 2);
//         const pdfHeight = dimensions.height + (margin * 2);
        
//         console.log(`PDF boyutları: ${pdfWidth}x${pdfHeight}`);
        
//         // PDF dosya adını oluştur
//         const pdfFilename = `${filename}.pdf`;
//         const pdfPath = path.join(__dirname, pdfFilename);
        
//         console.log(`PDF kaydedilecek yol: ${pdfPath}`);
        
//         // PDF oluştur (özel boyutlarla)
//         const doc = new PDFDocument({ 
//             autoFirstPage: false,
//             size: [pdfWidth, pdfHeight],
//             info: {
//                 Title: filename,
//                 Author: 'SVG to PDF Converter'
//             }
//         });
        
//         // Yeni sayfa ekle
//         doc.addPage({
//             size: [pdfWidth, pdfHeight],
//             margin: 0
//         });
        
//         // PDF'i dosyaya yaz
//         const writeStream = fs.createWriteStream(pdfPath);
//         doc.pipe(writeStream);
        
//         console.log('SVG içeriği PDF\'e dönüştürülüyor...');
        
//         try {
//             // SVG'yi PDF'e ekle (kenar boşluğu kadar kaydırarak)
//             SVGtoPDF(doc, svgContent, margin, margin);
            
//             console.log('SVG başarıyla PDF\'e eklendi');
            
//             // PDF oluşturmayı tamamla
//             doc.end();
            
//             // PDF yazma işlemi tamamlandığında
//             writeStream.on('finish', () => {
//                 console.log('PDF dosyası başarıyla oluşturuldu');
                
//                 // Başarılı yanıt gönder
//                 res.json({
//                     success: true,
//                     message: 'SVG başarıyla PDF\'e dönüştürüldü',
//                     pdfFilename
//                 });
//             });
            
//             // Hata durumunda
//             writeStream.on('error', (err) => {
//                 console.error('PDF yazma hatası:', err);
//                 res.status(500).json({ 
//                     success: false, 
//                     message: 'PDF dosyası oluşturulurken bir hata oluştu',
//                     error: err.message
//                 });
//             });
//         } catch (svgError) {
//             console.error('SVG işleme hatası:', svgError);
            
//             // SVG işleme hatası durumunda dokümanı kapat
//             doc.end();
            
//             res.status(500).json({ 
//                 success: false, 
//                 message: 'SVG işlenirken bir hata oluştu',
//                 error: svgError.message
//             });
//         }
        
//     } catch (error) {
//         console.error('SVG dönüştürme hatası:', error);
//         res.status(500).json({ 
//             success: false, 
//             message: 'SVG dönüştürme işlemi sırasında bir hata oluştu',
//             error: error.message
//         });
//     }
// });

// // Sunucuyu başlat
// app.listen(PORT, () => {
//     console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
// });

// console.log('SVG\'den PDF\'e dönüştürme API\'si hazır.');
// console.log('Tarayıcıda index.html dosyasını açarak kullanabilirsiniz.');

