import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import speakAfterPageReady from '../../utils/speakAfterPageReady';
import { CheckCircleIcon, AlertTriangleIcon, InfoIcon } from '../../components/Icons';
import StatusDialog from '../../components/common/StatusDialog';

const electron = window.require ? window.require('electron') : null;

const ScanRfidPajakPage = () => {
  const navigate = useNavigate();
  const [nopValue, setNopValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [pbbResult, setPbbResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

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
    const groups = [2, 2, 3, 3, 3, 4, 1];
    let cursor = 0;
    return groups
      .map((size) => {
        const part = val.slice(cursor, cursor + size);
        cursor += size;
        return part;
      })
      .filter(Boolean)
      .join('.');
  };

  const formatCurrency = (value) => {
    const numericValue = Number(value || 0);
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(numericValue);
  };

  const handleKeyPress = (key) => {
    if (key === 'CEK') {
      if (nopValue.length === 18) {
        processCode();
      }
    } else if (key === '←') {
      setErrorMessage('');
      setPbbResult(null);
      setNopValue(nopValue.slice(0, -1));
    } else {
      if (nopValue.length < 18) {
        setErrorMessage('');
        setPbbResult(null);
        setNopValue(nopValue + key);
      }
    }
  };

  const processCode = async () => {
    if (nopValue.length === 0) return;
    if (isProcessing) return;
    setIsProcessing(true);
    setErrorMessage('');
    setPbbResult(null);

    if (electron) {
      electron.ipcRenderer.invoke('voice:speakOnce', 'Mohon tunggu, sedang memeriksa data Pajak Bumi dan Bangunan Anda.').catch(() => {});
    }

    try {
      const result = electron
        ? await electron.ipcRenderer.invoke('kiosk:api:checkPbb', {
            nop: nopValue,
            tahun_pajak: new Date().getFullYear(),
          })
        : {
            success: true,
            found: true,
            status_bayar: 'belum_bayar',
            message: 'PBB Anda belum dibayar. Silakan lakukan pembayaran sebelum jatuh tempo.',
            data: {
              nop: nopValue,
              nama_wajib_pajak: 'Agus Salim',
              alamat_objek_pajak: 'Jl. Merdeka No. 5',
              tahun_pajak: new Date().getFullYear(),
              pbb_terhutang: 150000,
              denda: 0,
              total_tagihan: 150000,
              jumlah_dibayar: 0,
              sisa_tagihan: 150000,
              tanggal_jatuh_tempo: '31/08/2026',
              is_overdue: false,
              status_label: 'Belum Bayar',
            },
          };

      if (result?.success && result?.found !== false) {
        setPbbResult(result);
        if (electron) {
          const paid = result.status_bayar === 'sudah_bayar';
          electron.ipcRenderer.invoke(
            'voice:speakOnce',
            paid
              ? 'Pajak Bumi dan Bangunan Anda sudah dibayar. Terima kasih.'
              : 'Pajak Bumi dan Bangunan Anda belum dibayar. Rincian tagihan dapat dilihat pada layar.'
          ).catch(() => {});
        }
      } else {
        setErrorMessage(result?.message || 'Data PBB tidak ditemukan.');
        if (electron) {
          electron.ipcRenderer.invoke('voice:speakOnce', result?.message || 'Maaf, data PBB tidak ditemukan.').catch(() => {});
        }
      }
    } catch (error) {
      setErrorMessage(error.message || 'Gagal memeriksa data PBB.');
    } finally {
      setIsProcessing(false);
    }
  };

  const renderPbbResult = () => {
    if (!pbbResult?.data) return null;

    const data = pbbResult.data;
    const isPaid = pbbResult.status_bayar === 'sudah_bayar';
    const isOverdue = Boolean(data.is_overdue);

    return (
      <div style={{
        marginTop: 24,
        padding: '24px',
        borderRadius: '16px',
        background: isPaid ? 'rgba(16, 185, 129, 0.1)' : isOverdue ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
        border: `1px solid ${isPaid ? 'rgba(16, 185, 129, 0.3)' : isOverdue ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
        textAlign: 'left'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            {isPaid ? (
              <CheckCircleIcon size={48} color="#10b981" />
            ) : isOverdue ? (
              <AlertTriangleIcon size={48} color="#f87171" />
            ) : (
              <InfoIcon size={48} color="#f59e0b" />
            )}
          </div>
          <h3 style={{
            fontSize: 20,
            fontWeight: 600,
            color: isPaid ? '#10b981' : isOverdue ? '#f87171' : '#f59e0b',
            marginBottom: 8,
          }}>
            {isPaid ? 'PBB Sudah Lunas' : (data.status_label || 'Belum Bayar')}
          </h3>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: 14, lineHeight: 1.5 }}>{pbbResult.message}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Nama Wajib Pajak</p>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 'bold', color: 'white' }}>{data.nama_wajib_pajak || '-'}</p>
          </div>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Tahun Pajak</p>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 'bold', color: 'white' }}>{data.tahun_pajak || new Date().getFullYear()}</p>
          </div>

          {isPaid ? (
            <>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Tanggal Bayar</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 'bold', color: 'white' }}>{data.tanggal_bayar || '-'}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Nomor Bukti Bayar</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 'bold', color: 'white' }}>{data.nomor_bukti_bayar || '-'}</p>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Jumlah Dibayar</p>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 'bold', color: '#10b981' }}>{formatCurrency(data.jumlah_dibayar)}</p>
              </div>
            </>
          ) : (
            <>
              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Alamat Objek Pajak</p>
                <p style={{ margin: 0, fontSize: 14, color: 'white', lineHeight: 1.4 }}>{data.alamat_objek_pajak || '-'}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>PBB Terhutang</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 'bold', color: 'white' }}>{formatCurrency(data.pbb_terhutang)}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Denda</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 'bold', color: 'white' }}>{formatCurrency(data.denda)}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Total Tagihan</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 'bold', color: 'white' }}>{formatCurrency(data.total_tagihan)}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Jumlah Dibayar</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 'bold', color: 'white' }}>{formatCurrency(data.jumlah_dibayar)}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Sisa Tagihan</p>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 'bold', color: isOverdue ? '#f87171' : '#f59e0b' }}>{formatCurrency(data.sisa_tagihan)}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Jatuh Tempo</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 'bold', color: 'white' }}>{data.tanggal_jatuh_tempo || '-'}</p>
              </div>
            </>
          )}
        </div>
      </div>
    );
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
          style={{ letterSpacing: 'normal', fontSize: nopValue ? 'clamp(22px, 3.5vw, 42px)' : undefined, width: '100%', maxWidth: '720px' }}
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
          <>
            <StatusDialog
              isOpen={!!errorMessage}
              type="error"
              title="Pemeriksaan PBB Tidak Ditemukan"
              message={errorMessage}
              onClose={() => setErrorMessage('')}
              actionText="Periksa Ulang"
              secondaryActionText="Kembali ke Beranda"
              onSecondaryAction={() => navigate('/')}
            />

            {renderPbbResult()}

            {!pbbResult && (
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
          </>
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
