import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

const BukuTamuPage = () => {
  const navigate = useNavigate();
  const [nama, setNama] = useState('');
  const [tujuan, setTujuan] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const hasGreetedRef = useRef(false);

  // Sambutan saat halaman dibuka
  useEffect(() => {
    if (hasGreetedRef.current) return;
    hasGreetedRef.current = true;
    if (electron) {
      electron.ipcRenderer.invoke(
        'voice:speakOnce',
        'Silakan isi nama lengkap dan tujuan kunjungan Anda, kemudian tekan tombol Simpan.'
      ).catch(() => {});
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (electron) {
      electron.ipcRenderer.invoke(
        'voice:speakOnce',
        `Terima kasih, ${nama}! Kunjungan Anda telah berhasil dicatat. Semoga urusan Anda di Nagari berjalan lancar. Sampai jumpa!`
      ).catch(() => {});
    }
    setTimeout(() => navigate('/'), 7000);
  };

  if (submitted) {
    return (
      <div className="page-enter" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
        <h2 className="page-title">Terima Kasih, {nama}!</h2>
        <p className="page-subtitle">Kunjungan Anda telah dicatat.</p>
      </div>
    );
  }

  return (
    <div className="page-enter" style={{ textAlign: 'center', width: '100%', maxWidth: 500, margin: '0 auto' }}>
      <h2 className="page-title">Buku Tamu</h2>
      <p className="page-subtitle">Catat kunjungan Anda</p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
        <input
          type="text"
          className="form-input"
          placeholder="Nama Lengkap"
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          required
        />
        <textarea
          className="form-input"
          placeholder="Tujuan Kunjungan"
          value={tujuan}
          onChange={(e) => setTujuan(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-primary btn-lg btn-block" style={{ marginTop: 8 }}>
          ✓ Simpan
        </button>
      </form>

      <button
        className="btn btn-secondary"
        style={{ marginTop: 16 }}
        onClick={() => navigate('/')}
      >
        ← Batal
      </button>
    </div>
  );
};

export default BukuTamuPage;
