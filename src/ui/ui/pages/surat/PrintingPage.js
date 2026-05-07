import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

// ── Komponen Keyboard QWERTY Custom ──
const ROWS = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M','-'],
];

const CustomKeyboard = ({ value, onChange, onSubmit }) => {
  const handleKey = (k) => {
    if (k === '⌫') {
      onChange(value.slice(0, -1));
    } else if (k === 'SPASI') {
      onChange(value + ' ');
    } else {
      onChange(value + k);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      {ROWS.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: 10, justifyContent: 'center', width: '100%' }}>
          {row.map(k => (
            <button
              key={k}
              className="key-btn"
              onClick={() => handleKey(k)}
              style={{ flex: 1, height: 68, fontSize: 28, fontWeight: 700 }}
            >
              {k}
            </button>
          ))}
        </div>
      ))}
      {/* Baris bawah */}
      <div style={{ display: 'flex', gap: 10, width: '100%' }}>
        <button
          className="key-btn"
          onClick={() => handleKey('⌫')}
          style={{ flex: 1.5, height: 68, fontSize: 28, fontWeight: 700, background: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
        >
          ⌫
        </button>
        <button
          className="key-btn"
          onClick={() => handleKey('SPASI')}
          style={{ flex: 4, height: 68, fontSize: 26 }}
        >
          SPASI
        </button>
        <button
          className="key-btn action"
          onClick={onSubmit}
          style={{ flex: 2, height: 68, fontSize: 24, fontWeight: 700 }}
        >
          ✓ Cari
        </button>
      </div>
    </div>
  );
};

const PrintingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { result } = location.state || {};
  const isManualMode = location.state?.showManualResi || false;

  const getSafeImageSrc = (base64) => {
    if (!base64) return null;
    if (base64.startsWith('data:image')) return base64;
    return `data:image/png;base64,${base64}`;
  };

  const dataResi = result?.receipt || result || {};
  const resi = dataResi.tracking_code || dataResi.kode_resi || 'RESI-UNIK';
  const pdfUrl = dataResi.pdf_url || null;
  const qrBase64 = dataResi.tracking_qr_base64 || dataResi.qr_base64 || null;
  const safeQrSrc = getSafeImageSrc(qrBase64);
  const isSignedDoc = !!pdfUrl;

  const [isDone, setIsDone] = useState(false);
  const [printStatus, setPrintStatus] = useState('idle');
  const [printError, setPrintError] = useState('');
  const hasSynthesized = useRef(false);
  const warga = location.state?.warga;
  const hasFarewellSpoken = useRef(false);

  // State input resi manual
  const [showManualResi, setShowManualResi] = useState(isManualMode);
  const [manualResiInput, setManualResiInput] = useState('');
  const [manualResiLoading, setManualResiLoading] = useState(false);
  const [manualResiError, setManualResiError] = useState('');
  const [documentResult, setDocumentResult] = useState(null);

  // ── MENCEGAH DOUBLE EXECUTION TAPI TETAP BISA RE-RUN SAAT NAVIGASI ──
  const processedKey = useRef(null);

  useEffect(() => {
    // Jika masih di mode manual, jangan mulai print
    if (isManualMode) return;
    
    // Jika key lokasi ini sudah diproses (mencegah React Strict Mode double-fire), skip
    if (processedKey.current === location.key) return;
    processedKey.current = location.key;

    // 1. Run Print Process
    const runPrint = async () => {
      const nama = warga?.nama ? warga.nama.split(' ')[0] : '';
      
      if (pdfUrl && electron) {
        setPrintStatus('downloading');
        if (electron) electron.ipcRenderer.invoke('voice:speakOnce', 'Mohon tunggu, dokumen sedang diunduh dan diproses ke mesin pencetak.').catch(() => {});

        try {
          const response = await fetch(pdfUrl);
          if (!response.ok) throw new Error(`Server error ${response.status}`);
          const buffer = await response.arrayBuffer();
          const uint8Array = new Uint8Array(buffer);

          setPrintStatus('printing');
          const printResult = await electron.ipcRenderer.invoke('kiosk:printPdf', {
            data: Array.from(uint8Array),
            filename: `surat_${resi}.pdf`,
          });

          if (printResult && printResult.success) {
            // Beri waktu 8 detik agar kertas fisik benar-benar keluar dari printer EPSON
            await new Promise(r => setTimeout(r, 8000));
            
            setPrintStatus('done');
            const successText = `Surat Anda telah berhasil dicetak${nama ? ', ' + nama : ''}! Silakan ambil dokumen Anda. Terima kasih sudah menggunakan layanan Anjungan Nagari Mandiri. Sampai jumpa!`;
            electron.ipcRenderer.invoke('voice:speakOnce', successText).catch(() => {});
            setTimeout(() => navigate('/'), 8000); // Tunggu suara selesai sebelum kembali
          } else {
            throw new Error(printResult?.message || 'Gagal mencetak dokumen');
          }
        } catch (err) {
          setPrintError(err.message);
          setPrintStatus('error');
          if (electron) electron.ipcRenderer.invoke('voice:speakOnce', 'Maaf, terjadi kesalahan saat mencetak. Silakan hubungi petugas.').catch(() => {});
        }
      } else {
        setPrintStatus('printing');
        if (electron) {
          electron.ipcRenderer.invoke('voice:speakOnce', 'Pengajuan surat Anda telah berhasil. Struk resi sedang dicetak. Mohon tunggu.').catch(() => {});
          electron.ipcRenderer.invoke('kiosk:printReceipt', {
            resi, qrBase64,
            jenis_surat: result?.jenis_surat || result?.templateNama,
            warga,
          });
        }
        
        // Struk thermal biasanya cepat, tunggu 4 detik
        setTimeout(() => {
          setIsDone(true);
          setPrintStatus('done');
          if (electron) {
            const resiSpoken = resi ? resi.replace(/-/g, ' ') : '';
            const receiptText = `Pengajuan surat Anda telah berhasil${nama ? ', ' + nama : ''}! ${resiSpoken ? 'Nomor resi Anda adalah ' + resiSpoken + '. ' : ''}Silakan ambil dan simpan struk ini untuk mengambil surat nanti. Terima kasih dan sampai jumpa!`;
            electron.ipcRenderer.invoke('voice:speakOnce', receiptText).catch(() => {});
          }
          setTimeout(() => navigate('/'), 12000); // Tunggu suara agak panjang
        }, 4000);
      }
    };

    runPrint();
    
    // Safety fallback timer dihapus agar tidak bentrok dengan timer di atas
    // Navigasi sudah dihandle di dalam block runPrint
  }, [location.key, isManualMode, pdfUrl, resi, qrBase64, isSignedDoc, warga, result, navigate]);

  const handleSubmitManualResi = async () => {
    if (!manualResiInput.trim()) {
      setManualResiError('Kode resi tidak boleh kosong');
      return;
    }
    setManualResiLoading(true);
    setManualResiError('');
    setDocumentResult(null);
    try {
      const code = manualResiInput.trim().toUpperCase();
      if (electron) {
        const res = await electron.ipcRenderer.invoke('kiosk:api:cekStatusSurat', code);
        console.log('[ManualResi] Response:', JSON.stringify(res));
        // Handle berbagai format response
        const data = res?.data || res;
        if (data && (data.tracking_code || data.kode_resi || data.status)) {
          setDocumentResult({
            code: data.tracking_code || data.kode_resi || code,
            type: data.template_nama || data.template_name || 'Surat Keterangan',
            name: data.warga_nama || data.nama || '-',
            status_raw: data.status_raw || data.status || 'pending',
            status_label: data.status || 'Menunggu Review',
            pdf_url: data.pdf_url || null,
            is_signed: !!(data.pdf_url),
          });
        } else {
          setManualResiError(res?.message || 'Resi tidak ditemukan. Periksa kembali kode resi Anda.');
        }
      } else {
        setManualResiError('Aplikasi tidak terhubung ke sistem.');
      }
    } catch (err) {
      console.error('[ManualResi] Error:', err);
      setManualResiError('Terjadi kesalahan: ' + (err.message || 'Tidak dapat terhubung ke server.'));
    }
    setManualResiLoading(false);
  };

  const handlePrintFoundDoc = async () => {
    if (!documentResult?.pdf_url) return;
    
    // Ganti UI ke layar cetak segera
    setShowManualResi(false);

    navigate('/printing', {
      replace: true,
      state: {
        showManualResi: false, // Beri tahu komponen untuk tidak masuk mode manual lagi
        result: {
          tracking_code: documentResult.code,
          kode_resi: documentResult.code,
          pdf_url: documentResult.pdf_url,
        },
        warga
      }
    });
  };

  // ── LAYAR INPUT RESI MANUAL ──
  if (showManualResi) {
    return (
      <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 40px', gap: 24, width: '100%' }}>

        <div style={{ textAlign: 'center' }}>
          <h2 className="page-title" style={{ fontSize: 'clamp(28px, 3.5vw, 48px)', fontWeight: 300, marginBottom: 8 }}>
            🔢 Input Kode Resi Manual
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 22, margin: 0 }}>
            Masukkan nomor resi dari struk cetak yang sudah diterima
          </p>
        </div>

        {/* Kartu Hasil Pencarian */}
        {documentResult && (
          <div className="glass-card" style={{ background: 'rgba(30,41,88,0.9)', padding: '32px', width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 48, textAlign: 'center' }}>{documentResult.is_signed ? '✅' : '⏳'}</div>
            <h3 style={{ color: 'white', fontSize: 24, textAlign: 'center', margin: 0 }}>Dokumen Ditemukan</h3>
            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 16, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><span style={{ color: 'var(--text-secondary)', fontSize: 16 }}>Kode Resi</span><br /><strong style={{ fontSize: 20, color: '#818cf8', fontFamily: 'monospace' }}>{documentResult.code}</strong></div>
              <div><span style={{ color: 'var(--text-secondary)', fontSize: 16 }}>Jenis Surat</span><br /><strong style={{ fontSize: 20 }}>{documentResult.type}</strong></div>
              <div><span style={{ color: 'var(--text-secondary)', fontSize: 16 }}>Atas Nama</span><br /><strong style={{ fontSize: 20 }}>{documentResult.name}</strong></div>
              <div>
                <span style={{ color: 'var(--text-secondary)', fontSize: 16 }}>Status</span><br />
                <strong style={{ fontSize: 20, color: documentResult.is_signed ? '#10b981' : documentResult.status_raw === 'wali_review' ? '#a78bfa' : '#f87171' }}>
                  {documentResult.is_signed ? '✅ Sudah Ditandatangani (Siap Cetak)' : documentResult.status_raw === 'wali_review' ? '⏳ Menunggu Tanda Tangan Wali Nagari' : '❌ Belum Diproses'}
                </strong>
              </div>
            </div>
            {documentResult.is_signed ? (
              <button
                className="btn"
                onClick={handlePrintFoundDoc}
                style={{ fontSize: 24, padding: '20px', borderRadius: 16, background: '#10b981', border: 'none', color: 'white', fontWeight: 700 }}
              >
                🖨️ Cetak Dokumen Sekarang
              </button>
            ) : (
              <p style={{ color: '#f87171', textAlign: 'center', fontSize: 18, margin: 0 }}>
                Surat belum dapat dicetak. Silakan cek kembali nanti setelah Wali Nagari menandatangani.
              </p>
            )}
            <button
              onClick={() => { setDocumentResult(null); setManualResiInput(''); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 18, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Cari resi lain
            </button>
          </div>
        )}

        {/* Form Input + Keyboard — sembunyikan saat ada hasil */}
        {!documentResult && (
          <div className="glass-card" style={{ background: 'rgba(30,41,88,0.9)', padding: '32px 40px', width: '100%', maxWidth: 1400, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{
              background: 'rgba(0,0,0,0.4)',
              border: `2px solid ${manualResiError ? 'rgba(239,68,68,0.6)' : 'rgba(99,102,241,0.5)'}`,
              borderRadius: 16, padding: '20px 32px',
              fontSize: 36, fontFamily: 'monospace', fontWeight: 700,
              color: '#818cf8', letterSpacing: 4, textAlign: 'center', minHeight: 76
            }}>
              {manualResiInput || <span style={{ color: 'rgba(255,255,255,0.2)', fontWeight: 300, fontSize: 26 }}>Ketik kode resi di sini...</span>}
            </div>

            {manualResiError && (
              <p style={{ color: '#f87171', fontSize: 20, textAlign: 'center', margin: 0, fontWeight: 600 }}>{manualResiError}</p>
            )}

            <CustomKeyboard
              value={manualResiInput}
              onChange={(val) => { setManualResiInput(val.toUpperCase()); setManualResiError(''); }}
              onSubmit={handleSubmitManualResi}
            />

            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <button
                className="btn"
                onClick={() => navigate('/scan-barcode')}
                style={{ flex: 1, fontSize: 22, padding: '18px', borderRadius: 16, background: '#ef4444', border: 'none', color: 'white', fontWeight: 600 }}
              >
                ← Kembali
              </button>
              <button
                className="btn"
                onClick={handleSubmitManualResi}
                disabled={manualResiLoading}
                style={{ flex: 2, fontSize: 22, padding: '18px', borderRadius: 16, background: '#6366f1', border: 'none', color: 'white', fontWeight: 700 }}
              >
                {manualResiLoading ? '⏳ Mencari...' : '🔍 Cari & Periksa Resi'}
              </button>
            </div>
          </div>
        )}

        {/* Tombol Kembali saat ada hasil */}
        {documentResult && (
          <button
            className="btn"
            onClick={() => navigate('/scan-barcode')}
            style={{ fontSize: 20, padding: '16px 48px', borderRadius: 16, background: '#ef4444', border: 'none', color: 'white', fontWeight: 600 }}
          >
            ← Kembali ke Scanner
          </button>
        )}
      </div>
    );
  }

  // ── HALAMAN CETAK UTAMA ──
  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', minHeight: '100%', padding: '32px 40px', gap: 24 }}>

      <h2 className="page-title" style={{ marginBottom: 0, fontSize: 'clamp(28px, 3.5vw, 52px)', fontWeight: 300, letterSpacing: '1px', textAlign: 'center' }}>
        {printStatus === 'downloading' && '⏬ Mengunduh Dokumen...'}
        {printStatus === 'printing' && (isSignedDoc ? '🖨️ Mencetak Dokumen...' : '🖨️ Mencetak Struk Resi...')}
        {printStatus === 'done' && (isSignedDoc ? '✅ Dokumen Berhasil Dicetak!' : '✅ Pengajuan Berhasil')}
        {printStatus === 'error' && '❌ Gagal Mencetak'}
        {printStatus === 'idle' && '⏳ Mempersiapkan...'}
      </h2>

      {printError && (
        <div className="glass-card" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', padding: '32px 40px', color: '#f87171', fontSize: 22, maxWidth: 800, textAlign: 'center', width: '100%' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <p style={{ margin: '0 0 24px' }}>{printError}</p>
          <button className="btn btn-secondary" style={{ fontSize: 22, padding: '16px 40px', borderRadius: 14 }} onClick={() => navigate('/')}>Kembali ke Beranda</button>
        </div>
      )}

      {printStatus !== 'error' && printStatus !== 'done' && (
        <div className="glass-card" style={{ background: 'rgba(30,41,88,0.6)', padding: '40px 60px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, width: '100%', maxWidth: 700 }}>
          <div style={{ position: 'relative', width: '240px', height: '280px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: '150px', height: '170px', background: 'white', borderRadius: '6px', padding: '12px', color: 'black', position: 'absolute', top: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 1, animation: 'paperEject 2s infinite ease-in-out' }}>
              {qrBase64 ? (
                <img src={`data:image/png;base64,${qrBase64}`} alt="QR" style={{ width: '70%', height: 'auto', marginBottom: 6 }} />
              ) : (
                <>
                  <div style={{ width: '80%', height: '5px', background: '#ddd', marginBottom: '10px' }} />
                  <div style={{ width: '100%', height: '5px', background: '#ddd', marginBottom: '10px' }} />
                  <div style={{ width: '60%', height: '5px', background: '#ddd', marginBottom: '20px' }} />
                </>
              )}
              <div style={{ fontSize: '11px', color: '#666', fontWeight: 'bold' }}>{isSignedDoc ? 'DOKUMEN RESMI' : 'KODE RESI'}</div>
              <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#111', textAlign: 'center', marginTop: '4px', border: '2px dashed #aaa', padding: '4px', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resi}</div>
            </div>
            <div style={{ width: '240px', height: '100px', background: '#1e293b', borderRadius: '20px 20px 10px 10px', position: 'absolute', bottom: '20px', zIndex: 2, boxShadow: '0 16px 48px rgba(0,0,0,0.6)', borderTop: '5px solid #334155', display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '170px', height: '10px', background: '#0f172a', marginTop: '14px', borderRadius: '5px' }} />
              <div style={{ position: 'absolute', right: '24px', top: '24px', width: '12px', height: '12px', borderRadius: '50%', background: isDone ? '#10b981' : '#3b82f6', boxShadow: `0 0 16px ${isDone ? '#10b981' : '#3b82f6'}`, animation: 'blinkLight 1s infinite alternate' }} />
            </div>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 22, textAlign: 'center', margin: 0, lineHeight: 1.6 }}>
            {printStatus === 'downloading' && 'Mengunduh PDF dari server...'}
            {printStatus === 'printing' && 'Jangan tinggalkan area mesin pencetak.'}
          </p>
        </div>
      )}

      {printStatus === 'done' && isSignedDoc && (
        <div className="glass-card" style={{ background: 'rgba(30,41,88,0.6)', padding: '48px 60px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, maxWidth: 700, width: '100%' }}>
          <div style={{ fontSize: 72 }}>✅</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 24, maxWidth: 500, margin: 0 }}>Dokumen sah telah dicetak. Silakan ambil dari printer.</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 18, margin: 0 }}>Halaman akan kembali ke beranda secara otomatis...</p>
          <button className="btn btn-primary" style={{ fontSize: 22, padding: '16px 48px', borderRadius: 16, marginTop: 8 }} onClick={() => navigate('/')}>Kembali ke Beranda</button>
        </div>
      )}

      {isDone && !isSignedDoc && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(10,14,39,0.97)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '40px', backdropFilter: 'blur(20px)' }}>
          <div className="glass-card" style={{ background: 'rgba(30,41,88,0.7)', padding: '48px 64px', borderRadius: 40, textAlign: 'center', maxWidth: '900px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 26, margin: 0 }}>Pengajuan Berhasil! 🎉</p>
            <h2 style={{ color: 'white', fontSize: 'clamp(24px, 3vw, 40px)', fontWeight: 300, margin: 0 }}>Simpan / Foto Nomor Resi Anda:</h2>
            <div style={{ background: 'rgba(16,185,129,0.1)', border: '2px dashed rgba(16,185,129,0.4)', padding: '20px 48px', borderRadius: 24, display: 'inline-block' }}>
              <div style={{ fontSize: 'clamp(36px, 5vw, 64px)', fontWeight: 900, color: '#10b981', letterSpacing: '6px', textShadow: '0 0 20px rgba(16, 185, 129, 0.3)', wordBreak: 'break-all' }}>{resi}</div>
            </div>
            {safeQrSrc ? (
              <img src={safeQrSrc} alt="QR Resi" style={{ width: 280, height: 280, borderRadius: 24, background: 'white', padding: 20, boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }} />
            ) : (
              <div style={{ width: 280, height: 280, background: 'rgba(255,255,255,0.05)', borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>QR Code sedang dimuat...</p>
              </div>
            )}
            <p style={{ color: 'var(--text-muted)', fontSize: 20, maxWidth: 600, margin: 0, lineHeight: 1.6 }}>Gunakan nomor resi di atas untuk memantau status surat Anda.</p>
            <button className="btn btn-primary" style={{ fontSize: 28, padding: '20px 72px', borderRadius: 24, background: 'linear-gradient(135deg, #6366f1, #a855f7)', border: 'none', fontWeight: 700, boxShadow: '0 12px 40px rgba(99,102,241,0.4)', cursor: 'pointer' }} onClick={() => navigate('/')}>
              KEMBALI KE BERANDA
            </button>
          </div>
        </div>
      )}

      {!isDone && printStatus !== 'error' && (
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <button
            className="btn"
            onClick={() => setShowManualResi(true)}
            style={{ fontSize: 20, padding: '16px 40px', borderRadius: 16, background: 'rgba(99,102,241,0.15)', border: '2px solid rgba(99,102,241,0.4)', color: '#818cf8', fontWeight: 600 }}
          >
            📄 Cetak Surat (Input Resi Manual)
          </button>
        </div>
      )}

      <style>{`
        @keyframes paperEject {
          0% { transform: translateY(0); opacity: 0; }
          20% { opacity: 1; }
          80% { transform: translateY(100px); opacity: 1; }
          100% { transform: translateY(120px); opacity: 0; }
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
