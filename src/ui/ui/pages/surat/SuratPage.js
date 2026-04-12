/**
 * SuratPage — Halaman Pilih Jenis Surat + Slot Filling
 * 
 * Flow: Input NIK → Profil Warga → [PILIH SURAT] → Slot Filling → Print
 * 
 * PENTING: Tidak boleh listen IPC sendiri!
 * Semua state dari IPC dikelola oleh useVoiceSession (GlobalVoiceWidget).
 * Page ini hanya menggunakan electron.ipcRenderer.invoke() untuk kirim perintah.
 */
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

const SuratPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const nik = location.state?.nik;
  const warga = location.state?.warga;
  const [selectedSurat, setSelectedSurat] = useState(null);

  // Poll session data untuk slot filling display (tanpa listener duplikat)
  const [sessionData, setSessionData] = useState(null);
  const [phase, setPhase] = useState(null);

  useEffect(() => {
    // Poll session state setiap 500ms — TIDAK PAKAI LISTENER
    const interval = setInterval(async () => {
      if (electron) {
        try {
          const session = await electron.ipcRenderer.invoke('session:getState');
          if (session) {
            setSessionData(session);
            setPhase(session.phase);
            if (session.jenis_surat) {
              setSelectedSurat(session.jenis_surat);
            }
            // Auto-navigate ke printing saat EXECUTING/DONE
            if (session.phase === 'EXECUTING' || session.phase === 'DONE') {
              navigate('/printing', { state: { result: session.result, warga } });
            }
          }
        } catch { /* session belum ada */ }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [navigate, warga]);

  const handlePilihSurat = async (jenis) => {
    setSelectedSurat(jenis);
    if (electron) {
      // Kirim ke voice system — trigger intent + slot filling
      await electron.ipcRenderer.invoke('voice:processTranscript',
        `Saya ingin membuat ${jenis}`
      );
    }
  };

  const suratOptions = [
    {
      key: 'BUAT_SURAT_DOMISILI',
      label: 'Surat Domisili',
      desc: 'Keterangan tempat tinggal resmi',
      icon: '📍',
      color: '#6366f1',
    },
    {
      key: 'BUAT_SURAT_USAHA',
      label: 'Surat Keterangan Usaha',
      desc: 'Keterangan kepemilikan usaha',
      icon: '🏪',
      color: '#f59e0b',
    },
    {
      key: 'BUAT_SURAT_TIDAK_MAMPU',
      label: 'Surat Tidak Mampu',
      desc: 'Keterangan kondisi ekonomi',
      icon: '🤝',
      color: '#10b981',
    },
  ];

  return (
    <div className="page-enter" style={{ textAlign: 'center', width: '100%', maxWidth: 650, margin: '0 auto' }}>

      {/* Header — Warga Info Mini Card */}
      {warga && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 20px',
          background: 'var(--bg-glass)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid rgba(255,255,255,0.08)',
          marginBottom: 24,
          textAlign: 'left',
        }}>
          <div style={{ fontSize: 36 }}>👤</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
              {warga.nama}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              NIK: {warga.nik} · {warga.alamat}
            </div>
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => navigate('/profil-warga', { state: { nik } })}
          >
            Lihat Profil
          </button>
        </div>
      )}

      {/* Page Title */}
      <h2 className="page-title">
        {selectedSurat && phase === 'SLOT_FILLING' ? `📝 ${selectedSurat}` :
         selectedSurat && phase === 'CONFIRMATION' ? `✅ Konfirmasi ${selectedSurat}` :
         '📋 Pilih Jenis Surat'}
      </h2>
      <p className="page-subtitle">
        {selectedSurat && phase === 'SLOT_FILLING' ? 'Silakan lengkapi data surat melalui asisten suara' :
         selectedSurat && phase === 'CONFIRMATION' ? 'Periksa data berikut dan konfirmasi' :
         'Pilih jenis surat yang ingin diurus'}
      </p>

      {/* Surat Selection — show if no slot filling active */}
      {(!selectedSurat || (!phase && !sessionData)) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          {suratOptions.map((surat) => (
            <button
              key={surat.key}
              className="glass-card"
              onClick={() => handlePilihSurat(surat.label)}
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                textAlign: 'left',
                padding: '20px 24px',
                border: '1px solid rgba(255,255,255,0.1)',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{
                fontSize: 40,
                width: 64,
                height: 64,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 16,
                background: `${surat.color}20`,
              }}>
                {surat.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: 4,
                }}>
                  {surat.label}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {surat.desc}
                </div>
              </div>
              <div style={{ fontSize: 20, color: 'var(--text-muted)' }}>→</div>
            </button>
          ))}
        </div>
      )}

      {/* Slot Filling Progress */}
      {sessionData && (phase === 'SLOT_FILLING' || phase === 'CONFIRMATION') && (
        <div className="interview-panel" style={{ marginTop: 16 }}>
          <div className="interview-title">
            {phase === 'CONFIRMATION' ? '✅ Data Lengkap — Konfirmasi' : '📝 Mengumpulkan Data Surat'}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
            {phase === 'CONFIRMATION' 
              ? 'Konfirmasi melalui asisten suara: "Ya, benar" atau "Tidak, ubah"' 
              : 'Jawab pertanyaan dari asisten suara SINTA'}
          </p>

          {sessionData.slots && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(sessionData.slots).map(([key, value]) => (
                <div key={key} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 16px',
                  borderRadius: 10,
                  background: value ? 'rgba(52, 211, 153, 0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${value ? 'rgba(52, 211, 153, 0.2)' : 'rgba(255,255,255,0.05)'}`,
                  transition: 'all 0.3s ease',
                }}>
                  <div style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    background: value ? 'var(--accent-success)' : 'rgba(255,255,255,0.1)',
                    color: value ? 'white' : 'var(--text-muted)',
                  }}>
                    {value ? '✓' : '·'}
                  </div>
                  <span style={{ flex: 1, fontSize: 14, color: 'var(--text-secondary)' }}>{key}</span>
                  <span style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: value ? 'var(--accent-success)' : 'var(--text-muted)',
                  }}>
                    {value || 'Menunggu...'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Back Button */}
      <button
        className="btn btn-secondary"
        style={{ marginTop: 32 }}
        onClick={() => {
          if (selectedSurat && !phase) {
            setSelectedSurat(null);
          } else {
            navigate('/profil-warga', { state: { nik } });
          }
        }}
      >
        ← {selectedSurat && !phase ? 'Pilih Surat Lain' : 'Kembali ke Profil'}
      </button>
    </div>
  );
};

export default SuratPage;
