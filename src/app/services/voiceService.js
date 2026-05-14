/**
 * Voice Service — Orchestrator utama dengan Streaming Pipeline
 * 
 * STREAMING FLOW:
 * 1. Audio chunks → Deepgram WebSocket (real-time)
 * 2. Interim transcripts → frontend (kata per kata, live)
 * 3. Final transcript → LLM processing
 * 4. LLM streaming response → TTS per kalimat
 * 5. Audio kalimat pertama diputar ASAP, sisa di-buffer
 * 
 * Menghubungkan: STT (streaming), TTS (chunked), Ollama (streaming), VAD, Session
 */
const sttService = require('../../infrastructure/speech/sttService');
const ttsService = require('../../infrastructure/tts/ttsService');
const vadService = require('../../infrastructure/speech/vadService');
const ollamaService = require('../../infrastructure/llm/openrouterService');
const sessionManager = require('./sessionManager');
const slotFillingEngine = require('../../modules/voice/slotFillingEngine');
const { INTENT_TO_SURAT } = require('../../modules/voice/slotDefinitions');

class VoiceService {
  constructor() {
    this.onResponseCallback = null;
    this.onStateChangeCallback = null;
    this._isProcessing = false;
    this._manualMode = false;      // Jika true, semua voice/AI processing dihentikan
    this._utteranceBuffer = '';     // Buffer untuk mengumpulkan final segments
    this._utteranceTimer = null;    // Timer untuk flush utterance
    this._setupSTTListeners();
    this._setupVADListeners();
  }

  /**
   * Setup STT streaming event listeners
   * Ini menggantikan VAD sebagai trigger utama transcription
   */
  _setupSTTListeners() {
    // Interim transcript — kata per kata real-time
    sttService.on('interimTranscript', (text) => {
      if (this._isProcessing || this._manualMode) return;
      this._emitResponse({ type: 'interim', text: this._utteranceBuffer + text });
      vadService.onSpeechStarted();
    });

    // Final transcript — satu segment selesai (bisa ada beberapa per utterance)
    sttService.on('finalTranscript', (text) => {
      if (this._isProcessing || this._manualMode) return;
      this._utteranceBuffer += (this._utteranceBuffer ? ' ' : '') + text;

      // Reset utterance timer — tunggu 800ms tanpa segment baru berarti utterance selesai
      if (this._utteranceTimer) clearTimeout(this._utteranceTimer);
      this._utteranceTimer = setTimeout(() => {
        this._flushUtterance();
      }, 800);
    });

    // Speech final — Deepgram confirms utterance is complete
    sttService.on('speechFinal', (text) => {
      if (this._isProcessing || this._manualMode) return;
      // Langsung flush tanpa tunggu timer
      if (this._utteranceTimer) {
        clearTimeout(this._utteranceTimer);
        this._utteranceTimer = null;
      }
      // Tambahkan segment terakhir jika belum di-buffer
      if (text && !this._utteranceBuffer.endsWith(text)) {
        this._utteranceBuffer += (this._utteranceBuffer ? ' ' : '') + text;
      }
      this._flushUtterance();
    });

    // Utterance end — Deepgram detects end of speech
    sttService.on('utteranceEnd', () => {
      if (this._isProcessing || this._manualMode) return;
      if (this._utteranceBuffer.trim()) {
        if (this._utteranceTimer) {
          clearTimeout(this._utteranceTimer);
          this._utteranceTimer = null;
        }
        this._flushUtterance();
      }
    });

    // Speech started — Deepgram detects voice
    sttService.on('speechStarted', () => {
      vadService.onSpeechStarted();
    });
  }

  /**
   * Flush utterance buffer — proses kalimat lengkap
   */
  async _flushUtterance() {
    const transcript = this._utteranceBuffer.trim();
    this._utteranceBuffer = '';
    this._utteranceTimer = null;

    if (!transcript || transcript.length < 2) return;

    console.log(`🎤 Full utterance: "${transcript}"`);
    this._handleTranscript(transcript);
  }

  /**
   * Setup VAD event listeners (simplified)
   */
  _setupVADListeners() {
    vadService.on('idleTimeout', async () => {
      sttService.closeStream();
      const session = sessionManager.getSession();
      if (session) {
        await sessionManager.abandonSession();
      }
      this._emitState('STANDBY');
    });

    vadService.on('stateChange', ({ from, to }) => {
      this._emitState(to);
    });
  }

