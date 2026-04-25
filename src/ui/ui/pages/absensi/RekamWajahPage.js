/**
 * RekamWajahPage — Pendaftaran Wajah Pegawai
 * 
 * Flow: Token Admin → Pilih Pegawai (dari API) → Buka Kamera → Auto-Capture Wajah → Review → Kirim ke Server
 * 
 * Auto-capture otomatis saat wajah terdeteksi menggunakan face-api.js.
 * Descriptor dikirim ke backend via IPC → POST /api/device/hr/face-enroll
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as faceapi from '@vladmandic/face-api';

const electron = window.require ? window.require('electron') : null;

function getInitials(nama) {
  return nama.split(' ').filter(w => w.length > 1 && w[0] === w[0].toUpperCase()).slice(0, 2).map(w => w[0]).join('');
}

function getAvatarColor(nama) {
  const colors = [['#6366f1', '#8b5cf6'], ['#10b981', '#059669'], ['#f59e0b', '#d97706'], ['#ef4444', '#dc2626'], ['#3b82f6', '#2563eb'], ['#ec4899', '#db2777'], ['#14b8a6', '#0d9488'], ['#8b5cf6', '#7c3aed']];
  let hash = 0;
  for (let i = 0; i < nama.length; i++) hash += nama.charCodeAt(i);
  return colors[hash % colors.length];
}

// Deteksi arah kepala berdasarkan landmarks (hidung vs rahang)
function getHeadPose(landmarks) {
  const nose = landmarks.getNose()[3];
  const jaw = landmarks.getJawOutline();
  const leftJaw = jaw[0];
  const rightJaw = jaw[16];
  const leftDist = nose.x - leftJaw.x;
  const rightDist = rightJaw.x - nose.x;
  if (leftDist < rightDist * 0.55) return 'turn_left';
  if (rightDist < leftDist * 0.55) return 'turn_right';
  return 'center';
}

const RekamWajahPage = () => {
  const navigate = useNavigate();
  // step: token → select → camera → review → done
  const [step, setStep] = useState('token');
  const [adminToken, setAdminToken] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [selectedPegawai, setSelectedPegawai] = useState(null);
  const [tokenChecking, setTokenChecking] = useState(false);
  const [enrollError, setEnrollError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelError, setModelError] = useState(null);

  const [photos, setPhotos] = useState([]);
  const [descriptors, setDescriptors] = useState([]);
  
  const [captureCountdown, setCaptureCountdown] = useState(null);
  const [flashActive, setFlashActive] = useState(false);
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
  // Pause detection saat Sinta sedang bicara — agar foto tidak diambil sebelum instruksi selesai
  const pauseDetectionUntilRef = useRef(0);

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

    const detection = await faceapi.detectSingleFace(
      videoRef.current, 
      new faceapi.TinyFaceDetectorOptions()
    ).withFaceLandmarks().withFaceDescriptor();

    if (!detection) {
      setAutoCapturing(false);
      return;
    }

    // ✅ Reset SEGERA agar detection loop tidak re-trigger sebelum instruksi diucapkan
    faceStableRef.current = 0;
    // Pause deteksi 7 detik — cukup untuk Sinta selesai bicara instruksi berikutnya
    pauseDetectionUntilRef.current = Date.now() + 7000;

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

    // Ucapkan instruksi pertama saat kamera siap
    // Pause deteksi 7 detik agar Sinta selesai bicara sebelum auto-capture mulai
    pauseDetectionUntilRef.current = Date.now() + 7000;
    if (electron) {
      electron.ipcRenderer.invoke(
        'voice:speakOnce',
        'Kamera siap. Kami akan mengambil tiga foto wajah Anda. Pertama, lihat lurus ke kamera.'
      ).catch(() => {});
    }

    const detectFaces = async () => {
      if (!videoRef.current || step !== 'camera') return;
      if (stateRef.current.photos.length >= REQUIRED_PHOTOS) return;

      // Jika Sinta sedang bicara, tunda deteksi
      if (Date.now() < pauseDetectionUntilRef.current) {
        detectLoopRef.current = requestAnimationFrame(() => setTimeout(detectFaces, 200));
        return;
      }

      try {
        const photoIdx = stateRef.current.photos.length;

        // Gunakan landmarks untuk foto 2 & 3 (perlu validasi pose)
        const needsPose = photoIdx === 1 || photoIdx === 2;
        const detection = needsPose
          ? await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks()
          : await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions());

        if (detection) {
          setFaceDetected(true);
          setInstruction(INSTRUCTIONS[photoIdx] || INSTRUCTIONS[0]);

          // Validasi pose sebelum menghitung stable frames
          if (needsPose) {
            // Jika landmarks tidak tersedia, JANGAN capture — tunggu frame berikutnya
            if (!detection.landmarks) {
              faceStableRef.current = 0;
              detectLoopRef.current = requestAnimationFrame(() => setTimeout(detectFaces, 200));
              return;
            }

            const pose = getHeadPose(detection.landmarks);
            // Catatan: getHeadPose mengembalikan arah dari sisi KAMERA (non-mirror)
            // "Menoleh ke kanan" dari sisi USER = turn_left di camera space (mirroring)
            // "Menoleh ke kiri" dari sisi USER = turn_right di camera space
            const requiredPose = photoIdx === 1 ? 'turn_left' : 'turn_right';
            if (pose !== requiredPose) {
              // Pose belum benar — reset stability, jangan capture
              faceStableRef.current = 0;
              detectLoopRef.current = requestAnimationFrame(() => setTimeout(detectFaces, 200));
              return;
            }
          }

          faceStableRef.current++;

          if (faceStableRef.current >= STABLE_FRAMES && !autoCaptureTimerRef.current) {
            triggerAutoCapture();
          }
        } else {
          setFaceDetected(false);
          faceStableRef.current = Math.max(0, faceStableRef.current - 1);

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
    };
  }, [cameraReady, step, modelsLoaded, triggerAutoCapture]);

  // Ucapkan instruksi berikutnya setelah capture (deteksi sudah di-pause di doCapture)
  useEffect(() => {
    if (photos.length > 0 && photos.length < REQUIRED_PHOTOS) {
      setAutoCapturing(false);
      const nextInstr = INSTRUCTIONS[photos.length] || '';
      const t = setTimeout(() => {
        setInstruction(nextInstr);
        if (electron && nextInstr) {
          electron.ipcRenderer.invoke('voice:speakOnce',
            `Foto ${photos.length} berhasil. Sekarang ${nextInstr.toLowerCase()}.`
          ).catch(() => {});
        }
      }, 300);
      return () => clearTimeout(t);
    }
  }, [photos.length]);



  const handleSave = async () => {
    if (!selectedPegawai || photos.length < REQUIRED_PHOTOS || descriptors.length < REQUIRED_PHOTOS) return;
    setEnrollError('');

    // Pick the best descriptor (middle sample)
    const bestDescriptor = Array.from(descriptors[1] || descriptors[0]);

    try {
      if (electron) {
        const res = await electron.ipcRenderer.invoke('kiosk:api:hrFaceEnroll', {
          token: adminToken,
          descriptor: bestDescriptor,
        });
        if (!res || !res.success) {
          setEnrollError(res?.message || 'Gagal mendaftarkan wajah ke server.');
          return;
        }
      }
    } catch (err) {
      setEnrollError('Koneksi ke server gagal. Periksa jaringan.');
      return;
    }

    setStep('done');
    stopCamera();

    // Ucapkan pesan sukses via Sinta
    const namaPegawai = selectedPegawai?.nama?.split(/[\s,]+/)[0] || 'pegawai';
    if (electron) {
      electron.ipcRenderer.invoke(
        'voice:speakOnce',
        `Rekam wajah ${namaPegawai} berhasil! Data biometrik telah tersimpan dan siap digunakan untuk absensi.`
      ).catch(() => {});
    }
  };

  const handleReset = () => {
    stopCamera();
    setStep('token');
    setAdminToken('');
    setTokenError('');
    setSelectedPegawai(null);
    setPhotos([]);
    setDescriptors([]);
    setCaptureCountdown(null);
    setAutoCapturing(false);
    setFaceDetected(false);
    setEnrollError('');
  };

  // Delete enrollment not supported from Kiosk side — must be done from Admin Panel

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
          {step === 'token' && '🔐 Verifikasi Admin'}
          {step === 'select' && '📸 Rekam Wajah Pegawai'}
          {step === 'camera' && '📷 Ambil Foto Wajah'}
          {step === 'review' && '✅ Verifikasi Foto'}
          {step === 'done' && '🎉 Pendaftaran Berhasil'}
        </h2>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>
          {step === 'token' && 'Masukkan Token Pendaftaran yang diberikan Admin'}
          {step === 'camera' && (!modelsLoaded ? 'Memuat model AI...' : `Halo ${selectedPegawai?.nama?.split(' ')[0] || 'Pegawai'}, silakan arahkan wajah Anda ke kamera (${Math.min(photos.length + 1, REQUIRED_PHOTOS)}/${REQUIRED_PHOTOS})`)}
          {step === 'review' && 'Pastikan semua foto terlihat jelas'}
          {step === 'done' && 'Wajah pegawai berhasil didaftarkan ke sistem'}
        </p>
      </div>

      {/* Step: Token Admin */}
      {step === 'token' && (
        <div style={{ maxWidth: 400, margin: '24px auto', textAlign: 'center' }}>
          <div className="glass-card" style={{ padding: '32px 28px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔑</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
              Token ini diperoleh dari Admin Panel SINTANAGARI (6 atau 14 digit).
            </p>
            <input
              type="text"
              placeholder="Masukkan token (contoh: 482917)"
              value={adminToken}
              onChange={e => { setAdminToken(e.target.value); setTokenError(''); }}
              style={{
                width: '100%', padding: '14px', borderRadius: 10,
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.15)',
                color: 'white', fontSize: 20, textAlign: 'center', letterSpacing: 4, marginBottom: 8,
              }}
            />
            {tokenError && <p style={{ color: 'var(--accent-danger)', fontSize: 13, marginBottom: 12 }}>{tokenError}</p>}
            <button
              className="btn btn-primary btn-block"
              style={{ width: '100%', marginTop: 12 }}
              disabled={adminToken.trim().length < 6 || tokenChecking}
              onClick={async () => {
                if (adminToken.trim().length < 6) { setTokenError('Token minimal 6 karakter.'); return; }
                if (!electron) return;
                
                setTokenChecking(true);
                setTokenError('');
                try {
                  const res = await electron.ipcRenderer.invoke('kiosk:api:hrFaceEnrollCheckToken', adminToken.trim());
                  if (res && res.success && res.data) {
                    setSelectedPegawai(res.data);
                    setPhotos([]);
                    setDescriptors([]);
                    setStep('camera');
                  } else {
                    setTokenError(res?.message || 'Kode tidak valid atau sudah kedaluwarsa.');
                  }
                } catch (e) {
                  setTokenError('Gagal memverifikasi token. Periksa koneksi.');
                } finally {
                  setTokenChecking(false);
                }
              }}
            >
              {tokenChecking ? 'Memeriksa...' : 'Lanjut →'}
            </button>
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => navigate('/absensi')}>
            ← Kembali ke Absensi
          </button>
        </div>
      )}

      {modelError && (
        <div style={{ background: 'var(--accent-danger)', color: 'white', padding: '12px 20px', borderRadius: 8, marginTop: 16 }}>
          {modelError}
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

          {enrollError && (
            <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 16px', marginTop: 12, color: '#f87171', fontSize: 14 }}>
              ⚠️ {enrollError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button className="btn btn-primary btn-lg" onClick={handleSave}>
              ✓ Kirim & Daftarkan
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
          onClick={() => setStep('token')}
        >
          ← Ubah Token
        </button>
      )}
    </div>
  );
};

export default RekamWajahPage;
