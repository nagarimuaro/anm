/**
 * OpenRouter LLM Service — Cloud AI via OpenRouter API
 * HTTP client ke OpenRouter REST API (openrouter.ai)
 * Menggunakan format OpenAI-compatible (chat/completions)
 * 
 * OPTIMASI: Streaming mode (stream: true)
 * - Response token by token via SSE stream
 * - Bisa mulai TTS lebih cepat saat kalimat pertama selesai
 */
const https = require('https');
require('dotenv').config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-3-4b-it:free';
const TIMEOUT_MS = 60000; // Cloud API bisa lebih lambat dari lokal

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

class OpenRouterService {
  constructor() {
    this.model = MODEL;
    this.isReady = false;
  }

  /**
   * Kirim request ke OpenRouter API (non-streaming)
   * Format: OpenAI Chat Completions
   */
  _request(messages, options = {}) {
    return new Promise((resolve, reject) => {
      const isGoogleKey = OPENROUTER_API_KEY.startsWith('AIza');

      let reqOptions, body;

      if (isGoogleKey) {
        // Native Gemini API Format
        const systemMsg = messages.find(m => m.role === 'system')?.content;
        const chatMsgs = messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));

        const payload = {
          contents: chatMsgs,
          generationConfig: {
            temperature: options.temperature ?? 0.3,
            maxOutputTokens: options.max_tokens ?? 500,
            topP: options.top_p ?? 0.9,
          }
        };

        // Gemini 2.5 models punya "thinking" yang memakan output tokens.
        // Matikan thinking agar response tidak terpotong.
        if (this.model.includes('2.5')) {
          payload.generationConfig.thinkingConfig = { thinkingBudget: 0 };
        }

        if (systemMsg) {
          payload.systemInstruction = { parts: [{ text: systemMsg }] };
        }

        body = JSON.stringify(payload);
        // Pastikan nama model diambil dari .env, bukan hardcoded
        const modelName = this.model.includes('gemini') ? this.model : 'gemini-2.5-flash';
        reqOptions = {
          hostname: 'generativelanguage.googleapis.com',
          port: 443,
          path: `/v1beta/models/${modelName}:generateContent?key=${OPENROUTER_API_KEY}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: TIMEOUT_MS,
        };
      } else {
        // OpenRouter Format
        body = JSON.stringify({
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.max_tokens ?? 150,
          top_p: options.top_p ?? 0.9,
          stream: false,
        });

        reqOptions = {
          hostname: 'openrouter.ai',
          port: 443,
          path: '/api/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://anm.nagarimuaro.id',
            'X-Title': 'ANM - Anjungan Nagari Mandiri',
          },
          timeout: TIMEOUT_MS,
        };
      }

      const req = https.request(reqOptions, (res) => {
        let responseData = '';
        res.on('data', (chunk) => { responseData += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(responseData);
            if (isGoogleKey) {
              if (json.error) {
                return reject(new Error(`Gemini API error: ${json.error.message}`));
              }
              const content = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
              return resolve(content.trim());
            } else {
              if (json.error) {
                return reject(new Error(`OpenRouter API error: ${json.error.message || JSON.stringify(json.error)}`));
              }
              const content = json.choices?.[0]?.message?.content || '';
              return resolve(content.trim());
            }
          } catch (e) {
            reject(new Error(`API response parse error: ${responseData.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`API connection error: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('API request timeout'));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Kirim request ke OpenRouter API dengan streaming (SSE)
   * Memanggil onToken callback untuk setiap token yang diterima
   * 
   * @param {Array} messages - Chat messages array
   * @param {Object} options - temperature, max_tokens, etc
   * @param {function} onToken - Callback(tokenText) untuk setiap token
   * @returns {Promise<string>} - Full response text
   */
  _requestStreaming(messages, options = {}, onToken) {
    return new Promise((resolve, reject) => {
      const isGoogleKey = OPENROUTER_API_KEY.startsWith('AIza');
      let reqOptions, body;

      if (isGoogleKey) {
        const systemMsg = messages.find(m => m.role === 'system')?.content;
        const chatMsgs = messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));

        const payload = {
          contents: chatMsgs,
          generationConfig: {
            temperature: options.temperature ?? 0.3,
            maxOutputTokens: options.max_tokens ?? 500,
            topP: options.top_p ?? 0.9,
          }
        };

        // Gemini 2.5 models: matikan thinking agar response tidak terpotong
        if (this.model.includes('2.5')) {
          payload.generationConfig.thinkingConfig = { thinkingBudget: 0 };
        }

        if (systemMsg) {
          payload.systemInstruction = { parts: [{ text: systemMsg }] };
        }

        body = JSON.stringify(payload);
        const modelName = this.model.includes('gemini') ? this.model : 'gemini-2.5-flash';
        reqOptions = {
          hostname: 'generativelanguage.googleapis.com',
          port: 443,
          path: `/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${OPENROUTER_API_KEY}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: TIMEOUT_MS,
        };
      } else {
        body = JSON.stringify({
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.max_tokens ?? 150,
          top_p: options.top_p ?? 0.9,
          stream: true,
        });

        reqOptions = {
          hostname: 'openrouter.ai',
          port: 443,
          path: '/api/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://anm.nagarimuaro.id',
            'X-Title': 'ANM - Anjungan Nagari Mandiri',
          },
          timeout: TIMEOUT_MS,
        };
      }

      let fullResponse = '';
      let buffer = '';

      const req = https.request(reqOptions, (res) => {
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep last incomplete line
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const json = JSON.parse(data);
              let token = '';
              
              if (isGoogleKey) {
                token = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
              } else {
                token = json.choices?.[0]?.delta?.content || '';
              }

              if (token) {
                fullResponse += token;
                if (onToken) onToken(token);
              }
            } catch (e) {
              // Skip malformed lines
            }
          }
        });

        res.on('end', () => {
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                let token = isGoogleKey 
                  ? (json.candidates?.[0]?.content?.parts?.[0]?.text || '')
                  : (json.choices?.[0]?.delta?.content || '');
                if (token) {
                  fullResponse += token;
                  if (onToken) onToken(token);
                }
              } catch (e) { /* ignore */ }
            }
          }
          resolve(fullResponse.trim());
        });
      });

      req.on('error', (err) => reject(new Error(`API connection error: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('API request timeout'));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Pre-load model — untuk OpenRouter cukup test koneksi API
   * (tidak perlu load model ke RAM seperti Ollama)
   */
  async preloadModel() {
    try {
      if (!OPENROUTER_API_KEY) {
        console.warn('⚠️  OpenRouter: API key belum diset di .env (OPENROUTER_API_KEY)');
        return;
      }
      console.log(`🧠 OpenRouter: Testing connection with model ${this.model}...`);
      const result = await this._request([
        { role: 'user', content: 'Halo' }
      ], { max_tokens: 5 });
      this.isReady = true;
      console.log(`✅ OpenRouter: Model ${this.model} ready. Test response: "${result}"`);
    } catch (error) {
      console.error(`❌ OpenRouter: Connection test failed: ${error.message}`);
      console.error('   Pastikan OPENROUTER_API_KEY valid di file .env');
      console.error('   Pastikan koneksi internet tersedia');
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
      console.warn('OpenRouter: Belum ready, mencoba tetap generate...');
    }

    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ];

      const options = {
        temperature: 0.3,
        max_tokens: 1024,
        top_p: 0.9,
      };

      if (onToken) {
        // Streaming mode — token by token
        console.log('🧠 OpenRouter: Generating response (streaming)...');
        return await this._requestStreaming(messages, options, onToken);
      } else {
        // Non-streaming mode
        console.log('🧠 OpenRouter: Generating response...');
        return await this._request(messages, options);
      }
    } catch (error) {
      console.error('❌ OpenRouter generateResponse error:', error.message);
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
    // Bersihkan karakter markdown atau JSON (", *, `, dll)
    const cleanRaw = raw.replace(/[`*"'{}]/g, '');

    const intent = cleanRaw.match(/INTENT\s*:\s*(\S+)/i)?.[1] ?? 'TIDAK_DIKENAL';
    const nik = cleanRaw.match(/DATA_NIK\s*:\s*(\d{16})/i)?.[1] ?? null;
    const dataLain = cleanRaw.match(/DATA_LAIN\s*:\s*(.+)/i)?.[1]?.trim() || null;

    return {
      intent: intent.replace(/[^A-Z_]/gi, '').toUpperCase(),
      nik,
      dataLain: (dataLain && !dataLain.toLowerCase().includes('kosong')) ? dataLain : null,
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
   * Health check — test koneksi ke OpenRouter
   */
  async healthCheck() {
    try {
      if (!OPENROUTER_API_KEY) {
        return { ok: false, error: 'OPENROUTER_API_KEY belum diset' };
      }
      // Simple test request
      await this._request([
        { role: 'user', content: 'test' }
      ], { max_tokens: 1 });
      return { ok: true, model: this.model };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}

module.exports = new OpenRouterService();
