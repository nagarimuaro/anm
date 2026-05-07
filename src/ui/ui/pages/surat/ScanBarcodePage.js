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
      if (electron) electron.ipcRenderer.invoke('voice:stopSpeaking').catch(() => {});
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
        type: data.template_nama || data.template_name || 'Surat Keterangan',
        name: data.warga_nama || 'Pemohon',
        date: new Date().toLocaleDateString('id-ID'),
        status_signed: data.status_raw === 'signed',
        status_raw: data.status_raw || 'pending',
        status_label: data.status || 'Menunggu Review',
        pdf_url: data.pdf_url || null,
      });
      setStatusText('Hasil Pengecekan Dokumen');

      if (electron) {
        if (data.status_raw === 'signed') {
          electron.ipcRenderer.invoke('voice:speakOnce', `Surat atas nama ${data.warga_nama || 'Anda'} telah ditandatangani secara elektronik dan sah untuk dicetak. Silakan tekan tombol Cetak Dokumen.`).catch(() => {});
        } else if (data.status_raw === 'wali_review') {
          electron.ipcRenderer.invoke('voice:speakOnce', `Surat atas nama ${data.warga_nama || 'Anda'} sedang dalam proses tanda tangan Wali Nagari. Mohon tunggu beberapa saat.`).catch(() => {});
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
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', padding: '24px 40px', gap: 24, textAlign: 'center' }}>

      {/* Judul */}
      <div>
        <h2 className="page-title" style={{ fontSize: 'clamp(28px, 3.5vw, 52px)', fontWeight: 300, letterSpacing: '1px', marginBottom: 8 }}>Mencetak Surat</h2>
        <p className="page-subtitle" style={{ margin: 0, fontSize: 'clamp(18px, 2vw, 28px)' }}>
          {statusText}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '720px', margin: '0 auto', gap: '32px' }}>
        
        {documentData ? (
          <div style={{ width: '100%', animation: 'scaleIn 0.5s ease' }}>
            <div className="glass-card" style={{ padding: '40px', textAlign: 'center', background: 'rgba(30,41,88,0.6)' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>
                {documentData.status_signed ? '✅' : '⏳'}
              </div>
              <h3 style={{ fontSize: '24px', color: 'var(--text-primary)', marginBottom: '16px' }}>Detail Dokumen</h3>
              
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '24px', borderRadius: '16px', textAlign: 'left', marginBottom: '24px' }}>
                <p style={{ margin: '0 0 4px', color: 'var(--text-secondary)', fontSize: '16px' }}>Jenis Dokumen</p>
                <p style={{ margin: '0 0 20px', fontWeight: 'bold', fontSize: '20px' }}>{documentData.type}</p>
                
                <p style={{ margin: '0 0 4px', color: 'var(--text-secondary)', fontSize: '16px' }}>Atas Nama / Pemohon</p>
                <p style={{ margin: '0 0 20px', fontWeight: 'bold', fontSize: '20px' }}>{documentData.name}</p>

                <p style={{ margin: '0 0 4px', color: 'var(--text-secondary)', fontSize: '16px' }}>Status Pengesahan (E-Sign)</p>
                <p style={{ margin: 0, fontWeight: 'bold', color: 
                  documentData.status_raw === 'signed' ? '#10b981' : 
                  documentData.status_raw === 'wali_review' ? '#a78bfa' : '#f87171' 
                }}>
                  {documentData.status_label || (documentData.status_signed ? 'Sudah Ditandatangani (Sah)' : 'Menunggu Tanda Tangan Wali Nagari')}
                </p>
              </div>

              {documentData.status_signed ? (
                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%', fontSize: '22px', padding: '20px' }}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <p style={{ color: documentData.status_raw === 'wali_review' ? '#a78bfa' : '#f87171', fontSize: '18px', margin: 0 }}>
                    {documentData.status_raw === 'wali_review' 
                      ? 'Surat sedang menunggu tanda tangan Wali Nagari.' 
                      : 'Dokumen yang belum ditandatangani tidak bisa dicetak.'}
                  </p>
                  <button 
                    className="btn btn-outline" 
                    style={{ width: '100%', borderColor: 'rgba(255,255,255,0.2)', color: 'var(--text-secondary)', padding: '18px', fontSize: '20px' }}
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
              <div style={{ margin: '24px 0' }}>
                <div className="scanner-animation-box" style={{ 
                  position: 'relative', width: '640px', height: '520px', 
                  background: 'rgba(30, 41, 88, 0.9)', border: '1px solid rgba(255,255,255,0.1)', 
                  borderRadius: '40px', display: 'flex', alignItems: 'flex-end', 
                  justifyContent: 'center', overflow: 'hidden' 
                }}>
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
                    100% { opacity: 0; transform: translateY(120px); }
                  }
                `}</style>
                
                {/* Red Laser Scanner Ceiling */}
                <div style={{ position: 'absolute', top: 0, width: '160px', height: '32px', background: '#334155', borderRadius: '0 0 16px 16px', display: 'flex', justifyContent: 'center' }}>
                   <div style={{ width: '64px', height: '10px', background: '#0f172a', borderRadius: '3px', marginTop: '14px' }}></div>
                   {/* Laser Field Area */}
                   <div style={{ position: 'absolute', top: '32px', width: '130px', height: '220px', background: 'linear-gradient(180deg, rgba(239, 68, 68, 0.4) 0%, rgba(239, 68, 68, 0) 100%)', clipPath: 'polygon(30% 0, 70% 0, 100% 100%, 0% 100%)' }}></div>
                   {/* Dancing Laser Line */}
                   <div style={{ position: 'absolute', top: '32px', width: '200px', height: '3px', background: '#ef4444', boxShadow: '0 0 16px #ef4444', animation: 'scanLaserLine 2.5s infinite linear', zIndex: 11 }}></div>
                </div>

                {/* The Hand & Doc */}
                <div style={{ position: 'relative', width: '140px', height: '200px', background: '#f1f5f9', borderRadius: '12px', border: '4px solid #1e293b', animation: 'docScanSlide 2.5s infinite ease-in-out', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0' }}>
                   {/* Mock Barcode */}
                   <div style={{ width: '80%', display: 'flex', gap: '5px', height: '70px', justifyContent: 'center' }}>
                      <div style={{ width: '6px', background: 'black' }}></div>
                      <div style={{ width: '10px', background: 'black' }}></div>
                      <div style={{ width: '4px', background: 'black' }}></div>
                      <div style={{ width: '9px', background: 'black' }}></div>
                      <div style={{ width: '14px', background: 'black' }}></div>
                      <div style={{ width: '5px', background: 'black' }}></div>
                   </div>
                   {/* Hand */}
                   <div style={{ position: 'absolute', bottom: '-16px', right: '-24px', width: '80px', height: '80px', background: '#fbcfe8', borderRadius: '50%' }}></div>
                   <div style={{ position: 'absolute', bottom: '24px', right: '-14px', width: '28px', height: '50px', background: '#fbcfe8', borderRadius: '14px', transform: 'rotate(-25deg)' }}></div>
                </div>

                </div>

              </div>
            )}

            {/* The Input field acts as the catcher for physical scanner AND literal manual input */}
            <div style={{ 
              width: '100%', 
              opacity: showManual ? 1 : 0, 
              pointerEvents: showManual ? 'auto' : 'none',
              position: showManual ? 'relative' : 'absolute',
              transition: 'all 0.5s ease',
              animation: showManual ? 'fadeSlideUp 0.5s ease' : 'none'
            }}>
              <div className="glass-card" style={{ padding: '32px', background: 'rgba(30,41,88,0.6)' }}>
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

            {/* Tombol Bawah */}
            {!isProcessing && (
              <div style={{ display: 'flex', gap: 16, width: '100%', maxWidth: 720 }}>
                <button 
                  className="btn" 
                  style={{ flex: 1, padding: '20px', fontSize: 20, fontWeight: 600, borderRadius: 16, background: '#ef4444', border: 'none', color: 'white', cursor: 'pointer' }}
                  onClick={() => navigate('/')}
                >
                  ✕ Batalkan dan Kembali
                </button>
                <button 
                  className="btn" 
                  style={{ flex: 1, padding: '20px', fontSize: 20, fontWeight: 600, borderRadius: 16, background: '#6366f1', border: 'none', color: 'white', cursor: 'pointer' }}
                  onClick={() => navigate('/printing', { state: { showManualResi: true } })}
                >
                  📄 Input Resi Manual
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
};

export default ScanBarcodePage;
