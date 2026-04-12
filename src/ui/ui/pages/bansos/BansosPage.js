import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

const BansosPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const nik = location.state?.nik;
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkBansos = async () => {
      // Mematikan sementara hit ke IPC / API Backend, memaksa data simulasi kita jalan di Electron!
      // if (electron && nik) {
      //   try {
      //     const result = await electron.ipcRenderer.invoke('kiosk:api:cekBansos', nik);
      //     setStatus(result?.data || { terdaftar: false });
      //   } catch {
      //     setStatus({ terdaftar: false });
      //   }
      // } else {
        
        // Karena string dari USB RFID scanner berisiko mengandung hidden trailing characters, nol tambahan di depan, dsb,
        // Kita gunakan "includes" agar pasti tertembus selama memuat 2713107202.
        const isRegistered = String(nik).includes('2713107202');

        setStatus({
          nik: nik || '3171234567890001',
          nama: 'Budi Santoso',
          alamat: 'Jl. Merdeka No. 10, RT 01 / RW 02, Nagari Indah',
          terdaftar: isRegistered,
          bantuan: isRegistered ? [
            { jenis: 'Program Keluarga Harapan (PKH)', detail: 'Rp 600.000 / Tahap', periode: 'Tahap 1 (Jan-Mar 2024)' },
            { jenis: 'Bantuan Langsung Tunai (BLT)', detail: 'Uang Tunai Rp 400.000', periode: 'Maret 2024' },
            { jenis: 'Bantuan Pangan Non Tunai (BPNT)', detail: 'Sembako Setara Rp 200.000', periode: 'April 2024' }
          ] : [],
        });
        
      // } // <-- Akhir dari block else
      if (electron) {
        // Simulate waiting voice output on mount is handled in scanner, here we narrate outcome
      }
      setLoading(false);
    };
    checkBansos();
  }, [nik]);

  useEffect(() => {
    if (!loading && status && electron) {
      if (status.terdaftar) {
        electron.ipcRenderer.invoke('voice:synthesize', `Selamat. E-KTP atas nama ${status.nama} terdaftar sebagai penerima multimanfaat bantuan sosial, di antaranya Program Harapan Keluarga dan Bantuan Langsung Tunai. Rincian dapat dilihat pada layar.`);
      } else {
        electron.ipcRenderer.invoke('voice:synthesize', `Maaf. Kamu belum terdaftar sebagai penerima manfaat. Terima kasih sudah menggunakan Layanan A N M.`);
      }
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
              Data e-KTP Anda belum terverifikasi sebagai penerima subsidi pada gelombang ini.<br /><br />
              <strong style={{ color: 'white' }}>Terima kasih sudah menggunakan Layanan ANM.</strong>
            </p>
          )}

          {status.terdaftar && status.bantuan && status.bantuan.length > 0 && (
            <div style={{ textAlign: 'left', marginTop: 24, borderTop: '1px solid rgba(16, 185, 129, 0.2)', paddingTop: 16 }}>
              <h4 style={{ color: 'white', marginBottom: '16px', fontSize: '15px' }}>Rincian Bantuan yang Diterima:</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {status.bantuan.map((item, idx) => (
                  <div key={idx} style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
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