  /**
   * Handle transcript dari STT
   */
  async _handleTranscript(transcript) {
    if (this._isProcessing) {
      console.log(`⚠️ Skipping transcript "${transcript}" — already processing`);
      return;
    }
    this._isProcessing = true;

    try {
      vadService.setProcessing();
      sttService.pauseStreaming();  // Pause STT while processing (prevent noise)

      // Emit transcript ke frontend
      this._emitResponse({ type: 'transcript', text: transcript });

      const session = sessionManager.getSession();

      if (!session) {
        await this._handleNewSession(transcript);
      } else {
        await this._processPhase(transcript);
      }

      // Pause VAD — response audio akan diputar di frontend
      vadService.pauseForAudio();
    } finally {
      this._isProcessing = false;
    }
  }

  /**
   * Handle transcript langsung dari frontend Web Speech API
   * Entry point alternatif — bypass STT streaming
   */
  async handleTranscriptDirect(transcript) {
    if (!transcript || transcript.trim().length < 3) {
      console.log('Transcript terlalu pendek, skip.');
      return;
    }

    // MANUAL MODE: jangan proses transcript jika user sedang navigasi manual
    if (this._manualMode) {
      console.log(`🚫 Manual mode aktif, skip transcript: "${transcript}"`);
      return;
    }

    console.log(`🎤 Processing transcript (direct): "${transcript}"`);

    this._emitResponse({ type: 'transcript', text: transcript });

    const session = sessionManager.getSession();

    if (!session) {
      await this._handleNewSession(transcript);
    } else {
      await this._processPhase(transcript);
    }

    vadService.pauseForAudio();
  }

  /**
   * Fase 1: GREETING → Fase 2: INTENT
   */
  async _handleNewSession(transcript) {
    const session = await sessionManager.startSession();
    sessionManager.addConversation('user', transcript);

    // Fase INTENT: Extract intent
    sessionManager.setPhase('INTENT');
    const intentResult = await ollamaService.extractIntent(transcript);
    console.log('Intent extracted:', intentResult);

    if (intentResult.nik) {
      sessionManager.getSession().slots = { nik: intentResult.nik };
    }

    const jenisSurat = INTENT_TO_SURAT[intentResult.intent];

    if (jenisSurat) {
      sessionManager.setIntent(intentResult.intent);
      sessionManager.setPhase('SLOT_FILLING');

      const result = await slotFillingEngine.askNextSlot();
      this._emitResponse({
        type: 'response',
        phase: 'SLOT_FILLING',
        ...result,
      });
    } else if (intentResult.intent === 'CEK_BANSOS') {
      const responseText = 'Baik, silakan masukkan NIK bapak/ibu untuk mengecek bantuan sosial.';
      const audioPath = await ttsService.generateAudio(responseText);
      sessionManager.addConversation('assistant', responseText);

      this._emitResponse({
        type: 'response',
        phase: 'INTENT',
        action: 'NAVIGATE',
        intent: 'CEK_BANSOS',
        responseText,
        audioPath,
      });
    } else if (intentResult.intent === 'BUKU_TAMU') {
      const responseText = 'Baik, silakan isi buku tamu di layar.';
      const audioPath = await ttsService.generateAudio(responseText);
      sessionManager.addConversation('assistant', responseText);

      this._emitResponse({
        type: 'response',
        phase: 'INTENT',
        action: 'NAVIGATE',
        intent: 'BUKU_TAMU',
        responseText,
        audioPath,
      });
    } else if (intentResult.intent === 'GREETING') {
      const responseText = 'Halo, selamat datang di Anjungan Nagari Mandiri. Ada yang bisa saya bantu? Misalnya membuat surat keterangan usaha, surat domisili, atau mengecek bantuan sosial.';
      const audioPath = await ttsService.generateAudio(responseText);
      sessionManager.addConversation('assistant', responseText);

      this._emitResponse({
        type: 'response',
        phase: 'GREETING',
        action: 'GREETING',
        responseText,
        audioPath,
      });
    } else {
      // Intent tidak dikenal — generate response dengan streaming
      const aiResponse = await ollamaService.generateResponse(
        `Warga mengatakan: "${transcript}". Berikan bantuan singkat tentang layanan yang tersedia di ANM.`
      );
      const audioPath = await ttsService.generateAudio(aiResponse);
      sessionManager.addConversation('assistant', aiResponse);

      this._emitResponse({
        type: 'response',
        phase: 'INTENT',
        action: 'GENERAL_RESPONSE',
        responseText: aiResponse,
        audioPath,
      });
    }
  }

