import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

const ActivationPage = ({ status, setActivationStatus }) => {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isInvalid = status === 'INVALID_FINGERPRINT';

  const handleActivate = async (e) => {
    e.preventDefault();
    if (!token.trim() || !electron) return;

    setLoading(true);
    setError('');

    try {
      const result = await electron.ipcRenderer.invoke('device:activate', token);
      
      if (result.success) {
        setActivationStatus('ACTIVATED');
        // Will be naturally intercepted by router, or we can explicity navigate
        navigate('/');
      } else {
        setError(result.message || 'Gagal mengaktivasi perangkat.');
      }
    } catch (err) {
      setError('Terjadi kesalahan sambungan dengan sistem host.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="activation-page">
      <div className="activation-card">
        <div className="activation-icon-wrapper">
          <svg className="activation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        
        <h2>{isInvalid ? 'Perangkat Ilegal' : 'Aktivasi Perangkat'}</h2>
        
        <p className="activation-desc">
          {isInvalid 
            ? 'Peringatan Keamanan: Fingerprint perangkat keras ini tidak cocok dengan data pendaftaran awal. Mesin mungkin dipindahkan secara ilegal.'
            : 'Perangkat Kiosk ini belum terhubung ke sistem. Masukkan Activation Token dari Dashboard Admin.'}
        </p>

        {error && <div className="activation-error">{error}</div>}

        <form onSubmit={handleActivate} className="activation-form">
          <input
            type="text"
            className="activation-input"
            placeholder="Masukkan Activation Token..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={loading}
          />
          <button 
            type="submit" 
            className={`btn btn-primary activation-btn ${loading ? 'loading' : ''}`}
            disabled={loading || !token.trim()}
          >
            {loading ? 'Memvalidasi...' : 'Aktivasi Kiosk'}
          </button>
        </form>
      </div>

      <div className="activation-footer">
        ANM System (Anjungan Nagari Mandiri) — Fingerprint Secured.
      </div>
    </div>
  );
};

export default ActivationPage;
