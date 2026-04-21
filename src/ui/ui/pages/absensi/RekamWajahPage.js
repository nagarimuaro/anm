/**
 * RekamWajahPage — Pendaftaran Wajah Pegawai
 * 
 * Flow: Pilih Pegawai → Buka Kamera → Auto-Capture Wajah → Review → Simpan
 * 
 * Auto-capture otomatis saat wajah terdeteksi menggunakan face-api.js
 * Menyimpan Float32Array descriptor untuk proses pengenalan.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as faceapi from '@vladmandic/face-api';

// Data pegawai — shared constant
const PEGAWAI_DB = [
  { id: 'PEG-001', nip: '198501152010011001', nama: 'Ir. Muhammad Fadli, M.Si', jabatan: 'Wali Nagari' },
  { id: 'PEG-002', nip: '199003212015012001', nama: 'Dewi Sartika, S.Pd', jabatan: 'Sekretaris Nagari' },
  { id: 'PEG-003', nip: '199205102018011002', nama: 'Rendi Pratama, A.Md', jabatan: 'Kepala Urusan Umum' },
  { id: 'PEG-004', nip: '198811302012012003', nama: 'Siti Nurhaliza, S.E', jabatan: 'Kepala Urusan Keuangan' },
  { id: 'PEG-005', nip: '199507082020012001', nama: 'Andi Saputra', jabatan: 'Staf Pelayanan' },
];

function getInitials(nama) {
  return nama.split(' ').filter(w => w.length > 1 && w[0] === w[0].toUpperCase()).slice(0, 2).map(w => w[0]).join('');
}

function getAvatarColor(nama) {
  const colors = [['#6366f1', '#8b5cf6'], ['#10b981', '#059669'], ['#f59e0b', '#d97706'], ['#ef4444', '#dc2626'], ['#3b82f6', '#2563eb'], ['#ec4899', '#db2777'], ['#14b8a6', '#0d9488'], ['#8b5cf6', '#7c3aed']];
  let hash = 0;
  for (let i = 0; i < nama.length; i++) hash += nama.charCodeAt(i);
  return colors[hash % colors.length];
}

function getSavedFaces() {
  try {
    return JSON.parse(localStorage.getItem('anm_face_db') || '{}');
  } catch { return {}; }
}

// Ensure Float32Array values are saved as arrays
function saveFaceData(pegawaiId, descriptors, avatarUrl) {
  const db = getSavedFaces();
  db[pegawaiId] = { 
    descriptors: descriptors.map(d => Array.from(d)), 
    avatarUrl, 
    registeredAt: new Date().toISOString() 
  };
  localStorage.setItem('anm_face_db', JSON.stringify(db));
}

const RekamWajahPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState('select');       // select | camera | review | done
  const [selectedPegawai, setSelectedPegawai] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelError, setModelError] = useState(null);

  const [photos, setPhotos] = useState([]);
  const [descriptors, setDescriptors] = useState([]);
  
  const [captureCountdown, setCaptureCountdown] = useState(null);
  const [flashActive, setFlashActive] = useState(false);
  const [savedFaces, setSavedFaces] = useState(getSavedFaces());
  const [faceDetected, setFaceDetected] = useState(false);
  const [autoCapturing, setAutoCapturing] = useState(false);
  const [instruction, setInstruction] = useState('');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectLoopRef = useRef(null);
  const faceStableRef = useRef(0);
  const autoCaptureTimerRef = useRef(null);
  
  const stateRef = useRef({ photos: [], descriptors: [] });

  const REQUIRED_PHOTOS = 3;
  const INSTRUCTIONS = [
    'Lihat lurus ke kamera',
    'Sedikit menoleh ke kanan',
    'Sedikit menoleh ke kiri',
  ];

  // Load Face-API models with WebGL TensorFlow acceleration
  useEffect(() => {
    const loadModels = async () => {
      try {
        // Explicitly set TensorFlow to use powerful WebGL
        await faceapi.tf.setBackend('webgl');
        await faceapi.tf.ready();
        
        // face-api.js bug: loadFromUri() secara internal strip prefix http://
        // menyebabkan tfjs fallback ke file:// di Electron.
        // Solusi: load model manual via fetch + loadFromWeightMap
        const baseUrl = (window.location.protocol === 'http:' || window.location.protocol === 'https:')
          ? `${window.location.origin}/models`
          : 'file://' + (window.require('process').resourcesPath || '.') + '/models';

        console.log('[Face-API] Loading models from:', baseUrl);

        const loadModel = async (net, modelName) => {
          const manifestUrl = `${baseUrl}/${modelName}-weights_manifest.json`;
          const manifestRes = await fetch(manifestUrl);
          const manifest = await manifestRes.json();
          
          const weightSpecs = [];
          const shardBuffers = [];
          
          for (const group of manifest) {
            weightSpecs.push(...group.weights);
            for (const shardPath of group.paths) {
              const res = await fetch(`${baseUrl}/${shardPath}`);
              shardBuffers.push(await res.arrayBuffer());
            }
          }
          
          const totalBytes = shardBuffers.reduce((sum, b) => sum + b.byteLength, 0);
          const combined = new ArrayBuffer(totalBytes);
          const view = new Uint8Array(combined);
          let offset = 0;
          for (const buf of shardBuffers) {
            view.set(new Uint8Array(buf), offset);
            offset += buf.byteLength;
          }
          
          const weightMap = faceapi.tf.io.decodeWeights(combined, weightSpecs);
          net.loadFromWeightMap(weightMap);
        };

        await Promise.all([
          loadModel(faceapi.nets.tinyFaceDetector, 'tiny_face_detector_model'),
          loadModel(faceapi.nets.faceLandmark68Net, 'face_landmark_68_model'),
          loadModel(faceapi.nets.faceRecognitionNet, 'face_recognition_model'),
        ]);
        setModelsLoaded(true);
      } catch (err) {
        console.error('Failed to load Face-API models:', err);
        setModelError('Gagal memuat model pengenalan wajah. Pastikan public/models berisi file yang benar.');
      }
    };
    loadModels();
  }, []);

  // Update refs consistently
  useEffect(() => { 
    stateRef.current.photos = photos; 
    stateRef.current.descriptors = descriptors;
  }, [photos, descriptors]);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setCameraReady(true);
        };
      }
    } catch (err) {
      setCameraError(err.message || 'Gagal mengakses kamera');
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (detectLoopRef.current) cancelAnimationFrame(detectLoopRef.current);
    if (autoCaptureTimerRef.current) clearTimeout(autoCaptureTimerRef.current);
    setCameraReady(false);
  }, []);

  // Take the final photo & descriptor
  const doCapture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    // Detect using faceapi right before capturing to get the descriptor
    const detection = await faceapi.detectSingleFace(
      videoRef.current, 
      new faceapi.TinyFaceDetectorOptions()
    ).withFaceLandmarks().withFaceDescriptor();

    if (!detection) {
      // Very unlikely since we waited for stability, but handle it
      setAutoCapturing(false);
      return;
    }

    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 200);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setPhotos(prev => [...prev, dataUrl]);
    setDescriptors(prev => [...prev, detection.descriptor]);
    setAutoCapturing(false);
    setCaptureCountdown(null);
  }, []);

  // Auto-capture countdown (3..2..1)
  const triggerAutoCapture = useCallback(() => {
    if (autoCaptureTimerRef.current) return; // Prevent multiple timers
    setAutoCapturing(true);
    setCaptureCountdown(3);
    let count = 3;
    autoCaptureTimerRef.current = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
        setCaptureCountdown(null);
        doCapture();
      } else {
        setCaptureCountdown(count);
      }
    }, 1000);
  }, [doCapture]);

  // Face detection loop
  useEffect(() => {
    if (!cameraReady || step !== 'camera' || !modelsLoaded) return;

    faceStableRef.current = 0;
    const STABLE_FRAMES = 8;

    const detectFaces = async () => {
      if (!videoRef.current || step !== 'camera') return;
      if (stateRef.current.photos.length >= REQUIRED_PHOTOS) return; // done

      try {
        const detection = await faceapi.detectSingleFace(
          videoRef.current, 
          new faceapi.TinyFaceDetectorOptions()
        );

        if (detection) {
          setFaceDetected(true);
          faceStableRef.current++;

          const photoIdx = stateRef.current.photos.length;
          setInstruction(INSTRUCTIONS[photoIdx] || INSTRUCTIONS[0]);

          if (faceStableRef.current >= STABLE_FRAMES && !autoCaptureTimerRef.current) {
            triggerAutoCapture();
          }
        } else {
          setFaceDetected(false);
          faceStableRef.current = Math.max(0, faceStableRef.current - 1); // Forgive 1 dropped frame

          if (autoCaptureTimerRef.current && faceStableRef.current <= 0) {
            clearInterval(autoCaptureTimerRef.current);
            autoCaptureTimerRef.current = null;
            setAutoCapturing(false);
            setCaptureCountdown(null);
          }
        }
      } catch { /* ignore */ }

      detectLoopRef.current = requestAnimationFrame(() => {
        setTimeout(detectFaces, 200);
      });
    };

    detectFaces();

    return () => {
      if (detectLoopRef.current) cancelAnimationFrame(detectLoopRef.current);
      // We explicitly DO NOT clear autoCaptureTimerRef here so it survives re-renders
    };
  }, [cameraReady, step, modelsLoaded, triggerAutoCapture]);

  // Reset stable count after capture
  useEffect(() => {
    if (photos.length > 0 && photos.length < REQUIRED_PHOTOS) {
      faceStableRef.current = 0;
      setAutoCapturing(false);
      const t = setTimeout(() => {
        setInstruction(INSTRUCTIONS[photos.length] || '');
      }, 500);
      return () => clearTimeout(t);
    }
  }, [photos.length]);

  const handleSelectPegawai = (pegawai) => {
    setSelectedPegawai(pegawai);
    setPhotos([]);
    setDescriptors([]);
    setStep('camera');
  };

  const handleSave = () => {
    if (selectedPegawai && photos.length >= REQUIRED_PHOTOS && descriptors.length >= REQUIRED_PHOTOS) {
      // Save descriptors + 1 avatar photo
      saveFaceData(selectedPegawai.id, descriptors, photos[0]);
      setSavedFaces(getSavedFaces());
      setStep('done');
      stopCamera();
    }
  };

  const handleReset = () => {
    stopCamera();
    setStep('select');
    setSelectedPegawai(null);
    setPhotos([]);
    setDescriptors([]);
    setCaptureCountdown(null);
    setAutoCapturing(false);
    setFaceDetected(false);
  };

  const handleDeleteFace = (pegawaiId) => {
    const db = getSavedFaces();
    delete db[pegawaiId];
    localStorage.setItem('anm_face_db', JSON.stringify(db));
    setSavedFaces(getSavedFaces());
  };

  useEffect(() => {
    if (step === 'camera') startCamera();
    return () => { if (step === 'camera') stopCamera(); };
  }, [step, startCamera, stopCamera]);

  useEffect(() => { return () => stopCamera(); }, [stopCamera]);

  useEffect(() => {
    if (photos.length >= REQUIRED_PHOTOS && step === 'camera') {
      setTimeout(() => setStep('review'), 800);
    }
  }, [photos.length, step]);

  return (
    <div className="page-enter rekam-wajah-page">
      {/* Header */}
      <div className="absensi-header">
        <h2 className="page-title">
          {step === 'select' && '📸 Rekam Wajah Pegawai'}
          {step === 'camera' && '📷 Ambil Foto Wajah'}
          {step === 'review' && '✅ Verifikasi Foto'}
          {step === 'done' && '🎉 Pendaftaran Berhasil'}
        </h2>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>
          {step === 'select' && (modelError || 'Pilih pegawai untuk mendaftarkan wajah')}
          {step === 'camera' && (!modelsLoaded ? 'Memuat model AI...' : `Foto ${Math.min(photos.length + 1, REQUIRED_PHOTOS)} dari ${REQUIRED_PHOTOS} — Posisikan wajah di dalam guide`)}
          {step === 'review' && 'Pastikan semua foto terlihat jelas'}
          {step === 'done' && 'Wajah pegawai berhasil didaftarkan ke sistem'}
        </p>
      </div>

      {modelError && (
        <div style={{ background: 'var(--accent-danger)', color: 'white', padding: '12px 20px', borderRadius: 8, marginTop: 16 }}>
          {modelError}
        </div>
      )}

      {/* Step: Select Pegawai */}
      {step === 'select' && !modelError && (
        <div className="rekam-select-container">
          <div className="rekam-pegawai-list">
            {PEGAWAI_DB.map((p) => {
              const isRegistered = !!savedFaces[p.id];
              const colors = getAvatarColor(p.nama);
              return (
                <div key={p.id} className={`rekam-pegawai-card ${isRegistered ? 'registered' : ''}`}>
                  <div className="rekam-pegawai-avatar" style={{
                    background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`,
                  }}>
                    {savedFaces[p.id]?.avatarUrl ? (
                      <img src={savedFaces[p.id].avatarUrl} alt={p.nama} />
                    ) : (
                      <span>{getInitials(p.nama)}</span>
                    )}
                    {isRegistered && <div className="rekam-registered-badge">✓</div>}
                  </div>
                  <div className="rekam-pegawai-info">
                    <div className="rekam-pegawai-nama">{p.nama}</div>
                    <div className="rekam-pegawai-jabatan">{p.jabatan}</div>
                    {isRegistered && (
                      <div className="rekam-registered-label">Wajah Terdaftar</div>
                    )}
                  </div>
                  <div className="rekam-pegawai-actions">
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 13, padding: '8px 16px' }}
                      onClick={() => handleSelectPegawai(p)}
                      disabled={!modelsLoaded}
                    >
                      {isRegistered ? '🔄 Ulang' : '📸 Rekam'}
                    </button>
                    {isRegistered && (
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: '6px 10px', marginTop: 4 }}
                        onClick={() => handleDeleteFace(p.id)}
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step: Camera — AUTO CAPTURE via Face-API */}
      {step === 'camera' && (
        <div className="rekam-camera-container">
          {/* Selected pegawai mini card */}
          <div className="rekam-selected-mini">
            <span style={{ fontSize: 14 }}>📸</span>
            <span>{selectedPegawai?.nama}</span>
            <span style={{ color: 'var(--text-muted)' }}>•</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{selectedPegawai?.jabatan}</span>
          </div>

          <div className={`camera-viewport ${faceDetected ? 'face-active' : ''}`}>
            <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* ── Face silhouette guide ── */}
            <div className={`face-guide-silhouette ${faceDetected ? 'detected' : ''}`}>
              <svg viewBox="0 0 200 280" className="face-guide-svg">
                {/* Top Dotted Arch */}
                <path d="M 35 65 A 80 80 0 0 1 165 65" fill="none" stroke="var(--accent-info)" strokeWidth="3" strokeDasharray="4 6" strokeLinecap="round" />
                <circle cx="32" cy="68" r="4" fill="none" stroke="var(--accent-info)" strokeWidth="2.5" />
                <circle cx="168" cy="68" r="4" fill="none" stroke="var(--accent-info)" strokeWidth="2.5" />
                
                {/* Main Face Oval */}
                <ellipse cx="100" cy="150" rx="65" ry="90" fill="none" strokeWidth="3.5" className="face-guide-path" />
              </svg>
            </div>
            <div className="face-guide-mask" />

            {/* Instruction text */}
            {instruction && photos.length < REQUIRED_PHOTOS && (
              <div className="face-guide-instruction">
                {instruction}
              </div>
            )}

            {/* Capture countdown */}
            {captureCountdown !== null && (
              <div className="capture-countdown">{captureCountdown}</div>
            )}

            {/* Flash effect */}
            {flashActive && <div className="capture-flash" />}

            {/* Camera status badge */}
            <div className={`camera-status-badge ${faceDetected ? 'detected' : ''}`}>
              <span className="camera-status-dot" />
              {!cameraReady ? 'Membuka kamera...' :
               !modelsLoaded ? 'Memuat model AI...' :
               autoCapturing ? '📸 Merekam fitur wajah...' :
               faceDetected ? '✓ Wajah Terdeteksi' : 'Menunggu wajah...'}
            </div>
          </div>

          {/* Photo thumbnails */}
          <div className="rekam-thumbnails">
            {Array.from({ length: REQUIRED_PHOTOS }).map((_, i) => (
              <div key={i} className={`rekam-thumb ${photos[i] ? 'captured' : ''} ${i === photos.length ? 'current' : ''}`}>
                {photos[i] ? (
                  <img src={photos[i]} alt={`Foto ${i + 1}`} />
                ) : (
                  <span className="rekam-thumb-num">{i + 1}</span>
                )}
              </div>
            ))}
          </div>

          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginTop: 4 }}>
            {!modelsLoaded ? 'Mohon tunggu, memuat Face-API...' :
             photos.length >= REQUIRED_PHOTOS ? '✅ Memproses fitur wajah!' :
             autoCapturing ? '⏳ Siap-siap, jangan bergerak...' :
             faceDetected ? '🟢 Wajah terdeteksi — otomatis merekam' :
             '👤 Posisikan wajah di dalam guide'}
          </p>

          {cameraError && (
            <div className="camera-error">
              <p>⚠️ {cameraError}</p>
              <button className="btn btn-secondary" onClick={startCamera} style={{ marginTop: 8, fontSize: 13 }}>Coba Lagi</button>
            </div>
          )}
        </div>
      )}

      {/* Step: Review */}
      {step === 'review' && (
        <div className="rekam-review-container">
          <div className="rekam-review-photos">
            {photos.map((photo, i) => (
              <div key={i} className="rekam-review-photo">
                <img src={photo} alt={`Foto ${i + 1}`} />
                <div className="rekam-review-label">Pose {i + 1}</div>
              </div>
            ))}
          </div>

          <div className="rekam-review-info">
            <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              {selectedPegawai?.nama}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              {photos.length} pose telah direkam dengan fitur AI
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button className="btn btn-primary btn-lg" onClick={handleSave}>
              ✓ Simpan & Daftarkan
            </button>
            <button className="btn btn-secondary" onClick={() => { setPhotos([]); setDescriptors([]); setStep('camera'); }}>
              ↻ Ulangi Rekaman
            </button>
          </div>
        </div>
      )}

      {/* Step: Done */}
      {step === 'done' && (
        <div className="rekam-done-container">
          <div className="rekam-done-icon">🎉</div>
          <h3 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Pendaftaran Berhasil!
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 15, marginBottom: 24, maxWidth: 400, lineHeight: 1.6 }}>
            Fitur wajah <strong style={{ color: 'var(--accent-light)' }}>{selectedPegawai?.nama}</strong> telah
            berhasil didaftarkan ke sistem absensi.
          </p>

          <div className="rekam-done-photos">
            {photos.map((photo, i) => (
              <div key={i} className="rekam-done-thumb">
                <img src={photo} alt={`Foto ${i + 1}`} />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button className="btn btn-primary" onClick={handleReset}>
              📸 Rekam Pegawai Lain
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/absensi')}>
              ← Ke Absensi
            </button>
          </div>
        </div>
      )}

      {/* Back button */}
      {step === 'select' && (
        <button
          className="btn btn-secondary"
          style={{ marginTop: 24 }}
          onClick={() => navigate('/absensi')}
        >
          ← Kembali ke Absensi
        </button>
      )}
    </div>
  );
};

export default RekamWajahPage;
