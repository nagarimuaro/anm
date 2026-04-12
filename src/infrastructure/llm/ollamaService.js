/**
 * Ollama LLM Service — Gemma 4B (atau model lain)
 * HTTP client ke Ollama REST API (localhost:11434)
 * Offline-first: tidak butuh internet
 * 
 * OPTIMASI: Streaming mode (stream: true)
 * - Response token by token via NDJSON stream
 * - Bisa mulai TTS lebih cepat saat kalimat pertama selesai
 */
const http = require('http');
require('dotenv').config();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'phi3:mini';
const TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = `Kamu adalah SINTA, asisten pelayanan ANM (Anjungan Nagari Mandiri).
Tugasmu membantu warga mengurus surat administrasi nagari.

ATURAN:
- Selalu gunakan Bahasa Indonesia yang sopan dan mudah dipahami
- Tanya satu hal dalam satu waktu, jangan bertumpuk
- Jika warga menyebut NIK, pastikan 16 digit
- Jangan pernah mengarang data — selalu tanya jika tidak tahu
- Jika warga tidak paham, sederhanakan pertanyaan
- Jawab SINGKAT, maksimal 2-3 kalimat
- PENTING: Input berasal dari speech recognition yang kadang salah tangkap. 
  Auto-koreksi typo yang jelas, contoh: "sejunjung"→"Sijunjung", "padamg"→"Padang", 
  "soolok"→"Solok", "domasili"→"domisili", "srat"→"surat"

KONTEKS LOKAL (Sumatera Barat):
- Ini adalah kiosk mandiri di kantor nagari di Sumatera Barat
- Kabupaten/Kota: Sijunjung, Solok, Padang, Bukittinggi, Payakumbuh, Sawahlunto, 
  Pariaman, Tanah Datar, Agam, Pesisir Selatan, Dharmasraya, Pasaman, 
  Lima Puluh Kota, Padang Panjang, Solok Selatan
- Istilah lokal: Nagari (desa), Jorong (dusun), Wali Nagari (kepala desa), 
  Kerapatan Adat Nagari (KAN)
- Warga mungkin tidak familiar dengan teknologi
- Gunakan bahasa yang dipakai sehari-hari di desa`;

class OllamaService {
  constructor() {
    this.baseUrl = new URL(OLLAMA_URL);
    this.model = MODEL;
    this.isReady = false;
  }

  /**
   * Kirim request ke Ollama API (non-streaming)
   */
  _request(endpoint, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const url = new URL(endpoint, this.baseUrl);

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: TIMEOUT_MS,
      };

