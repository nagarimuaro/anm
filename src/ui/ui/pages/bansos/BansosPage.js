import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import speakAfterPageReady from '../../utils/speakAfterPageReady';

const electron = window.require ? window.require('electron') : null;

const normalizeBansosStatus = (result, fallbackNik) => {
  const data = result?.data || {};
  const statusText = String(data.status || data.status_bansos || '').toLowerCase();
  const isNegativeStatus = statusText.includes('bukan') || statusText.includes('tidak');
  const isRegistered = Boolean(
    data.terdaftar
    ?? data.registered
    ?? data.is_registered
    ?? (statusText.includes('penerima') && !isNegativeStatus)
  );

  const rawAssistance = data.bantuan || data.bantuans || data.jenis_bantuan || data.jenis || [];
  const bantuan = Array.isArray(rawAssistance)
    ? rawAssistance.map((item) => {
      if (typeof item === 'string') {
        return {
          jenis: item,
          detail: data.keterangan || '',
          periode: data.periode || '',
        };
      }

      return {
        jenis: item.jenis || item.nama || item.name || '-',
        detail: item.detail || item.nominal || item.keterangan || '',
        periode: item.periode || item.tahap || '',
      };
    })
    : [];

  return {
    nik: data.nik || fallbackNik || '',
    nama: data.nama || data.name || '-',
    alamat: data.alamat || data.address || '-',
    terdaftar: isRegistered,
    bantuan,
    message: data.message || result?.message || '',
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
      const pesan = status.terdaftar
        ? `Selamat. E-KTP Anda terdaftar sebagai penerima bantuan sosial. Anda menerima ${status.bantuan?.length || 0} jenis bantuan. Rincian dapat dilihat pada layar.`
        : 'Maaf. Data Anda belum terdaftar sebagai penerima bantuan sosial pada periode ini. Terima kasih sudah menggunakan layanan Anjungan Nagari Mandiri.';
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
            <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--text-secondary)' }}>Nama Terdftar</p>
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
          background: status.terdaftar ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
          border: `1px solid ${status.terdaftar ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`, 
          textAlign: 'center' 
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>
            {status.terdaftar ? '✅' : '❌'}
          </div>

          <h3 style={{
            fontSize: 20,
            fontWeight: 600,
            color: status.terdaftar ? '#10b981' : '#f87171',
            marginBottom: 12,
          }}>
            {status.terdaftar ? 'Anda Terdaftar sebagai Penerima' : 'Maaf, Kamu belum terdaftar sebagai penerima manfaat'}
          </h3>

          {!status.terdaftar && (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              {status.message || 'Data e-KTP Anda belum terverifikasi sebagai penerima subsidi pada gelombang ini.'}<br /><br />
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
