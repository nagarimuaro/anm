/**
 * GlobalVoiceWidget — Always-Listening Voice Assistant UI
 * Composable: uses useVoiceSession hook for logic
 * 
 * STREAMING: Menampilkan interim transcript real-time
 * Sync navigation: Fase AI → halaman UI yang sesuai
 */
import React, { useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useVoiceSession from '../hooks/useVoiceSession';
import SintaOrb from './SintaOrb';

const electron = window.require ? window.require('electron') : null;

const GlobalVoiceWidget = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const voice = useVoiceSession();
  // Track last handled timestamp to prevent duplicate navigation fires
  const lastHandledTimeRef = useRef(null);

  // Handle navigation actions from AI — keyed on lastActionTime to prevent re-firing
  React.useEffect(() => {
    if (!voice.lastAction) return;
    if (voice.lastAction === 'TTS_ONLY') return;

    // Deduplicate: skip if we already handled this exact action event
    const eventTime = voice.lastActionTime;
    if (eventTime && eventTime === lastHandledTimeRef.current) return;
    lastHandledTimeRef.current = eventTime;

    const currentPath = location.pathname;

    switch (voice.lastAction) {
      case 'NAVIGATE': {
        if (voice.lastPath) {
          if (currentPath !== voice.lastPath) {
            const isInputNik = voice.lastPath === '/input-nik';
            navigate(voice.lastPath, {
              state: {
                nextPath: voice.lastNextPath,
                fromVoice: isInputNik ? true : undefined,
                ...(voice.sessionData || {})
              }
            });
          }
        } else if (voice.sessionData?.intent === 'CEK_BANSOS') {
          if (currentPath !== '/input-nik') {
            navigate('/input-nik', { state: { nextPath: '/bansos', fromVoice: true } });
          }
        } else if (voice.sessionData?.intent === 'BUKU_TAMU') {
          if (currentPath !== '/buku-tamu') {
            navigate('/buku-tamu');
          }
        } else if (voice.sessionData?.intent?.startsWith('BUAT_SURAT')) {
          if (currentPath !== '/input-nik' && currentPath !== '/profil-warga' && currentPath !== '/surat') {
            navigate('/input-nik', { state: { nextPath: '/profil-warga', fromVoice: true } });
          }
        }
        break;
      }

      case 'REQUEST_KEYBOARD': {
        if (currentPath !== '/input-nik') {
          navigate('/input-nik', {
            state: {
              nextPath: '/profil-warga',
              slotKey: voice.sessionData?.current_slot,
              fromVoice: true,
            }
          });
        }
        break;
      }

      case 'SHOW_RECEIPT':
      case 'PROCESSING': {
        if (currentPath !== '/printing') {
          navigate('/printing', { state: { result: voice.sessionData } });
        }
        break;
      }

      case 'ASK_SLOT':
      case 'RETRY_SLOT':
      case 'SUGGEST_KEYBOARD': {
        if (voice.lastAction === 'SUGGEST_KEYBOARD') {
          if (currentPath !== '/input-nik') {
            navigate('/input-nik', {
              state: {
                nextPath: '/profil-warga',
                slotKey: voice.sessionData?.current_slot,
                fromVoice: true,
              }
            });
          }
        } else if (currentPath !== '/surat' && currentPath !== '/input-nik' && currentPath !== '/profil-warga') {
          const nik = voice.sessionData?.slots?.nik;
          navigate('/surat', { state: { nik: nik || '' } });
        }
        break;
      }

      case 'CONFIRM_DATA': {
        if (currentPath !== '/surat') {
          const nik = voice.sessionData?.slots?.nik;
          navigate('/surat', { state: { nik: nik || '' } });
        }
        break;
      }

      case 'GREETING':
      case 'GENERAL_RESPONSE':
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.lastActionTime, voice.lastAction]);

  // Determine what text to show — interim (live) or final
  const displayTranscript = voice.interimTranscript || voice.transcript;

  // Determine FAB state
  const fabState = voice.isConnecting ? 'connecting'
    : voice.isPlaying ? 'playing'
      : voice.isProcessing ? 'processing'
        : voice.isListening ? 'listening'
          : 'idle';

  const fabIcon = voice.isConnecting ? '⏳'
    : voice.isPlaying ? '🔊'
      : voice.isProcessing ? '⚙️'
        : voice.isListening ? '🎤'
          : '🎤';

  return (
    <div className="voice-widget">
      {/* Chat Bubble */}
      {(displayTranscript || voice.aiResponse || voice.isConnecting) && (
        <div className="voice-bubble">
          {voice.isConnecting && (
            <div className="voice-bubble-system">
              🔌 Menyambungkan ke Gemini...
            </div>
          )}
          {displayTranscript && !voice.isConnecting && (
            <div className={`voice-bubble-user ${voice.interimTranscript ? 'interim' : ''}`}>
              🗣️ "{displayTranscript}"
              {voice.interimTranscript && <span className="interim-indicator">...</span>}
            </div>
          )}
          {voice.aiResponse && !voice.isConnecting && (
            <div className="voice-bubble-ai">
              🤖 {voice.aiResponse}
            </div>
          )}
        </div>
      )}

      {/* Phase Indicator */}
      {voice.phase && voice.isActive && (
        <PhaseIndicator phase={voice.phase} />
      )}

      {/* FAB Button */}
      <button
        className={`voice-fab ${fabState}`}
        onClick={() => {
          // Jika akan mengaktifkan voice, keluar dari manual mode dulu
          const electronApi = window.require ? window.require('electron') : null;
          if (!voice.isActive && electronApi) {
            electronApi.ipcRenderer.invoke('voice:exitManualMode');
          }
          voice.toggle();
        }}
        title={voice.isActive ? 'Matikan Asisten' : 'Aktifkan Asisten'}
      >
        <SintaOrb
          size={80}
          state={
            !voice.isActive ? 'idle' :
              voice.isConnecting ? 'connecting' :
                voice.isPlaying ? 'playing' :
                  voice.isProcessing ? 'processing' :
                    voice.isListening ? 'listening' : 'idle'
          }
        />
      </button>
    </div>
  );
};

/**
 * Phase Indicator — shows current phase of 6-phase flow
 */
const PhaseIndicator = ({ phase }) => {
  const phases = [
    { key: 'GREETING', label: '👋' },
    { key: 'INTENT', label: '🎯' },
    { key: 'SLOT_FILLING', label: '📝' },
    { key: 'CONFIRMATION', label: '✅' },
    { key: 'EXECUTING', label: '⚙️' },
    { key: 'DONE', label: '🎉' },
  ];

  const currentIdx = phases.findIndex(p => p.key === phase);

  return (
    <div className="phase-bar">
      {phases.map((p, i) => (
        <React.Fragment key={p.key}>
          <div className={`phase-step ${i === currentIdx ? 'active' : ''} ${i < currentIdx ? 'done' : ''}`}>
            {i < currentIdx ? '✓' : p.label}
          </div>
          {i < phases.length - 1 && (
            <div className={`phase-connector ${i < currentIdx ? 'done' : ''}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default GlobalVoiceWidget;
