const { execSync } = require('child_process');
const prompt = `Tugas: Identifikasi maksud dari kalimat warga berikut.
Kalimat warga: "Saya ingin membuat Surat Keterangan Usaha"
Pilihan intent yang tersedia:
- BUAT_SURAT_USAHA
...
Jawab HANYA dalam format ini, tanpa penjelasan tambahan:
INTENT: [nama intent]
DATA_NIK: [isi jika ada, kosong jika tidak]
DATA_LAIN: [isi jika ada, kosong jika tidak]`;

const payload = {
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  systemInstruction: { parts: [{ text: 'Kamu adalah parser intent. Jawab hanya dalam format yang diminta.' }] },
  generationConfig: { temperature: 0.1 }
};

const fs = require('fs');
fs.writeFileSync('scratch/gemini_payload.json', JSON.stringify(payload));
