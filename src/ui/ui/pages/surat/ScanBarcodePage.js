import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

const ScanBarcodePage = () => {
  const navigate = useNavigate();
  const [showManual, setShowManual] = useState(false);
  const [codeValue, setCodeValue] = useState('');
  const [statusText, setStatusText] = useState('Pindai Resi di Scanner Mesin');
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanAttempt, setScanAttempt] = useState(1);
  const [documentData, setDocumentData] = useState(null);

  const inputRef = useRef(null);
  const fallbackTimer = useRef(null);
  const hasGreetedRef = useRef(false);

  useEffect(() => {
    // Announce instruction on first mount only
    if (electron && !showManual && scanAttempt === 1 && !hasGreetedRef.current) {
      hasGreetedRef.current = true;
      electron.ipcRenderer.invoke('voice:speakOnce', 'Silakan dekatkan barcode atau nomor resi Anda ke mesin pemindai.').catch(() => {});
    }

    // Always ensure input is focused for the hardware HID scanner
    if (inputRef.current) {
      inputRef.current.focus();
    }

    // Global listener to force focus back if lost
    const handleGlobalClick = () => {
      if (inputRef.current && !showManual && !isProcessing) {
        inputRef.current.focus();
      }
    };
    window.addEventListener('click', handleGlobalClick);

    // 30 seconds timer loop
    if (!showManual && !isProcessing) {
      fallbackTimer.current = setTimeout(() => {
        if (scanAttempt < 3) {
          // Hasn't reached max attempts, loop again
          setScanAttempt(prev => prev + 1);
          setStatusText(`Percobaan ke-${scanAttempt + 1} dari 3: Posisikan ulang resi Anda.`);
          if (electron) {
            electron.ipcRenderer.invoke('voice:speakOnce', `Mesin belum mendeteksi resi. Coba posisikan ulang barcode resi Anda ke mesin.`).catch(() => {});
          }
        } else {
          // Max attempts reached, reveal manual input
          setShowManual(true);
          setStatusText('Ketik kode resi secara manual di layar.');
          if (electron) {
            electron.ipcRenderer.invoke('voice:speakOnce', 'Anda dapat mengetikkan kode resi secara manual pada layar jika scanner kesulitan membaca.').catch(() => {});
          }
        }
      }, 30000); // 30 seconds
    }

    return () => {
      clearTimeout(fallbackTimer.current);
      window.removeEventListener('click', handleGlobalClick);
    };
  }, [showManual, isProcessing, scanAttempt]);

  // Handle hardware scanner input (It types fast and hits Enter)
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && codeValue.trim()) {
      e.preventDefault();
      processCode(codeValue.trim().toUpperCase());
    }
  };

  const processCode = async (code) => {
    if (isProcessing) return;
    setIsProcessing(true);
    clearTimeout(fallbackTimer.current);
    setStatusText(`Memeriksa status resi: ${code}`);

    try {
      let data = null;

      if (electron) {
        const res = await electron.ipcRenderer.invoke('kiosk:api:cekStatusSurat', code);
        if (res && res.success && res.data) {
          data = res.data;
        } else {
          throw new Error(res?.message || 'Resi tidak ditemukan di server.');
        }
      } else {
        // Fallback preview tanpa Electron
        data = {
          tracking_code: code,
          template_name: 'Surat Keterangan',
          warga_nama: 'Pemohon',
          status: code.endsWith('0') || code.endsWith('X') ? 'pending' : 'signed',
          pdf_url: null,
        };
      }

      setDocumentData({
        code: data.tracking_code || code,
        type: data.template_name || 'Surat Keterangan',
        name: data.warga_nama || 'Pemohon',
        date: new Date().toLocaleDateString('id-ID'),
        status_signed: data.status === 'signed',
        pdf_url: data.pdf_url || null,
      });
      setStatusText('Hasil Pengecekan Dokumen');

      if (electron) {
        if (data.status === 'signed') {
          electron.ipcRenderer.invoke('voice:speakOnce', `Surat atas nama ${data.warga_nama || 'Anda'} telah ditandatangani secara elektronik dan sah untuk dicetak. Silakan tekan tombol Cetak Dokumen.`).catch(() => {});
        } else {
          electron.ipcRenderer.invoke('voice:speakOnce', 'Maaf, surat Anda sedang dalam antrean dan belum ditandatangani oleh Wali Nagari. Mohon cek kembali nanti.').catch(() => {});
        }
      }
    } catch (err) {
      setStatusText(`Gagal: ${err.message}`);
      if (electron) {
        electron.ipcRenderer.invoke('voice:speakOnce', 'Kode resi tidak ditemukan atau terjadi kesalahan. Silakan coba lagi.').catch(() => {});
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (codeValue.trim()) {
      processCode(codeValue.trim().toUpperCase());
    }
  };

  return (
    <div className="page-enter barcode-page">
      <div className="absensi-header">
        <h2 className="page-title">Mencetak Surat</h2>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>
          {statusText}
        </p>
      </div>

      <div className="barcode-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '800px', margin: '0 auto', gap: '32px' }}>
        
        {documentData ? (
          <div className="document-review-card" style={{ width: '100%', maxWidth: '500px', animation: 'scaleIn 0.5s ease' }}>
            <div className="glass-card" style={{ padding: '32px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>
                {documentData.status_signed ? '✅' : '⏳'}
              </div>
              <h3 style={{ fontSize: '20px', color: 'var(--text-primary)', marginBottom: '8px' }}>Detail Dokumen</h3>
              
              <div style={{ background: 'var(--bg-glass)', padding: '16px', borderRadius: '12px', textAlign: 'left', marginBottom: '24px' }}>
                <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: '13px' }}>Jenis Dokumen</p>
                <p style={{ margin: '0 0 16px', fontWeight: 'bold' }}>{documentData.type}</p>
                
                <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: '13px' }}>Atas Nama / Pemohon</p>
                <p style={{ margin: '0 0 16px', fontWeight: 'bold' }}>{documentData.name}</p>

                <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: '13px' }}>Status Pengesahan (E-Sign)</p>
                <p style={{ margin: 0, fontWeight: 'bold', color: documentData.status_signed ? '#10b981' : '#f87171' }}>
                  {documentData.status_signed ? 'Sudah Ditandatangani (Sah)' : 'Menunggu Tanda Tangan Wali Nagari'}
                </p>
              </div>

              {documentData.status_signed ? (
                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%', fontSize: '16px', padding: '14px' }}
                  onClick={() => navigate('/printing', { 
                    state: { 
                      result: { 
                        kode_resi: documentData.code,
                        tracking_code: documentData.code,
                        pdf_url: documentData.pdf_url,
                        type: documentData.type,
                        name: documentData.name,
                      } 
                    } 
                  })}
                >
                  🖨️ Cetak Dokumen Sekarang
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <p style={{ color: '#f87171', fontSize: '14px', margin: 0 }}>
                    Dokumen yang belum ditandatangani tidak bisa dicetak.
                  </p>
                  <button 
                    className="btn btn-outline" 
                    style={{ width: '100%', borderColor: '#ef4444', color: '#ef4444', padding: '14px' }}
                    onClick={() => navigate('/')}
                  >
                    Kembali ke Beranda
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Hardware Scanner Animation Box */}
            {!showManual && (
              <div style={{ margin: '40px 0', transform: 'scale(1.8)' }}>
                <div className="scanner-animation-box" style={{ 
                  position: 'relative', width: '280px', height: '240px', 
                  background: 'rgba(255,255,255,0.05)', border: '2px dashed rgba(255,255,255,0.2)', 
                  borderRadius: '20px', display: 'flex', alignItems: 'flex-end', 
                  justifyContent: 'center', overflow: 'hidden' 
                }}>
                {/* Embedded CSS for this animation */}
                <style>{`
                  @keyframes docScanSlide {
                    0% { transform: translateY(80px) rotate(-10deg); opacity: 0; }
                    20% { transform: translateY(10px) rotate(-5deg); opacity: 1; }
                    80% { transform: translateY(-5px) rotate(-2deg); opacity: 1; }
                    100% { transform: translateY(80px) rotate(-10deg); opacity: 0; }
                  }
                  @keyframes scanLaserLine {
                    0% { opacity: 0; transform: translateY(-20px); }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { opacity: 0; transform: translateY(80px); }
                  }
                `}</style>
                
                {/* Red Laser Scanner Ceiling */}
                <div style={{ position: 'absolute', top: 0, width: '100px', height: '20px', background: '#334155', borderRadius: '0 0 10px 10px', display: 'flex', justifyContent: 'center' }}>
                   <div style={{ width: '40px', height: '6px', background: '#0f172a', borderRadius: '2px', marginTop: '10px' }}></div>
                   {/* Laser Field Area */}
                   <div style={{ position: 'absolute', top: '20px', width: '80px', height: '140px', background: 'linear-gradient(180deg, rgba(239, 68, 68, 0.4) 0%, rgba(239, 68, 68, 0) 100%)', clipPath: 'polygon(30% 0, 70% 0, 100% 100%, 0% 100%)' }}></div>
                   {/* Dancing Laser Line */}
                   <div style={{ position: 'absolute', top: '20px', width: '120px', height: '2px', background: '#ef4444', boxShadow: '0 0 12px #ef4444', animation: 'scanLaserLine 2.5s infinite linear', zIndex: 11 }}></div>
                </div>

                {/* The Hand & Phone/Doc */}
                <div style={{ position: 'relative', width: '80px', height: '120px', background: '#f1f5f9', borderRadius: '8px', border: '3px solid #1e293b', animation: 'docScanSlide 2.5s infinite ease-in-out', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0' }}>
                   {/* Mock Barcode inside Smartphone Screen / Doc */}
                   <div style={{ width: '80%', display: 'flex', gap: '3px', height: '40px', justifyContent: 'center' }}>
                      <div style={{ width: '3px', background: 'black' }}></div>
                      <div style={{ width: '6px', background: 'black' }}></div>
                      <div style={{ width: '2px', background: 'black' }}></div>
                      <div style={{ width: '5px', background: 'black' }}></div>
                      <div style={{ width: '8px', background: 'black' }}></div>
                      <div style={{ width: '3px', background: 'black' }}></div>
                   </div>
                   
                   {/* The Abstract Hand gripping the phone (bottom-right edge) */}
                   <div style={{ position: 'absolute', bottom: '-10px', right: '-15px', width: '50px', height: '50px', background: '#fbcfe8', borderRadius: '50%' }}></div>
                   {/* Thumb overlapping front */}
                   <div style={{ position: 'absolute', bottom: '15px', right: '-8px', width: '18px', height: '30px', background: '#fbcfe8', borderRadius: '10px', transform: 'rotate(-25deg)' }}></div>
                </div>

                </div>

              </div>
            )}

            {/* The Input field acts as the catcher for physical scanner AND literal manual input */}
            <div style={{ 
                width: '100%', 
                maxWidth: '400px', 
                opacity: showManual ? 1 : 0, 
                pointerEvents: showManual ? 'auto' : 'none',
                position: showManual ? 'relative' : 'absolute',
                transition: 'all 0.5s ease',
                animation: showManual ? 'fadeSlideUp 0.5s ease' : 'none'
              }}>
              <div className="glass-card" style={{ padding: '24px' }}>
                {showManual && (
                  <h3 style={{ fontSize: '16px', marginBottom: '16px', color: 'var(--text-primary)', textAlign: 'center' }}>
                    Ketik Kode Resi Manual
                  </h3>
                )}
                
                <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Contoh: RES-XXXX"
                    value={codeValue}
                    onChange={(e) => setCodeValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isProcessing}
                    style={{
                      width: '100%',
                      padding: '14px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-glass)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'white',
                      fontSize: '18px',
                      textAlign: 'center',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}
                  />
                  {showManual && (
                    <button 
                      type="submit" 
                      className={`btn btn-primary ${isProcessing ? 'loading' : ''}`}
                      disabled={!codeValue.trim() || isProcessing}
                    >
                      {isProcessing ? 'Memproses...' : 'Proses Dokumen'}
                    </button>
                  )}
                </form>
              </div>
            </div>

            {/* Cancel Button */}
            {!isProcessing && (
              <button 
                className="btn btn-outline" 
                style={{ width: '100%', maxWidth: '400px', borderColor: 'rgba(255,255,255,0.2)', color: 'var(--text-secondary)' }}
                onClick={() => navigate('/')}
              >
                Batalkan dan Kembali
              </button>
            )}
          </>
        )}

      </div>
    </div>
  );
};

export default ScanBarcodePage;