  /**
   * Proses transcript sesuai phase saat ini
   */
  async _processPhase(transcript) {
    const session = sessionManager.getSession();

    switch (session.phase) {
      case 'SLOT_FILLING': {
        const result = await slotFillingEngine.processSlotAnswer(transcript);

        if (result.action === 'ALL_FILLED' || result.action === 'CONFIRM_DATA') {
          this._emitResponse({
            type: 'response',
            phase: 'CONFIRMATION',
            ...result,
          });
        } else {
          this._emitResponse({
            type: 'response',
            phase: 'SLOT_FILLING',
            ...result,
          });
        }
        break;
      }

      case 'CONFIRMATION': {
        const result = await slotFillingEngine.processConfirmation(transcript);

        if (result.action === 'CONFIRMED') {
          sessionManager.setPhase('EXECUTING');
          await this._executeBackend();
        } else {
          this._emitResponse({
            type: 'response',
            phase: session.phase,
            ...result,
          });
        }
        break;
      }

      case 'INTENT':
      case 'GREETING': {
        await this._handleNewSession(transcript);
        break;
      }

      default: {
        const aiResponse = await ollamaService.generateResponse(transcript);
        const audioPath = await ttsService.generateAudio(aiResponse);
        sessionManager.addConversation('user', transcript);
        sessionManager.addConversation('assistant', aiResponse);

        this._emitResponse({
          type: 'response',
          phase: session.phase,
          action: 'GENERAL_RESPONSE',
          responseText: aiResponse,
          audioPath,
        });
      }
    }
  }

  /**
   * Fase 5: Eksekusi ke Laravel backend
   */
  async _executeBackend() {
    const session = sessionManager.getSession();
    const kioskService = require('./kioskService');

    try {
      // Bangun payload sesuai format API: POST /api/device/surat/request
      // { nik, template_id, keperluan, custom_data }
      const slots = session.slots || {};
      const slotDefs = session.slotDefs || [];
      
      const nik = slots.nik || '';
      const template_id = session.templateId || null;
      
      // Tentukan field "keperluan": ambil dari slot bernama keperluan/tujuan/keterangan
      // Docs: keperluan adalah top-level field, sisanya masuk custom_data
      const keperluanKeys = ['keperluan', 'tujuan', 'keterangan', 'alasan'];
      let keperluan = '';
      const custom_data = {};
      
      slotDefs.forEach(def => {
        if (def.key === 'nik') return; // nik sudah di-handle
        const val = slots[def.key];
        if (!val) return;
        
        if (keperluanKeys.includes(def.key) && !keperluan) {
          keperluan = val; // Field pertama yang cocok jadi keperluan utama
        } else {
          custom_data[def.key] = val; // Sisanya masuk custom_data
        }
      });

      const suratData = { nik, template_id, keperluan, custom_data };
      console.log('[voiceService] buatSurat payload:', JSON.stringify(suratData));

      const responseText = 'Data sedang diproses. Mohon tunggu sebentar.';
      const audioPath = await ttsService.generateAudio(responseText);
      sessionManager.addConversation('assistant', responseText);

      this._emitResponse({
        type: 'response',
        phase: 'EXECUTING',
        action: 'PROCESSING',
        responseText,
        audioPath,
      });

      const result = await kioskService.buatSurat(suratData);
      if (!result || (result.success === false && result.status !== 'success')) {
        throw new Error(result?.message || result?.pesan || 'Backend menolak pengajuan surat.');
      }

      const completedSession = await sessionManager.completeSession(result);

      // Ambil tracking_code dan qr_base64 dari response API
      const trackingCode = result.tracking_code || result.kode_resi || 'tersedia di layar';
      const qrBase64 = result.tracking_qr_base64 || null;

      const doneText = `Pengajuan surat bapak/ibu telah berhasil. Kode resi anda adalah ${trackingCode}. Silakan ambil bukti resi ini dan tunjukkan kepada petugas nagari. Terima kasih.`;
      const doneAudioPath = await ttsService.generateAudio(doneText);

      this._emitResponse({
        type: 'response',
        phase: 'DONE',
        action: 'SHOW_RECEIPT',
        responseText: doneText,
        audioPath: doneAudioPath,
        result: { ...result, tracking_code: trackingCode, tracking_qr_base64: qrBase64 },
      });
    } catch (error) {
      console.error('Backend execution error:', error.message);

      const errorText = 'Maaf, terjadi kesalahan saat memproses surat. Silakan coba lagi atau hubungi petugas.';
      const audioPath = await ttsService.generateAudio(errorText);

      this._emitResponse({
        type: 'response',
        phase: 'EXECUTING',
        action: 'ERROR',
        responseText: errorText,
        audioPath,
      });

      await sessionManager.abandonSession();
    }
  }

