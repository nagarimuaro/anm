import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

const MainLayout = ({ children }) => {
  const navigate = useNavigate();
  const [clock, setClock] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [bgUrl, setBgUrl] = useState('/assets/background.webp');
  const [logoSize, setLogoSize] = useState(120);
  const [logoX, setLogoX] = useState(0);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEffect(() => {
    if (electron) {
      electron.ipcRenderer.invoke('kiosk:settings:getLogo').then(url => {
        if (url) setLogoUrl(url);
      });
      electron.ipcRenderer.invoke('kiosk:settings:getBackground').then(url => {
        if (url) setBgUrl(url);
      });
      electron.ipcRenderer.invoke('kiosk:settings:get', 'logo_size').then(val => {
        if (val !== null) setLogoSize(parseInt(val, 10));
      });
      electron.ipcRenderer.invoke('kiosk:settings:get', 'logo_x').then(val => {
        if (val !== null) setLogoX(parseInt(val, 10));
      });
    }
  }, []);

  const updateLogoSetting = (key, val) => {
    if (key === 'logo_size') setLogoSize(val);
    if (key === 'logo_x') setLogoX(val);
    if (electron) {
      electron.ipcRenderer.invoke('kiosk:settings:set', { key, value: val.toString() });
    }
  };

  const handleChangeLogo = async () => {
    if (electron) {
      const res = await electron.ipcRenderer.invoke('kiosk:settings:setLogo');
      if (res.success) {
        setLogoUrl(res.logo);
      } else if (res.message !== 'Dibatalkan') {
        alert('Gagal mengubah logo: ' + res.message);
      }
    }
  };

  const handleChangeBackground = async () => {
    if (electron) {
      const res = await electron.ipcRenderer.invoke('kiosk:settings:setBackground');
      if (res.success) {
        setBgUrl(res.bg);
      } else if (res.message !== 'Dibatalkan') {
        alert('Gagal mengubah latar belakang: ' + res.message);
      }
    }
  };

  const handleExitApp = () => {
    if (electron) {
      if (window.confirm('Apakah Anda yakin ingin mematikan aplikasi Kiosk?')) {
        electron.ipcRenderer.invoke('kiosk:exitApp');
      }
    }
  };

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + 
        ' • ' + now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="app-container">
      {/* Background Image */}
      <img
        src={bgUrl}
        alt="Background"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: -1,
          pointerEvents: 'none',
        }}
      />
      <header className="header">
        <div className="header-left" style={{ display: 'flex', alignItems: 'center', transform: `translateX(${logoX}px)`, transition: 'transform 0.2s, height 0.2s' }}>
          {logoUrl ? (
            <img src={logoUrl} alt="Logo Instansi" style={{ height: `${logoSize}px`, objectFit: 'contain', transition: 'height 0.2s' }} />
          ) : (
            <div style={{ height: `${logoSize}px`, width: `${logoSize}px`, background: 'rgba(255,255,255,0.2)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
              <span style={{ fontSize: `${Math.max(20, logoSize / 2.5)}px` }}>🏛️</span>
            </div>
          )}
        </div>
        <div className="header-clock" style={{ position: 'absolute', top: '32px', left: '50%', transform: 'translateX(-50%)' }}>
          {clock}
        </div>
        <div className="header-right" style={{ display: 'flex', gap: '16px', alignItems: 'center', alignSelf: 'flex-start', paddingTop: '16px' }}>
          <button
            className="absensi-header-btn"
            onClick={() => navigate('/absensi')}
            title="Absensi Pegawai"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            <span>Absensi</span>
          </button>

          <button
            onClick={() => setShowSettingsModal(true)}
            title="Pengaturan"
            style={{ 
              background: 'transparent', 
              border: 'none', 
              cursor: 'pointer', 
              fontSize: '24px',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.8,
              transition: 'opacity 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = 1}
            onMouseOut={(e) => e.currentTarget.style.opacity = 0.8}
          >
            ⚙️
          </button>
        </div>
      </header>
      
      {/* Settings Modal */}
      {showSettingsModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999,
          animation: 'fadeSlideDown 0.3s ease'
        }}>
          <div className="glass-card" style={{ padding: '40px', maxWidth: '400px', width: '90%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '10px' }}>⚙️</div>
            <h2 style={{ fontSize: '26px', color: 'var(--text-primary)', fontFamily: 'var(--font-heading)' }}>
              Pengaturan Sistem
            </h2>
            <p style={{ color: 'var(--text-secondary)' }}>Sesuaikan preferensi Anjungan Kiosk Anda di sini.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              
              {/* Pengaturan Ukuran Logo */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.1)', padding: '12px 16px', borderRadius: '12px' }}>
                <span style={{ color: 'white', fontSize: '15px' }}>Ukuran Logo</span>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button className="btn" style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white' }} onClick={() => updateLogoSetting('logo_size', logoSize - 10)}>-</button>
                  <span style={{ color: 'white', width: '36px', fontWeight: 'bold' }}>{logoSize}</span>
                  <button className="btn" style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white' }} onClick={() => updateLogoSetting('logo_size', logoSize + 10)}>+</button>
                </div>
              </div>

              {/* Pengaturan Posisi Logo (Kiri/Kanan) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.1)', padding: '12px 16px', borderRadius: '12px' }}>
                <span style={{ color: 'white', fontSize: '15px' }}>Geser Posisi (X)</span>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button className="btn" style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white' }} onClick={() => updateLogoSetting('logo_x', logoX - 10)}>-</button>
                  <span style={{ color: 'white', width: '36px', fontWeight: 'bold' }}>{logoX}</span>
                  <button className="btn" style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white' }} onClick={() => updateLogoSetting('logo_x', logoX + 10)}>+</button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  className="btn" 
                  style={{ flex: 1, background: 'var(--accent-light)', color: 'white', border: 'none', fontWeight: 600, padding: '16px 8px', borderRadius: '12px', fontSize: '14px' }}
                  onClick={handleChangeLogo}
                >
                  🖼️ Ganti Logo
                </button>
                <button 
                  className="btn" 
                  style={{ flex: 1, background: 'var(--accent)', color: 'white', border: 'none', fontWeight: 600, padding: '16px 8px', borderRadius: '12px', fontSize: '14px' }}
                  onClick={handleChangeBackground}
                >
                  🌄 Ganti Latar
                </button>
              </div>
              
              <button 
                className="btn" 
                style={{ background: 'rgba(248, 113, 113, 0.2)', color: '#f87171', border: '1px solid rgba(248, 113, 113, 0.5)', fontWeight: 600, padding: '16px', borderRadius: '12px' }}
                onClick={handleExitApp}
              >
                🔌 Matikan Kiosk
              </button>
              
              <button 
                className="btn btn-outline" 
                style={{ borderColor: 'rgba(255,255,255,0.2)', color: 'var(--text-secondary)', padding: '16px', borderRadius: '12px', marginTop: '10px' }}
                onClick={() => setShowSettingsModal(false)}
              >
                Kembali
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="main-content">
        {children}
      </main>
    </div>
  );
};

export default MainLayout;