      const req = http.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => { responseData += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(responseData));
          } catch (e) {
            reject(new Error(`Ollama response parse error: ${responseData.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`Ollama connection error: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Ollama request timeout'));
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Kirim request ke Ollama API dengan streaming (NDJSON)
   * Memanggil onToken callback untuk setiap token yang diterima
   * 
   * @param {string} endpoint 
   * @param {Object} body 
   * @param {function} onToken - Callback(tokenText) untuk setiap token
   * @returns {Promise<string>} - Full response text
   */
  _requestStreaming(endpoint, body, onToken) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ ...body, stream: true });
      const url = new URL(endpoint, this.baseUrl);

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: TIMEOUT_MS,
      };

      let fullResponse = '';
      let buffer = '';

      const req = http.request(options, (res) => {
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          
          // Parse NDJSON — setiap baris adalah satu JSON object
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Simpan baris terakhir yang mungkin belum lengkap
          
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.response) {
                fullResponse += json.response;
                if (onToken) onToken(json.response);
              }
              if (json.done) {
                // Streaming selesai
              }
            } catch (e) {
              // Skip malformed lines
            }
          }
        });

        res.on('end', () => {
          // Parse sisa buffer
          if (buffer.trim()) {
            try {
              const json = JSON.parse(buffer);
              if (json.response) {
                fullResponse += json.response;
                if (onToken) onToken(json.response);
              }
            } catch (e) { /* ignore */ }
          }
          resolve(fullResponse.trim());
        });
      });

      req.on('error', (err) => reject(new Error(`Ollama connection error: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Ollama request timeout'));
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Pre-load model saat startup
   */
  async preloadModel() {
    try {
      console.log(`🧠 Ollama: Preloading model ${this.model}...`);
      await this._request('/api/generate', {
        model: this.model,
        prompt: 'Halo',
        stream: false,
        options: { num_predict: 1 },
      });
      this.isReady = true;
      console.log(`✅ Ollama: Model ${this.model} loaded and ready.`);
    } catch (error) {
      console.error(`❌ Ollama: Failed to preload model: ${error.message}`);
      console.error('   Pastikan Ollama berjalan: ollama serve');
      console.error(`   Pastikan model tersedia: ollama pull ${this.model}`);
    }
  }

  /**
   * Generate response — STREAMING mode
   * Token dikirim via callback saat diterima
   * 
   * @param {string} prompt 
   * @param {string} systemPrompt 
   * @param {function} [onToken] - Optional callback(token) per token
   * @returns {Promise<string>} - Full response
   */
  async generateResponse(prompt, systemPrompt = SYSTEM_PROMPT, onToken = null) {
    if (!this.isReady) {
      console.warn('Ollama: Model belum ready, mencoba tetap generate...');
    }

    try {
      const body = {
        model: this.model,
        prompt: prompt,
        system: systemPrompt,
        options: {
          temperature: 0.3,
          num_predict: 150,
          top_p: 0.9,
        },
      };

      if (onToken) {
        // Streaming mode — token by token
        console.log('🧠 Ollama: Generating response (streaming)...');
        return await this._requestStreaming('/api/generate', body, onToken);
      } else {
        // Non-streaming mode (legacy)
        const result = await this._request('/api/generate', {
          ...body,
          stream: false,
        });
        return (result.response || '').trim();
      }
    } catch (error) {
      console.error('❌ Ollama generateResponse error:', error.message);
      return 'Maaf, sistem sedang bermasalah. Silakan hubungi petugas nagari.';
    }
  }

  /**
   * Extract intent dari kalimat user
   */
  async extractIntent(userText) {
    const prompt = `Tugas: Identifikasi maksud dari kalimat warga berikut.

Kalimat warga: "${userText}"

Pilihan intent yang tersedia:
- BUAT_SURAT_USAHA
- BUAT_SURAT_DOMISILI
- BUAT_SURAT_TIDAK_MAMPU
- CEK_STATUS_SURAT
- CEK_BANSOS
- BUKU_TAMU
- GREETING
- TIDAK_DIKENAL

Jika BUAT_SURAT, identifikasi juga apakah ada data yang sudah disebutkan
(misal: warga langsung sebut NIK atau nama usaha di kalimat awal).

Jawab HANYA dalam format ini, tanpa penjelasan tambahan:
INTENT: [nama intent]
DATA_NIK: [isi jika ada, kosong jika tidak]
DATA_LAIN: [isi jika ada, kosong jika tidak]`;

    const raw = await this.generateResponse(prompt, 'Kamu adalah parser intent. Jawab hanya dalam format yang diminta.');

    return this._parseIntentResponse(raw);
  }

  /**
   * Parse intent response
   */
  _parseIntentResponse(raw) {
    const intent = raw.match(/INTENT:\s*(\S+)/)?.[1] ?? 'TIDAK_DIKENAL';
    const nik = raw.match(/DATA_NIK:\s*(\d{16})/)?.[1] ?? null;
    const dataLain = raw.match(/DATA_LAIN:\s*(.+)/)?.[1]?.trim() || null;

    return {
      intent: intent.replace(/[^A-Z_]/g, ''),
      nik,
      dataLain: dataLain === 'kosong' || dataLain === '' ? null : dataLain,
    };
  }

  /**
   * Klasifikasi konfirmasi YA/TIDAK
   */
  async classifyConfirmation(userResponse) {
    const prompt = `Warga baru saja menjawab: "${userResponse}"

Klasifikasikan jawaban ini:
- YA: jika warga setuju / membenarkan / mengkonfirmasi
- TIDAK: jika warga menolak / menyalahkan / ingin ubah data
- TIDAK_JELAS: jika jawaban tidak bisa diinterpretasi

Jawab HANYA dengan satu kata: YA, TIDAK, atau TIDAK_JELAS`;

    const raw = await this.generateResponse(prompt, 'Kamu adalah classifier. Jawab hanya YA, TIDAK, atau TIDAK_JELAS.');
    const normalized = raw.toUpperCase().trim();

    if (normalized.includes('TIDAK_JELAS')) return 'TIDAK_JELAS';
    if (normalized.includes('TIDAK')) return 'TIDAK';
    if (normalized.includes('YA') || normalized.includes('BENAR') || normalized.includes('BETUL')) return 'YA';
    return 'TIDAK_JELAS';
  }

  /**
   * Generate pertanyaan natural untuk slot tertentu
   */
  async generateSlotQuestion(jenisSurat, filledSlots, currentSlotLabel) {
    const prompt = `Kamu sedang membantu warga mengurus ${jenisSurat}.
Slot yang sudah terisi: ${JSON.stringify(filledSlots)}
Slot yang perlu ditanyakan sekarang: ${currentSlotLabel}

Buat SATU kalimat pertanyaan yang natural dan sopan untuk menanyakan
"${currentSlotLabel}" kepada warga.

Pertanyaan harus:
- Singkat (maksimal 15 kata)
- Mudah dipahami warga desa
- Menggunakan kata "bapak/ibu" sebagai sapaan

Jawab HANYA dengan kalimat pertanyaannya saja, tanpa tanda kutip.`;

    return await this.generateResponse(prompt, SYSTEM_PROMPT);
  }

  /**
   * Generate rangkuman konfirmasi
   */
  async generateConfirmationSummary(jenisSurat, slotData) {
    const prompt = `Data yang sudah terkumpul untuk surat ${jenisSurat}:
${JSON.stringify(slotData, null, 2)}

Buat kalimat rangkuman yang akan dibacakan kepada warga untuk dikonfirmasi.
Kalimat harus:
- Menyebutkan semua data dengan jelas
- Diakhiri dengan pertanyaan konfirmasi
- Panjang maksimal 3 kalimat
- Menggunakan gaya bahasa lisan (akan dibacakan, bukan dibaca)

Jawab HANYA dengan kalimat rangkumannya.`;

    return await this.generateResponse(prompt, SYSTEM_PROMPT);
  }

  /**
   * Extract nilai dari jawaban user
   */
  async extractSlotValue(userAnswer, slotLabel, slotType) {
    const prompt = `Warga menjawab: "${userAnswer}"
Pertanyaan yang ditanyakan: ${slotLabel}
Tipe data yang diharapkan: ${slotType}

PENTING: Input dari speech recognition, mungkin ada typo. Auto-koreksi jika jelas 
(contoh: "sejunjung"→"Sijunjung", "domasili"→"domisili").

Ekstrak nilai yang relevan dari jawaban.
Jawab HANYA dengan nilainya saja, tanpa penjelasan.
Jika tidak bisa diekstrak, jawab: TIDAK_DAPAT_DIEKSTRAK`;

    const raw = await this.generateResponse(prompt, 'Kamu adalah ekstraktor data. Auto-koreksi typo dari speech recognition. Jawab hanya dengan nilai yang diminta.');
    return raw.includes('TIDAK_DAPAT_DIEKSTRAK') ? null : raw.trim();
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const result = await this._request('/api/tags', {});
      return { ok: true, models: result.models || [] };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}

module.exports = new OllamaService();
