import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const electron = window.require ? window.require('electron') : null;

const SETTINGS_PASSWORD = '171945'; // 6 digit

const SettingsPage = () => {
  const navigate = useNavigate();

  // --- Auth State ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const keyboardRef = useRef(null);

  // --- Settings State ---
  const [logoSize, setLogoSize] = useState(120);
  const [logoX, setLogoX] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [deviceInfo, setDeviceInfo] = useState(null);

  useEffect(() => {
    if (isAuthenticated && electron) {
      electron.ipcRenderer.invoke('kiosk:settings:get', 'logo_size').then(val => {
        if (val !== null) setLogoSize(parseInt(val, 10));
      });
      electron.ipcRenderer.invoke('kiosk:settings:get', 'logo_x').then(val => {
        if (val !== null) setLogoX(parseInt(val, 10));
      });
      electron.ipcRenderer.invoke('kiosk:settings:get', 'gemini_api_key').then(val => {
        if (val !== null) setApiKey(val);
      });
      electron.ipcRenderer.invoke('device:status').then(res => {
        if (res.status === 'ACTIVATED' && res.data) setDeviceInfo(res.data);
      }).catch(() => {});
    }
  }, [isAuthenticated]);

  const handlePasswordKeyboard = (input) => {
    setPasswordInput(input);
    setPasswordError(false);
  };

  const handlePasswordKeyPress = (button) => {
    if (button === '{bksp}') {
      const next = passwordInput.slice(0, -1);
      setPasswordInput(next);
      if (keyboardRef.current) keyboardRef.current.setInput(next);
    } else if (button === '{enter}') {
      submitPassword();
    }
  };

  const submitPassword = () => {
    if (passwordInput === SETTINGS_PASSWORD) {
      setIsAuthenticated(true);
    } else {
      setPasswordError(true);
      setPasswordInput('');
      if (keyboardRef.current) keyboardRef.current.setInput('');
    }
  };

  const updateLogoSetting = (key, val) => {
    if (key === 'logo_size') setLogoSize(val);
    if (key === 'logo_x') setLogoX(val);
    if (electron) {
      electron.ipcRenderer.invoke('kiosk:settings:set', { key, value: val.toString() });
      window.dispatchEvent(new CustomEvent('update-header-logo', { detail: { key, val } }));
    }
  };

  const handleSaveApiKey = async () => {
    if (electron) {
      const res = await electron.ipcRenderer.invoke('kiosk:settings:set', { key: 'gemini_api_key', value: apiKey });
      if (res.success) {
        alert('API Key berhasil disimpan!');
      } else {
        alert('Gagal menyimpan API Key: ' + res.message);
      }
    }
  };

  const handleChangeLogo = async () => {
    if (electron) {
      const res = await electron.ipcRenderer.invoke('kiosk:settings:setLogo');
      if (res.success) {
        window.dispatchEvent(new CustomEvent('update-header-logo', { detail: { key: 'logo_url', val: res.logo } }));
      } else if (res.message !== 'Dibatalkan') {
        alert('Gagal mengubah logo: ' + res.message);
      }
    }
  };

  const handleChangeBackground = async () => {
    if (electron) {
      const res = await electron.ipcRenderer.invoke('kiosk:settings:setBackground');
      if (res.success) {
        window.dispatchEvent(new CustomEvent('update-header-logo', { detail: { key: 'bg_url', val: res.bg } }));
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

  // ────────────────────────────────────────────
  // LAYAR PASSWORD
  // ────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <>
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000', zIndex: -1 }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 32 }}>
          <div style={{ fontSize: 64, marginBottom: 8 }}>🔒</div>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 300, letterSpacing: 1, color: 'var(--text-primary)', margin: 0 }}>
            Akses Pengaturan
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 20, margin: 0 }}>
            Masukkan kata sandi untuk melanjutkan
          </p>

          {/* Password dots display */}
          <div style={{ display: 'flex', gap: 20, margin: '8px 0' }}>
            {[0,1,2,3,4,5].map(i => (
              <div key={i} style={{
                width: 24, height: 24, borderRadius: '50%',
                background: passwordInput.length > i
                  ? (passwordError ? '#ef4444' : 'var(--accent-primary)')
                  : 'rgba(255,255,255,0.2)',
                transition: 'background 0.2s, transform 0.1s',
                transform: passwordInput.length > i ? 'scale(1.2)' : 'scale(1)',
                boxShadow: passwordInput.length > i && !passwordError ? '0 0 12px rgba(99,102,241,0.6)' : 'none'
              }} />
            ))}
          </div>

          {passwordError && (
            <p style={{ color: '#ef4444', fontSize: 18, margin: 0, fontWeight: 600, animation: 'pulse 0.5s ease' }}>
              ❌ Kata sandi salah, coba lagi
            </p>
          )}

          {/* Numpad Custom */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 480, margin: '0 auto', width: '100%' }}>
            {['1','2','3','4','5','6','7','8','9'].map(n => (
              <button
                key={n}
                className="key-btn"
                onClick={() => {
                  if (passwordInput.length < 6) {
                    const next = passwordInput + n;
                    setPasswordInput(next);
                    setPasswordError(false);
                    if (next.length === 6) {
                      setTimeout(() => {
                        if (next === SETTINGS_PASSWORD) {
                          setIsAuthenticated(true);
                        } else {
                          setPasswordError(true);
                          setPasswordInput('');
                        }
                      }, 200);
                    }
                  }
                }}
                style={{ height: 100, fontSize: 36, fontWeight: 700 }}
              >
                {n}
              </button>
            ))}
            {/* Baris terakhir: Hapus | 0 | OK */}
            <button
              className="key-btn"
              onClick={() => { setPasswordInput(p => p.slice(0, -1)); setPasswordError(false); }}
              style={{ height: 100, fontSize: 28, fontWeight: 700, background: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.3)', color: '#f87171' }}
            >
              ⌫
            </button>
            <button
              className="key-btn"
              onClick={() => {
                if (passwordInput.length < 6) {
                  const next = passwordInput + '0';
                  setPasswordInput(next);
                  setPasswordError(false);
                  if (next.length === 6) {
                    setTimeout(() => {
                      if (next === SETTINGS_PASSWORD) {
                        setIsAuthenticated(true);
                      } else {
                        setPasswordError(true);
                        setPasswordInput('');
                      }
                    }, 200);
                  }
                }
              }}
              style={{ height: 100, fontSize: 36, fontWeight: 700 }}
            >
              0
            </button>
            <button
              className="key-btn action"
              onClick={submitPassword}
              style={{ height: 100, fontSize: 22, fontWeight: 700 }}
            >
              ✓ OK
            </button>
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => navigate(-1)}
            style={{ fontSize: 20, padding: '16px 40px', borderRadius: 16 }}
          >
            ← Kembali
          </button>
        </div>
      </>
    );
  }

  // ────────────────────────────────────────────
  // HALAMAN PENGATURAN (setelah auth)
  // ────────────────────────────────────────────
  return (
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000', zIndex: -1 }} />

      <div className="page-enter" style={{ width: '100%', maxWidth: '1600px', margin: '0 auto', padding: '24px', textAlign: 'center' }}>

        <h2 className="page-title" style={{ fontWeight: 300, letterSpacing: '1px', fontSize: 'clamp(32px, 4vw, 56px)', marginBottom: 8 }}>
          ⚙️ Pengaturan Sistem
        </h2>
        <p className="page-subtitle" style={{ marginBottom: 40, fontSize: 'clamp(18px, 1.8vw, 24px)' }}>
          Sesuaikan preferensi Anjungan Kiosk Anda di sini.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, maxWidth: 1200, margin: '0 auto' }}>

          {/* Kolom Kiri */}
          <div className="glass-card" style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '24px', textAlign: 'left', background: 'rgba(30, 41, 88, 0.6)' }}>
            <h3 style={{ fontSize: 24, color: 'var(--accent-light)', marginBottom: 16 }}>Tampilan & Sistem</h3>

            {/* Ukuran Logo */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '16px 24px', borderRadius: '16px' }}>
              <span style={{ color: 'white', fontSize: '18px' }}>Ukuran Logo</span>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <button className="btn" style={{ padding: '8px 20px', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', fontSize: 20 }} onClick={() => updateLogoSetting('logo_size', logoSize - 10)}>-</button>
                <span style={{ color: 'white', width: '48px', fontWeight: 'bold', textAlign: 'center', fontSize: 20 }}>{logoSize}</span>
                <button className="btn" style={{ padding: '8px 20px', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', fontSize: 20 }} onClick={() => updateLogoSetting('logo_size', logoSize + 10)}>+</button>
              </div>
            </div>

            {/* Posisi Logo */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '16px 24px', borderRadius: '16px' }}>
              <span style={{ color: 'white', fontSize: '18px' }}>Geser Posisi Logo (X)</span>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <button className="btn" style={{ padding: '8px 20px', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', fontSize: 20 }} onClick={() => updateLogoSetting('logo_x', logoX - 10)}>-</button>
                <span style={{ color: 'white', width: '48px', fontWeight: 'bold', textAlign: 'center', fontSize: 20 }}>{logoX}</span>
                <button className="btn" style={{ padding: '8px 20px', background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', fontSize: 20 }} onClick={() => updateLogoSetting('logo_x', logoX + 10)}>+</button>
              </div>
            </div>

            {/* API Key Gemini */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.05)', padding: '16px 24px', borderRadius: '16px' }}>
              <span style={{ color: 'white', fontSize: '18px' }}>Gemini API Key</span>
              <div style={{ display: 'flex', gap: '12px' }}>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Masukkan API Key Gemini..."
                  style={{ flex: 1, padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: 18 }}
                />
                <button
                  className="btn"
                  style={{ background: 'var(--accent-primary)', color: 'white', border: 'none', fontWeight: 600, padding: '16px 32px', borderRadius: '12px', fontSize: 18 }}
                  onClick={handleSaveApiKey}
                >
                  Simpan
                </button>
              </div>
            </div>

            {/* Ganti Logo & Latar */}
            <div style={{ display: 'flex', gap: '16px', marginTop: 16 }}>
              <button className="btn" style={{ flex: 1, background: 'var(--accent-light)', color: 'white', border: 'none', fontWeight: 600, padding: '20px 16px', borderRadius: '16px', fontSize: '18px' }} onClick={handleChangeLogo}>
                🖼️ Ganti Logo
              </button>
              <button className="btn" style={{ flex: 1, background: 'var(--accent-primary)', color: 'white', border: 'none', fontWeight: 600, padding: '20px 16px', borderRadius: '16px', fontSize: '18px' }} onClick={handleChangeBackground}>
                🌄 Ganti Latar
              </button>
            </div>
          </div>

          {/* Kolom Kanan */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>

            <div className="glass-card" style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left', flex: 1, background: 'rgba(30, 41, 88, 0.6)' }}>
              <h3 style={{ fontSize: 24, color: 'var(--accent-success)', marginBottom: 8 }}>Informasi Perangkat</h3>

              {deviceInfo ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Nama Perangkat</div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: 'white' }}>{deviceInfo.device_name || 'Tidak diketahui'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Device Token</div>
                    <div style={{ fontSize: 16, fontFamily: 'monospace', color: 'var(--accent-info)', wordBreak: 'break-all' }}>{deviceInfo.device_token || 'Tidak tersedia'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Hardware Fingerprint</div>
                    <div style={{ fontSize: 16, fontFamily: 'monospace', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{deviceInfo.fingerprint || '-'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Diaktifkan Pada</div>
                    <div style={{ fontSize: 18, color: 'white' }}>{deviceInfo.activated_at ? new Date(deviceInfo.activated_at).toLocaleString('id-ID') : '-'}</div>
                  </div>
                </div>
              ) : (
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: 24, borderRadius: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
                  Mengambil informasi perangkat...
                </div>
              )}
            </div>

            <button
              className="btn"
              style={{ background: 'rgba(248, 113, 113, 0.15)', color: '#f87171', border: '2px solid rgba(248, 113, 113, 0.4)', fontWeight: 600, padding: '24px', borderRadius: '20px', fontSize: 24, transition: 'all 0.3s' }}
              onClick={handleExitApp}
              onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(248, 113, 113, 0.3)'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(248, 113, 113, 0.15)'; }}
            >
              🔌 Matikan Kiosk
            </button>
          </div>
        </div>

        <div style={{ marginTop: 40, paddingBottom: 40 }}>
          <button
            className="btn btn-secondary"
            onClick={() => navigate(-1)}
            style={{ fontSize: 24, padding: '20px 48px', borderRadius: 20, minWidth: 250 }}
          >
            ← Kembali
          </button>
        </div>

      </div>
    </>
  );
};

export default SettingsPage;
