import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SintaPixiCanvas from '../../components/sinta/SintaPixiCanvas';

const HomePage = () => {
  const navigate = useNavigate();
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // (OpenRouter: cloud API — tidak perlu download/setup lokal)

  useEffect(() => {
    // Hentikan suara dari halaman sebelumnya saat kembali ke beranda
    const electron = window.require ? window.require('electron') : null;
    if (electron) electron.ipcRenderer.invoke('voice:stopSpeaking').catch(() => {});
  }, []);

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
    {
      icon: '🏠',
      title: 'Pajak PBB',
      desc: 'Cek & Bayar PBB Tahunan',
      action: () => navigate('/scan-rfid-pajak'),
      color: '#8b5cf6',
    },
  ];

  return (
    <div className="page-enter" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'flex-end',
      width: '100%', 
      height: '100%',
      gap: '0',
      position: 'relative',
      overflow: 'hidden'
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
            <div style={{ color: 'var(--text-secondary)', lineHeight: '1.6', background: 'var(--bg-glass)', padding: '20px', borderRadius: '12px', textAlign: 'left' }}>
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


      {/* SINTA Character — PixiJS Lipsync Canvas */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        pointerEvents: 'none',
        animation: 'fadeSlideUp 0.8s ease 0.1s both',
        zIndex: 0,
      }}>
        <SintaPixiCanvas />
      </div>

      {/* Dashboard Panel Container */}
      <div style={{
        width: '100%',
        maxWidth: '1500px',
        margin: '0 auto 20px auto', // Kurangi margin bawah dari 50px ke 20px
        padding: '24px 32px', // Kurangi padding dari 40px ke 24px atas-bawah
        background: 'rgba(255, 255, 255, 0.15)',
        backdropFilter: 'blur(32px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(32px) saturate(1.2)',
        border: '1.5px solid rgba(255, 255, 255, 0.4)',
        borderRadius: '32px',
        boxShadow: '0 30px 60px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.6)',
        position: 'relative',
        zIndex: 1,
        animation: 'fadeSlideUp 0.6s ease both'
      }}>
        
        {/* Header Text untuk Panel */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}> {/* Kurangi margin bawah dari 32px ke 20px */}
          <h2 style={{ 
            color: '#ffffff', 
            fontSize: '28px', // Kurangi dari 32px ke 28px
            fontFamily: 'var(--font-heading)', 
            fontWeight: '700', 
            textShadow: '0 4px 12px rgba(0,0,0,0.3)',
            marginBottom: '4px'
          }}>
            Layanan Anjungan Mandiri
          </h2>
          <p style={{ 
            color: 'rgba(255, 255, 255, 0.9)', 
            fontSize: '16px', // Kurangi dari 18px ke 16px
            textShadow: '0 2px 8px rgba(0,0,0,0.3)'
          }}>
            Pilih menu layanan yang Anda butuhkan di bawah ini
          </p>
        </div>

        {/* Services Grid — 5 columns sejajar */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '24px',
          width: '100%',
        }}>
        {menuItems.map((item, i) => (
          <div 
            key={i} 
            className="menu-card" 
            onClick={item.action}
            style={{
              padding: '32px 20px', // Kembalikan tinggi card
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px', // Kembalikan gap card
              animation: `fadeSlideUp 0.5s ease ${i * 0.1}s both`,
              '--card-color': item.color,
              background: `linear-gradient(135deg, ${item.color}, ${item.color}dd)`,
              border: `1px solid rgba(255,255,255,0.3)`
            }}
          >
            <div style={{
              width: '84px', // Kembalikan ukuran icon
              height: '84px',
              borderRadius: '50%',
              background: `rgba(255, 255, 255, 0.2)`,
              border: `1px solid rgba(255, 255, 255, 0.4)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '42px', // Kembalikan ukuran emoji
              boxShadow: `0 8px 32px rgba(0,0,0,0.15)`,
              transition: 'all 0.3s ease'
            }} className="menu-icon-container">
              {item.icon}
            </div>
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ 
                fontFamily: 'var(--font-heading)', 
                fontSize: '22px', // Kembalikan ukuran font title
                fontWeight: '700', 
                marginBottom: '6px',
                color: '#ffffff',
                textShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}>
                {item.title}
              </h3>
              <p style={{ 
                fontSize: '15px', // Kembalikan ukuran font deskripsi
                color: 'rgba(255, 255, 255, 0.9)', 
                lineHeight: '1.4' 
              }}>
                {item.desc}
              </p>
            </div>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
};

export default HomePage;
