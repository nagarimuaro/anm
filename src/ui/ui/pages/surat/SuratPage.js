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

  // Carousel state (Page index)
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const touchStartXRef = useRef(null);

  const CARDS_PER_PAGE = 9;
  const totalPages = Math.ceil(templates.length / CARDS_PER_PAGE);

  const handleCarouselSlide = (direction) => {
    if (isSliding || totalPages <= 1) return;
    setIsSliding(true);
    setTimeout(() => setIsSliding(false), 450);
    setActiveCardIndex(i => {
      if (direction === 'next') return Math.min(i + 1, totalPages - 1);
      return Math.max(i - 1, 0);
    });
  };

  const handleTouchStart = (e) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStartXRef.current === null) return;
    const diff = touchStartXRef.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      handleCarouselSlide(diff > 0 ? 'next' : 'prev');
    }
    touchStartXRef.current = null;
  };

  const onKeyboardChange = (input) => {
    setSlotInput(input);
  };

  const onKeyPress = (button) => {
    if (button === "{enter}") {
      handleSaveSlot(editingSlot);
    }
  };

  // Deteksi tipe input berdasarkan key/label slot
  const getSlotInputType = (key) => {
    if (!key) return 'text';
    const k = key.toLowerCase();
    const def = sessionData?.slotDefs?.find(d => d.key === key);
    const label = def ? def.label.toLowerCase() : '';
    if (k.includes('waktu') || k.includes('jam') || k.includes('pukul') || label.includes('waktu') || label.includes('jam') || label.includes('pukul')) return 'time';
    if (k.includes('hari') || label.includes('hari')) return 'day';
    if (k.includes('tanggal') || k.includes('tgl') || label.includes('tanggal') || label.includes('tgl')) return 'date';
    return 'text';
  };

  // Saat mulai edit slot, set input ke nilai slot yang sudah ada (jika ada)
  const startEditingSlot = (key) => {
    const currentValue = sessionData?.slots?.[key] || '';
    setEditingSlot(key);
    setSlotInput(currentValue);
    // Sync keyboard ref setelah render
    setTimeout(() => {
      if (keyboardRef.current) {
        keyboardRef.current.setInput(currentValue);
      }
    }, 50);
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

  const handleCancelEdit = () => {
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
        console.log('[SuratPage] API templates response:', JSON.stringify(res?.data?.slice(0, 2)));
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
                try { parsedVars = JSON.parse(parsedVars); } catch (e) { parsedVars = []; }
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

  // Sapaan untuk user yang masuk manual (bukan dari voice AI)
  const hasManualGreetRef = useRef(false);
  useEffect(() => {
    if (fromVoice || templatesLoading || hasManualGreetRef.current) return;
    hasManualGreetRef.current = true;
    if (electron) {
      electron.ipcRenderer.invoke(
        'voice:speakOnce',
        'Silakan pilih jenis surat yang ingin Anda ajukan dengan menekan salah satu pilihan di layar.'
      ).catch(() => { });
    }
  }, [fromVoice, templatesLoading]);

  // Kunci konteks AI sesuai fase surat (PILIH → SLOT_FILLING → CONFIRMATION)
  useEffect(() => {
    if (electron && phase) {
      electron.ipcRenderer.invoke('voice:setPageContext', '/surat', phase).catch(() => {});
    }
  }, [phase]);

  useEffect(() => {
    // Poll session state sebagai fallback; update utama datang dari listener session:update.
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
    }, 2000);

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

        // Jika user manual (bukan voice), ucapkan panduan isi data
        if (!fromVoice && result?.success) {
          const fields = (template.input_variables || [])
            .filter(f => f.key !== 'nik')
            .map(f => f.label || f.key)
            .join(', ');
          electron.ipcRenderer.invoke(
            'voice:speakOnce',
            `Anda memilih ${template.nama}. Silakan lengkapi data yang diperlukan: ${fields || 'tidak ada data tambahan'}. Tekan ikon pensil di samping setiap kolom untuk mengisi secara manual.`
          ).catch(() => { });
        }
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
    <div className="page-enter" style={{ width: '100%', maxWidth: '1600px', margin: '0 auto', padding: '0 24px 12px 24px', textAlign: 'center' }}>

      {/* Page Title Dihapus Sesuai Permintaan */}

      {/* Syarat Dokumen Dihapus Sesuai Permintaan */}

      {/* Surat Selection — Horizontal Carousel */}
      {(!selectedSurat || (selectedSurat && (!sessionData || (sessionData.phase !== 'SLOT_FILLING' && sessionData.phase !== 'CONFIRMATION')))) && (
        <div style={{ marginTop: 'clamp(8px, 1vh, 16px)', width: '100%' }}>

          {templatesLoading ? (
            <div style={{ display: 'flex', gap: 24, padding: '4px 64px' }}>
              <div className="shimmer" style={{ flex: 1, height: 200, borderRadius: 20 }} />
              <div className="shimmer" style={{ flex: 1, height: 200, borderRadius: 20 }} />
              <div className="shimmer" style={{ flex: 1, height: 200, borderRadius: 20 }} />
            </div>
          ) : templates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              <p>Tidak ada template surat tersedia dari server.</p>
            </div>
          ) : (
            (() => {
              const chunkedTemplates = [];
              for (let i = 0; i < templates.length; i += CARDS_PER_PAGE) {
                chunkedTemplates.push(templates.slice(i, i + CARDS_PER_PAGE));
              }

              return (
                <>
                  {/* Carousel Track Wrapper */}
                  <div
                    style={{ position: 'relative', overflow: 'hidden', width: '100%', padding: '8px 0', touchAction: 'pan-y' }}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                  >
                    {/* Sliding Track */}
                    <div style={{
                      display: 'flex',
                      transform: `translateX(calc(-${activeCardIndex * 100}%))`,
                      transition: isSliding ? 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none',
                      willChange: 'transform',
                    }}>
                      {chunkedTemplates.map((chunk, pageIndex) => (
                        <div
                          key={pageIndex}
                          style={{
                            minWidth: '100%',
                            padding: '0 clamp(100px, 8vw, 140px)',
                            boxSizing: 'border-box',
                          }}
                        >
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: 'clamp(8px, 1vw, 12px)',
                          }}>
                            {chunk.map((surat, localIndex) => {
                              const i = pageIndex * CARDS_PER_PAGE + localIndex;
                              return (
                                <div
                                  key={surat.id || i}
                                  className="glass-card"
                                  onClick={() => handlePilihSurat(surat)}
                                  style={{
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'clamp(8px, 1vw, 16px)',
                                    textAlign: 'left',
                                    padding: 'clamp(12px, 1vw, 20px)',
                                    borderRadius: '20px',
                                    minHeight: '95px',
                                    position: 'relative',
                                    overflow: 'hidden',
                                    width: '100%',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                                    transition: 'transform 0.2s, box-shadow 0.2s, border 0.2s, background 0.2s',
                                    background: 'rgba(30, 41, 88, 0.6)',
                                  }}
                                  onMouseOver={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-4px)';
                                    e.currentTarget.style.borderColor = `${surat.color || ICON_COLORS[i % 6]}60`;
                                    e.currentTarget.style.boxShadow = `0 12px 32px ${surat.color || ICON_COLORS[i % 6]}25`;
                                  }}
                                  onMouseOut={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                                    e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
                                  }}
                                >
                                  {/* Top accent bar */}
                                  <div style={{
                                    height: 6,
                                    background: surat.color
                                      ? `linear-gradient(90deg, ${surat.color}, ${surat.color}88)`
                                      : 'var(--gradient-accent)',
                                    position: 'absolute',
                                    top: 0, left: 0, right: 0,
                                    borderRadius: '20px 20px 0 0',
                                  }} />

                                  {/* Icon */}
                                  <div style={{
                                    fontSize: 'clamp(28px, 3.5vw, 48px)',
                                    fontWeight: 800,
                                    width: 'clamp(60px, 6.5vw, 96px)',
                                    height: 'clamp(60px, 6.5vw, 96px)',
                                    flexShrink: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 20,
                                    color: surat.color || ICON_COLORS[i % 6],
                                    background: `${surat.color || ICON_COLORS[i % 6]}15`,
                                    border: `2px solid ${surat.color || ICON_COLORS[i % 6]}35`,
                                    boxShadow: `0 8px 24px ${surat.color || ICON_COLORS[i % 6]}20`,
                                  }}>
                                    {surat.nama.charAt(0).toUpperCase()}
                                  </div>

                                  {/* Text */}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                      fontSize: 'clamp(18px, 2.2vw, 32px)',
                                      fontWeight: 700,
                                      color: 'var(--text-primary)',
                                      marginBottom: 2,
                                      letterSpacing: '0.4px',
                                    }}>
                                      {surat.nama}
                                    </div>
                                    <div style={{
                                      fontSize: 'clamp(13px, 1.4vw, 20px)',
                                      color: 'var(--text-secondary)',
                                      lineHeight: 1.5,
                                    }}>
                                      {surat.deskripsi || 'Klik untuk memilih jenis surat ini'}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Prev Arrow */}
                    {activeCardIndex > 0 && (
                      <button
                        onClick={() => handleCarouselSlide('prev')}
                        style={{
                          position: 'absolute',
                          left: 'clamp(8px, 1vw, 16px)',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: 'clamp(48px, 5vw, 64px)',
                          height: 'clamp(48px, 5vw, 64px)',
                          borderRadius: '50%',
                          background: '#3b82f6',
                          border: 'none',
                          color: 'white',
                          fontSize: 'clamp(24px, 2.5vw, 36px)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 8px 24px rgba(59, 130, 246, 0.4)',
                          transition: 'all 0.2s',
                          zIndex: 10,
                          fontWeight: 700
                        }}
                      >‹</button>
                    )}

                    {/* Next Arrow */}
                    {activeCardIndex < totalPages - 1 && (
                      <button
                        onClick={() => handleCarouselSlide('next')}
                        style={{
                          position: 'absolute',
                          right: 'clamp(8px, 1vw, 16px)',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: 'clamp(48px, 5vw, 64px)',
                          height: 'clamp(48px, 5vw, 64px)',
                          borderRadius: '50%',
                          background: '#3b82f6',
                          border: 'none',
                          color: 'white',
                          fontSize: 'clamp(24px, 2.5vw, 36px)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 8px 24px rgba(59, 130, 246, 0.4)',
                          transition: 'all 0.2s',
                          zIndex: 10,
                          fontWeight: 700
                        }}
                      >›</button>
                    )}
                  </div>

                  {/* Dot Indicators */}
                  {totalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 12 }}>
                      {chunkedTemplates.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => { if (!isSliding) setActiveCardIndex(i); }}
                          style={{
                            width: i === activeCardIndex ? 36 : 12,
                            height: 12,
                            borderRadius: 6,
                            background: i === activeCardIndex
                              ? 'var(--accent-primary)'
                              : 'rgba(255,255,255,0.2)',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            transition: 'all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </>
              );
            })()
          )}
        </div>
      )}

      {/* Slot Filling Progress — hanya tampil jika benar-benar sedang slot filling */}
      {selectedSurat && sessionData && (sessionData.phase === 'SLOT_FILLING' || sessionData.phase === 'CONFIRMATION') && (

        <div style={{ 
          marginTop: 0, 
          padding: phase === 'SLOT_FILLING' ? '16px 24px' : 'clamp(24px, 3.5vw, 48px) clamp(24px, 4.5vw, 64px)', 
          paddingBottom: editingSlot ? 420 : undefined,
          width: '100%',
          maxWidth: phase === 'SLOT_FILLING' ? '100%' : 1600, 
          margin: '0 auto', 
        }}>
          <div className="interview-title" style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
            {phase === 'CONFIRMATION' ? 'Data Lengkap — Tahap Konfirmasi' : 'Mengumpulkan Data Surat'}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 18, marginBottom: 16, textAlign: 'center' }}>
            {phase === 'CONFIRMATION'
              ? 'Konfirmasi melalui asisten suara: "Ya, benar" atau "Tidak, ubah"'
              : selectedSurat}
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
                    gap: 'clamp(12px, 1.5vw, 24px)',
                    padding: 'clamp(14px, 1.5vw, 24px) clamp(16px, 2vw, 32px)',
                    borderRadius: 16,
                    background: value ? '#0d2818' : (key === sessionData.current_slot ? '#1a1a4e' : '#0f172a'),
                    border: `2px solid ${value ? '#166534' : (key === sessionData.current_slot ? '#4338ca' : '#1e293b')}`,
                    transition: 'all 0.3s ease',
                    cursor: 'pointer'
                  }}
                    onClick={() => {
                      if (editingSlot !== key) {
                        startEditingSlot(key);
                      }
                    }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: value ? '#10b981' : (key === sessionData.current_slot ? '#6366f1' : '#1e293b'),
                    }}>
                    </div>
                    <span style={{ flex: 1, fontSize: 'clamp(16px, 2.2vw, 32px)', color: value ? 'white' : 'var(--text-secondary)', fontWeight: value ? 600 : 500, textAlign: 'left' }}>{label}</span>

                    {editingSlot === key ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{
                          fontSize: 28,
                          fontWeight: 600,
                          color: 'var(--accent-primary)',
                          animation: 'pulse 1.5s infinite'
                        }}>
                          Ketik di keyboard bawah...
                        </span>
                      </div>
                    ) : (
                      <span style={{
                        fontSize: 'clamp(14px, 2vw, 32px)',
                        fontWeight: 700,
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
                          background: '#1e293b', border: '2px solid #334155',
                          borderRadius: 12, padding: '16px 24px', cursor: 'pointer',
                          color: value ? '#10b981' : '#94a3b8', fontSize: 28, flexShrink: 0
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditingSlot(key);
                        }}
                      >✏️</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {phase === 'CONFIRMATION' && (
            <div style={{ marginTop: 'clamp(24px, 3vw, 48px)', display: 'flex', justifyContent: 'center', gap: 24 }}>
              <button
                className="btn btn-primary btn-lg"
                style={{ padding: 'clamp(14px, 1.6vw, 24px) clamp(32px, 4vw, 64px)', fontSize: 'clamp(16px, 1.8vw, 28px)', borderRadius: 20, boxShadow: '0 8px 32px rgba(99, 102, 241, 0.4)' }}
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
        style={{ 
          marginTop: '12px', 
          padding: 'clamp(12px, 1.4vw, 20px) clamp(24px, 3vw, 48px)', 
          fontSize: 'clamp(14px, 1.6vw, 24px)', 
          borderRadius: 16, 
          marginBottom: 0, 
          background: '#3b82f6', 
          color: 'white',
          border: 'none',
          boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
          cursor: 'pointer',
          fontWeight: 600
        }}
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

      {/* Virtual Keyboard — mengambang fixed di bawah layar (hanya tampil saat pensil diklik) */}
      {editingSlot && sessionData && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '16px 32px 24px 32px',
          background: '#0f172a',
          borderTop: '1px solid #1e293b',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
          zIndex: 200,
        }}>
          {/* Input field + tombol aksi */}
          {(() => {
            const inputType = getSlotInputType(editingSlot);
            const editingLabel = editingSlot ? (sessionData.slotDefs.find(d => d.key === editingSlot)?.label || editingSlot) : '';

            if (inputType === 'day') {
              // Day selector
              const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
              return (
                <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
                  <label style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 12 }}>
                    Pilih Hari untuk: <span style={{ color: '#6366f1', fontWeight: 700 }}>{editingLabel}</span>
                  </label>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {days.map(day => (
                      <button
                        key={day}
                        style={{
                          flex: '1 1 auto', minWidth: 120, padding: '18px 24px', fontSize: 20, fontWeight: 700,
                          background: slotInput === day ? '#6366f1' : '#1e293b',
                          border: slotInput === day ? '2px solid #818cf8' : '2px solid #334155',
                          color: 'white', borderRadius: 12, cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        onClick={() => {
                          setSlotInput(day);
                          setTimeout(() => handleSaveSlot(editingSlot), 200);
                        }}
                      >{day}</button>
                    ))}
                  </div>
                </div>
              );
            }

            if (inputType === 'time') {
              // Time picker: jam & menit
              const hours = Array.from({length: 24}, (_, i) => String(i).padStart(2, '0'));
              const minutes = ['00', '15', '30', '45'];
              const [selHour, selMinute] = (slotInput || '').split(':');
              return (
                <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
                  <label style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 12 }}>
                    Pilih Waktu untuk: <span style={{ color: '#6366f1', fontWeight: 700 }}>{editingLabel}</span>
                  </label>
                  <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                    {/* Jam */}
                    <div style={{ flex: 1 }}>
                      <p style={{ color: '#cbd5e1', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Jam</p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                        {hours.map(h => (
                          <button key={h} style={{
                            padding: '12px', fontSize: 20, fontWeight: 700,
                            background: selHour === h ? '#6366f1' : '#1e293b',
                            border: selHour === h ? '2px solid #818cf8' : '2px solid #334155',
                            color: 'white', borderRadius: 10, cursor: 'pointer',
                          }}
                          onClick={() => setSlotInput(`${h}:${selMinute || '00'}`)}
                          >{h}</button>
                        ))}
                      </div>
                    </div>
                    {/* Menit */}
                    <div style={{ width: 200 }}>
                      <p style={{ color: '#cbd5e1', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Menit</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {minutes.map(m => (
                          <button key={m} style={{
                            padding: '14px', fontSize: 20, fontWeight: 700,
                            background: selMinute === m ? '#6366f1' : '#1e293b',
                            border: selMinute === m ? '2px solid #818cf8' : '2px solid #334155',
                            color: 'white', borderRadius: 10, cursor: 'pointer',
                          }}
                          onClick={() => setSlotInput(`${selHour || '00'}:${m}`)}
                          >{m}</button>
                        ))}
                      </div>
                    </div>
                    {/* Simpan */}
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignSelf: 'flex-end' }}>
                      <button
                        onClick={() => { if (slotInput) handleSaveSlot(editingSlot); }}
                        disabled={!slotInput}
                        style={{
                          background: slotInput ? 'linear-gradient(135deg, #10b981, #059669)' : '#334155',
                          border: 'none', color: 'white', fontSize: 18, padding: '18px 40px',
                          borderRadius: 12, cursor: slotInput ? 'pointer' : 'not-allowed',
                          fontWeight: 700, opacity: slotInput ? 1 : 0.5,
                        }}
                      >SIMPAN</button>
                    </div>
                  </div>
                </div>
              );
            }

            if (inputType === 'date') {
              return (
                <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
                  <label style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 12 }}>
                    Pilih Tanggal untuk: <span style={{ color: '#6366f1', fontWeight: 700 }}>{editingLabel}</span>
                  </label>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <input
                      type="date"
                      value={slotInput}
                      onChange={e => setSlotInput(e.target.value)}
                      style={{
                        flex: 1, padding: '16px 24px', fontSize: 24, fontWeight: 600,
                        background: '#1e293b', border: '2px solid #6366f1', color: 'white',
                        borderRadius: 12, outline: 'none',
                        colorScheme: 'dark',
                      }}
                    />
                    <button
                      onClick={() => { if (slotInput) handleSaveSlot(editingSlot); }}
                      disabled={!slotInput}
                      style={{
                        background: slotInput ? 'linear-gradient(135deg, #10b981, #059669)' : '#334155',
                        border: 'none', color: 'white', fontSize: 18, padding: '18px 40px',
                        borderRadius: 12, cursor: slotInput ? 'pointer' : 'not-allowed',
                        fontWeight: 700, opacity: slotInput ? 1 : 0.5,
                      }}
                    >SIMPAN</button>
                  </div>
                </div>
              );
            }

            // Default: text input + keyboard
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, maxWidth: '1400px', margin: '0 auto 12px auto' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <label style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Mengisi: <span style={{ color: '#6366f1', fontWeight: 700 }}>
                        {editingLabel}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={slotInput}
                      onChange={e => {
                        setSlotInput(e.target.value);
                        if (keyboardRef.current) keyboardRef.current.setInput(e.target.value);
                      }}
                      onKeyDown={e => { if (e.key === 'Enter' && editingSlot) handleSaveSlot(editingSlot); }}
                      placeholder={'Ketik di sini atau gunakan keyboard...'}
                      style={{
                        width: '100%',
                        background: '#1e293b',
                        border: '2px solid #6366f1',
                        color: 'white',
                        padding: '14px 20px',
                        borderRadius: 12,
                        fontSize: 20,
                        outline: 'none',
                      }}
                    />
                  </div>
                  <button
                    onClick={() => handleSaveSlot(editingSlot)}
                    disabled={!slotInput.trim()}
                    style={{
                      background: !slotInput.trim() ? '#334155' : 'linear-gradient(135deg, #10b981, #059669)',
                      border: 'none', color: 'white', fontSize: 18, padding: '14px 32px',
                      borderRadius: 12, cursor: !slotInput.trim() ? 'not-allowed' : 'pointer',
                      fontWeight: 700, opacity: !slotInput.trim() ? 0.5 : 1,
                    }}
                  >
                    SIMPAN
                  </button>
                </div>
              </>
            );
          })()}
          {/* Keyboard — hanya tampil untuk input type text */}
          {getSlotInputType(editingSlot) === 'text' && (
          <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
            <Keyboard
              keyboardRef={r => (keyboardRef.current = r)}
              onChange={onKeyboardChange}
              onKeyPress={onKeyPress}
              theme={"hg-theme-default surat-kb-theme"}
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
                "{enter}": "OK",
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
          )}
          <style>{`
            .surat-kb-theme {
              background-color: transparent !important;
            }
            .surat-kb-theme .hg-button {
              background: #1e293b !important;
              color: white !important;
              border: 1px solid #334155 !important;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
              height: 56px !important;
              font-size: 20px !important;
              border-radius: 10px !important;
              margin: 3px !important;
            }
            .surat-kb-theme .hg-button:active {
              background: #334155 !important;
              transform: scale(0.95);
            }
            .surat-kb-theme .hg-primary-btn {
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
      )}
    </div>
  );
};

export default SuratPage;
