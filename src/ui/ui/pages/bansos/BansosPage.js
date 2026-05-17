import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import speakAfterPageReady from '../../utils/speakAfterPageReady';

const electron = window.require ? window.require('electron') : null;

const normalizeBansosStatus = (result, fallbackNik) => {
  // ── Case 1: API error (404 / success:false) ──
  // Ini terjadi saat e-KTP belum terdaftar atau data tidak ditemukan
  if (result?.success === false) {
    const isNotFound = result?.statusCode === 404;
    const msg = String(result?.message || '').toLowerCase();
    // Deteksi apakah error karena e-KTP belum terdaftar atau data tidak ditemukan
    const isEktpError = isNotFound || msg.includes('ektp') || msg.includes('ktp') || msg.includes('tidak ditemukan') || msg.includes('not found');

    return {
      nik: fallbackNik || '',
      nama: '-',
      alamat: '-',
      terdaftar: false,
      bantuan: [],
      errorType: isEktpError ? 'EKTP_NOT_REGISTERED' : 'DATA_NOT_FOUND',
      message: result?.message || 'Data tidak ditemukan',
    };
  }

  // ── Case 2: API success — parse response dari /api/device/bansos/check ──
  // Struktur: { success, data: { warga: {...}, bansos: {...} } }
  const warga = result?.data?.warga || {};
  const bansos = result?.data?.bansos || {};

  const isRegistered = Boolean(bansos.has_bansos);

  // Map programs array ke format bantuan
  const programs = bansos.programs || [];
  const bantuan = programs.map((item) => {
    if (typeof item === 'string') {
      return { jenis: item, detail: '', periode: '' };
    }
    return {
      jenis: item.jenis || item.nama || item.name || '-',
      detail: item.detail || item.nominal || item.keterangan || '',
      periode: item.periode || item.tahap || '',
    };
  });

  // Jika tidak ada programs tapi ada flag PKH/Raskin/BPNT, build list dari flag
  if (bantuan.length === 0 && isRegistered) {
    if (bansos.pkh) bantuan.push({ jenis: 'PKH (Program Keluarga Harapan)', detail: '', periode: '' });
    if (bansos.raskin) bantuan.push({ jenis: 'Raskin (Beras Miskin)', detail: '', periode: '' });
    if (bansos.bpnt) bantuan.push({ jenis: 'BPNT (Bantuan Pangan Non-Tunai)', detail: '', periode: '' });
  }

  return {
    nik: warga.nik_mask || fallbackNik || '',
    nama: warga.nama || '-',
    alamat: warga.jorong ? `Jorong ${warga.jorong}` : '-',
    terdaftar: isRegistered,
    bantuan,
    errorType: isRegistered ? null : 'NOT_RECIPIENT',
    message: result?.message || '',
  };
};

const BansosPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const nik = location.state?.nik;
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const hasGreetedRef = useRef(false);

  // Sambutan saat halaman dibuka
  useEffect(() => {
    if (hasGreetedRef.current) return;
    hasGreetedRef.current = true;
    if (electron) {
      return speakAfterPageReady(
        electron,
        'Silakan tunggu, kami sedang memproses data bantuan sosial Anda.'
      );
    }
  }, []);

  useEffect(() => {
    const checkBansos = async () => {
      if (!nik) {
        setStatus({
          nik: '',
          nama: '-',
          alamat: '-',
          terdaftar: false,
          bantuan: [],
          message: 'NIK tidak ditemukan. Silakan scan e-KTP terlebih dahulu.',
        });
        setLoading(false);
        return;
      }

      if (electron) {
        try {
          const result = await electron.ipcRenderer.invoke('kiosk:api:cekBansos', nik);
          setStatus(normalizeBansosStatus(result, nik));
        } catch (error) {
          setStatus({
            nik,
            nama: '-',
            alamat: '-',
            terdaftar: false,
            bantuan: [],
            message: error.message || 'Gagal mengambil data bansos.',
          });
        }
      } else {
        setStatus({
          nik,
          nama: '-',
          alamat: '-',
          terdaftar: false,
          bantuan: [],
          message: 'Aplikasi harus berjalan di Electron untuk mengambil data bansos.',
        });
      }
      setLoading(false);
    };
    checkBansos();
  }, [nik]);

  useEffect(() => {
    if (!loading && status && electron) {
      let pesan;
      if (status.terdaftar) {
        pesan = `Selamat. E-KTP Anda terdaftar sebagai penerima bantuan sosial. Anda menerima ${status.bantuan?.length || 0} jenis bantuan. Rincian dapat dilihat pada layar.`;
      } else if (status.errorType === 'EKTP_NOT_REGISTERED') {
        pesan = 'Maaf, e-KTP Anda belum terdaftar di sistem. Silakan hubungi petugas staff nagari untuk melakukan perekaman e-KTP terlebih dahulu.';
      } else if (status.errorType === 'DATA_NOT_FOUND') {
        pesan = 'Maaf, data Anda tidak ditemukan di sistem. Silakan periksa kembali atau hubungi petugas nagari.';
      } else {
        pesan = 'Maaf, Anda belum terdaftar sebagai penerima bantuan sosial pada periode ini. Terima kasih sudah menggunakan layanan Anjungan Nagari Mandiri.';
      }
      electron.ipcRenderer.invoke('voice:speakOnce', pesan).catch(() => {});
    }
  }, [loading, status]);

  if (loading) {
    return (
      <div className="page-enter" style={{ textAlign: 'center' }}>
        <h2 className="page-title">Mengecek Data Bansos</h2>
        <div className="shimmer" style={{ width: 300, height: 120, borderRadius: 16, margin: '40px auto' }} />
      </div>
    );
  }

  return (
    <div className="page-enter" style={{ textAlign: 'center', width: '100%', maxWidth: 500, margin: '0 auto' }}>
      <h2 className="page-title">Hasil Pengecekan Bansos</h2>

      <div className="glass-card" style={{ marginTop: 24, padding: '32px', textAlign: 'left' }}>
        
        {/* Profil KTP */}
        <h3 style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>
          Profil Pemegang e-KTP
        </h3>
        
        <div style={{ marginBottom: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Nama Terdaftar</p>
            <p style={{ margin: '0', fontSize: 16, fontWeight: 'bold', color: 'white' }}>{status.nama}</p>
          </div>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Kode RFID (KTP)</p>
            <p style={{ margin: '0', fontSize: 16, fontWeight: 'bold', color: 'white' }}>{status.nik}</p>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Alamat</p>
            <p style={{ margin: '0', fontSize: 14, color: 'white', lineHeight: '1.4' }}>{status.alamat}</p>
          </div>
        </div>

        {/* Status Area */}
        <div style={{ 
          padding: '24px', 
          borderRadius: '16px', 
          background: status.terdaftar 
            ? 'rgba(16, 185, 129, 0.1)' 
            : status.errorType === 'EKTP_NOT_REGISTERED' 
              ? 'rgba(245, 158, 11, 0.1)' 
              : 'rgba(239, 68, 68, 0.1)', 
          border: `1px solid ${status.terdaftar 
            ? 'rgba(16, 185, 129, 0.3)' 
            : status.errorType === 'EKTP_NOT_REGISTERED' 
              ? 'rgba(245, 158, 11, 0.3)' 
              : 'rgba(239, 68, 68, 0.3)'}`, 
          textAlign: 'center' 
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>
            {status.terdaftar ? '✅' : status.errorType === 'EKTP_NOT_REGISTERED' ? '🪪' : '❌'}
          </div>

          <h3 style={{
            fontSize: 20,
            fontWeight: 600,
            color: status.terdaftar ? '#10b981' : status.errorType === 'EKTP_NOT_REGISTERED' ? '#f59e0b' : '#f87171',
            marginBottom: 12,
          }}>
            {status.terdaftar
              ? 'Anda Terdaftar sebagai Penerima'
              : status.errorType === 'EKTP_NOT_REGISTERED'
                ? 'e-KTP Tidak Terdaftar'
                : status.errorType === 'DATA_NOT_FOUND'
                  ? 'Data Tidak Terdaftar'
                  : 'Belum Menerima Bantuan Sosial'
            }
          </h3>

          {!status.terdaftar && (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              {status.errorType === 'EKTP_NOT_REGISTERED'
                ? 'e-KTP Anda belum terdaftar di sistem. Silakan datang ke kantor nagari dan hubungi staff untuk melakukan perekaman e-KTP.'
                : status.errorType === 'DATA_NOT_FOUND'
                  ? 'Data tidak ditemukan di sistem. Pastikan e-KTP Anda sudah terdaftar dengan benar.'
                  : (status.message || 'Anda belum terdaftar sebagai penerima bantuan sosial pada periode ini.')
              }<br /><br />
              <strong style={{ color: 'white' }}>Terima kasih sudah menggunakan Layanan ANM.</strong>
            </p>
          )}

          {status.terdaftar && status.bantuan && status.bantuan.length > 0 && (
            <div style={{ textAlign: 'left', marginTop: 24, borderTop: '1px solid rgba(16, 185, 129, 0.2)', paddingTop: 16 }}>
              <h4 style={{ color: 'white', marginBottom: '16px', fontSize: '15px' }}>Rincian Bantuan yang Diterima:</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {status.bantuan.map((item, idx) => (
                  <div key={idx} style={{ background: 'var(--bg-glass)', padding: '12px', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
                    <div style={{ fontWeight: 'bold', color: 'white', fontSize: '14px', marginBottom: '4px' }}>{item.jenis}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <span style={{ color: '#10b981', fontWeight: 600 }}>{item.detail}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>🗓 {item.periode}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        className="btn btn-primary btn-lg"
        style={{ marginTop: 32 }}
        onClick={() => navigate('/')}
      >
        Selesai
      </button>
    </div>
  );
};

export default BansosPage;
