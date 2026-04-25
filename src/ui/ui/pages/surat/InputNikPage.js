/**
 * InputNikPage — Halaman input NIK dengan virtual keyboard
 * 
 * Flow: Input NIK (16 digit) → OK → Profil Warga
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

const InputNikPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [nik, setNik] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const nextPath = location.state?.nextPath || '/profil-warga';
  const slotKey = location.state?.slotKey;
  const fromVoice = location.state?.fromVoice;
  const hasGreetedRef = useRef(false);

  // Sambutan saat halaman dibuka
  useEffect(() => {
    if (hasGreetedRef.current || fromVoice) return; // jangan ganggu jika dari voice AI
    hasGreetedRef.current = true;
    if (electron) {
      electron.ipcRenderer.invoke(
        'voice:speakOnce',
        'Silakan masukkan 16 digit Nomor Induk Kependudukan Anda menggunakan keypad di layar.'
      ).catch(() => {});
    }
  }, []);

  const handleKeyPress = async (key) => {
    if (key === 'OK') {
      if (nik.length >= 16) {
        setLoading(true);
        setError('');

        try {
          if (fromVoice && slotKey && electron) {
            // Kirim NIK ke slot filling engine via voice system
            await electron.ipcRenderer.invoke('voice:keyboardInput', { slotKey, value: nik });
          } else if (fromVoice) {
            // User masuk dari voice AI (navigate_to_page) — JANGAN matikan AI
            // Langsung navigasi ke profil warga, biarkan voice tetap aktif
          } else if (electron) {
            // User masuk manual (bukan dari voice) — matikan AI di background
            await electron.ipcRenderer.invoke('voice:enterManualMode');
          }

          // Selalu navigasi ke profil warga dulu
          navigate(nextPath, { state: { nik, fromVoice: !!fromVoice } });
        } catch (err) {
          setError('Terjadi kesalahan. Silakan coba lagi.');
          setLoading(false);
        }
      }
    } else if (key === '←') {
      setNik(nik.slice(0, -1));
      setError('');
    } else {
      if (nik.length < 16) {
        setNik(nik + key);
        setError('');
      }
    }
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', 'OK'];

  return (
    <div className="page-enter" style={{ textAlign: 'center' }}>
      <h2 className="page-title">Masukkan NIK Anda</h2>
      <p className="page-subtitle">Ketik 16 digit Nomor Induk Kependudukan</p>

      <input
        type="text"
        className="nik-input"
        value={nik}
        readOnly
        placeholder="________________"
      />

      {/* NIK Progress Dots */}
      <div className="nik-progress">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className={`nik-digit ${i < nik.length ? 'filled' : ''}`} />
        ))}
      </div>

      {error && (
        <p style={{ color: 'var(--accent-danger)', fontSize: 14, marginTop: 12 }}>{error}</p>
      )}

      {loading ? (
        <div style={{ marginTop: 24 }}>
          <div className="shimmer" style={{ width: 200, height: 48, borderRadius: 12, margin: '0 auto' }} />
          <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 14 }}>Mencari data warga...</p>
        </div>
      ) : (
        <div className="keyboard-container" style={{ marginTop: '24px' }}>
          {keys.map((key) => (
            <button
              key={key}
              className={`key-btn ${key === 'OK' || key === '←' ? 'action' : ''}`}
              onClick={() => handleKeyPress(key)}
              disabled={key === 'OK' && nik.length < 16}
              style={key === 'OK' && nik.length < 16 ? { opacity: 0.4 } : {}}
            >
              {key}
            </button>
          ))}
        </div>
      )}

      <button
        className="btn btn-secondary"
        style={{ marginTop: '32px' }}
        onClick={() => navigate('/')}
      >
        ← Kembali
      </button>
    </div>
  );
};

export default InputNikPage;
