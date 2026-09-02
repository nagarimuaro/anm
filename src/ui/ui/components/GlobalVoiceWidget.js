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
const AI_ROUTE_RESPONSE_DELAY_MS = 350;

const normalizeVoicePath = (path) => {
  if (!path) return path;
  const normalized = String(path).trim().toLowerCase();
  const aliases = {
    '/pajak': '/scan-rfid-pajak',
    '/pbb': '/scan-rfid-pajak',
    '/cek-pajak': '/scan-rfid-pajak',
    '/pajak-pbb': '/scan-rfid-pajak',
    '/pajek': '/scan-rfid-pajak',
    '/pajek-pbb': '/scan-rfid-pajak',
    '/pajek-tanah': '/scan-rfid-pajak',
    '/bansos': '/scan-rfid',
    '/cek-bansos': '/scan-rfid',
    '/bantuan-sosial': '/scan-rfid',
    '/scan-bansos': '/scan-rfid',
    '/registrasi-ktp': '/registrasi-ektp',
    '/registrasi-rfid': '/registrasi-ektp',
    '/daftar-ektp': '/registrasi-ektp',
    '/daftar-ktp': '/registrasi-ektp',
    '/dapta-ktp': '/registrasi-ektp',
    '/cetak': '/scan-barcode',
    '/cetak-surat': '/scan-barcode',
    '/print-surat': '/scan-barcode',
    '/cetak-ulang': '/scan-barcode',
    '/cetak-ulang-surat': '/scan-barcode',
    '/mancetak-surek': '/scan-barcode',
    '/resi': '/scan-barcode',
    '/cek-resi': '/scan-barcode',
    '/scan-resi': '/scan-barcode',
    '/buku-tamu': '/buku-tamu',
    '/tamu': '/buku-tamu',
    '/isi-tamu': '/buku-tamu',
    '/surek': '/input-nik',
    '/mambuek-surek': '/input-nik',
    '/buek-surek': '/input-nik',
    '/verifikasi': '/verifikasi-surat',
    '/verifikasi-surat': '/verifikasi-surat',
    '/review-surat': '/verifikasi-surat',
    '/tinjau-surat': '/verifikasi-surat',
  };
  return aliases[normalized] || path;
};

const GlobalVoiceWidget = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const voice = useVoiceSession();
  // Track last handled timestamp to prevent duplicate navigation fires
  const lastHandledTimeRef = useRef(null);
  const previousPathRef = useRef(location.pathname);
  const pendingRouteReadyRef = useRef(null);
  const routeReadyTimerRef = useRef(null);
  const routeReadyFrameRef = useRef(null);

  const clearRouteReadyWait = React.useCallback(() => {
    if (routeReadyTimerRef.current) {
      clearTimeout(routeReadyTimerRef.current);
      routeReadyTimerRef.current = null;
    }
    if (routeReadyFrameRef.current) {
      cancelAnimationFrame(routeReadyFrameRef.current);
      routeReadyFrameRef.current = null;
    }
  }, []);

  const releaseRouteReady = React.useCallback(() => {
    clearRouteReadyWait();
    pendingRouteReadyRef.current = null;
    voice.resumeAiPlayback();
  }, [clearRouteReadyWait, voice.resumeAiPlayback]);

  const waitForRouteReady = React.useCallback((targetPath) => {
    clearRouteReadyWait();
    pendingRouteReadyRef.current = { targetPath, startedAt: Date.now() };
    voice.pauseAiPlayback('route-change');

    routeReadyTimerRef.current = setTimeout(() => {
      releaseRouteReady();
    }, AI_ROUTE_RESPONSE_DELAY_MS);
  }, [clearRouteReadyWait, releaseRouteReady, voice.pauseAiPlayback]);

  React.useEffect(() => {
    const previousPath = previousPathRef.current;
    const currentPath = location.pathname;

    if (previousPath !== '/' && currentPath === '/') {
      voice.resetConversation({ reactivate: false }).catch((error) => {
        console.error('Reset voice conversation failed:', error);
      });
    }

    // Kunci konteks AI sesuai halaman aktif
    if (electron) {
      electron.ipcRenderer.invoke('voice:setPageContext', currentPath).catch(() => {});
    }

    previousPathRef.current = currentPath;
  }, [location.pathname, voice.resetConversation]);

  React.useEffect(() => {
    const pending = pendingRouteReadyRef.current;
    if (!pending || location.pathname !== pending.targetPath) return;

    clearRouteReadyWait();
    routeReadyFrameRef.current = requestAnimationFrame(() => {
      routeReadyFrameRef.current = requestAnimationFrame(() => {
        routeReadyFrameRef.current = null;
        routeReadyTimerRef.current = setTimeout(() => {
          releaseRouteReady();
        }, AI_ROUTE_RESPONSE_DELAY_MS);
      });
    });
  }, [clearRouteReadyWait, location.pathname, releaseRouteReady]);

  React.useEffect(() => {
    return () => {
      clearRouteReadyWait();
      pendingRouteReadyRef.current = null;
    };
  }, [clearRouteReadyWait]);

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
          const targetPath = normalizeVoicePath(voice.lastPath);
          if (currentPath !== targetPath) {
            waitForRouteReady(targetPath);
            const isInputNik = targetPath === '/input-nik';
            navigate(targetPath, {
              state: {
                nextPath: voice.lastNextPath,
                fromVoice: isInputNik ? true : undefined,
                ...(voice.sessionData || {})
              }
            });
          } else {
            waitForRouteReady(targetPath);
          }
        } else if (voice.sessionData?.intent === 'CEK_BANSOS') {
          if (currentPath !== '/input-nik') {
            waitForRouteReady('/input-nik');
            navigate('/input-nik', { state: { nextPath: '/bansos', fromVoice: true } });
          }
        } else if (voice.sessionData?.intent === 'BUKU_TAMU') {
          if (currentPath !== '/buku-tamu') {
            waitForRouteReady('/buku-tamu');
            navigate('/buku-tamu');
          }
        } else if (voice.sessionData?.intent?.startsWith('BUAT_SURAT')) {
          if (currentPath !== '/input-nik' && currentPath !== '/profil-warga' && currentPath !== '/surat') {
            waitForRouteReady('/input-nik');
            navigate('/input-nik', { state: { nextPath: '/profil-warga', fromVoice: true } });
          }
        }
        break;
      }

      case 'REQUEST_KEYBOARD': {
        if (currentPath !== '/input-nik') {
          waitForRouteReady('/input-nik');
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
          waitForRouteReady('/printing');
          navigate('/printing', { state: { result: voice.sessionData } });
        }
        break;
      }

      case 'ASK_SLOT':
      case 'RETRY_SLOT':
      case 'SUGGEST_KEYBOARD': {
        if (voice.lastAction === 'SUGGEST_KEYBOARD') {
          if (currentPath !== '/input-nik') {
            waitForRouteReady('/input-nik');
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
          waitForRouteReady('/surat');
          navigate('/surat', { state: { nik: nik || '' } });
        }
        break;
      }

      case 'CONFIRM_DATA': {
        if (currentPath !== '/surat') {
          const nik = voice.sessionData?.slots?.nik;
          waitForRouteReady('/surat');
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
  }, [voice.lastActionTime, voice.lastAction, waitForRouteReady]);

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
