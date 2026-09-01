import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

const electron = window.require ? window.require('electron') : null;

const BukuTamuPage = () => {
  const navigate = useNavigate();
  const [nama, setNama] = useState('');
  const [noHp, setNoHp] = useState('');
  const [asalTamu, setAsalTamu] = useState('');
  const [tujuan, setTujuan] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeField, setActiveField] = useState('nama'); // 'nama' | 'tujuan' | null
  const hasGreetedRef = useRef(false);
  const keyboardRef = useRef(null);

  // Sambutan saat halaman dibuka
  useEffect(() => {
    if (hasGreetedRef.current) return;
    hasGreetedRef.current = true;
    if (electron) {
      electron.ipcRenderer.invoke(
        'voice:speakOnce',
        'Silakan isi nama lengkap, nomor telepon, asal tamu, dan tujuan kunjungan Anda, kemudian tekan tombol Simpan.'
      ).catch(() => {});
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nama.trim() || !noHp.trim() || !asalTamu.trim() || !tujuan.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const result = electron
        ? await electron.ipcRenderer.invoke('kiosk:api:createBukuTamu', {
            nama: nama.trim(),
            no_hp: noHp.trim(),
            asal_tamu: asalTamu.trim(),
            tujuan: tujuan.trim(),
          })
        : { success: true, message: 'Kunjungan berhasil dicatat.', data: { waktu_masuk: new Date().toLocaleString('id-ID') } };

      if (result?.success) {
        setSubmitResult(result);
        setSubmitted(true);
        if (electron) {
          electron.ipcRenderer.invoke(
            'voice:speakOnce',
            `Terima kasih, ${nama}! Kunjungan Anda telah berhasil dicatat. Semoga urusan Anda di Nagari berjalan lancar. Sampai jumpa!`
          ).catch(() => {});
        }
        setTimeout(() => navigate('/'), 7000);
      } else if (result?.statusCode === 409) {
        setSubmitResult(result);
        setSubmitted(true);
        if (electron) {
          electron.ipcRenderer.invoke(
            'voice:speakOnce',
            result.message || 'Nomor telepon ini sudah mengisi buku tamu hari ini.'
          ).catch(() => {});
        }
        setTimeout(() => navigate('/'), 7000);
      } else {
        setErrorMessage(result?.message || 'Gagal menyimpan buku tamu. Silakan coba lagi.');
        if (electron) {
          electron.ipcRenderer.invoke('voice:speakOnce', 'Maaf, buku tamu belum berhasil disimpan. Silakan periksa isian dan coba lagi.').catch(() => {});
        }
      }
    } catch (error) {
      setErrorMessage(error.message || 'Gagal menyimpan buku tamu. Silakan coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onKeyboardChange = (input) => {
    if (activeField === 'nama') {
      setNama(input);
    } else if (activeField === 'noHp') {
      setNoHp(input);
    } else if (activeField === 'asalTamu') {
      setAsalTamu(input);
    } else if (activeField === 'tujuan') {
      setTujuan(input);
    }
  };

  const onKeyPress = (button) => {
    if (button === '{enter}') {
      if (activeField === 'nama' && nama.trim()) {
        setActiveField('noHp');
        if (keyboardRef.current) keyboardRef.current.setInput(noHp);
      } else if (activeField === 'noHp' && noHp.trim()) {
        setActiveField('asalTamu');
        if (keyboardRef.current) keyboardRef.current.setInput(asalTamu);
      } else if (activeField === 'asalTamu' && asalTamu.trim()) {
        setActiveField('tujuan');
        if (keyboardRef.current) keyboardRef.current.setInput(tujuan);
      }
    }
  };

  const handleFieldFocus = (field) => {
    setActiveField(field);
    if (keyboardRef.current) {
      const value = field === 'nama' ? nama : field === 'noHp' ? noHp : field === 'asalTamu' ? asalTamu : tujuan;
      keyboardRef.current.setInput(value);
    }
  };

  if (submitted) {
    const isDuplicate = submitResult?.statusCode === 409;
    const waktuMasuk = submitResult?.data?.waktu_masuk;
    return (
      <div className="page-enter" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>{isDuplicate ? 'ℹ️' : '✅'}</div>
        <h2 className="page-title">{isDuplicate ? 'Sudah Tercatat Hari Ini' : `Terima Kasih, ${nama}!`}</h2>
        <p className="page-subtitle">{submitResult?.message || 'Kunjungan Anda telah dicatat.'}</p>
        {waktuMasuk && <p className="page-subtitle">Jam kunjungan: {waktuMasuk}</p>}
      </div>
    );
  }

  return (
    <div className="page-enter" style={{ textAlign: 'center', width: '100%', maxWidth: 700, margin: '0 auto', paddingBottom: 500, marginTop: -60 }}>
      <h2 className="page-title" style={{ fontSize: 32, marginBottom: 4 }}>Buku Tamu</h2>
      <p className="page-subtitle" style={{ marginBottom: 16 }}>Catat kunjungan Anda</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Field: Nama */}
        <div 
          onClick={() => handleFieldFocus('nama')}
          style={{
            background: activeField === 'nama' ? '#1e293b' : '#0f172a',
            border: activeField === 'nama' ? '2px solid #6366f1' : '2px solid #334155',
            borderRadius: 16,
            padding: '16px 24px',
            textAlign: 'left',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <label style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Nama Lengkap
          </label>
          <div style={{ 
            color: nama ? 'white' : '#64748b', 
            fontSize: 22, 
            fontWeight: 600,
            minHeight: 32,
          }}>
            {nama || 'Ketik nama Anda...'}
            {activeField === 'nama' && <span style={{ animation: 'blink-cursor 0.8s infinite', color: '#6366f1' }}>|</span>}
          </div>
        </div>

        {/* Field: Nomor Telepon */}
        <div
          onClick={() => handleFieldFocus('noHp')}
          style={{
            background: activeField === 'noHp' ? '#1e293b' : '#0f172a',
            border: activeField === 'noHp' ? '2px solid #6366f1' : '2px solid #334155',
            borderRadius: 16,
            padding: '16px 24px',
            textAlign: 'left',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <label style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Nomor Telepon
          </label>
          <div style={{
            color: noHp ? 'white' : '#64748b',
            fontSize: 22,
            fontWeight: 600,
            minHeight: 32,
          }}>
            {noHp || 'Ketik nomor telepon...'}
            {activeField === 'noHp' && <span style={{ animation: 'blink-cursor 0.8s infinite', color: '#6366f1' }}>|</span>}
          </div>
        </div>

        {/* Field: Asal Tamu */}
        <div
          onClick={() => handleFieldFocus('asalTamu')}
          style={{
            background: activeField === 'asalTamu' ? '#1e293b' : '#0f172a',
            border: activeField === 'asalTamu' ? '2px solid #6366f1' : '2px solid #334155',
            borderRadius: 16,
            padding: '16px 24px',
            textAlign: 'left',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <label style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Asal Tamu
          </label>
          <div style={{
            color: asalTamu ? 'white' : '#64748b',
            fontSize: 22,
            fontWeight: 600,
            minHeight: 32,
          }}>
            {asalTamu || 'Ketik asal tamu...'}
            {activeField === 'asalTamu' && <span style={{ animation: 'blink-cursor 0.8s infinite', color: '#6366f1' }}>|</span>}
          </div>
        </div>

        {/* Field: Tujuan */}
        <div 
          onClick={() => handleFieldFocus('tujuan')}
          style={{
            background: activeField === 'tujuan' ? '#1e293b' : '#0f172a',
            border: activeField === 'tujuan' ? '2px solid #6366f1' : '2px solid #334155',
            borderRadius: 16,
            padding: '16px 24px',
            textAlign: 'left',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <label style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Tujuan Kunjungan
          </label>
          <div style={{ 
            color: tujuan ? 'white' : '#64748b', 
            fontSize: 22, 
            fontWeight: 600,
            minHeight: 32,
          }}>
            {tujuan || 'Ketik tujuan kunjungan...'}
            {activeField === 'tujuan' && <span style={{ animation: 'blink-cursor 0.8s infinite', color: '#6366f1' }}>|</span>}
          </div>
        </div>

        {errorMessage && (
          <div style={{ color: '#f87171', fontSize: 14, fontWeight: 600 }}>
            {errorMessage}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          <button
            style={{
              flex: 1,
              background: 'rgb(239, 68, 68)', border: 'none', color: 'white',
              fontWeight: 700, borderRadius: '16px', padding: '18px 24px', fontSize: '18px',
              cursor: 'pointer', fontFamily: 'var(--font-body)', transition: 'all 0.2s ease',
            }}
            onClick={() => navigate('/')}
            disabled={isSubmitting}
          >
            ← Batal
          </button>
          <button
            style={{
              flex: 2,
              background: (!nama.trim() || !noHp.trim() || !asalTamu.trim() || !tujuan.trim() || isSubmitting) ? '#334155' : 'linear-gradient(135deg, #10b981, #059669)',
              border: 'none', color: 'white',
              fontWeight: 700, borderRadius: '16px', padding: '18px 24px', fontSize: '18px',
              cursor: (!nama.trim() || !noHp.trim() || !asalTamu.trim() || !tujuan.trim() || isSubmitting) ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-body)', transition: 'all 0.2s ease',
              boxShadow: (!nama.trim() || !noHp.trim() || !asalTamu.trim() || !tujuan.trim() || isSubmitting) ? 'none' : '0 4px 15px rgba(16, 185, 129, 0.4)',
              opacity: (!nama.trim() || !noHp.trim() || !asalTamu.trim() || !tujuan.trim() || isSubmitting) ? 0.6 : 1,
            }}
            onClick={handleSubmit}
            disabled={!nama.trim() || !noHp.trim() || !asalTamu.trim() || !tujuan.trim() || isSubmitting}
          >
            {isSubmitting ? 'Menyimpan...' : '✓ Simpan Kunjungan'}
          </button>
        </div>
      </div>

      {/* Virtual Keyboard */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '16px 32px 32px 32px',
        background: '#0f172a',
        borderTop: '1px solid #1e293b',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
        zIndex: 100,
      }}>
        <div style={{ 
          display: 'flex', alignItems: 'center', justifyContent: 'center', 
          marginBottom: 12, gap: 8,
          color: '#94a3b8', fontSize: 14, fontWeight: 600,
        }}>
          Mengisi: <span style={{ color: '#6366f1', fontWeight: 700 }}>
            {activeField === 'nama' ? 'Nama Lengkap' : activeField === 'noHp' ? 'Nomor Telepon' : activeField === 'asalTamu' ? 'Asal Tamu' : 'Tujuan Kunjungan'}
          </span>
        </div>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <Keyboard
            keyboardRef={r => (keyboardRef.current = r)}
            onChange={onKeyboardChange}
            onKeyPress={onKeyPress}
            theme={"hg-theme-default my-dark-theme"}
            layout={{
              default: [
                "1 2 3 4 5 6 7 8 9 0 {bksp}",
                "Q W E R T Y U I O P",
                "A S D F G H J K L",
                "Z X C V B N M , .",
                "{space} {enter}"
              ]
            }}
            display={{
              "{bksp}": "Hapus",
              "{enter}": activeField === 'tujuan' ? "OK" : "Lanjut →",
              "{space}": "Spasi"
            }}
            buttonTheme={[
              {
                class: "hg-dark-btn",
                buttons: "1 2 3 4 5 6 7 8 9 0 Q W E R T Y U I O P A S D F G H J K L Z X C V B N M , ."
              },
              {
                class: "hg-primary-btn",
                buttons: "{enter}"
              }
            ]}
          />
        </div>
        <style>{`
          .my-dark-theme {
            background-color: transparent !important;
          }
          .my-dark-theme .hg-button {
            background: #1e293b !important;
            color: white !important;
            border: 1px solid #334155 !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
            height: 64px !important;
            font-size: 22px !important;
            border-radius: 12px !important;
            margin: 3px !important;
          }
          .my-dark-theme .hg-button:active {
            background: #334155 !important;
            transform: scale(0.95);
          }
          .my-dark-theme .hg-primary-btn {
            background: linear-gradient(135deg, #6366f1, #a855f7) !important;
            color: white !important;
            font-weight: bold;
            border: none !important;
          }
        `}</style>
      </div>
    </div>
  );
};

export default BukuTamuPage;
