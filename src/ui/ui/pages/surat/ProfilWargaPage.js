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
import speakAfterPageReady from '../../utils/speakAfterPageReady';
const electron = window.require ? window.require('electron') : null;
const ProfilWargaPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const nik = location.state?.nik;
  const fromVoice = location.state?.fromVoice || false;
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
            console.log('[ProfilWargaPage] Data dari backend:', result.data);
            const data = result.data;
            
            // Normalize keys in case backend uses different field names
            if (!data.tempat_lahir && data.tpt_lahir) data.tempat_lahir = data.tpt_lahir;
            if (!data.tempat_lahir && data.tempatlahir) data.tempat_lahir = data.tempatlahir;
            
            // Inject NIK dari input jika backend tidak mengembalikannya
            if (!data.nik && nik) data.nik = nik;
            setWarga(data);
          } else {
            setError(result?.message || 'Data warga tidak ditemukan di backend.');
          }
        } else {
          setError('Aplikasi harus berjalan di Electron untuk mengambil data warga.');
        }
      } catch (err) {
        setError('Gagal mengambil data. Silakan coba lagi.');
        console.error('Fetch warga error:', err);
      }
      setLoading(false);
    };
    fetchWarga();
  }, [nik]);
  // Ucapkan profil warga saat data tersedia — gunakan speakOnce konsisten
  useEffect(() => {
    if (!warga || !electron || hasSynthesized.current) return;
    hasSynthesized.current = true;
    const pesan = `Data ditemukan atas nama ${warga.nama}. Silakan periksa data Anda pada layar, lalu tekan tombol Lanjut untuk memilih jenis surat.`;
    return speakAfterPageReady(electron, pesan);
  }, [warga]);

  const handleLanjut = () => {
    // Masuk ke manual mode — matikan AI processing di background
    if (!fromVoice && electron) {
      // Hanya matikan AI jika user masuk secara manual
      electron.ipcRenderer.invoke('voice:enterManualMode');
    }
    navigate('/surat', { state: { nik, warga, fromVoice } });
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
    const safe = (val) => (val !== null && val !== undefined && val !== '' && val !== '-') ? val : 'Tidak Ada';
    const safeTtl = (tempat, tgl) => {
      const t = safe(tempat);
      const d = tgl && tgl !== '-' ? formatDate(tgl) : 'Tidak Ada';
      if (t === 'Tidak Ada' && d === 'Tidak Ada') return 'Tidak Ada';
      if (t === 'Tidak Ada') return d;
      return `${t}, ${d}`;
    };
    const safeRtRw = (rt, rw, jorong) => {
      const r = safe(rt);
      const w = safe(rw);
      const j = safe(jorong);
      if (r === 'Tidak Ada' && w === 'Tidak Ada' && j === 'Tidak Ada') return 'Tidak Ada';
      let rtrwStr = (r !== 'Tidak Ada' || w !== 'Tidak Ada') ? `RT ${r !== 'Tidak Ada' ? r : '-'} / RW ${w !== 'Tidak Ada' ? w : '-'}` : '';
      if (j !== 'Tidak Ada') {
        return rtrwStr ? `${rtrwStr} (${j})` : `Jorong ${j}`;
      }
      return rtrwStr;
    };
    
    // Format L/P ke Laki-Laki/Perempuan
    let jk = safe(warga.jenis_kelamin);
    if (jk === 'L' || jk?.toLowerCase() === 'laki-laki') jk = 'Laki-Laki';
    if (jk === 'P' || jk?.toLowerCase() === 'perempuan') jk = 'Perempuan';

    const profileFields = [
      { label: 'NIK', value: safe(warga.nik) },
      { label: 'Nama Lengkap', value: safe(warga.nama), highlight: true },
      { label: 'Tempat / Tgl Lahir', value: safeTtl(warga.tempat_lahir, warga.tanggal_lahir) },
      { label: 'Jenis Kelamin', value: jk },
      { label: 'Alamat', value: safe(warga.alamat) },
      { label: 'RT / RW / Jorong', value: safeRtRw(warga.rt, warga.rw, warga.jorong) },
      { label: 'No. Handphone', value: safe(warga.phone_number) },
      { label: 'Agama', value: safe(warga.agama) },
      { label: 'Pekerjaan', value: safe(warga.pekerjaan) },
    ];
    return (
      <div className="page-enter" style={{ textAlign: 'center', width: '100%', maxWidth: 1600, margin: '16px auto 0 auto' }}>
        {/* Profile Card */}
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
          {/* Header accent bar */}
          <div style={{
            height: 8,
            background: 'var(--gradient-accent)',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
          }} />
          <div style={{ padding: '32px 56px 24px' }}>
            {profileFields.map((field, i) => (
              <div key={i} className="data-row" style={{
                padding: '16px 0',
                borderBottom: i < profileFields.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              }}>
                <span className="data-label" style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '20px' }}>
                  {field.label}
                </span>
                <span className="data-value" style={{
                  color: field.value === 'Tidak Ada' ? 'var(--text-muted)' : (field.highlight ? 'var(--accent-light)' : 'var(--text-primary)'),
                  fontWeight: field.highlight ? 800 : 600,
                  fontSize: field.highlight ? 32 : 24,
                  fontStyle: field.value === 'Tidak Ada' ? 'italic' : 'normal',
                }}>
                  {field.value}
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
          marginTop: 12,
          marginBottom: 16,
          padding: '8px 24px',
          borderRadius: 24,
          background: 'rgba(52, 211, 153, 0.1)',
          border: '1px solid rgba(52, 211, 153, 0.3)',
          color: 'var(--accent-success)',
          fontSize: 16,
          fontWeight: 600,
        }}>
          <span style={{ fontSize: 12 }}>●</span>
          Data Terverifikasi
        </div>
        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'row', gap: 16, marginBottom: 16 }}>
          <button
            onClick={() => navigate('/input-nik')}
            style={{ fontSize: 24, padding: '20px 32px', flex: 1, background: '#ef4444', color: 'white', border: 'none', borderRadius: 16, boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)', cursor: 'pointer', fontWeight: 600 }}
          >
            ← Ubah NIK
          </button>
          <button
            className="btn btn-primary"
            onClick={handleLanjut}
            style={{ fontSize: 28, padding: '20px 32px', flex: 2 }}
          >
            Lanjut → Pilih Surat
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
