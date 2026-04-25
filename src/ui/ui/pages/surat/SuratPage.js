/**
 * SuratPage — Halaman Pilih Jenis Surat + Slot Filling
 * 
 * Flow: Input NIK → Profil Warga → [PILIH SURAT] → Slot Filling → Print
 * 
 * PENTING: Tidak boleh listen IPC sendiri!
 * Semua state dari IPC dikelola oleh useVoiceSession (GlobalVoiceWidget).
 * Page ini hanya menggunakan electron.ipcRenderer.invoke() untuk kirim perintah.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

const electron = window.require ? window.require('electron') : null;

const SuratPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const nik = location.state?.nik;
  const warga = location.state?.warga;
  const fromVoice = location.state?.fromVoice || false;
  const hasSentVoicePrompt = useRef(false);
  const [selectedSurat, setSelectedSurat] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);

  // Poll session data untuk slot filling display (tanpa listener duplikat)
  const [sessionData, setSessionData] = useState(null);
  const [phase, setPhase] = useState(null);

  // Manual typing state
  const [editingSlot, setEditingSlot] = useState(null);
  const [slotInput, setSlotInput] = useState('');
  const keyboardRef = useRef(null);

  const onKeyboardChange = (input) => {
    setSlotInput(input);
  };

  const onKeyPress = (button) => {
    if (button === "{enter}") {
      handleSaveSlot(editingSlot);
    }
  };

  const handleSaveSlot = async (key) => {
    if (!slotInput.trim()) return;
    if (electron) {
      await electron.ipcRenderer.invoke('voice:keyboardInput', { slotKey: key, value: slotInput });
    }
    setEditingSlot(null);
    setSlotInput('');
    if (keyboardRef.current) {
      keyboardRef.current.clearInput();
    }
  };

  // Fetch template list dari backend saat halaman terbuka
  useEffect(() => {
    if (!electron) {
      // Fallback statis jika tidak ada electron
      setTemplates([
        { id: null, nama: 'Surat Domisili', deskripsi: 'Keterangan tempat tinggal resmi', icon: '📍', color: '#6366f1' },
        { id: null, nama: 'Surat Keterangan Usaha', deskripsi: 'Keterangan kepemilikan usaha', icon: '🏪', color: '#f59e0b' },
        { id: null, nama: 'Surat Tidak Mampu', deskripsi: 'Keterangan kondisi ekonomi', icon: '🤝', color: '#10b981' },
      ]);
      setTemplatesLoading(false);
      return;
    }
    electron.ipcRenderer.invoke('kiosk:api:getTemplatesSurat')
      .then(res => {
        console.log('[SuratPage] API templates response:', JSON.stringify(res?.data?.slice(0,2)));
        if (res && res.success && Array.isArray(res.data)) {
          // Deduplication berdasarkan id
          const seen = new Set();
          const mapped = res.data
            .filter(t => {
              const key = t.id ?? t.slug ?? JSON.stringify(t);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .map((t, i) => {
              let parsedVars = t.input_variables || t.fields || t.slots || [];
              if (typeof parsedVars === 'string') {
                try { parsedVars = JSON.parse(parsedVars); } catch(e) { parsedVars = []; }
              }
              return {
                id: t.id,
                nama: t.nama || t.name || t.title || t.label || `Template ${i + 1}`,
                deskripsi: t.deskripsi || t.description || t.keterangan || t.desc || '',
                input_variables: parsedVars,
                requires_keperluan: t.requires_keperluan || false,
                persyaratan: t.persyaratan || [],
                color: ['#6366f1', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#14b8a6'][i % 6],
              };
            });
          setTemplates(mapped);
        }
        setTemplatesLoading(false);
      })
      .catch(err => {
        console.error('[SuratPage] getTemplatesSurat error:', err);
        setTemplatesLoading(false);
      });
  }, []);

  // Jika dari voice, minta Gemini menanyakan jenis surat yang diinginkan
  useEffect(() => {
    if (!fromVoice || !electron || hasSentVoicePrompt.current || templatesLoading) return;
    hasSentVoicePrompt.current = true;

    const daftarSurat = templates.length > 0
      ? templates.map((t, i) => `${i + 1}. ${t.nama}`).join(', ')
      : 'Surat Domisili, Surat Keterangan Usaha, Surat Tidak Mampu';

    const prompt = `[SISTEM] Data warga telah terverifikasi. Kini warga berada di halaman pilih jenis surat. Surat yang tersedia: ${daftarSurat}. Tolong tanyakan kepada warga dengan ramah: surat apa yang ingin dibuat hari ini? Tunggu jawaban warga.`;
    electron.ipcRenderer.invoke('voice:sendToGemini', prompt);
  }, [fromVoice, templatesLoading, templates]);

  useEffect(() => {
    // Poll session state setiap 500ms — TIDAK PAKAI LISTENER
    const interval = setInterval(async () => {
      if (electron) {
        try {
          const session = await electron.ipcRenderer.invoke('session:getState');
          if (session) {
            setSessionData(session);
            setPhase(session.phase);
            // HANYA update selectedSurat dari voice session jika phase sudah SLOT_FILLING+
            // Ini mencegah race condition dimana background voice menimpa state UI klik
            if (session.jenis_surat && (session.phase === 'SLOT_FILLING' || session.phase === 'CONFIRMATION')) {
              setSelectedSurat(session.jenis_surat);
            }
            // Auto-navigate ke printing saat EXECUTING/DONE
            if (session.phase === 'EXECUTING' || session.phase === 'DONE') {
              navigate('/printing', { state: { result: session.result, warga } });
            }
          }
        } catch { /* session belum ada */ }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [navigate, warga]);

  // Listen session:update dari backend (real-time saat fill_slot dipanggil Gemini)
  useEffect(() => {
    if (!electron) return;
    const handleSessionUpdate = (event, session) => {
      if (!session) return;
      setSessionData(session);
      setPhase(session.phase);
      if (session.jenis_surat && (session.phase === 'SLOT_FILLING' || session.phase === 'CONFIRMATION')) {
        setSelectedSurat(session.jenis_surat);
      }
      if (session.phase === 'EXECUTING' || session.phase === 'DONE') {
        navigate('/printing', { state: { result: session.result, warga } });
      }
    };
    electron.ipcRenderer.on('session:update', handleSessionUpdate);
    return () => electron.ipcRenderer.removeListener('session:update', handleSessionUpdate);
  }, [navigate, warga]);

  const handlePilihSurat = async (template) => {
    console.log('[SuratPage] handlePilihSurat:', template.nama, 'id:', template.id);
    setSelectedSurat(template.nama);
    if (electron) {
      try {
        // Simpan seluruh info template (id + input_variables) ke session
        await electron.ipcRenderer.invoke('session:setTemplate', {
          id: template.id,
          nama: template.nama,
          input_variables: template.input_variables || [],
          requires_keperluan: template.requires_keperluan,
          persyaratan: template.persyaratan,
          prefilledSlots: { nik: nik }
        });

        // Jika dari voice, briefing Gemini dulu SEBELUM start slot filling
        if (fromVoice) {
          const fields = (template.input_variables || [])
            .filter(f => f.key !== 'nik')
            .map(f => f.label || f.key)
            .join(', ');
          const persyaratan = (template.persyaratan || []).join(', ') || '-';
          const briefing = `[SISTEM] Warga memilih "${template.nama}". Tolong beritahu warga secara ramah dan singkat: untuk surat ini, data yang perlu dilengkapi adalah: ${fields || 'tidak ada data tambahan'}. Persyaratan dokumen: ${persyaratan}. Setelah menjelaskan, langsung mulai tanyakan data pertama yang diperlukan satu per satu.`;
          await electron.ipcRenderer.invoke('voice:sendToGemini', briefing);
        }

        // Mulai slot filling
        const result = await electron.ipcRenderer.invoke('voice:startSlotFillingDirect');
        console.log('[SuratPage] startSlotFillingDirect result:', result);
        if (!result || !result.success) {
          console.warn('[SuratPage] Slot filling gagal, reset selectedSurat');
          setSelectedSurat(null);
        }
      } catch (err) {
        console.error('[SuratPage] handlePilihSurat error:', err);
        setSelectedSurat(null);
      }
    }
  };

  // Listen for SELECT_TEMPLATE action dari Gemini voice
  // Satu-satunya listener di halaman ini — dikelola dengan proper cleanup
  useEffect(() => {
    if (!electron || !fromVoice) return;

    const handleVoiceResponse = (event, response) => {
      if (response.action !== 'SELECT_TEMPLATE' || !response.templateName || selectedSurat) return;
      if (templates.length === 0) return;

      const needle = response.templateName.toLowerCase();
      // Fuzzy match: cari template yang namanya paling cocok dengan ucapan user
      const match = templates.find(t => {
        const hay = t.nama.toLowerCase();
        return hay.includes(needle) || needle.includes(hay) ||
          // Keyword shortcuts
          (needle.includes('usaha') && hay.includes('usaha')) ||
          (needle.includes('domisili') && hay.includes('domisili')) ||
          (needle.includes('mampu') && hay.includes('mampu')) ||
          (needle.includes('sku') && hay.includes('usaha'));
      });

      if (match) {
        console.log('[SuratPage] SELECT_TEMPLATE voice → memilih:', match.nama);
        handlePilihSurat(match);
      } else {
        console.warn('[SuratPage] SELECT_TEMPLATE: tidak ada template cocok untuk:', response.templateName);
        // Beritahu Gemini bahwa template tidak ditemukan
        electron.ipcRenderer.invoke('voice:sendToGemini',
          `[SISTEM] Template "${response.templateName}" tidak ditemukan. Pilihan yang ada: ${templates.map(t => t.nama).join(', ')}. Tanyakan lagi kepada warga.`
        );
      }
    };

    electron.ipcRenderer.on('voice:response', handleVoiceResponse);
    return () => electron.ipcRenderer.removeListener('voice:response', handleVoiceResponse);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, selectedSurat, fromVoice]);

  // Icon defaults kalau backend tidak menyertakan
  const ICON_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#14b8a6'];

  const suratOptions = [
    {
      key: 'BUAT_SURAT_DOMISILI',
      label: 'Surat Domisili',
      desc: 'Keterangan tempat tinggal resmi',
      icon: '📍',
      color: '#6366f1',
    },
    {
      key: 'BUAT_SURAT_USAHA',
      label: 'Surat Keterangan Usaha',
      desc: 'Keterangan kepemilikan usaha',
      icon: '🏪',
      color: '#f59e0b',
    },
    {
      key: 'BUAT_SURAT_TIDAK_MAMPU',
      label: 'Surat Tidak Mampu',
      desc: 'Keterangan kondisi ekonomi',
      icon: '🤝',
      color: '#10b981',
    },
  ];

  return (
    <div className="page-enter" style={{ textAlign: 'center', width: '100%', maxWidth: '1600px', margin: '0 auto', padding: '20px 40px' }}>

      {/* Header — Warga Info Mini Card */}
      {warga && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          padding: '24px 32px',
          background: 'rgba(255,255,255,0.02)',
          borderRadius: '24px',
          border: '1px solid rgba(255,255,255,0.05)',
          marginBottom: 40,
          textAlign: 'left',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', 
            background: 'linear-gradient(135deg, #6366f1, #a855f7)', 
            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', 
            fontWeight: 700, fontSize: 36, boxShadow: '0 8px 24px rgba(99, 102, 241, 0.4)'
          }}>
            {warga.nama.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 28, color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
              {warga.nama}
            </div>
            <div style={{ fontSize: 18, color: 'var(--text-secondary)', marginTop: 8 }}>
              NIK: {warga.nik} • {warga.alamat}
            </div>
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 18, padding: '16px 32px', borderRadius: 16, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
            onClick={() => navigate('/profil-warga', { state: { nik } })}
          >
            Lihat Profil
          </button>
        </div>
      )}

      {/* Page Title */}
      <h2 className="page-title" style={{ fontWeight: 300, letterSpacing: '1px', fontSize: 42, marginBottom: 16 }}>
        {selectedSurat && phase === 'SLOT_FILLING' ? `Melengkapi: ${selectedSurat}` :
         selectedSurat && phase === 'CONFIRMATION' ? `Konfirmasi: ${selectedSurat}` :
         'Pilih Jenis Surat'}
      </h2>
      <p className="page-subtitle" style={{ marginBottom: 32, fontSize: 20 }}>
        {selectedSurat && phase === 'SLOT_FILLING' ? 'Silakan lengkapi data surat melalui asisten suara' :
         selectedSurat && phase === 'CONFIRMATION' ? 'Periksa data berikut dan konfirmasi' :
         'Pilih jenis surat yang ingin diurus'}
      </p>

      {/* Tampilkan Persyaratan jika ada dan sedang dalam proses pengisian */}
      {selectedSurat && sessionData && sessionData.persyaratan && sessionData.persyaratan.length > 0 && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.05)',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          borderRadius: 16,
          padding: '16px 32px',
          display: 'inline-block',
          marginBottom: 32,
          color: 'var(--text-secondary)',
          fontSize: 18,
          textAlign: 'left'
        }}>
          <strong style={{ color: '#f59e0b' }}>Syarat Dokumen: </strong>
          {sessionData.persyaratan.join(', ')}
        </div>
      )}

      {/* Surat Selection — show if no selectedSurat OR if selectedSurat but no active slot filling */}
      {(!selectedSurat || (selectedSurat && (!sessionData || (sessionData.phase !== 'SLOT_FILLING' && sessionData.phase !== 'CONFIRMATION')))) && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', 
          gap: 24, 
          marginTop: 16,
          padding: '16px 8px'
        }}>
          {templatesLoading ? (
            <>
              <div className="shimmer" style={{ height: 120, borderRadius: 20 }} />
              <div className="shimmer" style={{ height: 120, borderRadius: 20 }} />
              <div className="shimmer" style={{ height: 120, borderRadius: 20 }} />
              <div className="shimmer" style={{ height: 120, borderRadius: 20 }} />
              <div className="shimmer" style={{ height: 120, borderRadius: 20 }} />
              <div className="shimmer" style={{ height: 120, borderRadius: 20 }} />
            </>
          ) : templates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              <p>Tidak ada template surat tersedia dari server.</p>
            </div>
          ) : (
            templates.map((surat, i) => (
              <button
                key={surat.id || i}
                className="glass-card"
                onClick={() => handlePilihSurat(surat)}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  textAlign: 'left',
                  padding: '24px',
                  border: '1px solid rgba(255,255,255,0.05)',
                  background: 'linear-gradient(145deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
                  borderRadius: '20px',
                  minHeight: '120px',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = `0 16px 32px ${(surat.color || ICON_COLORS[i % 6])}25`;
                  e.currentTarget.style.borderColor = `${surat.color || ICON_COLORS[i % 6]}50`;
                  e.currentTarget.style.background = 'linear-gradient(145deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.1)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
                  e.currentTarget.style.background = 'linear-gradient(145deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)';
                }}
              >
                <div style={{
                  fontSize: 32,
                  fontWeight: 800,
                  width: 72,
                  height: 72,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 20,
                  color: surat.color || ICON_COLORS[i % 6],
                  background: `${surat.color || ICON_COLORS[i % 6]}10`,
                  border: `2px solid ${surat.color || ICON_COLORS[i % 6]}30`
                }}>
                  {surat.nama.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: 8,
                    letterSpacing: '0.5px'
                  }}>
                    {surat.nama}
                  </div>
                  <div style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {surat.deskripsi}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Slot Filling Progress — hanya tampil jika benar-benar sedang slot filling */}
      {selectedSurat && sessionData && (sessionData.phase === 'SLOT_FILLING' || sessionData.phase === 'CONFIRMATION') && (

        <div className="interview-panel" style={{ marginTop: 24, borderRadius: 32, padding: '48px 64px', background: 'linear-gradient(180deg, rgba(30,41,59,0.4) 0%, rgba(15,23,42,0.7) 100%)', border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 24px 64px rgba(0,0,0,0.4)', maxWidth: 1200, margin: '0 auto' }}>
          <div className="interview-title" style={{ fontSize: 36, fontWeight: 300, letterSpacing: '0.5px', marginBottom: 16 }}>
            {phase === 'CONFIRMATION' ? 'Data Lengkap — Tahap Konfirmasi' : 'Mengumpulkan Data Surat'}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 20, marginBottom: 40 }}>
            {phase === 'CONFIRMATION' 
              ? 'Konfirmasi melalui asisten suara: "Ya, benar" atau "Tidak, ubah"' 
              : 'Jawab pertanyaan dari asisten suara SINTA'}
          </p>

          {sessionData.slots && sessionData.slotDefs && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {Object.entries(sessionData.slots).map(([key, value]) => {
                const def = sessionData.slotDefs.find(d => d.key === key);
                const label = def ? def.label : key;
                return (
                <div key={key} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 24,
                  padding: '24px 32px',
                  borderRadius: 20,
                  background: value ? 'rgba(52, 211, 153, 0.05)' : (key === sessionData.current_slot ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255,255,255,0.02)'),
                  border: `1px solid ${value ? 'rgba(52, 211, 153, 0.2)' : (key === sessionData.current_slot ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255,255,255,0.05)')}`,
                  transition: 'all 0.3s ease',
                  cursor: !value ? 'pointer' : 'default'
                }}
                onClick={() => {
                  if (editingSlot !== key) { // Hapus pengecekan !value agar bisa diedit kapan saja
                    setEditingSlot(key);
                    setSlotInput(value || '');
                    if (keyboardRef.current) {
                      keyboardRef.current.setInput(value || '');
                    }
                  }
                }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: value ? 'var(--accent-success)' : (key === sessionData.current_slot ? 'var(--accent-light)' : 'rgba(255,255,255,0.05)'),
                  }}>
                  </div>
                  <span style={{ flex: 1, fontSize: 24, color: value ? 'white' : 'var(--text-secondary)', fontWeight: value ? 500 : 400, textAlign: 'left' }}>{label}</span>
                  
                  {editingSlot === key ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{
                        fontSize: 24,
                        fontWeight: 600,
                        color: 'var(--accent-primary)',
                        animation: 'pulse 1.5s infinite'
                      }}>
                        Ketik di keyboard bawah...
                      </span>
                    </div>
                  ) : (
                    <span style={{
                      fontSize: 24,
                      fontWeight: 600,
                      color: value ? 'var(--accent-success)' : (key === sessionData.current_slot ? 'var(--accent-light)' : 'var(--text-muted)'),
                    }}>
                      {value || (key === sessionData.current_slot ? 'Tunggu suara / Klik ketik' : 'Menunggu...')}
                    </span>
                  )}

                  {/* Tampilkan tombol edit jika baris ini sedang tidak diedit */}
                  {editingSlot !== key && (
                    <button
                      title="Edit manual"
                      style={{
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8, padding: '10px 16px', cursor: 'pointer',
                        color: value ? 'var(--accent-success)' : 'var(--text-muted)', fontSize: 20, flexShrink: 0
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingSlot(key);
                        setSlotInput(value || '');
                        if (keyboardRef.current) {
                          keyboardRef.current.setInput(value || '');
                        }
                      }}
                    >✏️</button>
                  )}
                  </div>
                );
              })}
              {/* Virtual Keyboard — Mengambang di bawah layar */}
              {editingSlot && (() => {
                const editingDef = sessionData.slotDefs.find(d => d.key === editingSlot);
                const editingLabel = editingDef ? editingDef.label : editingSlot;
                
                return (
                  <>
                  {/* Overlay transparan tipis agar fokus ke keyboard */}
                <div 
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', zIndex: 90 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingSlot(null);
                    setSlotInput('');
                  }}
                />
                <div style={{
                  position: 'fixed',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: '24px 32px 40px 32px',
                  background: 'rgba(15,23,42,0.95)',
                  backdropFilter: 'blur(16px)',
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                  boxShadow: '0 -16px 48px rgba(0,0,0,0.6)',
                  zIndex: 100,
                  animation: 'slideUp 0.3s ease-out forwards'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, maxWidth: '1400px', margin: '0 auto 24px auto', gap: 24 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, position: 'relative' }}>
                      <label style={{ color: 'var(--text-secondary)', fontSize: 20, fontWeight: 500, marginBottom: 8, textAlign: 'left' }}>
                        Sedang Mengisi: <span style={{ color: 'white', fontWeight: 700 }}>{editingLabel}</span>
                      </label>
                      <input 
                        type="text" 
                        autoFocus
                        value={slotInput}
                        onChange={e => {
                          setSlotInput(e.target.value);
                          if (keyboardRef.current) {
                            keyboardRef.current.setInput(e.target.value);
                          }
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveSlot(editingSlot); }}
                        placeholder={`Ketik ${editingLabel} di sini...`}
                        style={{
                          width: '100%',
                          background: 'rgba(0,0,0,0.5)',
                          border: '2px solid rgba(255,255,255,0.2)',
                          color: 'white',
                          padding: '24px 32px',
                          borderRadius: 16,
                          fontSize: 32,
                          outline: 'none',
                          boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.5)'
                        }}
                      />
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleSaveSlot(editingSlot); }} 
                      style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: 'white', fontSize: 24, padding: '24px 48px', borderRadius: 16, cursor: 'pointer', fontWeight: 700, boxShadow: '0 8px 24px rgba(16,185,129,0.4)' }}
                    >
                      SIMPAN
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingSlot(null);
                        setSlotInput('');
                      }}
                      style={{ background: 'rgba(239, 68, 68, 0.1)', border: '2px solid rgba(239, 68, 68, 0.3)', color: '#f87171', fontSize: 24, padding: '24px 40px', borderRadius: 16, cursor: 'pointer', fontWeight: 600 }}
                    >
                      BATAL
                    </button>
                  </div>
                  <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
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
                          "Z X C V B N M",
                          "{space} {enter}"
                        ]
                      }}
                      display={{
                        "{bksp}": "Hapus",
                        "{enter}": "OK / Simpan",
                        "{space}": "Spasi"
                      }}
                      buttonTheme={[
                        {
                          class: "hg-dark-btn",
                          buttons: "1 2 3 4 5 6 7 8 9 0 Q W E R T Y U I O P A S D F G H J K L Z X C V B N M"
                        },
                        {
                          class: "hg-primary-btn",
                          buttons: "{enter}"
                        }
                      ]}
                    />
                  </div>
                  <style>{`
                    @keyframes slideUp {
                      from { transform: translateY(100%); }
                      to { transform: translateY(0); }
                    }
                    .my-dark-theme {
                      background-color: transparent !important;
                    }
                    .my-dark-theme .hg-button {
                      background: rgba(255,255,255,0.08) !important;
                      color: white !important;
                      border: 1px solid rgba(255,255,255,0.05) !important;
                      box-shadow: 0 8px 16px rgba(0,0,0,0.3) !important;
                      height: 80px !important;
                      font-size: 28px !important;
                      border-radius: 16px !important;
                      margin: 4px !important;
                    }
                    .my-dark-theme .hg-button:active {
                      background: rgba(255,255,255,0.2) !important;
                      transform: scale(0.95);
                    }
                    .my-dark-theme .hg-primary-btn {
                      background: linear-gradient(135deg, #6366f1, #a855f7) !important;
                      color: white !important;
                      font-weight: bold;
                      border: none !important;
                    }
                    @keyframes pulse {
                      0% { opacity: 0.6; }
                      50% { opacity: 1; }
                      100% { opacity: 0.6; }
                    }
                  `}</style>
                </div>
                </>
                );
              })()}
            </div>
          )}

          {phase === 'CONFIRMATION' && (
            <div style={{ marginTop: 48, display: 'flex', justifyContent: 'center', gap: 24 }}>
              <button
                className="btn btn-primary btn-lg"
                style={{ padding: '24px 64px', fontSize: 28, borderRadius: 20, boxShadow: '0 8px 32px rgba(99, 102, 241, 0.4)' }}
                onClick={async () => {
                  if (electron) {
                    try {
                      // JANGAN panggil enterManualMode di sini!
                      // Gemini harus tetap aktif agar bisa bicara farewell di PrintingPage.
                      // enterManualMode akan dipanggil otomatis oleh PrintingPage setelah 12 detik.

                      // Temukan template ID
                      const templateObj = templates.find(t => t.nama === selectedSurat);

                      const submitData = {
                        nik: nik,
                        template_id: templateObj ? templateObj.id : null,
                        keperluan: sessionData.slots?.keperluan || 'Keperluan tidak dicantumkan',
                        custom_data: sessionData.slots
                      };

                      const result = await electron.ipcRenderer.invoke('kiosk:api:buatSurat', submitData);

                      if (result && (result.status === 'success' || result.success)) {
                        navigate('/printing', { state: { result: { ...sessionData, receipt: result }, warga, fromVoice } });
                      } else {
                        alert('Gagal memproses surat: ' + (result?.pesan || result?.message || 'Terjadi kesalahan'));
                      }
                    } catch (e) {
                      alert('Kesalahan jaringan: ' + e.message);
                    }
                  }
                }}
              >
                Cetak & Ajukan Surat
              </button>
            </div>
          )}
        </div>
      )}

      {/* Back Button */}
      <button
        className="btn btn-secondary"
        style={{ marginTop: 48, padding: '20px 48px', fontSize: 24, borderRadius: 16, marginBottom: 40, border: '2px solid rgba(255,255,255,0.1)' }}
        onClick={() => {
          if (selectedSurat && !phase) {
            setSelectedSurat(null);
          } else {
            navigate('/profil-warga', { state: { nik } });
          }
        }}
      >
        {selectedSurat && !phase ? 'Pilih Surat Lain' : 'Kembali ke Profil'}
      </button>
    </div>
  );
};

export default SuratPage;
