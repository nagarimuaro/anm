/**
 * Gemini Live Service — Orchestrator Voice Realtime
 * Menggantikan Pipeline STT -> LLM -> TTS menjadi satu WebSocket connection
 */
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

class GeminiLiveService {
  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    this.session = null;
    this.isConnecting = false;
    this._manualMode = false;
    this.audioBufferQueue = [];
    this.onResponseCallback = null;
    this._speakSession = null; // referensi ke sesi speakOnce aktif

    // Konfigurasi Tools yang bisa dipanggil oleh Gemini
    this.tools = [{
      functionDeclarations: [
        {
          name: 'navigate_to_page',
          description: 'Navigasi ke halaman tertentu seperti buku-tamu, input-nik, surat',
          parameters: {
            type: 'OBJECT',
            properties: {
              page: { type: 'STRING', description: "Nama path utama, contoh: '/buku-tamu', '/input-nik'" },
              nextPath: { type: 'STRING', description: "Tujuan selanjutnya. Contoh: jika pengguna ingin buat surat, page='/input-nik' dan nextPath='/profil-warga'." }
            },
            required: ['page']
          }
        },
        {
          name: 'set_nik',
          description: 'Dipanggil ketika pengguna menyebutkan NIK mereka',
          parameters: {
            type: 'OBJECT',
            properties: {
              nik: { type: 'STRING', description: "16 digit angka NIK" }
            },
            required: ['nik']
          }
        },
        {
          name: 'select_surat',
          description: 'Dipanggil ketika pengguna menyebutkan jenis surat yang ingin dibuat. WAJIB dipanggil setelah pengguna menyebut nama surat.',
          parameters: {
            type: 'OBJECT',
            properties: {
              template_name: { type: 'STRING', description: "Nama lengkap surat yang dipilih, contoh: 'Surat Keterangan Usaha', 'Surat Domisili', 'Surat Tidak Mampu'" }
            },
            required: ['template_name']
          }
        },
        {
          name: 'fill_slot',
          description: 'WAJIB dipanggil setiap kali pengguna menjawab pertanyaan data surat (slot filling). Isi slot dengan nilai dari jawaban pengguna.',
          parameters: {
            type: 'OBJECT',
            properties: {
              slot_key: { type: 'STRING', description: "Key slot yang diisi, contoh: 'nama_usaha', 'keperluan', 'tujuan'" },
              value: { type: 'STRING', description: 'Nilai yang disebutkan pengguna' }
            },
            required: ['slot_key', 'value']
          }
        }
      ]
    }];
  }

  // Event handler
  setOnResponse(callback) {
    this.onResponseCallback = callback;
  }

  async activate() {
    console.log("🚀 Menghubungkan ke Gemini Live API...");
    this.isConnecting = true;
    try {
      let apiKey = process.env.GEMINI_API_KEY;
      try {
        const { dbGet } = require('../../infrastructure/database/db');
        const row = await dbGet(`SELECT value FROM settings WHERE key = 'gemini_api_key'`);
        if (row && row.value) {
          apiKey = row.value;
        }
      } catch (dbErr) {
        console.error("Gagal membaca API key dari DB:", dbErr);
      }
      this.ai = new GoogleGenAI({ apiKey });

      // Kita gunakan model dari .env (default: gemini-1.5-flash-8b yang merupakan model termurah)
      const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-8b';

      this.session = await this.ai.live.connect({
        model: modelName,
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Aoede" // Suara wanita
              }
            }
          },
          tools: this.tools,
          systemInstruction: { parts: [{ text: `Kamu adalah asisten suara wanita bernama 'Sinta' di Anjungan Nagari Mandiri. Sapaan pertamamu harus hangat, ceria, dan bervariasi. JANGAN PERNAH menyebutkan fitur-fitur aplikasi secara eksplisit di sapaan awal. Jawablah dengan SANGAT SINGKAT dan natural.

ATURAN NAVIGASI:
- Sebelum meminta data (NIK) atau memproses layanan, WAJIB panggil navigate_to_page terlebih dahulu.
- Jika pengguna ingin buat surat, LANGSUNG panggil navigate_to_page(page='/input-nik', nextPath='/profil-warga') SEBELUM meminta NIK.
- Jika pengguna ingin buku tamu, LANGSUNG panggil navigate_to_page(page='/buku-tamu').
- Jangan pernah meminta NIK secara lisan jika belum memanggil tool navigasi!

ATURAN PENGUMPULAN DATA SURAT (SLOT FILLING):
- Saat mengumpulkan data surat, tanyakan SATU pertanyaan per giliran.
- Ketika pengguna menjawab pertanyaan data surat, WAJIB panggil tool fill_slot(slot_key, value) SEGERA sebelum merespons secara lisan.
- Setelah fill_slot dipanggil, lanjutkan tanya slot berikutnya ATAU bacakan ringkasan jika semua data sudah lengkap.
- PENTING: slot_key harus sesuai dengan nama field yang sedang ditanyakan (contoh: 'nama_usaha', 'keperluan', 'tujuan', 'nama_ahli_waris').
- Contoh: User bilang 'nama usaha saya Toko Sepatu' → panggil fill_slot(slot_key='nama_usaha', value='Toko Sepatu') lalu konfirmasi.
- Jangan lewati pemanggilan fill_slot saat user memberikan jawaban.

ATURAN KONFIRMASI DATA:
- Setelah SEMUA data terkumpul, bacakan ringkasan semua data yang telah diisi satu per satu dengan ramah.
- Setelah membacakan, katakan: "Jika ada data yang kurang tepat, silakan tekan ikon pensil ✏️ di samping data tersebut untuk mengubahnya. Jika semua sudah benar, tekan tombol Cetak untuk mencetak surat."
- JANGAN navigasi atau lakukan aksi apapun setelah konfirmasi — biarkan warga yang memutuskan.` }] }
        },
        callbacks: {
          onopen: () => {
            console.log("\u2705 Terhubung ke Gemini Live!");
            this._emitResponse({ type: 'stateChange', state: 'CONNECTED' });
          },
          onmessage: (e) => {
            // Cek di seluruh struktur `e` untuk menemukan usage
            if (e.serverContent) {
              if (e.serverContent.modelTurn && e.serverContent.modelTurn.usage) {
                console.log('📊 Token Usage (Turn):', e.serverContent.modelTurn.usage);
              }
              if (e.serverContent.turnComplete) {
                // Terkadang Live API tidak menyediakan field usage secara default, 
                // tapi kita bisa intercept turnComplete
                console.log('🏁 Turn Complete (Sesi Gemini Selesai Bicara)');
              }
              this._handleContent(e.serverContent);
            }
            if (e.usage) {
              console.log('📊 Token Usage Total:', e.usage);
            }
            if (e.toolCall) {
              this._handleToolCall(e.toolCall);
            }
          },
          onclose: (e) => {
            console.log('Koneksi Gemini Live ditutup.', e ? `Code: ${e.code}, Reason: ${e.reason}` : '');
          },
          onerror: (err) => console.error('Gemini Live error:', err)
        }
      });

      this.isConnecting = false;
      // Flush buffered audio chunks
      while (this.audioBufferQueue.length > 0) {
        const chunk = this.audioBufferQueue.shift();
        this.session.sendRealtimeInput(chunk);
      }

      return true;
    } catch (error) {
      this.isConnecting = false;
      console.error("Gagal terhubung ke Gemini Live:", error);
      this._emitResponse({ type: 'ai_error', message: 'AI Sedang Ada Gangguan' });
      return false;
    }

  }

  deactivate() {
    if (this.session) {
      try {
        if (typeof this.session.close === 'function') {
          this.session.close();
        }
      } catch (e) {
        console.error('Error menutup sesi Gemini Live:', e);
      }
      this.session = null;
    }
  }

  /**
   * speakOnce — Sesi Gemini khusus untuk TTS one-shot (absensi, notifikasi)
   * Emit state 'SPEAKING' bukan 'CONNECTED', agar useVoiceSession tidak buka mic/greeting.
   * Auto-disconnect setelah timeout.
   */
  async speakOnce(text, timeoutMs = 10000) {
    console.log('🔊 speakOnce:', text.substring(0, 60) + '...');
    // Tutup sesi speakOnce sebelumnya jika masih aktif
    this.cancelSpeakOnce();

    // Jika sudah ada sesi aktif, gunakan saja
    if (this.session) {
      try {
        this.session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: `[SISTEM] Ucapkan kalimat berikut persis seperti adanya, hangat dan ramah, tanpa tambahan kata lain: "${text}"` }] }]
        });
      } catch (e) { console.error('speakOnce on existing session error:', e); }
      return;
    }
    const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-8b';
    let speakSession = null;
    const pendingText = `[SISTEM] Ucapkan persis dengan hangat dan ramah, tanpa tambahan: "${text}"`;
    try {
      let apiKey = process.env.GEMINI_API_KEY;
      try {
        const { dbGet } = require('../../infrastructure/database/db');
        const row = await dbGet(`SELECT value FROM settings WHERE key = 'gemini_api_key'`);
        if (row && row.value) {
          apiKey = row.value;
        }
      } catch (dbErr) {}
      this.ai = new GoogleGenAI({ apiKey });

      speakSession = await this.ai.live.connect({
        model: modelName,
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
          systemInstruction: { parts: [{ text: 'Kamu adalah asisten Sinta. Ucapkan persis apa yang diminta sistem.' }] }
        },
        callbacks: {
          onopen: () => {
            console.log('🔊 speakOnce connected OK');
            this._emitResponse({ type: 'stateChange', state: 'SPEAKING' });
          },
          onmessage: (e) => {
            if (e.serverContent) this._handleContent(e.serverContent);
          },
          onclose: (e) => { console.log(`🔊 speakOnce closed. Code: ${e?.code}, Reason: "${e?.reason}"`); },
          onerror: (err) => console.error('speakOnce error:', err)
        }
      });

      // Tambahkan turnComplete:true agar Gemini tahu user turn selesai dan harus merespons
      console.log('🔊 Sending content to speakOnce session...');

      // Gemini Live butuh audio context untuk menghasilkan audio output.
      // Kirim beberapa frame audio senyap (silent) untuk membuka audio stream, 
      // lalu kirim teks. Ini meniru perilaku main session yang punya mic aktif.
      const silentFrame = Buffer.alloc(320, 0); // 160 samples @ 16kHz = 10ms silence
      for (let i = 0; i < 5; i++) {
        speakSession.sendRealtimeInput({
          audio: { data: silentFrame.toString('base64'), mimeType: 'audio/pcm;rate=16000' }
        });
      }

      // Tunggu sebentar agar audio context terbuka, lalu kirim teks
      await new Promise(r => setTimeout(r, 200));
      speakSession.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: pendingText }] }],
        turnComplete: true
      });

      this._speakSession = speakSession;
      setTimeout(() => { this.cancelSpeakOnce(); }, timeoutMs);
    } catch (err) {
      console.error('speakOnce connect error:', err);
      this._emitResponse({ type: 'ai_error', message: 'AI Sedang Ada Gangguan' });
    }
  }

  /** Hentikan sesi speakOnce yang sedang aktif */
  cancelSpeakOnce() {
    if (this._speakSession) {
      console.log('🔇 Cancelling active speakOnce session');
      try { this._speakSession.close(); } catch (_) {}
      this._speakSession = null;
    }
  }

  // (Legacy) Frontend mengirim chunk audio sebagai Buffer
  processAudioChunk(chunk) {
    if (!this.session) return;
    if (!this._chunkCount) this._chunkCount = 0;
    this._chunkCount++;

    const int16View = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
    let sumSq = 0;
    for (let i = 0; i < int16View.length; i++) sumSq += int16View[i] * int16View[i];
    const rms = Math.sqrt(sumSq / int16View.length);

    if (this._chunkCount % 16 === 1) {
      console.log(`🎤 Audio chunk #${this._chunkCount}, size: ${chunk.length}B, RMS: ${rms.toFixed(0)} ${rms > 500 ? '🔊 SUARA TERDETEKSI' : '🔇 hening'}`);
    }
    this.session.sendRealtimeInput({
      audio: {
        data: Buffer.from(chunk).toString('base64'),
        mimeType: "audio/pcm;rate=16000"
      }
    });
  }

  // Frontend mengirim base64 (format baru dari useVoiceSession)
  processAudioChunkBase64(base64pcm, frontendRms) {
    if (!this.session) {
      if (this.isConnecting) {
        this.audioBufferQueue.push({
          audio: {
            data: base64pcm,
            mimeType: 'audio/pcm;rate=16000'
          }
        });
      }
      return;
    }

    if (!this._chunkCount) this._chunkCount = 0;
    this._chunkCount++;

    if (this._chunkCount % 64 === 1) {
      const rmsLabel = (frontendRms || 0) > 0.01 ? '🔊 SUARA TERDETEKSI' : '🔇 hening';
      console.log(`🎤 Audio chunk #${this._chunkCount}, RMS: ${(frontendRms || 0).toFixed(4)} ${rmsLabel}`);
    }

    this.session.sendRealtimeInput({
      audio: {
        data: base64pcm,
        mimeType: 'audio/pcm;rate=16000'
      }
    });
  }

  // Handle balasan dari Gemini (Audio 24kHz)
  _handleContent(content) {
    if (content.modelTurn && content.modelTurn.parts) {
      content.modelTurn.parts.forEach(part => {
        if (part.inlineData && part.inlineData.data) {
          this._emitResponse({
            type: 'audio_stream',
            audioData: part.inlineData.data
          });
        }
        if (part.text) {
          console.log('🗣️ Gemini:', part.text);
        }
      });
    }
    if (content.outputTranscription) {
      console.log('🗣️ Gemini:', content.outputTranscription.text);
    }
    if (content.inputTranscription) {
      console.log('🎤 User:', content.inputTranscription.text);
    }
    if (content.interrupted) {
      console.log('⏸️ Gemini interrupted');
    }
    if (content.turnComplete) {
      console.log('🏁 Turn Complete (Sesi Gemini Selesai Bicara)');
    }
  }

  // Handle ketika Gemini memanggil fungsi (navigate_to_page, set_nik)
  _handleToolCall(call) {
    const fnCalls = call.functionCalls;
    fnCalls.forEach(fn => {
      console.log(`🤖 Gemini memanggil fungsi: ${fn.name}`, fn.args);

      if (fn.name === 'navigate_to_page') {
        this._emitResponse({
          type: 'response',
          action: 'NAVIGATE',
          path: fn.args.page,
          nextPath: fn.args.nextPath,
          timestamp: Date.now()
        });
      } else if (fn.name === 'set_nik') {
        this._emitResponse({
          type: 'response',
          action: 'NAVIGATE',
          path: '/profil-warga',
          sessionData: { nik: fn.args.nik },
          timestamp: Date.now()
        });
      } else if (fn.name === 'select_surat') {
        this._emitResponse({
          type: 'response',
          action: 'SELECT_TEMPLATE',
          templateName: fn.args.template_name,
          timestamp: Date.now()
        });
      } else if (fn.name === 'fill_slot') {
        // Isi slot di session manager dengan nilai yang disebutkan warga
        const sessionManager = require('./sessionManager');
        const session = sessionManager.getSession();
        if (session && session.phase === 'SLOT_FILLING') {
          const fillResult = sessionManager.fillSlot(fn.args.slot_key, fn.args.value);
          console.log(`✅ Slot filled via voice: ${fn.args.slot_key} = "${fn.args.value}" | allFilled: ${fillResult?.allFilled}`);
          // Emit session update ke frontend agar form langsung ter-update
          this._emitResponse({
            type: 'session_update',
            slots: session.slots,
            slotDefs: session.slotDefs,
            current_slot: session.current_slot,
            phase: session.phase,
            jenis_surat: session.jenis_surat,
            timestamp: Date.now()
          });

          // Jika semua slot sudah terisi, kirim prompt ke Gemini untuk bacakan ringkasan
          if (fillResult?.allFilled) {
            // Susun ringkasan data yang terisi
            const ringkasan = session.slotDefs
              .filter(def => session.slots[def.key])
              .map(def => `${def.label}: ${session.slots[def.key]}`)
              .join(', ');

            const confirmPrompt = `[SISTEM] Semua data surat telah terkumpul. Ringkasan data: ${ringkasan}. Tolong bacakan semua data ini kepada warga secara ramah dan jelas satu per satu. Setelah selesai, katakan kepada warga: "Jika ada data yang kurang tepat, silakan tekan ikon pensil di samping data yang ingin diubah. Jika semua sudah benar, silakan tekan tombol Cetak Surat."  Jangan lakukan navigasi apapun, biarkan warga yang memutuskan.`;

            try {
              this.session.sendClientContent({
                turns: [{ role: 'user', parts: [{ text: confirmPrompt }] }]
              });
            } catch (e) {
              console.error('[GeminiLive] Error sending confirmation prompt:', e);
            }
          }
        }
      }

      // Kirim hasil balasan fungsi ke Gemini (wajib agar Gemini tahu fungsinya berhasil dieksekusi)
      this.session.sendToolResponse({
        functionResponses: [{
          id: fn.id,
          name: fn.name,
          response: { success: true }
        }]
      });
    });
  }

  _emitResponse(data) {
    if (this.onResponseCallback) this.onResponseCallback(data);
  }

  // --- COMPATIBILITY METHODS ---
  // Agar tidak error ketika dipanggil oleh voiceController lama
  setOnStateChange(callback) { }
  async synthesize(text) { return { success: true }; }
  async processKeyboardInput(slotKey, value) {
    const sessionManager = require('./sessionManager');
    const fillResult = sessionManager.fillSlot(slotKey, value);

    if (this._manualMode && fillResult && fillResult.allFilled) {
      sessionManager.setPhase('CONFIRMATION');
      this._emitResponse({ type: 'stateChange', state: 'CONFIRMATION_READY' });
    }

    if (!this._manualMode && this.session) {
      try {
        const promptText = fillResult && fillResult.allFilled
          ? `Saya telah mengetik data terakhir secara manual untuk kolom ${slotKey} yaitu: "${value}". Semua data telah lengkap. Tolong beritahu saya untuk segera menekan tombol cetak surat yang ada di layar.`
          : `Saya telah mengetik data secara manual untuk kolom ${slotKey} yaitu: "${value}". Lanjutkan ke pertanyaan berikutnya.`;

        this.session.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{ text: promptText }]
          }]
        });
      } catch (e) {
        console.error('Error sending keyboard input to Gemini:', e);
      }
    }
  }
  async handleTranscriptDirect(transcript) { }
  async startSlotFillingDirect() {
    const sessionManager = require('./sessionManager');
    sessionManager.setPhase('SLOT_FILLING');

    const session = sessionManager.getSession();

    // Reactivate if it was deactivated by manual mode
    if (!this._manualMode && !this.session && !this.isConnecting) {
      await this.activate();
    }

    if (!this._manualMode && this.session && session && session.slotDefs) {
      const pendingSlots = session.slotDefs
        .filter(s => !session.slots[s.key])
        .map(s => s.label || s.key)
        .join(', ');

      try {
        this.session.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{ text: `Saya telah memilih untuk membuat surat "${session.jenis_surat}". Tolong bantu saya mengumpulkan data berikut: [ ${pendingSlots} ]. Ingat, tanyakan secara berurutan SATU PER SATU. Tanyakan pertanyaan pertama SEKARANG.` }]
          }]
        });
      } catch (e) {
        console.error('Error instructing Gemini for slot filling:', e);
      }
    }

    return { success: true };
  }
  enterManualMode() {
    console.log('🛑 Berpindah ke Manual Mode - Mematikan Voice AI');
    this._manualMode = true;
    this.deactivate();
    this._emitResponse({ type: 'stateChange', state: 'MANUAL_MODE' });
  }
  exitManualMode() {
    this._manualMode = false;
  }

  isManualMode() {
    return this._manualMode;
  }
}

module.exports = new GeminiLiveService();
