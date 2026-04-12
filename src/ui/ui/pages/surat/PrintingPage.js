import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

const PrintingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { result } = location.state || {}; // Warga detail omitted as requested
  const resi = result?.kode_resi || 'DOC-READY';
  
  const [isDone, setIsDone] = useState(false);
  const hasSynthesized = useRef(false);

  useEffect(() => {
    // Narrate processing — ONLY ONCE
    if (!hasSynthesized.current && electron) {
      hasSynthesized.current = true;
      electron.ipcRenderer.invoke('voice:synthesize',
        'Mohon tunggu, surat Anda sedang dicetak di laci bawah.'
      );
    }

    // Finish printing after 6 seconds
    const doneTimer = setTimeout(() => {
      setIsDone(true);
      if (electron) {
        electron.ipcRenderer.invoke('voice:synthesize',
          `Surat telah dicetak. Kode resi Anda adalah ${resi}. Silakan ambil dokumen Anda. Mesin akan kembali ke layar utama.`
        );
      }
    }, 6000);

    // Auto-navigate home after 14 seconds
    const finalTimer = setTimeout(() => navigate('/'), 14000);

    return () => {
      clearTimeout(doneTimer);
      clearTimeout(finalTimer);
    };
  }, []);

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <h2 className="page-title" style={{ marginBottom: '40px' }}>
        {isDone ? 'Pencetakan Selesai' : 'Mencetak Dokumen...'}
      </h2>

      {/* Printer Animation Wrap */}
      <div style={{ position: 'relative', width: '200px', height: '240px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Paper Ejecting (Translates down over time indefinitely until done) */}
        <div style={{
          width: '120px', 
          height: '140px', 
          background: 'white', 
          borderRadius: '4px',
          padding: '12px',
          color: 'black',
          position: 'absolute',
          top: '20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          zIndex: 1,
          animation: isDone ? 'none' : 'paperEject 2s infinite ease-in-out',
          transform: isDone ? 'translateY(80px)' : 'none'
        }}>
          <div style={{ width: '80%', height: '4px', background: '#ccc', marginBottom: '8px' }} />
          <div style={{ width: '100%', height: '4px', background: '#ccc', marginBottom: '8px' }} />
          <div style={{ width: '60%', height: '4px', background: '#ccc', marginBottom: '16px' }} />
          
          <div style={{ fontSize: '10px', color: '#666', fontWeight: 'bold' }}>KODE RESI</div>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#111', textAlign: 'center', marginTop: '4px', border: '2px dashed #888', padding: '6px', width: '100%' }}>
            {resi}
          </div>
        </div>

        {/* Printer Body (In front of paper) */}
        <div style={{
          width: '200px',
          height: '80px',
          background: '#334155',
          borderRadius: '16px 16px 8px 8px',
          position: 'absolute',
          bottom: '20px',
          zIndex: 2,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          borderTop: '4px solid #475569',
          display: 'flex',
          justifyContent: 'center'
        }}>
          {/* Printer Output Slot */}
          <div style={{ width: '140px', height: '8px', background: '#0f172a', marginTop: '12px', borderRadius: '4px' }} />
          
          {/* Status Light */}
          <div style={{
            position: 'absolute',
            right: '20px',
            top: '20px',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isDone ? '#10b981' : '#3b82f6',
            boxShadow: isDone ? '0 0 10px #10b981' : '0 0 10px #3b82f6',
            animation: isDone ? 'none' : 'blinkLight 1s infinite alternate'
          }} />
        </div>
      </div>

      <p style={{ color: 'var(--text-secondary)', marginTop: '20px', fontSize: '18px' }}>
        {isDone ? 'Silakan ambil dokumen Anda di laci bawah printer.' : 'Jangan tinggalkan area mesin pencetak.'}
      </p>

      {/* Internal Keyframes for this page */}
      <style>{`
        @keyframes paperEject {
          0% { transform: translateY(0); opacity: 0; }
          20% { opacity: 1; }
          80% { transform: translateY(80px); opacity: 1; }
          100% { transform: translateY(100px); opacity: 0; }
        }
        @keyframes blinkLight {
          0% { opacity: 0.4; filter: brightness(0.5); }
          100% { opacity: 1; filter: brightness(1.5); }
        }
      `}</style>
    </div>
  );
};

export default PrintingPage;
