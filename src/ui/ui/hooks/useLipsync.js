import { useEffect, useRef } from 'react';

const electron = window.require ? window.require('electron') : null;

// Helper function to decode base64 to Int16Array
function decodeBase64Pcm(base64Str) {
  const binaryString = window.atob(base64Str);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

// Helper to calculate RMS (Root Mean Square)
function calculateRMS(int16Array) {
  let sumSq = 0;
  for (let i = 0; i < int16Array.length; i++) {
    sumSq += int16Array[i] * int16Array[i];
  }
  return Math.sqrt(sumSq / int16Array.length);
}

const useLipsync = () => {
  const visemeRef = useRef('idle');
  const smoothedRmsRef = useRef(0);
  const idleTimeoutRef = useRef(null);

  useEffect(() => {
    if (!electron) return;

    let toggleViseme = false; // to alternate between similar visemes

    const handleAudioStream = (event, data) => {
      if (data && data.audioData) {
        // Clear idle timeout since we are receiving audio
        if (idleTimeoutRef.current) {
          clearTimeout(idleTimeoutRef.current);
          idleTimeoutRef.current = null;
        }

        try {
          const pcmData = decodeBase64Pcm(data.audioData);
          const currentRms = calculateRMS(pcmData);
          
          // Exponential smoothing to avoid jitter
          smoothedRmsRef.current = smoothedRmsRef.current * 0.6 + currentRms * 0.4;
          const rms = smoothedRmsRef.current;

          // Mapping RMS to Viseme (Thresholds tuned for Gemini's 24kHz PCM)
          let newViseme = 'idle';
          if (rms > 1500) {
            newViseme = 'A';
          } else if (rms > 700) {
            newViseme = toggleViseme ? 'A' : 'O';
            toggleViseme = !toggleViseme;
          } else if (rms > 300) {
            newViseme = toggleViseme ? 'E' : 'U';
            toggleViseme = !toggleViseme;
          } else if (rms > 80) {
            newViseme = 'I';
          } else {
            newViseme = 'idle';
          }

          visemeRef.current = newViseme;

          // Set a debounce timeout to return to idle after audio stops
          idleTimeoutRef.current = setTimeout(() => {
            visemeRef.current = 'idle';
            smoothedRmsRef.current = 0;
          }, 200);

        } catch (error) {
          console.error("Error processing audio for lipsync:", error);
        }
      }
    };

    electron.ipcRenderer.on('voice:audio_stream', handleAudioStream);

    return () => {
      electron.ipcRenderer.removeListener('voice:audio_stream', handleAudioStream);
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
    };
  }, []);

  return visemeRef;
};

export default useLipsync;
