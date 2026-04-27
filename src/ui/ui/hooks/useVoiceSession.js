/**
 * useVoiceSession — Custom React Hook
 * Manages mic, IPC communication, audio playback, and session state
 * 
 * STREAMING: Menampilkan interim transcript secara real-time
 * saat user masih berbicara (kata per kata)
 */
import { useState, useRef, useEffect, useCallback } from 'react';

const electron = window.require ? window.require('electron') : null;

export default function useVoiceSession(disableMic = false) {
  // State
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [systemState, setSystemState] = useState('STANDBY');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [phase, setPhase] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [lastAction, setLastAction] = useState(null);
  const [lastPath, setLastPath] = useState(null);
  const [lastNextPath, setLastNextPath] = useState(null);
  const [lastActionTime, setLastActionTime] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Refs
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioPlayerRef = useRef(new Audio());
  const isMicOpenRef = useRef(false);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const audioListenerRegistered = useRef(false);
  
  // Playback Refs
  const playbackCtxRef = useRef(null);
  const nextPlayTimeRef = useRef(0);
  const playbackEndTimerRef = useRef(null);

  // ── Mic Management (Inline AudioWorklet — terbukti bekerja di test page) ──
  const openMic = useCallback(async () => {
    if (disableMic) return;
    if (isMicOpenRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const systemSampleRate = audioCtx.sampleRate;
      console.log('[Mic] sampleRate:', systemSampleRate);

      // Inline worklet via Blob URL (file path di-fallback ke index.html oleh webpack!)
      const workletCode = `
        class MicCapture extends AudioWorkletProcessor {
          constructor() { super(); this._buf = []; }
          process(inputs) {
            const ch = inputs[0] && inputs[0][0];
            if (ch) {
              for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
              while (this._buf.length >= 1024) {
                const chunk = new Float32Array(this._buf.splice(0, 1024));
                this.port.postMessage({ type: 'audio', chunk }, [chunk.buffer]);
              }
            }
            return true;
          }
        }
        registerProcessor('mic-capture', MicCapture);
      `;
      const blobUrl = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }));
      await audioCtx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const workletNode = new AudioWorkletNode(audioCtx, 'mic-capture');
      let debugCount = 0;

      workletNode.port.onmessage = (e) => {
        if (!electron || e.data.type !== 'audio') return;
        const float32 = e.data.chunk;

        // Downsample ke 16kHz
        const targetRate = 16000;
        const ratio = systemSampleRate / targetRate;
        const outputLength = Math.floor(float32.length / ratio);
        const resampled = new Float32Array(outputLength);
        for (let i = 0; i < outputLength; i++) {
          resampled[i] = float32[Math.floor(i * ratio)];
        }

        // RMS
        let sumSq = 0;
        for (let i = 0; i < float32.length; i++) sumSq += float32[i] * float32[i];
        const rms = Math.sqrt(sumSq / float32.length);

        debugCount++;
        if (debugCount % 64 === 0) {
          console.log(`[Mic] RMS: ${rms.toFixed(5)}, sr: ${systemSampleRate}`);
        }

        // Float32 → Int16 → base64
        const int16 = new Int16Array(outputLength);
        for (let i = 0; i < outputLength; i++) {
          const s = Math.max(-1, Math.min(1, resampled[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const bytes = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64pcm = window.btoa(binary);

        electron.ipcRenderer.invoke('voice:audioChunk', {
          base64pcm, rms, sampleRate: targetRate, format: 'pcm_s16le',
        });
      };

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);

      audioCtxRef.current = audioCtx;
      analyserRef.current = workletNode;
      isMicOpenRef.current = true;
      console.log('[Mic] Inline AudioWorklet started OK');
    } catch (err) {
      console.error('[Mic] Failed to open:', err);
    }
  }, []);

  const closeMic = useCallback(() => {
    if (analyserRef.current) { analyserRef.current.disconnect(); analyserRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    isMicOpenRef.current = false;
  }, []);

  // ── WAV Playback via HTML5 Audio ──
  // AudioContext TIDAK berfungsi di Electron ini. Edge TTS pakai <audio> element dan berhasil.
  // Jadi kita konversi PCM → WAV blob → Audio element.


  // ── PCM Playback via AudioContext BufferSource ──
  // AudioContext sangat bisa menangani PCM stream (gapless) jika diputar secara berurutan.
  
  const initPlaybackContext = useCallback(() => {
    if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
      playbackCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      nextPlayTimeRef.current = 0;
      
      // Buat AnalyserNode untuk lipsync sinkron dengan speaker
      const analyser = playbackCtxRef.current.createAnalyser();
      analyser.fftSize = 512;
      analyser.connect(playbackCtxRef.current.destination);
      playbackCtxRef.current.lipsyncAnalyser = analyser;

      const dataArray = new Float32Array(analyser.frequencyBinCount);
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      let smoothedRms = 0;
      
      const updateLipsync = () => {
        if (playbackCtxRef.current && playbackCtxRef.current.state === 'running') {
          analyser.getFloatTimeDomainData(dataArray);
          analyser.getByteFrequencyData(freqData);

          // 1. RMS (Volume) Calculation
          let sumSq = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sumSq += dataArray[i] * dataArray[i];
          }
          const rms = Math.sqrt(sumSq / dataArray.length);
          const displayRms = rms * 20000; 
          
          if (displayRms > smoothedRms) {
            smoothedRms = smoothedRms * 0.3 + displayRms * 0.7;
          } else {
            smoothedRms = smoothedRms * 0.85 + displayRms * 0.15;
          }
          window.currentVoiceRMS = smoothedRms;

          // 2. Formant (Phoneme/Vowel) Extraction via FFT
          const getEnergy = (startFreq, endFreq) => {
            const binSize = 24000 / analyser.fftSize; // 46.875 Hz
            const startBin = Math.floor(startFreq / binSize);
            const endBin = Math.floor(endFreq / binSize);
            let sum = 0;
            for (let i = startBin; i <= endBin; i++) sum += freqData[i];
            return sum / (endBin - startBin + 1);
          };

          // F1 (Mouth Openness)
          const f1_low = getEnergy(300, 500);   // I, U
          const f1_mid = getEnergy(500, 700);   // E, O
          const f1_high = getEnergy(700, 1200); // A

          // F2 (Tongue Position)
          const f2_low = getEnergy(800, 1200);  // U, O
          const f2_high = getEnergy(1500, 2500); // I, E

          let targetPhoneme = 'idle';
          if (rms > 0.005) { // Only detect if loud enough to be a vowel
            if (f1_high > f1_low && f1_high > f1_mid) {
              targetPhoneme = 'A';
            } else if (f1_mid > f1_low && f1_mid > f1_high) {
              targetPhoneme = (f2_high > f2_low + 10) ? 'E' : 'O';
            } else {
              targetPhoneme = (f2_high > f2_low + 10) ? 'I' : 'U';
            }
          }
          window.currentPhoneme = targetPhoneme;
          
          if (!window.lipsyncTick) window.lipsyncTick = 0;
          window.lipsyncTick++;
          if (window.lipsyncTick % 30 === 0 && rms > 0.001) {
             console.log(`[AudioAnalyser] Phoneme: ${targetPhoneme} | PixiRMS: ${Math.round(smoothedRms)}`);
          }
        } else {
          window.currentVoiceRMS = 0;
          window.currentPhoneme = 'idle';
        }
        requestAnimationFrame(updateLipsync);
      };
      requestAnimationFrame(updateLipsync);
    }
  }, []);
  
  const pcmToFloat32Array = useCallback((base64pcm) => {
    const binaryString = window.atob(base64pcm);
    const len = binaryString.length;
    const float32Array = new Float32Array(Math.floor(len / 2));
    for (let i = 0; i < float32Array.length; i++) {
      const lsb = binaryString.charCodeAt(i * 2);
      const msb = binaryString.charCodeAt(i * 2 + 1);
      let int16 = (msb << 8) | lsb;
      if (int16 >= 32768) int16 -= 65536;
      float32Array[i] = int16 / 32768.0;
    }
    return float32Array;
  }, []);

  const queuePCMChunk = useCallback(async (base64data) => {
    initPlaybackContext();
    
    const ctx = playbackCtxRef.current;
    if (ctx.state === 'suspended') await ctx.resume();

    const float32Array = pcmToFloat32Array(base64data);
    if (float32Array.length === 0) return;

    const buf = ctx.createBuffer(1, float32Array.length, 24000);
    buf.getChannelData(0).set(float32Array);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Hubungkan ke analyser, BUKAN langsung ke destination (karena analyser sudah konek ke destination)
    src.connect(ctx.lipsyncAnalyser || ctx.destination);

    const now = ctx.currentTime;
    // Jika nextPlayTime telat, set ke "now" + sedikit margin agar gapless
    const startAt = Math.max(now + 0.05, nextPlayTimeRef.current);
    nextPlayTimeRef.current = startAt + buf.duration;

    setIsPlaying(true);
    if (playbackEndTimerRef.current) clearTimeout(playbackEndTimerRef.current);
    playbackEndTimerRef.current = setTimeout(() => {
      setIsPlaying(false);
      if (electron) electron.ipcRenderer.invoke('voice:audioEnded').catch(() => {});
    }, (nextPlayTimeRef.current - now) * 1000 + 100);

    src.start(startAt);
  }, [pcmToFloat32Array]);

  const playBeep = useCallback(() => {
    try {
      const ctx = playbackCtxRef.current;
      if (!ctx || ctx.state !== 'running') return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      console.warn('Failed to play beep', e);
    }
  }, []);

  // ── Session Control ──
  const activate = useCallback(async () => {
    setIsActive(true);
    setIsConnecting(true); // Mulai status loading

    // WAJIB: Buka mic di sini karena ini adalah call stack dari onClick (user gesture)
    // Jika dipanggil dari IPC callback (asynchronous), browser akan memblokir akses mic.
    await openMic();

    if (!disableMic) {
      initPlaybackContext();
      if (playbackCtxRef.current.state === 'suspended') {
        await playbackCtxRef.current.resume();
      }
      if (!audioListenerRegistered.current && electron) {
        // Listener dipindah ke useEffect permanen di bawah agar speakOnce juga bisa memutar audio
        // tanpa perlu activate() terlebih dahulu
        audioListenerRegistered.current = true;
      }
    }

    // Panggil backend (mic belum dibuka sampai menerima CONNECTED)
    if (electron) {
      await electron.ipcRenderer.invoke('voice:activate');
    }
  }, [openMic, queuePCMChunk]);

  const deactivate = useCallback(() => {
    setIsActive(false);
    setIsConnecting(false);
    setIsListening(false);
    setIsProcessing(false);
    closeMic();
    
    // Hentikan pemutaran PCM jika sedang berjalan
    if (playbackCtxRef.current && playbackCtxRef.current.state !== 'closed') {
      playbackCtxRef.current.suspend(); // Atau close()
    }
    if (playbackEndTimerRef.current) {
      clearTimeout(playbackEndTimerRef.current);
    }
    setIsPlaying(false);

    if (electron) {
      electron.ipcRenderer.invoke('voice:deactivate');
    }
    setTimeout(() => {
      setTranscript('');
      setInterimTranscript('');
      setAiResponse('');
      setPhase(null);
    }, 3000);
  }, [closeMic]);

  const toggle = useCallback(async () => {
    if (isActive) {
      deactivate();
    } else {
      await activate();
    }
  }, [isActive, activate, deactivate]);

  // ── Audio Playback (Edge TTS / legacy) ──
  const playAudio = useCallback((audioUrl) => {
    if (!audioUrl) return;

    const player = audioPlayerRef.current;
    player.pause();
    player.currentTime = 0;

    setIsPlaying(true);
    if (electron) electron.ipcRenderer.invoke('voice:audioStarted');

    player.src = audioUrl;
    player.load();

    const onCanPlay = () => {
      player.removeEventListener('canplaythrough', onCanPlay);
      player.play().catch(e => {
        if (e.name !== 'AbortError') console.error('Audio play error:', e);
        setIsPlaying(false);
        if (electron) electron.ipcRenderer.invoke('voice:audioEnded');
      });
    };

    player.addEventListener('canplaythrough', onCanPlay);
  }, []);

  // ── Keyboard Input ──
  const sendKeyboardInput = useCallback(async (slotKey, value) => {
    if (electron) {
      await electron.ipcRenderer.invoke('voice:keyboardInput', { slotKey, value });
    }
  }, []);

  // ── IPC Listeners ──
  useEffect(() => {
    if (!electron || !electron.ipcRenderer) return;

    const handleTranscript = (event, data) => {
      setTranscript(data.text);
      setInterimTranscript('');
      setIsListening(false);
      setIsProcessing(true);
    };

    const handleInterim = (event, data) => {
      setInterimTranscript(data.text);
      setIsListening(true);
    };

    const handleResponse = (event, response) => {
      setIsProcessing(false);
      setAiResponse(response.responseText || response.text || '');
      setLastAction(response.action || null);
      if (response.path) setLastPath(response.path);
      if (response.nextPath) setLastNextPath(response.nextPath);
      if (response.sessionData) setSessionData(response.sessionData);
      if (response.timestamp) setLastActionTime(response.timestamp);
      setPhase(response.phase || null);
      if (response.audioUrl) playAudio(response.audioUrl);
    };

    const handleStateChange = async (event, data) => {
      setSystemState(data.state);
      if (data.state === 'CONNECTED') {
        setIsConnecting(false);
        if (!disableMic) {
          playBeep(); // Bunyi Beep sebagai penanda
          await openMic(); // Baru mulai merekam setelah beep
        }
        setIsListening(true);

        // Kirim prompt sambutan ke Gemini agar Sinta langsung menyapa warga
        if (electron) {
          electron.ipcRenderer.invoke('voice:sendToGemini',
            '[SISTEM] Kamu baru saja terhubung. Berikan sambutan yang hangat, singkat, dan ceria kepada warga. Perkenalkan dirimu sebagai Sinta. Tanyakan dengan ramah: ada yang bisa Sinta bantu hari ini?'
          ).catch(() => {});
        }
      } else if (data.state === 'LISTENING' || data.state === 'BUFFERING') {
        setIsListening(true);
        setIsProcessing(false);
      } else if (data.state === 'TRANSCRIBING' || data.state === 'PROCESSING') {
        setIsListening(false);
        setIsProcessing(true);
      } else if (data.state === 'SPEAKING') {
        // speakOnce mode — hanya putar audio, TIDAK buka mic atau kirim greeting
        // Pastikan AudioContext diinisialisasi agar audio bisa diputar
        initPlaybackContext();
        if (playbackCtxRef.current.state === 'suspended') {
          playbackCtxRef.current.resume().catch(() => {});
        }
      } else if (data.state === 'STANDBY' || data.state === 'MANUAL_MODE') {
        setIsListening(false);
        setIsProcessing(false);
        setIsActive(false);
        closeMic();
      }
    };

    const handleSessionUpdate = (event, data) => { setSessionData(data); };
    const handleError = (event, data) => {
      setIsProcessing(false);
      setAiResponse(`Terjadi kesalahan: ${data.message}`);
    };

    electron.ipcRenderer.on('voice:transcript', handleTranscript);
    electron.ipcRenderer.on('voice:interim', handleInterim);
    electron.ipcRenderer.on('voice:response', handleResponse);
    electron.ipcRenderer.on('voice:stateChange', handleStateChange);
    electron.ipcRenderer.on('session:update', handleSessionUpdate);
    electron.ipcRenderer.on('voice:error', handleError);
    // Selalu listen audio_stream agar speakOnce juga bisa memutar audio tanpa activate()
    const handleAudioStream = (event, data) => {
      if (data && data.audioData) queuePCMChunk(data.audioData);
    };
    electron.ipcRenderer.on('voice:audio_stream', handleAudioStream);

    return () => {
      electron.ipcRenderer.removeListener('voice:transcript', handleTranscript);
      electron.ipcRenderer.removeListener('voice:interim', handleInterim);
      electron.ipcRenderer.removeListener('voice:response', handleResponse);
      electron.ipcRenderer.removeListener('voice:stateChange', handleStateChange);
      electron.ipcRenderer.removeListener('session:update', handleSessionUpdate);
      electron.ipcRenderer.removeListener('voice:error', handleError);
      electron.ipcRenderer.removeListener('voice:audio_stream', handleAudioStream);
    };
  }, [playAudio, queuePCMChunk]);

  // Audio onended handler
  useEffect(() => {
    const player = audioPlayerRef.current;
    const handleEnded = () => {
      setIsPlaying(false);
      if (electron) electron.ipcRenderer.invoke('voice:audioEnded');
    };
    player.addEventListener('ended', handleEnded);
    return () => player.removeEventListener('ended', handleEnded);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closeMic();
      audioPlayerRef.current.pause();
    };
  }, [closeMic]);

  return {
    isActive,
    isConnecting,
    isListening,
    isProcessing,
    isPlaying,
    systemState,
    transcript,
    interimTranscript,
    aiResponse,
    phase,
    sessionData,
    lastAction,
    lastPath,
    lastNextPath,
    lastActionTime,
    activate,
    deactivate,
    toggle,
    playAudio,
    sendKeyboardInput,
  };
}
