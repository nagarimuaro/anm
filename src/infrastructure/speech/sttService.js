/**
 * STT Service — Deepgram WebSocket Streaming (Primary) + Whisper.cpp (Offline)
 * 
 * STREAMING MODE: Audio dikirim real-time via WebSocket
 * - interim results: kata per kata saat user berbicara
 * - final results: kalimat lengkap saat user pause
 * - endpointing: Deepgram handle otomatis
 * - keywords: boost akurasi untuk nama daerah lokal
 * 
 * Audio format: Raw PCM Int16 @ 16kHz Mono (LINEAR16)
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');
const EventEmitter = require('events');
require('dotenv').config();

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';
const WHISPER_BIN = process.env.WHISPER_BIN || 'whisper-cli';
let whisperFallbackPath = path.join(__dirname, '../../../models/whisper-tiny.bin');
try {
  const electron = require('electron');
  if (electron.app && electron.app.isPackaged) {
    whisperFallbackPath = path.join(process.resourcesPath, 'models', 'whisper-tiny.bin');
  }
} catch(e) {}
const WHISPER_MODEL = process.env.WHISPER_MODEL_PATH 
  ? path.resolve(process.cwd(), process.env.WHISPER_MODEL_PATH)
  : whisperFallbackPath;
const TEMP_DIR = path.join(os.tmpdir(), 'anm-stt');
const SAMPLE_RATE = 16000;

// Deepgram streaming config
const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';

// Keywords untuk boost akurasi nama daerah dan istilah lokal
const KEYWORDS = [
  'Sijunjung:5', 'Solok:3', 'Padang:3', 'Bukittinggi:3', 
  'Payakumbuh:3', 'Sawahlunto:3', 'Pariaman:3', 'Tanah Datar:3',
  'Agam:3', 'Pesisir Selatan:3', 'Dharmasraya:3', 'Pasaman:3',
  'Lima Puluh Kota:3', 'Padang Panjang:3',
  'nagari:5', 'jorong:3', 'wali nagari:3', 'kerapatan:3',
  'NIK:5', 'surat keterangan:5', 'surat domisili:5',
  'surat keterangan usaha:5', 'surat tidak mampu:5',
  'bansos:3', 'buku tamu:3',
  'Anjungan Nagari Mandiri:5',
];

class SpeechToTextService extends EventEmitter {
  constructor() {
    super();
    this.audioChunks = [];
    this.isListening = false;
    this.useDeepgram = !!DEEPGRAM_API_KEY;
    this.ws = null;
    this.wsReady = false;
    this.isPaused = false;
    this._reconnectTimer = null;
    this._keepAliveTimer = null;
    this._lastInterim = '';
    this._isConnecting = false;   // Prevent multiple simultaneous connections
    this._intentionallyClosed = false;  // Track if we closed on purpose

    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    if (this.useDeepgram) {
      console.log('📝 STT Service initialized (Deepgram WebSocket Streaming).');
    } else {
      console.log('📝 STT Service initialized (Whisper.cpp — offline).');
    }
  }

  // ══════════════════════════════════════════
  // Deepgram WebSocket Streaming
  // ══════════════════════════════════════════

  /**
   * Buka koneksi WebSocket ke Deepgram
   */
  openStream() {
    if (!this.useDeepgram) {
      this.isListening = true;
      return;
    }

    // Prevent multiple simultaneous connections
    if (this._isConnecting || (this.ws && this.wsReady)) {
      console.log('STT: Connection already open/in-progress, skipping');
      return;
    }

    this._isConnecting = true;
    this._intentionallyClosed = false;

    // Close any existing dead connection
    this._cleanupConnection();

    const params = new URLSearchParams({
      model: 'nova-2',
      language: 'id',
      punctuate: 'true',
      smart_format: 'true',
      interim_results: 'true',
      endpointing: '300',
      utterance_end_ms: '1000',
      vad_events: 'true',
      encoding: 'linear16',
      sample_rate: SAMPLE_RATE.toString(),
      channels: '1',
      keywords: KEYWORDS.join(','),
    });

    const url = `${DEEPGRAM_WS_URL}?${params.toString()}`;

    console.log('STT: 🔌 Opening Deepgram WebSocket...');

    try {
      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        },
      });
    } catch (e) {
      console.error('STT: WebSocket creation error:', e.message);
      this._isConnecting = false;
      return;
    }

    this.ws.on('open', () => {
      this.wsReady = true;
      this.isListening = true;
      this._isConnecting = false;
      console.log('STT: ✅ Deepgram WebSocket connected');
      this._startKeepAlive();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this._handleDeepgramMessage(msg);
      } catch (e) {
        console.error('STT: Parse error:', e.message);
      }
    });

    this.ws.on('close', (code, reason) => {
      const reasonStr = reason ? reason.toString() : 'no reason';
      console.log(`STT: WebSocket closed (${code}: ${reasonStr})`);
      this.wsReady = false;
      this._isConnecting = false;
      this._stopKeepAlive();

      // Only auto-reconnect if:
      // 1. We didn't close intentionally
      // 2. We're supposed to be listening
      // 3. We're not paused
      if (!this._intentionallyClosed && this.isListening && !this.isPaused) {
        console.log('STT: Will reconnect in 2s...');
        this._reconnectTimer = setTimeout(() => this.openStream(), 2000);
      }
    });

    this.ws.on('error', (err) => {
      console.error('STT: WebSocket error:', err.message);
      this.wsReady = false;
      this._isConnecting = false;
    });
  }

  /**
   * Handle pesan dari Deepgram WebSocket
   */
  _handleDeepgramMessage(msg) {
    if (msg.type === 'SpeechStarted') {
      this.emit('speechStarted');
      return;
    }

    if (msg.type === 'UtteranceEnd') {
      console.log('STT: ⏹️ Utterance end');
      this.emit('utteranceEnd');
      return;
    }

    if (msg.type === 'Results' && msg.channel) {
      const alt = msg.channel.alternatives?.[0];
      if (!alt) return;

      const transcript = alt.transcript || '';
      const isFinal = msg.is_final;
      const speechFinal = msg.speech_final;

      if (!transcript.trim()) return;

      if (isFinal) {
        console.log(`📢 STT Final: "${transcript}"`);
        this._lastInterim = '';
        this.emit('finalTranscript', transcript.trim());

        if (speechFinal) {
          console.log(`📢 STT Speech Final`);
          this.emit('speechFinal', transcript.trim());
        }
      } else {
        if (transcript !== this._lastInterim) {
          this._lastInterim = transcript;
          this.emit('interimTranscript', transcript.trim());
        }
      }
    }
  }

  /**
   * Kirim audio chunk ke Deepgram WebSocket
   */
  processAudioChunk(chunk) {
    if (this.ws && this.wsReady && !this.isPaused) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(chunk);
        }
      } catch (e) {
        // Silently ignore send errors
      }
    }

    // Legacy fallback buffer for offline mode
    if (this.isListening && !this.useDeepgram) {
      this.audioChunks.push(chunk);
    }
  }

  /**
   * Pause streaming (saat TTS diputar)
   * PENTING: Tidak menutup WebSocket, hanya stop kirim audio
   * KeepAlive tetap berjalan agar connection tidak putus
   */
  pauseStreaming() {
    this.isPaused = true;
    console.log('STT: ⏸️ Streaming paused');
  }

  /**
   * Resume streaming
   */
  resumeStreaming() {
    this.isPaused = false;
    this._lastInterim = '';
    console.log('STT: ▶️ Streaming resumed');

    // Reconnect jika WebSocket mati saat paused
    if (this.useDeepgram && !this.wsReady && this.isListening) {
      console.log('STT: WebSocket was closed during pause, reconnecting...');
      this.openStream();
    }
  }

  /**
   * Tutup WebSocket connection (intentional)
   */
  closeStream() {
    this.isListening = false;
    this.wsReady = false;
    this._intentionallyClosed = true;
    this._stopKeepAlive();

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._cleanupConnection();
    console.log('STT: Stream closed');
  }

  /**
   * Cleanup WebSocket connection
   */
  _cleanupConnection() {
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        }
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (e) { /* ignore */ }
      this.ws = null;
    }
  }

  /**
   * KeepAlive — mencegah Deepgram timeout saat paused
   * Dikirim setiap 5 detik TERMASUK saat paused
   */
  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAliveTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
        } catch (e) { /* ignore */ }
      }
    }, 5000);
  }

  _stopKeepAlive() {
    if (this._keepAliveTimer) {
      clearInterval(this._keepAliveTimer);
      this._keepAliveTimer = null;
    }
  }

  // ══════════════════════════════════════════
  // Legacy Methods
  // ══════════════════════════════════════════

  startListening() {
    this.isListening = true;
    this.audioChunks = [];
    if (this.useDeepgram && !this.wsReady) {
      this.openStream();
    }
  }

  stopListening(label = 'unknown') {
    this.isListening = false;
    console.log(`STT: Stopped listening [${label}]`);
  }

  async transcribeBufferedAudio() {
    if (this.useDeepgram) return null;

    if (this.audioChunks.length === 0) return null;

    const pcmBuffer = Buffer.concat(this.audioChunks);
    this.audioChunks = [];

    if (pcmBuffer.length < 9600) return null;

    try {
      const transcript = await this._transcribeWhisper(pcmBuffer);
      if (transcript && transcript.trim().length > 1) {
        return transcript.trim();
      }
      return null;
    } catch (error) {
      console.error('STT: Whisper error:', error.message);
      return null;
    }
  }

  // ══════════════════════════════════════════
  // Whisper.cpp (Offline Fallback)
  // ══════════════════════════════════════════

  async _transcribeWhisper(pcmBuffer) {
    const tempWav = path.join(TEMP_DIR, `stt_${Date.now()}.wav`);
    try {
      fs.writeFileSync(tempWav, this._buildWavBuffer(pcmBuffer));
      const transcript = await this._runWhisper(tempWav);
      this._cleanupFile(tempWav);
      return transcript;
    } catch (error) {
      this._cleanupFile(tempWav);
      throw error;
    }
  }

  _runWhisper(wavPath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', WHISPER_MODEL, '-f', wavPath,
        '-l', 'id', '--no-timestamps', '-nt',
        '--beam-size', '5',
        '--prompt', 'Anjungan Nagari Mandiri. Sijunjung. Buat surat keterangan usaha, domisili, tidak mampu. NIK. Cek bansos. Ya, tidak.',
      ];

      let output = '', errorOutput = '';
      const whisper = spawn(WHISPER_BIN, args);

      whisper.stdout.on('data', (d) => { output += d.toString(); });
      whisper.stderr.on('data', (d) => { errorOutput += d.toString(); });

      whisper.on('close', (code) => {
        if (code === 0) {
          resolve(output.replace(/\[BLANK_AUDIO\]/g, '').replace(/\n/g, ' ').trim());
        } else {
          reject(new Error(`Whisper exit ${code}: ${errorOutput.slice(-200)}`));
        }
      });

      whisper.on('error', (err) => reject(new Error(`Whisper error: ${err.message}`)));
    });
  }

  // ══════════════════════════════════════════
  // Utility
  // ══════════════════════════════════════════

  _buildWavBuffer(pcmBuffer) {
    const dataSize = pcmBuffer.length;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(dataSize + 36, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmBuffer]);
  }

  reset() {
    this.audioChunks = [];
    this.isListening = false;
    this._lastInterim = '';
  }

  _cleanupFile(fp) {
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
  }
}

module.exports = new SpeechToTextService();
