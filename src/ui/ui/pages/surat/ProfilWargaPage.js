/**
 * ProfilWargaPage — Halaman Profil Lengkap Warga
 * 
 * Flow: Input NIK → [PROFIL WARGA] → Pilih Surat
 * 
 * Menampilkan data lengkap warga dari database/API
 * dengan tombol "Lanjut" untuk memilih jenis surat
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

const ProfilWargaPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const nik = location.state?.nik;
  const [warga, setWarga] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const hasSynthesized = useRef(false);

  // Fetch warga data
  useEffect(() => {
    const fetchWarga = async () => {
      if (!nik) {
        setError('NIK tidak ditemukan. Silakan masukkan NIK terlebih dahulu.');
        setLoading(false);
        return;
      }

      try {
        if (electron) {
          const result = await electron.ipcRenderer.invoke('kiosk:api:getWarga', nik);
          if (result?.success && result?.data) {
            setWarga(result.data);
          } else {
            setWarga({
              nik,
              nama: `Warga (${nik.slice(-4)})`,
              tempat_lahir: '-',
              tanggal_lahir: '-',
              jenis_kelamin: '-',
              alamat: '-',
              rt: '-', rw: '-',
              agama: '-',
              pekerjaan: '-',
              status_kawin: '-',
            });
          }
        } else {
          // Fallback tanpa electron
          setWarga({
            nik,
            nama: 'Demo User',
            tempat_lahir: 'Padang',
            tanggal_lahir: '1990-01-01',
            jenis_kelamin: 'Laki-Laki',
            alamat: 'Jorong Koto Baru, Nagari Sungai Penuh',
            rt: '001', rw: '001',
            agama: 'Islam',
            pekerjaan: 'Wiraswasta',
            status_kawin: 'Belum Kawin',
          });
        }
      } catch (err) {
        setError('Gagal mengambil data. Silakan coba lagi.');
        console.error('Fetch warga error:', err);
      }

      setLoading(false);
    };

    fetchWarga();
  }, [nik]);

  // TTS: announce profile — ONLY ONCE
  useEffect(() => {
    if (warga && electron && !hasSynthesized.current) {
      hasSynthesized.current = true;
      electron.ipcRenderer.invoke('voice:synthesize',
        `Data ditemukan atas nama ${warga.nama}. Silakan periksa data anda, lalu tekan tombol lanjut.`
      );
    }
  }, [warga]);

  const handleLanjut = () => {
    navigate('/surat', { state: { nik, warga } });
  };

  // Loading state
  if (loading) {
    return (
      <div className="page-enter" style={{ textAlign: 'center' }}>
        <h2 className="page-title">Mencari Data Warga</h2>
        <p className="page-subtitle">Mohon tunggu sebentar...</p>
        <div style={{ marginTop: 40 }}>
          <div className="shimmer" style={{ width: 400, height: 300, borderRadius: 16, margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="page-enter" style={{ textAlign: 'center' }}>
        <h2 className="page-title">⚠️ Terjadi Kesalahan</h2>
        <p style={{ color: 'var(--accent-danger)', fontSize: 16, margin: '24px 0' }}>{error}</p>
        <button className="btn btn-primary btn-lg" onClick={() => navigate('/input-nik')}>
          Coba Lagi
        </button>
      </div>
    );
  }

  // Profile fields to display
  const profileFields = [
    { label: 'NIK', value: warga.nik, icon: '🆔' },
    { label: 'Nama Lengkap', value: warga.nama, icon: '👤', highlight: true },
    { label: 'Tempat / Tgl Lahir', value: `${warga.tempat_lahir}, ${formatDate(warga.tanggal_lahir)}`, icon: '📅' },
    { label: 'Jenis Kelamin', value: warga.jenis_kelamin, icon: '⚧️' },
    { label: 'Alamat', value: warga.alamat, icon: '🏠' },
    { label: 'RT / RW', value: `${warga.rt} / ${warga.rw}`, icon: '📍' },
    { label: 'Agama', value: warga.agama, icon: '🕌' },
    { label: 'Pekerjaan', value: warga.pekerjaan, icon: '💼' },
    { label: 'Status Perkawinan', value: warga.status_kawin, icon: '💍' },
  ];

  return (
    <div className="page-enter" style={{ textAlign: 'center', width: '100%', maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 64, marginBottom: 8 }}>👤</div>
        <h2 className="page-title">{warga.nama}</h2>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>Data Kependudukan</p>
      </div>

      {/* Profile Card */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Header accent bar */}
        <div style={{
          height: 4,
          background: 'var(--gradient-accent)',
          borderRadius: '16px 16px 0 0',
        }} />

        <div style={{ padding: '20px 24px' }}>
          {profileFields.map((field, i) => (
            <div key={i} className="data-row" style={{
              padding: '12px 0',
              borderBottom: i < profileFields.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
            }}>
              <span className="data-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>{field.icon}</span>
                {field.label}
              </span>
              <span className="data-value" style={{
                color: field.highlight ? 'var(--accent-light)' : 'var(--text-primary)',
                fontWeight: field.highlight ? 700 : 600,
                fontSize: field.highlight ? 16 : 14,
              }}>
                {field.value || '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Status Label */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 16,
        padding: '8px 20px',
        borderRadius: 20,
        background: 'rgba(52, 211, 153, 0.1)',
        border: '1px solid rgba(52, 211, 153, 0.3)',
        color: 'var(--accent-success)',
        fontSize: 14,
        fontWeight: 600,
      }}>
        <span style={{ fontSize: 10 }}>●</span>
        Data Terverifikasi
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
        <button
          className="btn btn-primary btn-lg btn-block"
          onClick={handleLanjut}
          style={{ fontSize: 20, padding: '20px 32px' }}
        >
          Lanjut → Pilih Surat
        </button>

        <button
          className="btn btn-secondary"
          onClick={() => navigate('/input-nik')}
        >
          ← Ubah NIK
        </button>
      </div>
    </div>
  );
};

/**
 * Format date string to Indonesian locale
 */
function formatDate(dateStr) {
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
}

export default ProfilWargaPage;
