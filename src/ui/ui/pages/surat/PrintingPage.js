import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

const PrintingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { result } = location.state || {};

  // Helper untuk membersihkan prefix base64 jika ada
  const getSafeImageSrc = (base64) => {
    if (!base64) return null;
    if (base64.startsWith('data:image')) return base64;
    return `data:image/png;base64,${base64}`;
  };

  // Ambil dari result langsung (Voice AI mode) ATAU dari result.receipt (Manual mode)
  const dataResi = result?.receipt || result || {};

  const resi = dataResi.tracking_code || dataResi.kode_resi || 'RESI-UNIK';
  const pdfUrl = dataResi.pdf_url || null;
  const qrBase64 = dataResi.tracking_qr_base64 || dataResi.qr_base64 || null;
  const safeQrSrc = getSafeImageSrc(qrBase64);

  const [isDone, setIsDone] = useState(false);
  const [printStatus, setPrintStatus] = useState('idle'); // idle | downloading | printing | done | error
  const [printError, setPrintError] = useState('');
  const hasSynthesized = useRef(false);

  const warga = location.state?.warga;
  const fromVoice = location.state?.fromVoice || false;
  const hasFarewellSpoken = useRef(false);

  // Sinta berbicara saat halaman printing terbuka
  useEffect(() => {
    if (hasFarewellSpoken.current) return;
    hasFarewellSpoken.current = true;

    const speakFarewell = async () => {
      if (!electron) return;

      // Tunggu sebentar agar halaman render dulu
      await new Promise(r => setTimeout(r, 800));

      const nama = warga?.nama ? warga.nama.split(' ')[0] : 'ya';
      const farewellText = resi && resi !== 'RESI-UNIK'
        ? `Pengajuan surat Anda telah berhasil, ${nama}! Nomor resi Anda adalah ${resi.replace(/-/g, ' ')}. Silakan simpan atau foto nomor resi tersebut. Terima kasih sudah menggunakan layanan Anjungan Nagari Mandiri. Sampai jumpa!`
        : `Pengajuan surat Anda telah berhasil, ${nama}! Terima kasih sudah menggunakan layanan Anjungan Nagari Mandiri. Semoga urusan Anda lancar. Sampai jumpa!`;

      // Kirim ke Gemini Live (agar suara konsisten dengan sesi AI)
      try {
        const sent = await electron.ipcRenderer.invoke('voice:sendToGemini',
          `[SISTEM] Halaman cetak/hasil pengajuan telah terbuka. Tolong ucapkan pesan perpisahan berikut kepada warga dengan hangat dan ramah: "${farewellText}" Setelah selesai berbicara, sesi ini berakhir.`
        );
        // Jika Gemini tidak aktif (manual mode), fallback ke TTS biasa
        if (!sent?.success) {
          electron.ipcRenderer.invoke('voice:synthesize', farewellText);
        }
      } catch {
        electron.ipcRenderer.invoke('voice:synthesize', farewellText);
      }

      // Matikan mic setelah Sinta selesai bicara farewell (~12 detik)
      // enterManualMode = tutup WebSocket Gemini + kirim sinyal ke frontend agar mic hardware mati
      setTimeout(() => {
        electron.ipcRenderer.invoke('voice:enterManualMode').catch(() => {});
      }, 12000);
    };

    speakFarewell();
  }, []);

  useEffect(() => {
    if (hasSynthesized.current) return;
    hasSynthesized.current = true;

    const runPrint = async () => {
      if (pdfUrl && electron) {
        // Ada PDF dari server — download dan print
        setPrintStatus('downloading');
        if (electron) {
          electron.ipcRenderer.invoke('voice:synthesize', 'Mohon tunggu, mengunduh dokumen dari server.');
        }

        try {
          // Download PDF via fetch, simpan via IPC, lalu buka
          const response = await fetch(pdfUrl);
          if (!response.ok) throw new Error(`Server error ${response.status}`);

          const buffer = await response.arrayBuffer();
          const uint8Array = new Uint8Array(buffer);

          // Kirim ke Main Process untuk disimpan dan dibuka/dicetak
          setPrintStatus('printing');
          const printResult = await electron.ipcRenderer.invoke('kiosk:printPdf', {
            data: Array.from(uint8Array),
            filename: `surat_${resi}.pdf`,
          });

          if (printResult && printResult.success) {
            setPrintStatus('done');
            setIsDone(true);
            electron.ipcRenderer.invoke('voice:synthesize',
              `Surat telah dicetak. Kode resi Anda adalah ${resi}. Silakan ambil dokumen Anda. Mesin akan kembali ke layar utama.`
            );
          } else {
            throw new Error(printResult?.message || 'Gagal mencetak dokumen');
          }
        } catch (err) {
          console.error('Print error:', err);
          setPrintError(err.message);
          setPrintStatus('error');
          if (electron) {
            electron.ipcRenderer.invoke('voice:synthesize', 'Maaf, terjadi kesalahan saat mencetak. Silakan hubungi petugas.');
          }
          return; // Jangan auto-navigate jika error
        }
      } else {
        // Tidak ada pdf_url — cetak struk resi
        setPrintStatus('printing');
        if (electron) {
          electron.ipcRenderer.invoke('voice:synthesize', 'Pengajuan surat Anda telah berhasil. Struk resi sedang dicetak. Mohon tunggu.');
          // Minta backend print resi/QR
          electron.ipcRenderer.invoke('kiosk:printReceipt', {
            resi: resi,
            qrBase64: qrBase64,
            jenis_surat: result?.jenis_surat || result?.templateNama
          });
        }
        
        setTimeout(() => {
          setIsDone(true);
          setPrintStatus('done');
          if (electron) {
            electron.ipcRenderer.invoke('voice:synthesize',
              `Struk resi Anda telah dicetak. Silakan ambil dan simpan struk ini untuk mencetak surat Anda setelah ditandatangani oleh Bapak Wali Nagari.`
            );
          }
        }, 5000);
      }
    };

    runPrint();

    // Auto-navigate home after 18 seconds
    const finalTimer = setTimeout(() => navigate('/'), 18000);
    return () => clearTimeout(finalTimer);
  }, []);

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px' }}>
      <h2 className="page-title" style={{ marginBottom: '24px', fontSize: 48, fontWeight: 300, letterSpacing: '1px' }}>
        {printStatus === 'downloading' && 'Mengunduh Dokumen...'}
        {printStatus === 'printing' && 'Mencetak Struk Resi...'}
        {printStatus === 'done' && 'Pengajuan Berhasil'}
        {printStatus === 'error' && 'Gagal Mengajukan'}
        {printStatus === 'idle' && 'Mempersiapkan...'}
      </h2>

      {printError && (
        <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 16, padding: '24px 32px', marginBottom: 32, color: '#f87171', fontSize: 20, maxWidth: 600, textAlign: 'center' }}>
          {printError}
          <br />
          <button className="btn btn-secondary" style={{ marginTop: 24, fontSize: 20, padding: '16px 32px', borderRadius: 12 }} onClick={() => navigate('/')}>
            Kembali ke Beranda
          </button>
        </div>
      )}

      {/* Printer Animation */}
      {printStatus !== 'error' && !isDone && (
        <div style={{ position: 'relative', width: '300px', height: '360px', display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 32 }}>
          <div style={{
            width: '180px', height: '210px', background: 'white', borderRadius: '8px', padding: '16px',
            color: 'black', position: 'absolute', top: '30px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.3)', zIndex: 1,
            animation: isDone ? 'none' : 'paperEject 2s infinite ease-in-out',
            transform: isDone ? 'translateY(120px)' : 'none'
          }}>
            {qrBase64 ? (
              <img src={`data:image/png;base64,${qrBase64}`} alt="QR Code" style={{ width: '80%', height: 'auto', marginBottom: 8 }} />
            ) : (
              <>
                <div style={{ width: '80%', height: '6px', background: '#ccc', marginBottom: '12px' }} />
                <div style={{ width: '100%', height: '6px', background: '#ccc', marginBottom: '12px' }} />
                <div style={{ width: '60%', height: '6px', background: '#ccc', marginBottom: '24px' }} />
              </>
            )}
            <div style={{ fontSize: '14px', color: '#666', fontWeight: 'bold' }}>KODE RESI</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#111', textAlign: 'center', marginTop: '6px', border: '2px dashed #888', padding: '6px', width: '100%' }}>
              {resi}
            </div>
          </div>

          <div style={{
            width: '300px', height: '120px', background: '#1e293b', borderRadius: '24px 24px 12px 12px',
            position: 'absolute', bottom: '30px', zIndex: 2, boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
            borderTop: '6px solid #334155', display: 'flex', justifyContent: 'center'
          }}>
            <div style={{ width: '210px', height: '12px', background: '#0f172a', marginTop: '18px', borderRadius: '6px' }} />
            <div style={{
              position: 'absolute', right: '30px', top: '30px', width: '12px', height: '12px', borderRadius: '50%',
              background: printStatus === 'error' ? '#ef4444' : isDone ? '#10b981' : '#3b82f6',
              boxShadow: `0 0 16px ${printStatus === 'error' ? '#ef4444' : isDone ? '#10b981' : '#3b82f6'}`,
              animation: isDone ? 'none' : 'blinkLight 1s infinite alternate'
            }} />
          </div>
        </div>
      )}

      {/* Status text */}
      {printStatus !== 'error' && !isDone && (
        <p style={{ color: 'var(--text-secondary)', marginTop: '40px', fontSize: '24px', textAlign: 'center', maxWidth: '800px', lineHeight: 1.6 }}>
          {printStatus === 'downloading' && 'Mengunduh PDF dari server...'}
          {printStatus === 'printing' && 'Jangan tinggalkan area mesin pencetak.'}
        </p>
      )}

      {/* QR Code besar dan Nomor Resi */}
      {isDone && (
        <div style={{ 
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.95)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '40px',
          backdropFilter: 'blur(20px)'
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.05)', 
            padding: '48px 80px', 
            borderRadius: 48, 
            border: '1px solid rgba(255,255,255,0.1)', 
            boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
            textAlign: 'center',
            maxWidth: '900px',
            width: '100%'
          }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 28, marginBottom: 16 }}>Pengajuan Berhasil!</p>
            <h2 style={{ color: 'white', fontSize: 42, fontWeight: 300, marginBottom: 40 }}>Simpan / Foto Nomor Resi Anda:</h2>
            
            <div style={{ 
              background: 'rgba(255,255,255,0.1)',
              padding: '24px 40px',
              borderRadius: 24,
              display: 'inline-block',
              marginBottom: 40,
              border: '2px dashed rgba(255,255,255,0.2)'
            }}>
              <div style={{ fontSize: 72, fontWeight: 900, color: '#10b981', letterSpacing: '8px', textShadow: '0 0 20px rgba(16, 185, 129, 0.3)' }}>
                {resi}
              </div>
            </div>
            
            <div style={{ marginBottom: 40 }}>
              {safeQrSrc ? (
                <img 
                  src={safeQrSrc} 
                  alt="QR Resi" 
                  style={{ 
                    width: 360, height: 360, 
                    borderRadius: 32, 
                    background: 'white', 
                    padding: 24, 
                    boxShadow: '0 12px 64px rgba(0,0,0,0.5)',
                    display: 'inline-block'
                  }} 
                />
              ) : (
                <div style={{ width: 360, height: 360, background: 'rgba(255,255,255,0.05)', borderRadius: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                   <p style={{ color: 'var(--text-muted)' }}>QR Code sedang dimuat...</p>
                </div>
              )}
            </div>
            
            <p style={{ color: 'var(--text-muted)', fontSize: 22, marginBottom: 48, maxWidth: '600px', margin: '0 auto 48px' }}>
              Gunakan Nomor Resi di atas untuk memantau status surat Anda. Struk fisik juga sedang dicetak di mesin.
            </p>
            
            <button 
              className="btn btn-primary" 
              style={{ 
                background: 'linear-gradient(135deg, #6366f1, #a855f7)', 
                border: 'none', 
                fontSize: 32, 
                padding: '24px 80px', 
                borderRadius: 24, 
                boxShadow: '0 12px 40px rgba(99, 102, 241, 0.4)',
                fontWeight: 'bold',
                cursor: 'pointer'
              }} 
              onClick={() => navigate('/')}
            >
              KEMBALI KE BERANDA
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes paperEject {
          0% { transform: translateY(0); opacity: 0; }
          20% { opacity: 1; }
          80% { transform: translateY(120px); opacity: 1; }
          100% { transform: translateY(140px); opacity: 0; }
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
