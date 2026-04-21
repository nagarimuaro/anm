import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const HomePage = () => {
  const navigate = useNavigate();
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // (OpenRouter: cloud API — tidak perlu download/setup lokal)

  useEffect(() => {
    // Polling function to check for updates from the Main Process (where heartbeat is cached)
    const checkUpdate = async () => {
      if (window.require) {
        try {
          const electron = window.require('electron');
          const res = await electron.ipcRenderer.invoke('device:getUpdate');
          if (res && res.success && res.update) {
            setUpdateInfo(res.update);
          } else {
            setUpdateInfo(null);
          }
        } catch (e) {
          console.warn('Update check failed:', e);
        }
      }
    };

    // Check updates immediately and then every 15 seconds
    checkUpdate();
    const interval = setInterval(checkUpdate, 15000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const menuItems = [
    {
      icon: '📄',
      title: 'Buat Surat',
      desc: 'Domisili, Usaha, Tidak Mampu',
      action: () => navigate('/input-nik', { state: { nextPath: '/profil-warga' } }),
      color: '#6366f1',
    },
    {
      icon: '💰',
      title: 'Cek Bansos',
      desc: 'Info bantuan PKH & BLT',
      action: () => navigate('/scan-rfid'),
      color: '#10b981',
    },
    {
      icon: '📋',
      title: 'Buku Tamu',
      desc: 'Catat kunjungan hari ini',
      action: () => navigate('/buku-tamu'),
      color: '#f59e0b',
    },
    {
      icon: '🖨️',
      title: 'Cetak Surat',
      desc: 'Scan barcode/resi',
      action: () => navigate('/scan-barcode'),
      color: '#ec4899',
    },
  ];

  return (
    <div className="page-enter" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      width: '100%', 
      height: '100%',
      gap: '40px'
    }}>
      {/* Added dynamic CSS animation for update pulse */}
      <style>{`
        @keyframes updatePulse {
          0% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.7); }
          70% { box-shadow: 0 0 0 15px rgba(79, 70, 229, 0); }
          100% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0); }
        }
      `}</style>

      {/* Floating Update Icon */}
      {updateInfo && !showUpdateModal && (
        <div 
          onClick={() => setShowUpdateModal(true)}
          style={{
            position: 'absolute',
            top: '30px',
            right: '40px',
            background: 'var(--accent-light)',
            color: '#fff',
            padding: '12px 24px',
            borderRadius: '30px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            animation: 'updatePulse 2s infinite',
            zIndex: 50,
            border: '1px solid rgba(255,255,255,0.2)'
          }}
        >
          <span style={{ fontSize: '20px' }}>⭐</span>
          <span style={{ fontWeight: '600', fontSize: '15px' }}>Pembaruan Tersedia</span>
        </div>
      )}

      {/* Update Consent Modal */}
      {showUpdateModal && updateInfo && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          animation: 'fadeSlideDown 0.3s ease'
        }}>
          <div className="glass-card" style={{ padding: '40px', maxWidth: '500px', width: '90%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '10px' }}>🚀</div>
            <h2 style={{ fontSize: '26px', color: 'var(--text-primary)', fontFamily: 'var(--font-heading)' }}>
              Pembaruan Sistem v{updateInfo.version}
            </h2>
            <div style={{ color: 'var(--text-secondary)', lineHeight: '1.6', background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '12px', textAlign: 'left' }}>
              <p style={{ marginBottom: '8px', fontWeight: 600, color: 'var(--text-primary)' }}>Catatan Rilis:</p>
              <p style={{ fontSize: '15px' }}>{updateInfo.changelog || 'Perbaikan stabilitas dan kecepatan sistem.'}</p>
            </div>

            <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
              <button 
                className="btn btn-outline" 
                style={{ flex: 1, borderColor: 'rgba(255,255,255,0.2)', color: 'var(--text-secondary)' }}
                onClick={() => setShowUpdateModal(false)}
                disabled={isDownloading}
              >
                Nanti Saja
              </button>
              <button 
                className="btn" 
                disabled={isDownloading}
                style={{ 
                  flex: 1, 
                  background: isDownloading ? '#6b7280' : 'var(--accent-light)', 
                  color: 'white', 
                  border: 'none', 
                  fontWeight: 600, 
                  boxShadow: '0 4px 15px rgba(99, 102, 241, 0.4)',
                  cursor: isDownloading ? 'wait' : 'pointer'
                }}
                onClick={async () => {
                  try {
                    setIsDownloading(true);
                    if (window.require) {
                      const electron = window.require('electron');
                      const result = await electron.ipcRenderer.invoke('device:downloadUpdate', updateInfo.download_url);
                      
                      if (result.success) {
                        alert(`Download sukses!\nFile tersimpan fisik di: ${result.path}\n\n(Ini membuktikan test payload koneksi backend berhasil 100%)`);
                        setShowUpdateModal(false);
                      } else {
                        alert(`Gagal mengunduh file: ${result.message}`);
                      }
                    }
                  } catch (e) {
                    alert('Error: ' + e.message);
                  } finally {
                    setIsDownloading(false);
                  }
                }}
              >
                {isDownloading ? 'Mengunduh File...' : 'Download & Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <div style={{ textAlign: 'center', animation: 'fadeSlideDown 0.8s ease' }}>
        <div style={{ 
          fontSize: '72px', 
          marginBottom: '16px',
          filter: 'drop-shadow(0 0 20px rgba(99, 102, 241, 0.4))'
        }}>
          🤖
        </div>
        <h1 className="page-title" style={{ fontSize: '42px', marginBottom: '8px' }}>
          Halo, Saya SINTA
        </h1>
        <p className="page-subtitle" style={{ fontSize: '18px', maxWidth: '600px', margin: '0 auto', lineHeight: '1.6' }}>
          Asisten AI interaktif Anda. Saya siap membantu mengurus surat kependudukan, cek bansos, dan layanan lainnya.<br/>
          <br/>
          <strong style={{ color: 'var(--accent-light)', fontWeight: 600, fontSize: '16px', background: 'var(--bg-glass)', padding: '8px 16px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
            ☝️ Sentuh menu di bawah atau katakan "Halo Sinta"
          </strong>
        </p>
      </div>

      {/* Services Grid — 3 columns */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '20px',
        width: '100%',
        maxWidth: '1000px',
        padding: '0 20px'
      }}>
        {menuItems.map((item, i) => (
          <div 
            key={i} 
            className="menu-card" 
            onClick={item.action}
            style={{
              padding: '32px 24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              animation: `fadeSlideUp 0.5s ease ${i * 0.1}s both`,
              '--card-color': item.color
            }}
          >
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${item.color}20, ${item.color}05)`,
              border: `1px solid ${item.color}40`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '40px',
              boxShadow: `0 8px 32px ${item.color}20`,
              transition: 'all 0.3s ease'
            }} className="menu-icon-container">
              {item.icon}
            </div>
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ 
                fontFamily: 'var(--font-heading)',
                fontSize: '18px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '8px'
              }}>{item.title}</h3>
              <p style={{ 
                fontSize: '13px', 
                color: 'var(--text-secondary)',
                lineHeight: '1.4'
              }}>{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Helper Footer */}
      <div style={{
        marginTop: '20px',
        padding: '12px 24px',
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '30px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        color: 'var(--text-secondary)',
        fontSize: '14px',
        animation: 'fadeSlideUp 0.8s ease 0.5s both'
      }}>
        <div className="status-dot"></div>
        Sistem Suara & AI Aktif
        
        {/* DEVELOPMENT ONLY: RESET ACTIVATION */}
        {window.require && (
          <button 
            style={{ marginLeft: 16, background: '#ef4444', border: 'none', color: 'white', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
            onClick={async () => {
              const electron = window.require('electron');
              await electron.ipcRenderer.invoke('device:reset');
              if (window.testActivationStatus) window.testActivationStatus('UNACTIVATED');
            }}
          >
            TEST: Reset Device
          </button>
        )}

      </div>
    </div>
  );
};

export default HomePage;
