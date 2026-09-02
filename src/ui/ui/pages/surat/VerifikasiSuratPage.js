/**
 * VerifikasiSuratPage — Halaman Khusus Review & Verifikasi Data Sebelum Cetak
 * 
 * Flow: Input NIK -> Profil Warga -> Pilih Surat -> [VERIFIKASI DATA] -> Printing
 * 
 * Menampilkan ringkasan lengkap data pemohon + data surat yang akan diajukan
 * dengan opsi untuk memeriksa kembali atau menyetujui & mencetak surat.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import speakAfterPageReady from '../../utils/speakAfterPageReady';
import StatusDialog from '../../components/common/StatusDialog';
import { CheckCircleIcon, ShieldCheckIcon, SuratIcon, AlertTriangleIcon } from '../../components/Icons';

const electron = window.require ? window.require('electron') : null;

const VerifikasiSuratPage = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    nik,
    warga,
    selectedSurat,
    templateObj,
    slots = {},
    sessionData = {},
    fromVoice = false,
  } = location.state || {};

  const [submitting, setSubmitting] = useState(false);
  const [errorDialog, setErrorDialog] = useState('');
  const hasSpokenRef = useRef(false);

  // Fallback jika state tidak lengkap (misal direct URL access)
  useEffect(() => {
    if (!nik || !selectedSurat) {
      navigate('/surat', { replace: true });
    }
  }, [nik, selectedSurat, navigate]);

  // Sambutan suara asisten SINTA
  useEffect(() => {
    if (hasSpokenRef.current || !electron) return;
    hasSpokenRef.current = true;

    const pesan = `Silakan periksa kembali data permohonan surat Anda pada layar. Jika semua data sudah benar, silakan tekan tombol Setujui dan Cetak Surat.`;
    return speakAfterPageReady(electron, pesan, 400);
  }, []);

  // Cleanup suara saat keluar halaman
  useEffect(() => {
    return () => {
      if (electron) electron.ipcRenderer.invoke('voice:stopSpeaking').catch(() => {});
    };
  }, []);

  // Format Helper
  const safe = (val) => (val !== null && val !== undefined && val !== '' && val !== '-') ? val : '-';

  const formatDate = (dateStr) => {
    if (!dateStr || dateStr === '-') return '-';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const handleConfirmAndPrint = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorDialog('');

    if (!electron) {
      alert('Aplikasi harus berjalan di Electron.');
      setSubmitting(false);
      return;
    }

    try {
      const templateId = templateObj?.id || sessionData?.templateId || null;
      const keperluan = slots?.keperluan || sessionData?.slots?.keperluan || 'Keperluan pengurusan administrasi warga';

      const submitData = {
        nik: nik,
        template_id: templateId,
        keperluan: keperluan,
        custom_data: {
          ...slots,
          ...(sessionData?.slots || {})
        }
      };

      console.log('[VerifikasiSuratPage] Mengirim request buatSurat:', submitData);
      const result = await electron.ipcRenderer.invoke('kiosk:api:buatSurat', submitData);

      if (result && (result.status === 'success' || result.success)) {
        console.log('[VerifikasiSuratPage] Surat berhasil dibuat, menuju printing:', result);
        navigate('/printing', {
          state: {
            result: {
              ...sessionData,
              receipt: result
            },
            warga,
            fromVoice
          }
        });
      } else {
        const errorMsg = result?.pesan || result?.message || 'Gagal memproses permohonan surat ke server.';
        setErrorDialog(errorMsg);
        setSubmitting(false);
      }
    } catch (err) {
      console.error('[VerifikasiSuratPage] Error submitting surat:', err);
      setErrorDialog('Terjadi gangguan koneksi ke server. Silakan coba sesaat lagi.');
      setSubmitting(false);
    }
  };

  // Filter slots custom fields (selain NIK)
  const customSlotEntries = Object.entries(slots).filter(([k]) => k !== 'nik');

  return (
    <div className="page-enter" style={{
      width: '100%',
      maxWidth: '1500px',
      margin: '0 auto',
      padding: '0 24px 24px 24px',
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px'
    }}>
      {/* Header Banner */}
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        <h2 style={{
          fontSize: 'clamp(24px, 2.5vw, 36px)',
          fontWeight: '800',
          color: '#ffffff',
          fontFamily: 'var(--font-heading)',
          textShadow: '0 4px 16px rgba(0,0,0,0.4)',
          marginBottom: '6px'
        }}>
          Verifikasi & Tinjau Data Surat
        </h2>
        <p style={{
          fontSize: 'clamp(14px, 1.4vw, 18px)',
          color: 'rgba(255, 255, 255, 0.9)',
          textShadow: '0 2px 8px rgba(0,0,0,0.3)'
        }}>
          Mohon periksa kembali kebenaran identitas pemohon dan data isian surat sebelum dicetak
        </p>
      </div>

      {/* Main Review Grid (2 Kolom: Data Pemohon & Data Surat) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))',
        gap: '24px',
        textAlign: 'left'
      }}>
        {/* KARTU 1: Data Identitas Pemohon */}
        <div className="glass-card" style={{
          padding: '28px 32px',
          borderRadius: '24px',
          position: 'relative',
          overflow: 'hidden',
          background: 'rgba(15, 23, 42, 0.75)',
          border: '1.5px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div style={{
            height: '6px',
            background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
            position: 'absolute',
            top: 0, left: 0, right: 0
          }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              👤
            </div>
            <div>
              <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#ffffff', margin: 0 }}>Identitas Pemohon</h3>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Data kependudukan terdaftar di Nagari</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="data-row" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>Nama Lengkap</span>
              <span style={{ color: '#60a5fa', fontWeight: '700', fontSize: '18px' }}>{safe(warga?.nama)}</span>
            </div>

            <div className="data-row" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>NIK</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: '600', fontSize: '16px', letterSpacing: '1px' }}>{safe(nik || warga?.nik)}</span>
            </div>

            <div className="data-row" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>Tempat / Tgl Lahir</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: '500', fontSize: '15px' }}>
                {safe(warga?.tempat_lahir || warga?.tpt_lahir)}, {formatDate(warga?.tanggal_lahir)}
              </span>
            </div>

            <div className="data-row" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>Jenis Kelamin</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: '500', fontSize: '15px' }}>
                {warga?.jenis_kelamin === 'L' ? 'Laki-Laki' : (warga?.jenis_kelamin === 'P' ? 'Perempuan' : safe(warga?.jenis_kelamin))}
              </span>
            </div>

            <div className="data-row" style={{ padding: '8px 0' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>Alamat / Jorong</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: '500', fontSize: '15px', maxWidth: '60%', textAlign: 'right' }}>
                {safe(warga?.alamat)} {warga?.jorong ? `(Jorong ${warga.jorong})` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* KARTU 2: Rincian Surat & Isian */}
        <div className="glass-card" style={{
          padding: '28px 32px',
          borderRadius: '24px',
          position: 'relative',
          overflow: 'hidden',
          background: 'rgba(15, 23, 42, 0.75)',
          border: '1.5px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div style={{
            height: '6px',
            background: 'linear-gradient(90deg, #10b981, #34d399)',
            position: 'absolute',
            top: 0, left: 0, right: 0
          }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: 'rgba(16, 185, 129, 0.2)', border: '1px solid rgba(16, 185, 129, 0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              📄
            </div>
            <div>
              <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#ffffff', margin: 0 }}>Rincian Surat yang Diajukan</h3>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Format dan isian dokumen surat resmi</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="data-row" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>Jenis Surat</span>
              <span style={{
                color: '#34d399',
                fontWeight: '800',
                fontSize: '18px',
                background: 'rgba(16, 185, 129, 0.15)',
                padding: '4px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(16, 185, 129, 0.3)'
              }}>
                {selectedSurat}
              </span>
            </div>

            {/* Custom Input Fields / Keperluan */}
            {customSlotEntries.length > 0 ? (
              customSlotEntries.map(([key, val]) => {
                const def = sessionData?.slotDefs?.find(d => d.key === key);
                const label = def?.label || key.replace(/_/g, ' ').toUpperCase();
                return (
                  <div key={key} className="data-row" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '15px', textTransform: 'capitalize' }}>{label}</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '600', fontSize: '16px', maxWidth: '60%', textAlign: 'right' }}>
                      {safe(val)}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="data-row" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>Keperluan</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: '500', fontSize: '15px' }}>
                  {safe(slots?.keperluan || 'Pengurusan Administrasi')}
                </span>
              </div>
            )}

            <div className="data-row" style={{ padding: '8px 0' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>Instansi Penerbit</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: '500', fontSize: '15px' }}>Pemerintah Nagari</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pernyataan Kebenaran Data */}
      <div style={{
        background: 'rgba(59, 130, 246, 0.1)',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        borderRadius: '16px',
        padding: '14px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        maxWidth: '900px',
        margin: '0 auto'
      }}>
        <span style={{ fontSize: '22px' }}>🛡️</span>
        <span style={{ color: '#93c5fd', fontSize: '14px', lineHeight: '1.4', textAlign: 'left' }}>
          Saya menyatakan bahwa data yang tercantum pada rincian di atas telah diperiksa dengan seksama, benar, dan sah sesuai identitas kependudukan saya.
        </span>
      </div>

      {/* Status Dialog untuk Error Submission */}
      <StatusDialog
        isOpen={!!errorDialog}
        type="error"
        title="Gagal Memproses Surat"
        message={errorDialog}
        onClose={() => setErrorDialog('')}
        actionText="Coba Lagi"
        secondaryActionText="Kembali ke Pilihan Surat"
        onSecondaryAction={() => navigate('/surat', { state: { nik, warga, fromVoice } })}
      />

      {/* Action Buttons Footer */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '20px',
        marginTop: '8px',
        flexWrap: 'wrap'
      }}>
        {/* Tombol Ubah / Kembali */}
        <button
          type="button"
          onClick={() => navigate('/surat', { state: { nik, warga, fromVoice } })}
          disabled={submitting}
          style={{
            flex: '1',
            maxWidth: '320px',
            padding: '18px 28px',
            fontSize: '18px',
            fontWeight: '600',
            borderRadius: '16px',
            background: '#1e293b',
            color: '#cbd5e1',
            border: '2px solid #475569',
            cursor: submitting ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}
        >
          ← Ubah Isian Data
        </button>

        {/* Tombol Setujui & Cetak */}
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleConfirmAndPrint}
          disabled={submitting}
          style={{
            flex: '2',
            maxWidth: '540px',
            padding: '18px 36px',
            fontSize: '22px',
            fontWeight: '800',
            borderRadius: '16px',
            background: submitting
              ? '#475569'
              : 'linear-gradient(135deg, #10b981, #059669)',
            color: '#ffffff',
            border: 'none',
            boxShadow: submitting ? 'none' : '0 8px 28px rgba(16, 185, 129, 0.4)',
            cursor: submitting ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px'
          }}
        >
          {submitting ? (
            <>
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
              <span>Memproses & Menyiapkan Dokumen...</span>
            </>
          ) : (
            <>
              <span>✓ Data Sudah Benar — Cetak & Ajukan Surat</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default VerifikasiSuratPage;