  /**
   * Start slot filling secara langsung (bypass LLM intent)
   * Dipanggil ketika user sudah memilih template dari UI
   * 
   * PENTING: Method ini HARUS membuat session baru agar tidak bentrok
   * dengan background voice processing yang mungkin sedang berjalan.
   */
  async startSlotFillingDirect() {
    // Ambil template data sebelum membuat session baru
    let currentSession = sessionManager.getSession();
    
    // Simpan data template dari session lama (diset oleh session:setTemplate)
    const savedSlotDefs = currentSession?.slotDefs ? [...currentSession.slotDefs] : null;
    const savedTemplateId = currentSession?.templateId;
    const savedTemplateNama = currentSession?.templateNama;
    const savedSlots = currentSession?.slots ? {...currentSession.slots} : null;

    console.log('🎯 startSlotFillingDirect: slotDefs=', savedSlotDefs?.map(s => s.key), 'templateId=', savedTemplateId);

    if (!savedSlotDefs || savedSlotDefs.length === 0) {
      console.error('startSlotFillingDirect: Tidak ada template/slot yang dipilih');
      return { success: false, error: 'Tidak ada template yang dipilih di session' };
    }

    this._isProcessing = true;
    try {
      vadService.setProcessing();
      sttService.pauseStreaming();

      // Buat session BARU untuk menghentikan background voice processing  
      // yang mungkin sedang menggunakan session lama
      const newSession = await sessionManager.startSession();
      
      // Restore template data ke session baru
      newSession.templateId = savedTemplateId;
      newSession.templateNama = savedTemplateNama;
      newSession.slotDefs = savedSlotDefs;
      newSession.slots = savedSlots || {};
      // Pastikan semua slot terinitialisasi
      savedSlotDefs.forEach(def => {
        if (newSession.slots[def.key] === undefined) {
          newSession.slots[def.key] = null;
        }
      });

      sessionManager.setPhase('SLOT_FILLING');
      
      if (this._manualMode) {
        // Mode manual: jangan putar suara dan jangan paksa microphone menyala
        const result = await slotFillingEngine.askNextSlot(true); // skipAudio = true
        this._emitResponse({
          type: 'response',
          phase: 'SLOT_FILLING',
          ...result,
          audioPath: null // Pastikan tidak ada audio
        });
      } else {
        const result = await slotFillingEngine.askNextSlot(false);
        this._emitResponse({
          type: 'response',
          phase: 'SLOT_FILLING',
          ...result,
        });
        vadService.pauseForAudio();
      }
      
      return { success: true };
    } catch (err) {
      console.error('startSlotFillingDirect error:', err);
      return { success: false, error: err.message };
    } finally {
      this._isProcessing = false;
    }
  }

  /**
   * MANUAL MODE: Aktifkan mode manual (semua voice/AI dihentikan)
   * Dipanggil saat user navigasi via klik UI
   */
  enterManualMode() {
    this._manualMode = true;
    this._utteranceBuffer = '';
    if (this._utteranceTimer) {
      clearTimeout(this._utteranceTimer);
      this._utteranceTimer = null;
    }
    // Pause STT agar tidak mengirim transcript
    sttService.pauseStreaming();
    console.log('🖱️  Manual mode: ON — AI processing dihentikan');
  }

