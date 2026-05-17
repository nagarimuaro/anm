import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import speakAfterPageReady from '../../utils/speakAfterPageReady';

const electron = window.require ? window.require('electron') : null;
const CODE_MAX_LENGTH = 12;

const cleanCode = (value) => String(value || '').replace(/\D/g, '').slice(0, CODE_MAX_LENGTH);
const cleanCardUid = (value) => String(value || '').replace(/[\r\n\s]/g, '').trim().toUpperCase();

const RegisterEktpPage = () => {
  const navigate = useNavigate();
  const [registrationCode, setRegistrationCode] = useState('');
  const [registrationData, setRegistrationData] = useState(null);
  const [resultData, setResultData] = useState(null);
  const [rfidValue, setRfidValue] = useState('');
  const [step, setStep] = useState('code');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const hasGreetedRef = useRef(false);

  useEffect(() => {
    if (hasGreetedRef.current) return undefined;
    hasGreetedRef.current = true;

    if (electron) {
      return speakAfterPageReady(
        electron,
        'Silakan masukkan kode registrasi yang diberikan oleh petugas.'
      );
    }

    return undefined;
  }, []);

  useEffect(() => {
    if (step !== 'scan') return undefined;

    if (inputRef.current) {
      inputRef.current.focus();
    }

    const handleGlobalClick = () => {
      if (inputRef.current && !loading) {
        inputRef.current.focus();
      }
    };

    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, [step, loading]);

  useEffect(() => {
    return () => {
      if (electron) electron.ipcRenderer.invoke('voice:stopSpeaking').catch(() => {});
    };
  }, []);

  const speak = (message) => {
    if (electron) {
      electron.ipcRenderer.invoke('voice:speakOnce', message).catch(() => {});
    }
  };

  const validateCode = async () => {
    const code = cleanCode(registrationCode);
    if (code.length < 4 || loading) return;

    setLoading(true);
    setError('');

    try {
      if (!electron) {
        throw new Error('Aplikasi harus berjalan di Electron untuk terhubung ke perangkat.');
      }

      const response = await electron.ipcRenderer.invoke('kiosk:api:validateEktpRegistrationCode', code);
      if (!response?.success) {
        throw new Error(response?.message || 'Kode registrasi tidak valid.');
      }

      setRegistrationCode(code);
      setRegistrationData(response.data || {});
      setStep('scan');
      setRfidValue('');
      speak(response.message || 'Kode valid. Silakan tempelkan e-KTP atau RFID ke ANM.');
    } catch (err) {
      setError(err.message || 'Gagal memvalidasi kode registrasi.');
      speak('Kode registrasi tidak dapat diproses. Silakan periksa kembali.');
    } finally {
      setLoading(false);
    }
  };

  const registerCard = async (cardUid) => {
    if (!cardUid || loading) return;

    setLoading(true);
    setError('');

    try {
      if (!electron) {
        throw new Error('Aplikasi harus berjalan di Electron untuk membaca RFID.');
      }

      const response = await electron.ipcRenderer.invoke('kiosk:api:registerEktpCard', {
        code: registrationCode,
        card_uid: cardUid,
        card_type: 'KTP',
      });

      if (!response?.success) {
        throw new Error(response?.message || 'Kartu gagal didaftarkan.');
      }

      setResultData(response.data || { card_uid: cardUid, ...registrationData?.warga });
      setStep('success');
      speak(response.message || 'Kartu berhasil didaftarkan dan dihubungkan ke warga.');
    } catch (err) {
      setError(err.message || 'Gagal mendaftarkan kartu.');
      setRfidValue('');
      speak('Kartu belum berhasil didaftarkan. Silakan tempelkan ulang e-KTP.');
      setTimeout(() => inputRef.current?.focus(), 80);
    } finally {
      setLoading(false);
    }
  };

  const cancelRegistration = async () => {
    if (!registrationCode || step !== 'scan' || !electron) return;

    try {
      await electron.ipcRenderer.invoke('kiosk:api:cancelEktpRegistration', registrationCode);
    } catch (err) {
      console.warn('Cancel e-KTP registration failed:', err.message);
    }
  };

  const handleChangeCode = async () => {
    if (loading) return;

    await cancelRegistration();
    setRegistrationData(null);
    setRfidValue('');
    setError('');
    setStep('code');
  };

  const handleBack = async () => {
    if (loading) return;

    await cancelRegistration();
    navigate('/');
  };

  const handleRfidKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const cardUid = cleanCardUid(event.currentTarget.value);
    if (cardUid) {
      registerCard(cardUid);
    }
  };

  const handleKeyPress = (key) => {
    if (loading) return;

    if (key === 'OK') {
      validateCode();
      return;
    }

    if (key === 'BACK') {
      setRegistrationCode((current) => current.slice(0, -1));
      setError('');
      return;
    }

    setRegistrationCode((current) => cleanCode(`${current}${key}`));
    setError('');
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'BACK', '0', 'OK'];
  const warga = registrationData?.warga || {};
  const result = resultData || {};

  return (
    <div className="page-enter" style={{ width: '100%', maxWidth: 920, margin: '0 auto', textAlign: 'center' }}>
      <div className="glass-card" style={{ padding: '36px 28px', overflow: 'hidden', position: 'relative' }}>
        <div style={{
          height: 6,
          background: 'linear-gradient(135deg, #0ea5e9, #22c55e)',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
        }} />

        <h2 className="page-title">Registrasi e-KTP</h2>
        <p className="page-subtitle" style={{ marginBottom: 28 }}>
          {step === 'code' && 'Masukkan kode unik yang diberikan oleh petugas'}
          {step === 'scan' && 'Kode valid. Tempelkan e-KTP atau RFID pada scanner'}
          {step === 'success' && 'Kartu berhasil didaftarkan'}
        </p>

        {step === 'code' && (
          <>
            <input
              type="text"
              className="nik-input"
              value={registrationCode}
              readOnly
              placeholder="Kode registrasi"
              style={{ letterSpacing: 6, maxWidth: 420 }}
            />

            {error && (
              <p style={{ color: 'var(--accent-danger)', fontSize: 14, marginTop: 12 }}>{error}</p>
            )}

            {loading ? (
              <div style={{ marginTop: 28 }}>
                <div className="shimmer" style={{ width: 220, height: 52, borderRadius: 12, margin: '0 auto' }} />
                <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 14 }}>Memvalidasi kode...</p>
              </div>
            ) : (
              <div className="keyboard-container" style={{ marginTop: 32, maxWidth: 500 }}>
                {keys.map((key) => (
                  <button
                    key={key}
                    className={`key-btn ${key === 'OK' || key === 'BACK' ? 'action' : ''}`}
                    onClick={() => handleKeyPress(key)}
                    disabled={key === 'OK' && registrationCode.length < 4}
                    style={key === 'OK' && registrationCode.length < 4 ? { opacity: 0.4 } : {}}
                  >
                    {key === 'BACK' ? '←' : key}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {step === 'scan' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 16,
              width: '100%',
              textAlign: 'left',
            }}>
              {[
                ['Nama', warga.nama || '-'],
                ['NIK', warga.nik_mask || '-'],
                ['Jorong', warga.jorong || '-'],
              ].map(([label, value]) => (
                <div key={label} style={{ background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16 }}>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 6 }}>{label}</p>
                  <p style={{ color: 'white', fontWeight: 700, fontSize: 16, lineHeight: 1.35 }}>{value}</p>
                </div>
              ))}
            </div>

            <div style={{
              width: 420,
              height: 300,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '44px 0 32px',
            }}>
              <div style={{
                position: 'relative',
                width: 280,
                height: 200,
                transform: 'scale(1.5)',
                background: 'var(--bg-glass)',
                border: '2px dashed rgba(34, 197, 94, 0.45)',
                borderRadius: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'visible',
                boxShadow: '0 8px 32px rgba(34, 197, 94, 0.12)',
              }}>
                <style>{`
                  @keyframes registerRfWave {
                    0% { transform: scale(1); opacity: 0.8; }
                    100% { transform: scale(2.5); opacity: 0; }
                  }
                  @keyframes registerFloatCard {
                    0% { transform: translateY(0) rotate(-5deg); }
                    50% { transform: translateY(-10px) rotate(-5deg); }
                    100% { transform: translateY(0) rotate(-5deg); }
                  }
                `}</style>
                <div style={{ position: 'absolute', width: 80, height: 80, borderRadius: '50%', background: 'rgba(34, 197, 94, 0.2)', animation: 'registerRfWave 2s infinite ease-out' }} />
                <div style={{ position: 'absolute', width: 80, height: 80, borderRadius: '50%', background: 'rgba(14, 165, 233, 0.18)', animation: 'registerRfWave 2s infinite ease-out 1s' }} />
                <div style={{ position: 'relative', width: 140, height: 90, background: 'linear-gradient(135deg, #f8fafc 0%, #cbd5e1 100%)', borderRadius: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.5)', zIndex: 10, animation: 'registerFloatCard 3s infinite ease-in-out', display: 'flex', padding: 12, boxSizing: 'border-box' }}>
                  <div style={{ width: '30%', height: '100%', background: 'rgba(0,0,0,0.1)', borderRadius: 4, marginRight: 10 }} />
                  <div style={{ width: '60%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ height: 8, background: 'rgba(14, 165, 233, 0.25)', borderRadius: 2, width: '100%' }} />
                    <div style={{ height: 6, background: 'rgba(0,0,0,0.15)', borderRadius: 2, width: '80%', marginTop: 4 }} />
                    <div style={{ height: 6, background: 'rgba(0,0,0,0.15)', borderRadius: 2, width: '90%' }} />
                    <div style={{ height: 6, background: 'rgba(0,0,0,0.15)', borderRadius: 2, width: '60%' }} />
                  </div>
                </div>
              </div>
            </div>

            <input
              ref={inputRef}
              type="text"
              value={rfidValue}
              onChange={(event) => setRfidValue(event.target.value)}
              onKeyDown={handleRfidKeyDown}
              disabled={loading}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', top: 0, left: 0 }}
            />

            {loading && <p style={{ color: 'var(--accent-info)', fontWeight: 700 }}>Mendaftarkan kartu...</p>}
            {error && <p style={{ color: 'var(--accent-danger)', fontSize: 14 }}>{error}</p>}
          </div>
        )}

        {step === 'success' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
            <div style={{
              width: 92,
              height: 92,
              borderRadius: '50%',
              background: 'rgba(52, 211, 153, 0.16)',
              border: '1px solid rgba(52, 211, 153, 0.45)',
              color: '#34d399',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 52,
              fontWeight: 800,
            }}>
              ✓
            </div>

            <div style={{ width: '100%', maxWidth: 620, textAlign: 'left', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24 }}>
              {[
                ['Nama', result.nama || '-'],
                ['NIK', result.nik_mask || '-'],
                ['Jorong', result.jorong || '-'],
                ['UID Kartu', result.card_uid || '-'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 18, padding: '12px 0', borderBottom: label === 'UID Kartu' ? 'none' : '1px solid rgba(255,255,255,0.08)' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <strong style={{ color: 'white', textAlign: 'right' }}>{value}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 28, flexWrap: 'wrap' }}>
        {step === 'scan' && !loading && (
          <button 
            style={{ 
              background: '#1e3a5f', border: '2px solid #3b82f6', color: '#93c5fd',
              fontWeight: 700, borderRadius: '12px', padding: '14px 28px', fontSize: '16px',
              cursor: 'pointer', fontFamily: 'var(--font-body)', transition: 'all 0.2s ease',
            }}
            onClick={handleChangeCode}
          >
            Ganti Kode
          </button>
        )}
        <button 
          style={{ 
            background: step === 'success' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgb(239, 68, 68)',
            border: step === 'success' ? 'none' : 'none',
            color: 'white',
            fontWeight: 700, borderRadius: '12px', padding: '14px 28px', fontSize: '16px',
            cursor: 'pointer', fontFamily: 'var(--font-body)', transition: 'all 0.2s ease',
            boxShadow: step === 'success' ? '0 4px 15px rgba(99, 102, 241, 0.4)' : 'none',
          }}
          onClick={handleBack}
        >
          {step === 'success' ? 'Selesai' : 'Kembali'}
        </button>
      </div>
    </div>
  );
};

export default RegisterEktpPage;
