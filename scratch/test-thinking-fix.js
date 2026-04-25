const https = require('https');
const API_KEY = 'AIzaSyBwunJnqtK49sYQwhVkqFEEuDpGHQVY5uw';

const payload = {
  contents: [{ role: 'user', parts: [{ text: 'Tugas: Identifikasi maksud dari kalimat warga berikut.\n\nKalimat warga: "Saya ingin membuat Surat Keterangan Usaha"\n\nPilihan intent yang tersedia:\n- BUAT_SURAT_USAHA\n- BUAT_SURAT_DOMISILI\n- BUAT_SURAT_TIDAK_MAMPU\n- CEK_STATUS_SURAT\n- CEK_BANSOS\n- BUKU_TAMU\n- GREETING\n- TIDAK_DIKENAL\n\nJawab HANYA dalam format ini, tanpa penjelasan tambahan:\nINTENT: [nama intent]\nDATA_NIK: [isi jika ada, kosong jika tidak]\nDATA_LAIN: [isi jika ada, kosong jika tidak]' }] }],
  systemInstruction: { parts: [{ text: 'Kamu adalah parser intent. Jawab hanya dalam format yang diminta.' }] },
  generationConfig: { temperature: 0.3, maxOutputTokens: 1024, topP: 0.9, thinkingConfig: { thinkingBudget: 0 } },
};

const body = JSON.stringify(payload);

const reqOptions = {
  hostname: 'generativelanguage.googleapis.com',
  port: 443,
  path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
};

const req = https.request(reqOptions, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    const json = JSON.parse(data);
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('Raw response:', JSON.stringify(text));
    console.log('Usage:', JSON.stringify(json.usageMetadata));
    
    // Parse intent
    const cleanRaw = (text || '').replace(/[`*"'{}]/g, '');
    const intent = cleanRaw.match(/INTENT\s*:\s*(\S+)/i)?.[1] ?? 'TIDAK_DIKENAL';
    console.log('Parsed intent:', intent.replace(/[^A-Z_]/gi, '').toUpperCase());
  });
});

req.on('error', (e) => console.error('Error:', e));
req.write(body);
req.end();
