/**
 * AbsensiPage — Halaman Absensi Pegawai Nagari
 * 
 * Flow: Face Recognition (Kamera) -> Liveness Challenge (Blink/Head) -> Profil -> Absensi Tercatat
 * 
 * Menggunakan face-api.js (WebGL) untuk deteksi wajah dan mengukur landmarks.
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

// ── Liveness Logic Heuristics ──

// Eye Aspect Ratio (EAR) to detect blinking
function getEAR(eye) {
  const v1 = Math.hypot(eye[1].x - eye[5].x, eye[1].y - eye[5].y);
  const v2 = Math.hypot(eye[2].x - eye[4].x, eye[2].y - eye[4].y);
  const h = Math.hypot(eye[0].x - eye[3].x, eye[0].y - eye[3].y);
  return (v1 + v2) / (2.0 * h);
}

// Pose detection based on 2D landmarks (nose vs jawline)
function getHeadPose(landmarks) {
  const nose = landmarks.getNose()[3];
  const jaw = landmarks.getJawOutline();
  const leftJaw = jaw[0];
  const rightJaw = jaw[16];

  const leftDist = nose.x - leftJaw.x;
  const rightDist = rightJaw.x - nose.x;

  if (leftDist < rightDist * 0.5) return 'turn_left';
  if (rightDist < leftDist * 0.5) return 'turn_right';
  return 'center';
}


const AbsensiPage = () => {
  const navigate = useNavigate();
  // mode: camera -> liveness -> identifying -> identified
  const [mode, setMode] = useState('camera');      
  const [pegawai, setPegawai] = useState(null);
  const [absensiTime, setAbsensiTime] = useState(null);
  
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  
  const [faceDetected, setFaceDetected] = useState(false);
  const [faceBox, setFaceBox] = useState(null);

  // Liveness State
  const [challenge, setChallenge] = useState(null);
  const [livenessStatus, setLivenessStatus] = useState('waiting'); // waiting, progress, passed
  
  const [identifyProgress, setIdentifyProgress] = useState(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectLoopRef = useRef(null);
  const autoResetRef = useRef(null);
  const identifyIntervalRef = useRef(null);
  const isMatchingFaceRef = useRef(false);

  const matchedPegawaiRef = useRef(null);
  
  // Liveness tracking refs
  const eyesClosedRef = useRef(false);

  // Load Face-API models and descriptors DB with WebGL TensorFlow acceleration
  useEffect(() => {
    const initFaceAPI = async () => {
      try {
        await faceapi.tf.setBackend('webgl');
        await faceapi.tf.ready();
        
        // face-api.js bug: loadFromUri() secara internal strip prefix http://
        // menyebabkan tfjs fallback ke file:// di Electron.
        // Solusi: load model manual via fetch + loadFromWeightMap
        const baseUrl = (window.location.protocol === 'http:' || window.location.protocol === 'https:')
          ? `${window.location.origin}/models`
          : 'file://' + (window.require('process').resourcesPath || '.') + '/models';

        console.log('[Face-API] Loading models from:', baseUrl);

        // Helper: fetch manifest JSON, download shard binaries, decode via tfjs
        const loadModel = async (net, modelName) => {
          const manifestUrl = `${baseUrl}/${modelName}-weights_manifest.json`;
          const manifestRes = await fetch(manifestUrl);
          const manifest = await manifestRes.json();
          
          // Collect all weight specs and download all shards
          const weightSpecs = [];
          const shardBuffers = [];
          
          for (const group of manifest) {
            weightSpecs.push(...group.weights);
            for (const shardPath of group.paths) {
              const res = await fetch(`${baseUrl}/${shardPath}`);
              shardBuffers.push(await res.arrayBuffer());
            }
          }
          
          // Combine all shard buffers into one
          const totalBytes = shardBuffers.reduce((sum, b) => sum + b.byteLength, 0);
          const combined = new ArrayBuffer(totalBytes);
          const view = new Uint8Array(combined);
          let offset = 0;
          for (const buf of shardBuffers) {
            view.set(new Uint8Array(buf), offset);
            offset += buf.byteLength;
          }
          
          // Use tfjs decodeWeights which handles all dtypes correctly
          const weightMap = faceapi.tf.io.decodeWeights(combined, weightSpecs);
          net.loadFromWeightMap(weightMap);
        };

        await Promise.all([
          loadModel(faceapi.nets.tinyFaceDetector, 'tiny_face_detector_model'),
          loadModel(faceapi.nets.faceLandmark68Net, 'face_landmark_68_model'),
          loadModel(faceapi.nets.faceRecognitionNet, 'face_recognition_model'),
        ]);
        setModelsLoaded(true);
        setDbLoaded(true); // Always true because DB is now on the backend
      } catch (err) {
        console.error('Face-API Init Error:', err);
      }
    };
    initFaceAPI();
  }, []);

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

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (detectLoopRef.current) cancelAnimationFrame(detectLoopRef.current);
    setCameraReady(false);
  }, []);

  // Transition to Liveness
  const startLivenessChallenge = (matchedPegawai) => {
    matchedPegawaiRef.current = matchedPegawai;
    
    // Choose random challenge
    const challenges = ['blink', 'turn_left', 'turn_right'];
    const randomCh = challenges[Math.floor(Math.random() * challenges.length)];
    
    setChallenge(randomCh);
    setLivenessStatus('waiting');
    eyesClosedRef.current = false;
    setMode('liveness');

    if (electron && randomCh === 'blink') {
      electron.ipcRenderer.invoke('voice:synthesize', 'Silakan kedipkan mata Anda.');
    } else if (electron && randomCh === 'turn_left') {
      electron.ipcRenderer.invoke('voice:synthesize', 'Tolong menoleh sedikit ke kiri.');
    } else if (electron && randomCh === 'turn_right') {
      electron.ipcRenderer.invoke('voice:synthesize', 'Tolong menoleh sedikit ke kanan.');
    }
  };

  // Transition to Identified
  const startIdentification = useCallback(() => {
    setMode('identifying');
    setIdentifyProgress(0);

    let progress = 0;
    identifyIntervalRef.current = setInterval(() => {
      progress += Math.random() * 20 + 20;
      if (progress >= 100) {
        progress = 100;
        clearInterval(identifyIntervalRef.current);

        const now = new Date();
        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const finalPegawai = matchedPegawaiRef.current;

        setPegawai(finalPegawai);
        
        // Push checkin/checkout to Backend
        if (electron && finalPegawai) {
          const isCheckout = finalPegawai.sudah_checkin && !finalPegawai.sudah_checkout;
          const action = isCheckout ? 'kiosk:api:hrCheckout' : 'kiosk:api:hrCheckin';
          
          electron.ipcRenderer.invoke(action, { pegawai_id: finalPegawai.id, confidence: 0.95 })
            .then(res => {
              setAbsensiTime(timeStr);
              setMode('identified');

              // Pesan suara personal berdasarkan check-in atau checkout
              const namaDepan = finalPegawai.nama.split(/[\s,]+/)[0] || 'Pegawai';
              const jamSekarang = now.getHours();
              const sapaanWaktu = jamSekarang < 11 ? 'Selamat pagi' : jamSekarang < 15 ? 'Selamat siang' : 'Selamat sore';

              const pesanSuara = isCheckout
                ? `${sapaanWaktu}, ${namaDepan}! Absensi pulang Anda telah tercatat. Terima kasih atas kerja keras Anda hari ini. Istirahat yang cukup ya, dan sampai jumpa besok! Tetap semangat!`
                : `${sapaanWaktu}, ${namaDepan}! Absensi masuk Anda telah tercatat. Selamat bekerja, semoga hari ini penuh produktivitas dan menyenangkan!`;

              // Gunakan voice:speakOnce — buka sesi Gemini dedicated agar suara Aoede (Sinta)
              // konsisten dengan fitur lainnya. Tidak mengganggu sesi voice utama.
              if (electron) {
                electron.ipcRenderer.invoke('voice:speakOnce', pesanSuara).catch(() => {});
              }

              autoResetRef.current = setTimeout(() => {
                handleReset();
                navigate('/');
              }, 10000); // Cukup waktu untuk dengar sapaan Sinta
            })
            .catch(err => {
              console.error('Absensi fail:', err);
              // Lanjut tampilkan UI identified meskipun backend gagal
              setAbsensiTime(timeStr);
              setMode('identified');
              autoResetRef.current = setTimeout(() => { handleReset(); navigate('/'); }, 4000);
            });
        } else {
          setAbsensiTime(timeStr);
          setMode('identified');
          autoResetRef.current = setTimeout(() => { handleReset(); navigate('/'); }, 4000);
        }
      }
      setIdentifyProgress(Math.min(progress, 100));
    }, 120);
  }, [handleReset, navigate]);


  // Main Detection Loop
  useEffect(() => {
    if (!cameraReady || !modelsLoaded || (mode !== 'camera' && mode !== 'liveness')) return;

    const detectFaces = async () => {
      if (!videoRef.current) return;

      try {
        const detection = await faceapi.detectSingleFace(
          videoRef.current,
          new faceapi.TinyFaceDetectorOptions()
        ).withFaceLandmarks().withFaceDescriptor();

        if (detection) {
          // Draw Box
          const videoW = videoRef.current.videoWidth;
          const videoH = videoRef.current.videoHeight;
          const box = detection.detection.box;
          
          setFaceBox({
            x: (box.x / videoW) * 100,
            y: (box.y / videoH) * 100,
            width: (box.width / videoW) * 100,
            height: (box.height / videoH) * 100,
          });
          setFaceDetected(true);

          if (mode === 'camera' && dbLoaded && electron && !isMatchingFaceRef.current) {
            isMatchingFaceRef.current = true;
            
            // Call API via IPC Main Process
            electron.ipcRenderer.invoke('kiosk:api:hrFaceMatch', Array.from(detection.descriptor))
              .then(res => {
                if (res && res.success && res.data && res.matched) {
                   const matchedP = res.data;
                   if (matchedP && (matchedP.id || matchedP.pegawai_id)) {
                     // Normalize ID to id if it's pegawai_id
                     if (!matchedP.id) matchedP.id = matchedP.pegawai_id;
                     startLivenessChallenge(matchedP);
                     // No need to reset isMatchingFaceRef immediately as mode changes
                   } else {
                     setTimeout(() => { isMatchingFaceRef.current = false; }, 1000);
                   }
                } else {
                   setTimeout(() => { isMatchingFaceRef.current = false; }, 1000);
                }
              })
              .catch(err => {
                console.error("hrFaceMatch error:", err);
                setTimeout(() => { isMatchingFaceRef.current = false; }, 1000);
              });
          } 
          
          else if (mode === 'liveness') {
            const landmarks = detection.landmarks;
            
            if (challenge === 'blink') {
              const leftEAR = getEAR(landmarks.getLeftEye());
              const rightEAR = getEAR(landmarks.getRightEye());
              const EAR = (leftEAR + rightEAR) / 2;
              
              // More forgiving threshold for TinyFaceDetector and smaller eye shapes
              if (EAR < 0.265) { 
                eyesClosedRef.current = true;
                setLivenessStatus('progress');
              } else if (EAR > 0.275 && eyesClosedRef.current) {
                // Blink completed!
                setLivenessStatus('passed');
                setTimeout(() => {
                  if (detectLoopRef.current) cancelAnimationFrame(detectLoopRef.current);
                  startIdentification();
                }, 500);
                return;
              }
            }
            
            else if (challenge === 'turn_left' || challenge === 'turn_right') {
              const pose = getHeadPose(landmarks);
              
              if (pose === challenge) {
                setLivenessStatus('passed');
                setTimeout(() => {
                  if (detectLoopRef.current) cancelAnimationFrame(detectLoopRef.current);
                  startIdentification();
                }, 500);
                return;
              } else if (pose !== 'center') {
                setLivenessStatus('progress');
              }
            }
          }

        } else {
          setFaceDetected(false);
          setFaceBox(null);
        }
      } catch (err) { }

      detectLoopRef.current = requestAnimationFrame(() => {
        setTimeout(detectFaces, 150); 
      });
    };

    detectFaces();

    return () => {
      if (detectLoopRef.current) cancelAnimationFrame(detectLoopRef.current);
    };
  }, [cameraReady, modelsLoaded, dbLoaded, mode, challenge, startIdentification]);

  const handleReset = useCallback(() => {
    if (identifyIntervalRef.current) clearInterval(identifyIntervalRef.current);
    if (autoResetRef.current) clearTimeout(autoResetRef.current);
    setMode('camera');
    setPegawai(null);
    setAbsensiTime(null);
    setChallenge(null);
    setLivenessStatus('waiting');
    setIdentifyProgress(0);
    setFaceDetected(false);
    setFaceBox(null);
    matchedPegawaiRef.current = null;
    eyesClosedRef.current = false;
    isMatchingFaceRef.current = false;
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      if (identifyIntervalRef.current) clearInterval(identifyIntervalRef.current);
      if (autoResetRef.current) clearTimeout(autoResetRef.current);
    };
  }, [startCamera, stopCamera]);


  const getSubTitleText = () => {
    if (!modelsLoaded) return '⏳ Memuat Face-API...';
    if (!dbLoaded) return '⚠️ Belum ada data wajah direkam.';
    if (mode === 'camera') return faceDetected ? '🟢 Wajah terdeteksi — memverifikasi...' : 'Arahkan wajah ke kamera untuk absensi';
    if (mode === 'liveness') return '🛡️ Deteksi Keamanan (Liveness)';
    if (mode === 'identifying') return '⏳ Menyelesaikan absensi...';
    if (mode === 'identified') return '✅ Absensi berhasil dicatat';
    return '';
  };

  const renderLivenessInstruction = () => {
    if (mode !== 'liveness') return null;
    
    let text = "";
    let icon = "";
    if (challenge === 'blink') { text = 'Kedipkan Mata Anda'; icon = '👀...😌...👀'; }
    else if (challenge === 'turn_left') { text = 'Menoleh ke Kiri'; icon = '👤 ⬅️'; }
    else if (challenge === 'turn_right') { text = 'Menoleh ke Kanan'; icon = '➡️ 👤'; }

    return (
      <div className="liveness-challenge-box" style={{
        position: 'absolute', bottom: '20%', left: '50%', transform: 'translateX(-50%)',
        background: livenessStatus === 'passed' ? 'var(--accent-success)' : 'rgba(0,0,0,0.8)',
        color: 'white', padding: '12px 24px', borderRadius: '12px', zIndex: 10,
        textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', minWidth: 200,
        border: livenessStatus === 'passed' ? 'none' : '2px solid rgba(56, 189, 248, 0.5)'
      }}>
        {livenessStatus === 'passed' ? (
          <div>
            <div style={{ fontSize: 24, marginBottom: 4 }}>✅</div>
            <div style={{ fontWeight: 600 }}>Liveness Valid</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
            <div style={{ fontWeight: 600 }}>Tantangan Keamanan:</div>
            <div style={{ fontSize: 18, color: 'var(--accent-info)', marginTop: 4 }}>{text}</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page-enter absensi-page">
      <div className="absensi-header">
        <h2 className="page-title">Absensi Pegawai Nagari</h2>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>
          {getSubTitleText()}
        </p>
      </div>

      <div className="absensi-content">
        <div className="absensi-scan-area">
          {(mode === 'camera' || mode === 'liveness' || mode === 'identifying') && (
            <div className="camera-container">
              <div className={`camera-viewport ${faceDetected ? 'face-active' : ''} ${mode === 'identifying' ? 'identifying' : ''}`}>
                <video ref={videoRef} autoPlay playsInline muted className="camera-video" />

                {/* ── Face silhouette guide ── */}
                <div className={`face-guide-silhouette ${faceDetected ? 'detected' : ''}`}>
                  <svg viewBox="0 0 200 280" className="face-guide-svg">
                    {/* Top Dotted Arch */}
                    <path d="M 35 65 A 80 80 0 0 1 165 65" fill="none" stroke="var(--accent-info)" strokeWidth="3" strokeDasharray="4 6" strokeLinecap="round" />
                    <circle cx="32" cy="68" r="4" fill="none" stroke="var(--accent-info)" strokeWidth="2.5" />
                    <circle cx="168" cy="68" r="4" fill="none" stroke="var(--accent-info)" strokeWidth="2.5" />
                    
                    {/* Main Face Oval */}
                    <ellipse cx="100" cy="150" rx="65" ry="90" fill="none" strokeWidth="3.5" className="face-guide-path" style={{ 
                      stroke: mode === 'liveness' ? 'var(--accent-warning)' : faceDetected ? 'var(--accent-success)' : undefined 
                    }} />
                  </svg>
                </div>
                <div className="face-guide-mask" />

                {renderLivenessInstruction()}

                {mode === 'identifying' && (
                  <div className="camera-scan-overlay">
                    <div className="scan-line" />
                  </div>
                )}

                <div className={`camera-status-badge ${faceDetected ? 'detected' : ''}`}>
                  <span className="camera-status-dot" style={{ background: mode === 'liveness' ? 'var(--accent-warning)' : '' }} />
                  {!cameraReady ? 'Kamera mati' :
                   mode === 'liveness' ? 'Verifikasi Keamanan...' :
                   mode === 'identifying' ? 'Mempersiapkan data...' :
                   faceDetected ? 'Wajah Terdeteksi' : 'Menunggu Wajah'}
                </div>
              </div>

              {mode === 'identifying' && (
                <div style={{ marginTop: 16, width: '100%', maxWidth: 320 }}>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${identifyProgress}%` }} />
                  </div>
                  <p style={{ color: 'var(--accent-info)', fontSize: 13, marginTop: 8, fontWeight: 500, textAlign: 'center' }}>
                    Menghubungkan rekaman... {Math.round(identifyProgress)}%
                  </p>
                </div>
              )}

              {cameraError && (
                <div className="camera-error">
                  <p>⚠️ {cameraError}</p>
                  <button className="btn btn-secondary" onClick={startCamera} style={{ marginTop: 12, fontSize: 13 }}>Coba Lagi</button>
                </div>
              )}
            </div>
          )}

          {mode === 'identified' && pegawai && (
            <div className="pegawai-profile" onClick={handleReset}>
              <div className="pegawai-avatar-large" style={{ background: `linear-gradient(135deg, ${getAvatarColor(pegawai.nama)[0]}, ${getAvatarColor(pegawai.nama)[1]})`, overflow: 'hidden' }}>
                {JSON.parse(localStorage.getItem('anm_face_db') || '{}')[pegawai.id]?.avatarUrl ? (
                  <img src={JSON.parse(localStorage.getItem('anm_face_db') || '{}')[pegawai.id].avatarUrl} alt={pegawai.nama} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span>{getInitials(pegawai.nama)}</span>
                )}
                <div className="avatar-check-badge">✓</div>
              </div>

              <h3 className="pegawai-nama">{pegawai.nama}</h3>
              <div className="pegawai-jabatan">{pegawai.jabatan}</div>

              <div className="absensi-time-badge">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                Masuk: {absensiTime}
              </div>

              <div className="pegawai-detail-card">
                <div className="pegawai-detail-row">
                  <span className="pegawai-detail-label">NIP</span>
                  <span className="pegawai-detail-value">{pegawai.nip}</span>
                </div>
                <div className="pegawai-detail-row">
                  <span className="pegawai-detail-label">Pangkat</span>
                  <span className="pegawai-detail-value">{pegawai.pangkat}</span>
                </div>
                <div className="pegawai-detail-row">
                  <span className="pegawai-detail-label">Unit Kerja</span>
                  <span className="pegawai-detail-value">{pegawai.unit}</span>
                </div>
              </div>

              <div className="absensi-success-msg">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" strokeWidth="2.5">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                Wajah diverifikasi
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button
          className="btn btn-secondary"
          onClick={() => { stopCamera(); navigate('/rekam-wajah'); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Pendaftaran Wajah
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => { stopCamera(); navigate('/'); }}
        >
          ← Kembali ke Beranda
        </button>
      </div>
    </div>
  );
};

export default AbsensiPage;
