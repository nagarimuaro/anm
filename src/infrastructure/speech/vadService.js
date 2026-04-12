/**
 * VAD Service — Voice Activity Detection (Simplified for Streaming)
 * 
 * Dengan Deepgram WebSocket Streaming, VAD tidak lagi menjadi trigger utama
 * untuk transcription. Deepgram handle endpointing sendiri (lebih akurat).
 * 
 * VAD sekarang hanya bertanggung jawab untuk:
 * 1. Echo suppression (pause saat TTS diputar)
 * 2. Idle timeout (kembali standby jika tidak ada aktivitas)
 * 3. State management (untuk UI indicators)
 */

const EventEmitter = require('events');

const IDLE_TIMEOUT_MS = 15000;      // 15 detik tanpa suara = kembali STANDBY
const ENERGY_THRESHOLD = 0.005;     // Minimum energy level
let _debugCounter = 0;

class VADService extends EventEmitter {
  constructor() {
    super();
    this.state = 'STANDBY';   // STANDBY | LISTENING | PROCESSING
    this.idleTimer = null;
    this.isActive = false;
    this.isPaused = false;    // True saat TTS sedang diputar (echo suppression)

    console.log('🎙️ VAD Service initialized (simplified — Deepgram handles endpointing).');
  }

  /**
   * Aktifkan VAD — mulai monitoring
   */
  activate() {
    this.isActive = true;
    this.setState('LISTENING');
    this._startIdleTimer();
    console.log('VAD: Activated');
  }

  /**
   * Deaktifkan VAD
   */
  deactivate() {
    this.isActive = false;
    this.isPaused = false;
    this.setState('STANDBY');
    this._clearTimers();
    console.log('VAD: Deactivated');
  }

  /**
   * Pause VAD saat TTS audio diputar — mencegah echo
   */
  pauseForAudio() {
    this.isPaused = true;
    this._clearTimers();
    console.log('VAD: ⏸️  Paused (audio playing — echo suppression)');
  }

  /**
   * Resume VAD setelah audio selesai diputar
   */
  resumeAfterAudio() {
    this.isPaused = false;
    if (this.isActive) {
      this.setState('LISTENING');
      this._startIdleTimer();
      console.log('VAD: ▶️  Resumed (audio ended)');
    }
  }

  /**
   * Proses audio chunk — hanya untuk idle detection & state management
   * Transcription sudah ditangani oleh Deepgram WebSocket
   */
  processChunk(audioChunk, rms) {
    if (!this.isActive || this.isPaused) return;

    // Debug log every ~2 seconds
    _debugCounter++;
    if (_debugCounter % 8 === 0 && typeof rms === 'number') {
      console.log(`VAD: RMS=${rms.toFixed(4)} state=${this.state}`);
    }

    const hasVoice = typeof rms === 'number'
      ? rms > ENERGY_THRESHOLD
      : false;

    if (hasVoice) {
      // Voice detected — reset idle timer
      this._resetIdleTimer();

      if (this.state === 'LISTENING') {
        this.setState('BUFFERING');
        this.emit('voiceStart');
      }
    }
    // Note: silence detection & endpointing sekarang ditangani oleh Deepgram
  }

  /**
   * Dipanggil saat Deepgram mendeteksi speech started
   */
  onSpeechStarted() {
    if (!this.isActive || this.isPaused) return;
    this._resetIdleTimer();
    if (this.state !== 'BUFFERING') {
      this.setState('BUFFERING');
      this.emit('voiceStart');
    }
  }

  /**
   * Dipanggil saat transcript final diterima — kembali listening
   */
  onTranscriptReceived() {
    if (this.isActive && !this.isPaused) {
      this.setState('LISTENING');
      this._resetIdleTimer();
    }
  }

  /**
   * Set ke processing state (saat AI sedang memproses)
   */
  setProcessing() {
    this.setState('PROCESSING');
    this._clearTimers();
  }

  /**
   * Selesai transcribing, kembali ke listening
   */
  resumeListening() {
    if (this.state === 'TRANSCRIBING' || this.state === 'PROCESSING') {
      this.setState('LISTENING');
      this._resetIdleTimer();
    }
  }

  /**
   * Update state dan emit event
   */
  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    if (oldState !== newState) {
      this.emit('stateChange', { from: oldState, to: newState });
      console.log(`VAD: State ${oldState} → ${newState}`);
    }
  }

  /**
   * Idle timer — kembali ke STANDBY jika tidak ada input
   */
  _startIdleTimer() {
    this._clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      console.log('VAD: Idle timeout — returning to STANDBY');
      this.setState('STANDBY');
      this.emit('idleTimeout');
    }, IDLE_TIMEOUT_MS);
  }

  _resetIdleTimer() {
    this._clearIdleTimer();
    this._startIdleTimer();
  }

  _clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  _clearTimers() {
    this._clearIdleTimer();
  }

  getState() {
    return this.state;
  }
}

module.exports = new VADService();
