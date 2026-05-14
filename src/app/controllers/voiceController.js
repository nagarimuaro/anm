/**
 * Voice Controller — IPC Handler untuk Voice System
 * Menghubungkan Renderer Process (React) dengan Voice Service
 * 
 * Mendukung streaming: interim transcripts dikirim real-time ke frontend
 */
const voiceService = require('../services/geminiLiveService'); // Menggunakan Gemini Service
const DEBUG_VOICE = process.env.DEBUG_VOICE === 'true';

function register(ipc, mainWindow) {
  // Set callback untuk mengirim response ke frontend
  voiceService.setOnResponse((data) => {
    try {
      if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
        // Konversi audioPath ke audioUrl untuk HTTP serving
        if (data.audioPath) {
          const path = require('path');
          const fileName = path.basename(data.audioPath);
          data.audioUrl = `http://localhost:3003/audio/${fileName}`;
          delete data.audioPath;
        }

        if (data.type === 'transcript') {
          mainWindow.webContents.send('voice:transcript', { text: data.text });
        } else if (data.type === 'interim') {
          // Streaming interim transcript — kata per kata real-time
          mainWindow.webContents.send('voice:interim', { text: data.text });
        } else if (data.type === 'audio_stream') {
          if (DEBUG_VOICE) console.log(`🔉 [VC] Forwarding audio_stream to renderer, size: ${data.audioData?.length}`);
          mainWindow.webContents.send('voice:audio_stream', data);
        } else if (data.type === 'stateChange') {
          mainWindow.webContents.send('voice:stateChange', data);
        } else if (data.type === 'ai_error') {
          mainWindow.webContents.send('voice:ai_error', data);
        } else {
          mainWindow.webContents.send('voice:response', data);
        }

        // Kirim session update
        const sessionManager = require('../services/sessionManager');
        const session = sessionManager.getSession();
        if (session) {
          mainWindow.webContents.send('session:update', {
            phase: session.phase,
            slots: session.slots,
            slotDefs: session.slotDefs,
            current_slot: session.current_slot,
            intent: session.intent,
            jenis_surat: session.jenis_surat,
            persyaratan: session.persyaratan,
          });
        }
      }
    } catch (e) {
      console.error('Voice controller send error:', e.message);
    }
  });

  voiceService.setOnStateChange((state) => {
    try {
      if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('voice:stateChange', { state });
      }
    } catch (e) { /* Window destroyed */ }
  });

  // --- IPC Handlers ---

  // Aktivasi sistem
  ipc.handle('voice:activate', async () => {
    try {
      await voiceService.activate();
      return { success: true };
    } catch (error) {
      console.error('Voice activate error:', error);
      return { success: false, error: error.message };
    }
  });

  // Deaktivasi
  ipc.handle('voice:deactivate', () => {
    voiceService.deactivate();
    return { success: true };
  });

  // Reset percakapan saat kembali ke beranda: hapus konteks Gemini + session bisnis,
  // lalu aktifkan ulang agar Sinta mulai dari nol.
  ipc.handle('voice:resetConversation', async (event, options = {}) => {
    try {
      const result = await voiceService.resetConversation({
        reactivate: options.reactivate !== false,
      });
      return result
        ? { success: true }
        : { success: false, error: 'Gagal mengaktifkan ulang sesi Gemini.' };
    } catch (error) {
      console.error('Voice reset conversation error:', error);
      return { success: false, error: error.message };
    }
  });

  const handleAudioChunk = ({ base64pcm, chunk, rms }) => {
    // base64pcm: dikirim dari frontend sebagai base64 string (format baru)
    // chunk: fallback untuk format lama
    if (base64pcm) {
      voiceService.processAudioChunkBase64(base64pcm, rms);
    } else {
      let buffer;
      if (chunk instanceof ArrayBuffer) {
        buffer = Buffer.from(chunk);
      } else if (Array.isArray(chunk)) {
        buffer = Buffer.from(new Int16Array(chunk).buffer);
      } else {
        buffer = Buffer.from(chunk);
      }
      voiceService.processAudioChunk(buffer, rms);
    }
  };

  // Audio chunk dari frontend mic (raw PCM Int16, encoded base64)
  ipc.on('voice:audioChunk', (event, payload) => {
    handleAudioChunk(payload || {});
  });

  // Backward compat untuk caller lama yang masih invoke().
  ipc.handle('voice:audioChunk', (event, payload) => {
    handleAudioChunk(payload || {});
  });

  // TTS only — synthesize teks and play with echo suppression
  ipc.handle('voice:synthesize', async (event, text) => {
    try {
      const result = await voiceService.synthesize(text);
      if (result.audioPath) {
        const path = require('path');
        const fileName = path.basename(result.audioPath);
        result.audioUrl = `http://localhost:3003/audio/${fileName}`;
        delete result.audioPath;
      }

      // Also send as voice:response so frontend plays it with echo suppression
      if (result.audioUrl && mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('voice:response', {
          type: 'response',
          action: 'TTS_ONLY',
          responseText: text,
          audioUrl: result.audioUrl,
        });
      }

      return { success: true, data: result };
    } catch (error) {
      console.error('Voice synthesize error:', error);
      return { success: false, error: error.message };
    }
  });

  // Keyboard input untuk slot filling
  ipc.handle('voice:keyboardInput', async (event, { slotKey, value }) => {
    try {
      await voiceService.processKeyboardInput(slotKey, value);
      return { success: true };
    } catch (error) {
      console.error('Keyboard input error:', error);
      return { success: false, error: error.message };
    }
  });

  // Person detected
  ipc.handle('camera:personDetected', async () => {
    try {
      await voiceService.activate();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Transcript dari frontend Web Speech API (bypass streaming STT)
  ipc.handle('voice:processTranscript', async (event, transcript) => {
    try {
      if (DEBUG_VOICE) console.log(`📝 Received transcript from frontend: "${transcript}"`);
      await voiceService.handleTranscriptDirect(transcript);
      return { success: true };
    } catch (error) {
      console.error('Process transcript error:', error);
      return { success: false, error: error.message };
    }
  });

  // Start slot filling langsung (bypass LLM intent)
  ipc.handle('voice:startSlotFillingDirect', async () => {
    try {
      return await voiceService.startSlotFillingDirect();
    } catch (error) {
      console.error('Start slot filling direct error:', error);
      return { success: false, error: error.message };
    }
  });

  // MANUAL MODE: Matikan semua AI processing (user navigasi manual via klik)
  ipc.handle('voice:enterManualMode', () => {
    try {
      voiceService.enterManualMode();
      return { success: true };
    } catch (e) {
      console.error('Enter manual mode error:', e);
      return { success: false, error: e.message };
    }
  });

  // TTS one-shot via Gemini Aoede — untuk absensi, notifikasi, dsb.
  // Membuka sesi Gemini dedicated, speak, lalu auto-close. Tidak mengganggu sesi utama.
  ipc.handle('voice:speakOnce', async (event, text) => {
    try {
      await voiceService.speakOnce(text);
      return { success: true };
    } catch (e) {
      console.error('voice:speakOnce error:', e);
      return { success: false, error: e.message };
    }
  });

  // Hentikan audio speakOnce yang sedang diputar (dipanggil saat navigasi keluar halaman)
  ipc.handle('voice:stopSpeaking', () => {
    try {
      voiceService.cancelSpeakOnce();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // EXIT MANUAL MODE: Aktifkan kembali voice AI
  ipc.handle('voice:exitManualMode', () => {
    voiceService.exitManualMode();
    return { success: true };
  });

  // Kirim teks konteks ke sesi Gemini Live yang aktif (agar AI bisa bicara sesuai konteks)
  ipc.handle('voice:sendToGemini', async (event, text) => {
    try {
      if (voiceService.session && typeof voiceService.session.sendClientContent === 'function') {
        voiceService.session.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{ text }]
          }]
        });
        return { success: true };
      }
      return { success: false, error: 'No active Gemini session' };
    } catch (e) {
      console.error('voice:sendToGemini error:', e);
      return { success: false, error: e.message };
    }
  });

  // Echo suppression: pause STT + VAD saat audio diputar
  ipc.handle('voice:audioStarted', () => {
    const vadService = require('../../infrastructure/speech/vadService');
    const sttService = require('../../infrastructure/speech/sttService');
    vadService.pauseForAudio();
    sttService.pauseStreaming();
    if (typeof voiceService.pauseInput === 'function') {
      voiceService.pauseInput();
    }
    return { success: true };
  });

  // Resume STT + VAD saat audio selesai
  ipc.handle('voice:audioEnded', () => {
    const vadService = require('../../infrastructure/speech/vadService');
    const sttService = require('../../infrastructure/speech/sttService');

    // Cegah nyala otomatis jika sedang dalam mode manual
    if (!voiceService.isManualMode()) {
      vadService.resumeAfterAudio();
      sttService.resumeStreaming();
      if (typeof voiceService.resumeInput === 'function') {
        voiceService.resumeInput();
      }
    }
    return { success: true };
  });

  // Get session state — used by pages to poll session data
  // (pages harus TIDAK listen IPC events langsung agar tidak duplikat)
  ipc.handle('session:getState', () => {
    const sessionManager = require('../services/sessionManager');
    const session = sessionManager.getSession();
    if (!session) return null;
    return {
      phase: session.phase,
      intent: session.intent,
      jenis_surat: session.jenis_surat,
      slots: session.slots,
      slotDefs: session.slotDefs,
      current_slot: session.current_slot,
      result: session.result,
      persyaratan: session.persyaratan,
    };
  });

  // Simpan template lengkap (id + input_variables) ke session saat warga memilih template dari UI
  ipc.handle('session:setTemplate', (event, template) => {
    const sessionManager = require('../services/sessionManager');
    sessionManager.setTemplate(template);
    return { success: true };
  });

  // Backward compat
  ipc.handle('session:setTemplateId', (event, templateId) => {
    const sessionManager = require('../services/sessionManager');
    sessionManager.setTemplateId(templateId);
    return { success: true };
  });
}

module.exports = { register };
