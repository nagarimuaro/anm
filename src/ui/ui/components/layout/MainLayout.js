import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LandmarkIcon, SettingsIcon } from '../Icons';

const electron = window.require ? window.require('electron') : null;

const MainLayout = ({ children }) => {
  const navigate = useNavigate();
  const [clock, setClock] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [bgUrl, setBgUrl] = useState('/assets/background.webp');
  const [logoSize, setLogoSize] = useState(120);
  const [logoX, setLogoX] = useState(0);
  const [showSettingsModal, setShowSettingsModal] = useState(false); // Deprecated
  const [apiKey, setApiKey] = useState(''); // Deprecated
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
      electron.ipcRenderer.invoke('kiosk:settings:get', 'gemini_api_key').then(val => {
        if (val !== null) setApiKey(val);
      });
    }

  }, []);

  const updateLogoSetting = (key, val) => {
    // Dipindahkan ke SettingsPage
  };

  const handleSaveApiKey = () => {};
  const handleChangeLogo = () => {};
  const handleChangeBackground = () => {};
  const handleExitApp = () => {};

  // Listen for live updates from SettingsPage
  useEffect(() => {
    const handleUpdateLogo = (e) => {
      const { key, val } = e.detail;
      if (key === 'logo_size') setLogoSize(parseInt(val, 10));
      if (key === 'logo_x') setLogoX(parseInt(val, 10));
      if (key === 'logo_url') setLogoUrl(val);
      if (key === 'bg_url') setBgUrl(val);
    };
    window.addEventListener('update-header-logo', handleUpdateLogo);
    return () => window.removeEventListener('update-header-logo', handleUpdateLogo);
  }, []);

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
              <LandmarkIcon size={Math.max(24, Math.round(logoSize / 2.2))} color="white" />
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
            onClick={() => navigate('/settings')}
            title="Pengaturan"
            style={{ 
              background: 'transparent', 
              border: 'none', 
              cursor: 'pointer', 
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
            <SettingsIcon size={24} color="white" />
          </button>
        </div>
      </header>
      
      {/* Modal Pengaturan dipindah ke SettingsPage */}

      <main className="main-content">
        {children}
      </main>
    </div>
  );
};

export default MainLayout;
