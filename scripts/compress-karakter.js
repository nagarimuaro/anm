/**
 * Script: Kompres PNG karakter Sinta ke WebP
 * Jalankan sekali: node scripts/compress-karakter.js
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const inputDir = path.join(__dirname, '../public/assets/karakter');
const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.png'));

async function compress() {
  console.log(`Mengompres ${files.length} file...`);
  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputName = file.replace('.png', '.webp');
    const outputPath = path.join(inputDir, outputName);

    const inputStat = fs.statSync(inputPath);
    
    await sharp(inputPath)
      .webp({ quality: 85, effort: 4 })
      .toFile(outputPath);

    const outputStat = fs.statSync(outputPath);
    const reduction = (100 - (outputStat.size / inputStat.size * 100)).toFixed(1);
    console.log(`  ✅ ${file} → ${outputName} | ${(inputStat.size/1024/1024).toFixed(2)}MB → ${(outputStat.size/1024/1024).toFixed(2)}MB (${reduction}% lebih kecil)`);
  }
  console.log('\n✅ Selesai! Update SintaPixiCanvas.js untuk pakai .webp');
}

compress().catch(console.error);
