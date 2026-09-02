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
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  InfoIcon,
  ShieldCheckIcon,
  ScanFaceIcon,
  UserIcon,
  ArrowLeftIcon
} from '../../components/Icons';
import StatusDialog from '../../components/common/StatusDialog';

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
      new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.70 })
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

    // Gunakan master descriptor dari foto 1 (wajah lurus frontal - paling akurat dan presisi)
    const bestDescriptor = Array.from(descriptors[0] || descriptors[1] || []);

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
      {/* Header */}
      <div className="absensi-header">
        <h2 className="page-title">
          {step === 'token' && 'Otorisasi Admin'}
          {step === 'select' && 'Pendaftaran Wajah Pegawai'}
          {step === 'camera' && 'Pengambilan Sampel Wajah'}
          {step === 'review' && 'Verifikasi Sampel Foto'}
          {step === 'done' && 'Pendaftaran Biometrik Selesai'}
        </h2>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>
          {step === 'token' && 'Masukkan Token Pendaftaran yang diterbitkan dari Admin Panel'}
          {step === 'camera' && (!modelsLoaded ? 'Memuat modul biometrik...' : `Halo ${selectedPegawai?.nama?.split(' ')[0] || 'Pegawai'}, silakan posisikan wajah Anda ke kamera (${Math.min(photos.length + 1, REQUIRED_PHOTOS)}/${REQUIRED_PHOTOS})`)}
          {step === 'review' && 'Pastikan seluruh sampel foto tampak jelas dan fokus'}
          {step === 'done' && 'Data biometrik pegawai telah berhasil didaftarkan'}
        </p>
      </div>

      {/* Step: Token Admin */}
      {step === 'token' && (
        <div style={{ maxWidth: 420, margin: '24px auto', textAlign: 'center' }}>
          <div className="glass-card" style={{ padding: '36px 30px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ marginBottom: 16 }}>
              <ShieldCheckIcon size={48} color="var(--accent-info, #38BDF8)" />
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
              Masukkan 6 atau 14 digit token verifikasi dari sistem admin SINTANAGARI.
            </p>
            <input
              type="text"
              placeholder="Contoh: 482917"
              value={adminToken}
              onChange={e => { setAdminToken(e.target.value); setTokenError(''); }}
              style={{
                width: '100%', padding: '14px', borderRadius: 12,
                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.18)',
                color: 'white', fontSize: 20, textAlign: 'center', letterSpacing: 4, marginBottom: 8,
              }}
            />
            <StatusDialog
              isOpen={!!tokenError}
              type="error"
              title="Token Admin Tidak Valid"
              message={tokenError}
              onClose={() => setTokenError('')}
              actionText="Ketik Ulang Token"
            />
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
                    setTokenError(res?.message || 'Token tidak valid atau sudah kedaluwarsa.');
                  }
                } catch (e) {
                  setTokenError('Gagal memverifikasi token. Periksa koneksi jaringan.');
                } finally {
                  setTokenChecking(false);
                }
              }}
            >
              {tokenChecking ? 'Memeriksa Otorisasi...' : 'Lanjutkan Verifikasi'}
            </button>
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={() => navigate('/absensi')}>
            <ArrowLeftIcon size={16} color="currentColor" />
            Kembali ke Absensi
          </button>
        </div>
      )}

      {/* Step: Camera — AUTO CAPTURE via Face-API */}
      {step === 'camera' && (
        <div className="rekam-camera-container">
          {/* Selected pegawai mini card */}
          <div className="rekam-selected-mini" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 18px', background: 'rgba(15,23,42,0.85)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.15)', marginBottom: 12 }}>
            <UserIcon size={16} color="var(--accent-info, #38BDF8)" />
            <span style={{ fontWeight: 600 }}>{selectedPegawai?.nama}</span>
            <span style={{ color: 'var(--text-muted)' }}>•</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{selectedPegawai?.jabatan}</span>
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
               !modelsLoaded ? 'Memuat modul biometrik...' :
               autoCapturing ? 'Merekam sampel wajah...' :
               faceDetected ? 'Wajah Terdeteksi' : 'Menunggu wajah...'}
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

          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginTop: 8 }}>
            {!modelsLoaded ? 'Mohon tunggu, memuat modul pengenalan...' :
             photos.length >= REQUIRED_PHOTOS ? 'Pengambilan sampel foto selesai' :
             autoCapturing ? 'Siap-siap, pertahankan posisi Anda...' :
             faceDetected ? 'Wajah terdeteksi — otomatis mengambil foto' :
             'Posisikan wajah Anda di dalam lingkaran panduan'}
          </p>

          {cameraError && (
            <div className="camera-error" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <AlertTriangleIcon size={24} color="#EF4444" />
              <p style={{ margin: 0 }}>{cameraError}</p>
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

          <div className="rekam-review-info" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ marginBottom: 8 }}>
              <CheckCircleIcon size={40} color="#10B981" />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              {selectedPegawai?.nama}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              {photos.length} sampel foto berhasil diambil secara optimal
            </p>
          </div>

      <StatusDialog
        isOpen={!!modelError}
        type="error"
        title="Modul AI Gagal Dimuat"
        message={modelError}
        onClose={() => setModelError(null)}
        actionText="Tutup"
      />

      <StatusDialog
        isOpen={!!enrollError}
        type="error"
        title="Pendaftaran Biometrik Gagal"
        message={enrollError}
        onClose={() => setEnrollError('')}
        actionText="Ulangi Pengambilan"
        onAction={() => { setEnrollError(''); setPhotos([]); setDescriptors([]); setStep('camera'); }}
      />

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button className="btn btn-primary btn-lg" onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircleIcon size={18} color="white" />
              Kirim & Daftarkan Biometrik
            </button>
            <button className="btn btn-secondary" onClick={() => { setPhotos([]); setDescriptors([]); setStep('camera'); }}>
              Ulangi Pengambilan Foto
            </button>
          </div>
        </div>
      )}

      {/* Step: Done */}
      {step === 'done' && (
        <div className="rekam-done-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div className="rekam-done-icon" style={{ marginBottom: 12 }}>
            <CheckCircleIcon size={56} color="#10B981" />
          </div>
          <h3 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Pendaftaran Biometrik Berhasil
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 15, marginBottom: 24, maxWidth: 440, lineHeight: 1.6 }}>
            Data wajah <strong style={{ color: 'var(--accent-light, #38BDF8)' }}>{selectedPegawai?.nama}</strong> telah
            berhasil disimpan dan dapat langsung digunakan untuk presensi mandiri.
          </p>

          <div className="rekam-done-photos">
            {photos.map((photo, i) => (
              <div key={i} className="rekam-done-thumb">
                <img src={photo} alt={`Foto ${i + 1}`} />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button className="btn btn-primary" onClick={handleReset} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ScanFaceIcon size={18} color="white" />
              Daftarkan Pegawai Lain
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/absensi')} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowLeftIcon size={16} color="currentColor" />
              Ke Halaman Absensi
            </button>
          </div>
        </div>
      )}

      {/* Back button */}
      {step === 'select' && (
        <button
          className="btn btn-secondary"
          style={{ marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 8 }}
          onClick={() => setStep('token')}
        >
          <ArrowLeftIcon size={16} color="currentColor" />
          Ubah Token
        </button>
      )}
    </div>
  );
};

export default RekamWajahPage;
