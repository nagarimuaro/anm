import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import speakAfterPageReady from '../../utils/speakAfterPageReady';

const electron = window.require ? window.require('electron') : null;

const ScanRfidPajakPage = () => {
  const navigate = useNavigate();
  const [nopValue, setNopValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    let cancelGreeting = null;
    if (electron && !isProcessing) {
      cancelGreeting = speakAfterPageReady(electron, 'Untuk mengecek Pajak P B B Anda, silakan masukkan 18 digit Nomor Objek Pajak menggunakan keypad di layar.');
    }
    return () => {
      if (cancelGreeting) cancelGreeting();
      if (electron) electron.ipcRenderer.invoke('voice:stopSpeaking').catch(() => {});
    };
  }, [isProcessing]);

  const formatNOP = (val) => {
    if (!val) return '';
    let res = '';
    for (let i = 0; i < val.length; i++) {
      if (i === 2 || i === 4 || i === 7 || i === 10 || i === 17) res += '.';
      else if (i === 13) res += '-';
      res += val[i];
    }
    return res;
  };

  const handleKeyPress = (key) => {
    if (key === 'CEK') {
      if (nopValue.length === 18) {
        processCode();
      }
    } else if (key === '←') {
      setNopValue(nopValue.slice(0, -1));
    } else {
      if (nopValue.length < 18) {
        setNopValue(nopValue + key);
      }
    }
  };

  const processCode = () => {
    if (nopValue.length === 0) return;
    if (isProcessing) return;
    setIsProcessing(true);

    if (electron) {
      electron.ipcRenderer.invoke('voice:speakOnce', 'Mohon tunggu, sedang memeriksa data Pajak Bumi dan Bangunan Anda.').catch(() => {});
    }

    // Wait a brief moment for UX, then navigate to result page
    setTimeout(() => {
      alert(`Fitur integrasi PBB untuk NOP ${nopValue} sedang dalam tahap pengembangan!`);
      navigate('/');
    }, 2000);
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', 'CEK'];

  return (
    <div className="page-enter" style={{ textAlign: 'center', width: '100%', maxWidth: 800, margin: '0 auto' }}>
      <div className="glass-card" style={{ padding: '40px 24px', overflow: 'hidden', position: 'relative' }}>
        <div style={{
          height: 6,
          background: 'var(--gradient-accent)',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
        }} />
        <h2 className="page-title">Pengecekan Pajak PBB</h2>
        <p className="page-subtitle">Masukkan 18 digit Nomor Objek Pajak</p>

        <input
          type="text"
          className="nik-input"
          value={formatNOP(nopValue)}
          readOnly
          placeholder="__________________"
          style={{ letterSpacing: nopValue ? '2px' : 'normal' }}
        />

        {/* NOP Progress Dots */}
        <div className="nik-progress" style={{ gridTemplateColumns: 'repeat(18, 1fr)' }}>
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className={`nik-digit ${i < nopValue.length ? 'filled' : ''}`} />
          ))}
        </div>

        {isProcessing ? (
          <div style={{ marginTop: 24 }}>
            <div className="shimmer" style={{ width: 200, height: 48, borderRadius: 12, margin: '0 auto' }} />
            <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 14 }}>Memproses data PBB...</p>
          </div>
        ) : (
          <div className="keyboard-container" style={{ marginTop: '32px', maxWidth: '500px', margin: '32px auto 0' }}>
            {keys.map((key) => (
              <button
                key={key}
                className={`key-btn ${key === 'CEK' || key === '←' ? 'action' : ''}`}
                onClick={() => handleKeyPress(key)}
                disabled={key === 'CEK' && nopValue.length < 18}
                style={key === 'CEK' && nopValue.length < 18 ? { opacity: 0.4 } : {}}
              >
                {key}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        className="btn btn-secondary"
        style={{ marginTop: '32px' }}
        onClick={() => navigate('/')}
        disabled={isProcessing}
      >
        ← Kembali
      </button>
    </div>
  );
};

export default ScanRfidPajakPage;