  /**
   * EXIT MANUAL MODE: Kembalikan ke voice mode
   * Dipanggil saat user menekan tombol voice FAB
   */
  exitManualMode() {
    this._manualMode = false;
    sttService.resumeStreaming();
    console.log('🎤 Manual mode: OFF — Voice AI aktif kembali');
  }

  /**
   * Cek apakah sedang dalam manual mode
   */
  isManualMode() {
    return this._manualMode;
  }

  /**
   * Aktivasi sistem
   */
  async activate() {
    // Buka Deepgram WebSocket streaming
    sttService.openStream();
    vadService.activate();
    vadService.pauseForAudio(); // Pause during greeting

    const greetingText = 'Selamat datang di Anjungan Nagari Mandiri. Ada yang bisa saya bantu?';
    const audioPath = await ttsService.generateAudio(greetingText);

    this._emitResponse({
      type: 'response',
      phase: 'GREETING',
      action: 'GREETING',
      responseText: greetingText,
      audioPath,
    });

    return audioPath;
  }

  /**
   * Deaktivasi sistem
   */
  deactivate() {
    vadService.deactivate();
    sttService.closeStream();
    this._utteranceBuffer = '';
    if (this._utteranceTimer) {
      clearTimeout(this._utteranceTimer);
      this._utteranceTimer = null;
    }
  }

  /**
   * Proses audio chunk dari frontend
   */
  processAudioChunk(chunk, rms) {
    // Feed ke VAD untuk state management & idle detection
    vadService.processChunk(chunk, rms);

    // Feed ke STT WebSocket streaming (real-time)
    sttService.processAudioChunk(chunk);
  }

  /**
   * Input dari keyboard (untuk NIK)
   */
  async processKeyboardInput(slotKey, value) {
    const session = sessionManager.getSession();
    if (!session || session.phase !== 'SLOT_FILLING') return;

    if (this._isProcessing) return;
    this._isProcessing = true;

    try {
      const result = await slotFillingEngine.processSlotAnswer(value, this._manualMode);

      if (slotKey === 'nik' && result.action !== 'RETRY_SLOT') {
        const kioskService = require('./kioskService');
        const wargaResult = await kioskService.getWarga(value);

        if (wargaResult && wargaResult.success && wargaResult.data) {
          const warga = wargaResult.data;
          session.wargaData = warga;

          const confirmText = `Terima kasih. Data atas nama ${warga.nama}, ${warga.alamat}. `;

          if (result.action === 'ASK_SLOT') {
            const combined = confirmText + result.responseText;
            let audioPath = null;
            
            if (!this._manualMode) {
              audioPath = await ttsService.generateAudio(combined);
              vadService.pauseForAudio();
            }

            this._emitResponse({
              type: 'response',
              phase: 'SLOT_FILLING',
              action: 'ASK_SLOT',
              responseText: combined,
              audioPath,
              slotKey: result.slotKey,
              slotLabel: result.slotLabel,
              wargaData: warga,
            });
          } else {
            let audioPath = null;
            if (!this._manualMode) {
              audioPath = await ttsService.generateAudio(confirmText);
              vadService.pauseForAudio();
            }

            this._emitResponse({
              type: 'response',
              phase: session.phase,
              ...result,
              responseText: confirmText + (result.responseText || ''),
              audioPath,
              wargaData: warga,
            });
          }
          return;
        }
      }

      if (!this._manualMode) {
        vadService.pauseForAudio();
      }
      this._emitResponse({
        type: 'response',
        phase: session.phase,
        ...result,
        audioPath: this._manualMode ? null : result.audioPath
      });
    } finally {
      this._isProcessing = false;
    }
  }

  setOnResponse(callback) {
    this.onResponseCallback = callback;
  }

  setOnStateChange(callback) {
    this.onStateChangeCallback = callback;
  }

  async synthesize(text) {
    const audioPath = await ttsService.generateAudio(text);
    return { audioPath };
  }

  // --- Internal ---

  _emitResponse(data) {
    if (this.onResponseCallback) {
      this.onResponseCallback(data);
    }
  }

  _emitState(state) {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(state);
    }
  }
}

module.exports = new VoiceService();
