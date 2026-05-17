import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import speakAfterPageReady from '../../utils/speakAfterPageReady';

const electron = window.require ? window.require('electron') : null;

const ScanRfidPage = () => {
  const navigate = useNavigate();
  const [rfidValue, setRfidValue] = useState('');
  const [statusText, setStatusText] = useState('Tempelkan KTP pada Scanner Bawah');
  const [isProcessing, setIsProcessing] = useState(false);

  const inputRef = useRef(null);

  useEffect(() => {
    let cancelGreeting = null;
    // Announce instruction
    if (electron && !isProcessing) {
      cancelGreeting = speakAfterPageReady(electron, 'Tempelkan e-KTP Anda pada alat scanner sensor yang menyala di bawah layar.');
    }

    // Always ensure input is focused to catch the HID reader
    if (inputRef.current) {
      inputRef.current.focus();
    }

    // Global listener to force focus back if user randomly taps the screen
    const handleGlobalClick = () => {
      if (inputRef.current && !isProcessing) {
        inputRef.current.focus();
      }
    };
    window.addEventListener('click', handleGlobalClick);

    return () => {
      if (cancelGreeting) cancelGreeting();
      window.removeEventListener('click', handleGlobalClick);
      if (electron) electron.ipcRenderer.invoke('voice:stopSpeaking').catch(() => {});
    };
  }, [isProcessing]);

  // Handle hardware scanner input (Types fast and hits Enter)
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Mengambil nilai asli dari DOM langsung, bukan dari state React yang mungkin terlambat merender sinkronisasi
      let codeToProcess = e.currentTarget.value;
      // Hapus karakter invisible seperti spasi, enter, carriage return
      codeToProcess = codeToProcess.replace(/[\r\n\s]/g, '').trim().toUpperCase();
      
      if (codeToProcess) {
        processCode(codeToProcess);
      }
    }
  };

  const processCode = (code) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setStatusText('Memproses identitas e-KTP...');

    if (electron) {
      electron.ipcRenderer.invoke('voice:speakOnce', 'e-KTP terdeteksi. Mohon tunggu, sedang mencocokkan data bantuan sosial.').catch(() => {});
    }

    // Wait a brief moment for UX, then navigate to bansos result
    setTimeout(() => {
      navigate('/bansos', { state: { card_uid: code } });
    }, 2000);
  };

  return (
    <div className="page-enter barcode-page">
      <div className="absensi-header">
        <h2 className="page-title">Pengecekan Bansos</h2>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>
          {statusText}
        </p>
      </div>

      <div className="barcode-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '800px', margin: '0 auto', gap: '32px' }}>
        
        {/* RFID Card Animation Box */}
        <div style={{ margin: '40px 0', transform: 'scale(1.8)' }}>
          <div className="scanner-animation-box" style={{ 
              position: 'relative', 
              width: '280px', 
              height: '200px', 
              background: 'var(--bg-glass)', 
              border: '2px dashed rgba(16, 185, 129, 0.4)', 
              borderRadius: '20px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              overflow: 'visible',
              boxShadow: '0 8px 32px rgba(16, 185, 129, 0.1)'
          }}>
          {/* Internal CSS for RFID Animations */}
          <style>{`
            @keyframes rfWave {
              0% { transform: scale(1); opacity: 0.8; }
              100% { transform: scale(2.5); opacity: 0; }
            }
            @keyframes floatCard {
              0% { transform: translateY(0px) rotate(-5deg); }
              50% { transform: translateY(-10px) rotate(-5deg); }
              100% { transform: translateY(0px) rotate(-5deg); }
            }
          `}</style>
          
          {/* Signal Waves */}
          <div style={{ position: 'absolute', width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.2)', animation: 'rfWave 2s infinite ease-out' }}></div>
          <div style={{ position: 'absolute', width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.2)', animation: 'rfWave 2s infinite ease-out 1s' }}></div>

          {/* Aesthetic UI e-KTP Card */}
          <div style={{ position: 'relative', width: '140px', height: '90px', background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', zIndex: 10, animation: 'floatCard 3s infinite ease-in-out', display: 'flex', padding: '12px', boxSizing: 'border-box' }}>
             {/* Card Photo placeholder */}
             <div style={{ width: '30%', height: '100%', background: 'rgba(0,0,0,0.1)', borderRadius: '4px', marginRight: '10px' }}></div>
             {/* Text lines placeholder */}
             <div style={{ width: '60%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ height: '8px', background: 'var(--bg-glass)', borderRadius: '2px', width: '100%' }}></div>
                <div style={{ height: '6px', background: 'rgba(0,0,0,0.15)', borderRadius: '2px', width: '80%', marginTop: '4px' }}></div>
                <div style={{ height: '6px', background: 'rgba(0,0,0,0.15)', borderRadius: '2px', width: '90%' }}></div>
                <div style={{ height: '6px', background: 'rgba(0,0,0,0.15)', borderRadius: '2px', width: '60%' }}></div>
             </div>
          </div>
        </div>
        </div>

        {/* The HID Reader Target Input — Kept Invisible but Focusable */}
        <input
          ref={inputRef}
          type="text"
          value={rfidValue}
          onChange={(e) => setRfidValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isProcessing}
          style={{
            position: 'absolute',
            opacity: 0,
            pointerEvents: 'none',
            top: 0,
            left: 0
          }}
        />

        {/* Cancel Button */}
        {!isProcessing && (
          <div style={{ display: 'flex', gap: '16px', width: '100%', maxWidth: '500px', marginTop: '20px' }}>
            <button 
              style={{ 
                flex: 1, 
                background: 'rgb(239, 68, 68)', 
                border: 'none', 
                color: 'white',
                fontWeight: 700,
                borderRadius: '16px',
                padding: '16px 24px',
                fontSize: '16px',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                transition: 'all 0.2s ease',
              }}
              onClick={() => navigate('/')}
            >
              Batalkan
            </button>
            {/* Input Manual dipindahkan dari NIK Input ke Profil Warga agar data konsisten, tapi fallback ini diletakkan jika KTP tak bisa dibaca sama sekali */}
            <button 
              style={{ 
                flex: 1, 
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)', 
                border: 'none', 
                color: 'white',
                fontWeight: 700,
                borderRadius: '16px',
                padding: '16px 24px',
                fontSize: '16px',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                boxShadow: '0 4px 15px rgba(59, 130, 246, 0.4)',
                transition: 'all 0.2s ease',
              }}
              onClick={() => {
                  electron?.ipcRenderer.invoke('voice:speakOnce', 'Masukkan NIK anda secara manual').catch(() => {});
                  navigate('/input-nik', { state: { nextPath: '/bansos' } })
              }}
            >
              Input Manual NIK
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default ScanRfidPage;
