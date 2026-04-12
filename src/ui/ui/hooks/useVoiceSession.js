/**
 * useVoiceSession — Custom React Hook
 * Manages mic, IPC communication, audio playback, and session state
 * 
 * STREAMING: Menampilkan interim transcript secara real-time
 * saat user masih berbicara (kata per kata)
 */
import { useState, useRef, useEffect, useCallback } from 'react';

const electron = window.require ? window.require('electron') : null;

export default function useVoiceSession() {
  // State
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [systemState, setSystemState] = useState('STANDBY');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');  // Live streaming text
  const [aiResponse, setAiResponse] = useState('');
  const [phase, setPhase] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [lastAction, setLastAction] = useState(null);

  // Refs
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioPlayerRef = useRef(new Audio());
  const isMicOpenRef = useRef(false);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);

  // ── Mic Management ──
  const openMic = useCallback(async () => {
    if (isMicOpenRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 }
      });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      const source = audioCtx.createMediaStreamSource(stream);

      // ScriptProcessorNode for raw PCM capture
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      let debugCount = 0;

      processor.onaudioprocess = (e) => {
        if (!electron) return;

        const float32 = e.inputBuffer.getChannelData(0);

        // Calculate RMS
        let sumSquare = 0;
        for (let i = 0; i < float32.length; i++) {
          sumSquare += float32[i] * float32[i];
        }
        const rms = Math.sqrt(sumSquare / float32.length);

        // Convert Float32 → Int16 for backend
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Debug log every ~4 seconds (less noise)
        debugCount++;
        if (debugCount % 16 === 0) {
          console.log(`[Mic] RMS: ${rms.toFixed(5)}, samples: ${int16.length}`);
        }

        electron.ipcRenderer.invoke('voice:audioChunk', {
          chunk: Array.from(int16),
          rms,
          sampleRate: 16000,
          format: 'pcm_s16le',
        });
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      audioCtxRef.current = audioCtx;
      analyserRef.current = processor;
      isMicOpenRef.current = true;
    } catch (err) {
      console.error('Mic access denied:', err);
    }
  }, []);

  const closeMic = useCallback(() => {
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    isMicOpenRef.current = false;
  }, []);

  // ── Session Control ──
  const activate = useCallback(async () => {
    setIsActive(true);
    await openMic();
    if (electron) {
      await electron.ipcRenderer.invoke('voice:activate');
    }
  }, [openMic]);

  const deactivate = useCallback(() => {
    setIsActive(false);
    setIsListening(false);
    setIsProcessing(false);
    closeMic();
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

  // ── Audio Playback ──
  const playAudio = useCallback((audioUrl) => {
    if (!audioUrl) return;

    const player = audioPlayerRef.current;

    // Stop any current playback first to prevent race condition
    player.pause();
    player.currentTime = 0;

    setIsPlaying(true);
    
    if (electron) {
      electron.ipcRenderer.invoke('voice:audioStarted');
    }

    // Set new source and wait for it to be ready before playing
    player.src = audioUrl;
    player.load();

    const onCanPlay = () => {
      player.removeEventListener('canplaythrough', onCanPlay);
      player.play().catch(e => {
        // Only log if it's not the expected abort from a new load
        if (e.name !== 'AbortError') {
          console.error('Audio play error:', e);
        }
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
      setInterimTranscript('');  // Clear interim saat final transcript diterima
      setIsListening(false);
      setIsProcessing(true);
    };

    const handleInterim = (event, data) => {
      // Real-time streaming: update interim transcript kata per kata
      setInterimTranscript(data.text);
      setIsListening(true);
    };

    const handleResponse = (event, response) => {
      setIsProcessing(false);
      setAiResponse(response.responseText || response.text || '');
      setLastAction(response.action || null);
      setPhase(response.phase || null);

      if (response.audioUrl) {
        playAudio(response.audioUrl);
      }
    };

    const handleStateChange = (event, data) => {
      setSystemState(data.state);
      if (data.state === 'LISTENING' || data.state === 'BUFFERING') {
        setIsListening(true);
        setIsProcessing(false);
      } else if (data.state === 'TRANSCRIBING' || data.state === 'PROCESSING') {
        setIsListening(false);
        setIsProcessing(true);
      } else if (data.state === 'STANDBY') {
        setIsListening(false);
        setIsProcessing(false);
        setIsActive(false);
      }
    };

    const handleSessionUpdate = (event, data) => {
      setSessionData(data);
    };

    const handleError = (event, data) => {
      setIsProcessing(false);
      setAiResponse(`Terjadi kesalahan: ${data.message}`);
    };

    // Register listeners
    electron.ipcRenderer.on('voice:transcript', handleTranscript);
    electron.ipcRenderer.on('voice:interim', handleInterim);
    electron.ipcRenderer.on('voice:response', handleResponse);
    electron.ipcRenderer.on('voice:stateChange', handleStateChange);
    electron.ipcRenderer.on('session:update', handleSessionUpdate);
    electron.ipcRenderer.on('voice:error', handleError);

    return () => {
      electron.ipcRenderer.removeListener('voice:transcript', handleTranscript);
      electron.ipcRenderer.removeListener('voice:interim', handleInterim);
      electron.ipcRenderer.removeListener('voice:response', handleResponse);
      electron.ipcRenderer.removeListener('voice:stateChange', handleStateChange);
      electron.ipcRenderer.removeListener('session:update', handleSessionUpdate);
      electron.ipcRenderer.removeListener('voice:error', handleError);
    };
  }, [playAudio]);

  // Audio onended handler
  useEffect(() => {
    const player = audioPlayerRef.current;
    const handleEnded = () => {
      setIsPlaying(false);
      if (electron) {
        electron.ipcRenderer.invoke('voice:audioEnded');
      }
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
    // State
    isActive,
    isListening,
    isProcessing,
    isPlaying,
    systemState,
    transcript,
    interimTranscript,    // NEW: real-time streaming transcript
    aiResponse,
    phase,
    sessionData,
    lastAction,

    // Actions
    activate,
    deactivate,
    toggle,
    playAudio,
    sendKeyboardInput,
  };
}
