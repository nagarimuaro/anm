/**
 * Voice Controller — IPC Handler untuk Voice System
 * Menghubungkan Renderer Process (React) dengan Voice Service
 * 
 * Mendukung streaming: interim transcripts dikirim real-time ke frontend
 */
const voiceService = require('../services/voiceService');

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
            current_slot: session.current_slot,
            intent: session.intent,
            jenis_surat: session.jenis_surat,
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

  // Audio chunk dari frontend mic (raw PCM Int16)
  ipc.handle('voice:audioChunk', (event, { chunk, rms, sampleRate, format }) => {
    const int16Array = new Int16Array(chunk);
    const buffer = Buffer.from(int16Array.buffer);
    voiceService.processAudioChunk(buffer, rms);
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
      console.log(`📝 Received transcript from frontend: "${transcript}"`);
      await voiceService.handleTranscriptDirect(transcript);
      return { success: true };
    } catch (error) {
      console.error('Process transcript error:', error);
      return { success: false, error: error.message };
    }
  });

  // Echo suppression: pause STT + VAD saat audio diputar
  ipc.handle('voice:audioStarted', () => {
    const vadService = require('../../infrastructure/speech/vadService');
    const sttService = require('../../infrastructure/speech/sttService');
    vadService.pauseForAudio();
    sttService.pauseStreaming();
    return { success: true };
  });

  // Resume STT + VAD saat audio selesai
  ipc.handle('voice:audioEnded', () => {
    const vadService = require('../../infrastructure/speech/vadService');
    const sttService = require('../../infrastructure/speech/sttService');
    vadService.resumeAfterAudio();
    sttService.resumeStreaming();
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
      current_slot: session.current_slot,
      result: session.result,
    };
  });
}

module.exports = { register };
