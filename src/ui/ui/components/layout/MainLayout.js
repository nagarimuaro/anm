import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const MainLayout = ({ children }) => {
  const navigate = useNavigate();
  const [clock, setClock] = useState('');

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
      <header className="header">
        <div className="header-clock">{clock}</div>
        <div className="header-right">
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
        </div>
      </header>
      <main className="main-content">
        {children}
      </main>
    </div>
  );
};

export default MainLayout;
