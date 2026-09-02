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
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  InfoIcon,
  EyeIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ShieldCheckIcon,
  ClockIcon,
  ScanFaceIcon,
  UserIcon,
  LandmarkIcon
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
  const [faceGuidance, setFaceGuidance] = useState({
    type: 'none',
    text: 'Arahkan wajah ke kamera',
    color: 'rgba(255,255,255,0.7)'
  });

  // Liveness State
  const [challenge, setChallenge] = useState(null);
  const [livenessStatus, setLivenessStatus] = useState('waiting'); // waiting, progress, passed
  
  const [identifyProgress, setIdentifyProgress] = useState(0);
  const [absensiError, setAbsensiError] = useState(null); // pesan error dari API

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectLoopRef = useRef(null);
  const autoResetRef = useRef(null);
  const identifyIntervalRef = useRef(null);
  const isMatchingFaceRef = useRef(false);

  const matchedPegawaiRef = useRef(null);
  const consecutiveMatchRef = useRef({ pegawaiId: null, count: 0, matchedData: null, lastTime: 0 });
  const lastVoiceGuidanceRef = useRef({ type: null, firstSeen: 0, lastSpoken: 0 });
  
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

    // Gunakan speakOnce agar suara Sinta konsisten
    if (electron) {
      const pesanLiveness = randomCh === 'blink'
        ? 'Untuk keamanan, silakan kedipkan mata Anda sekarang.'
        : randomCh === 'turn_left'
        ? 'Untuk keamanan, tolong menoleh sedikit ke kiri.'
        : 'Untuk keamanan, tolong menoleh sedikit ke kanan.';
      electron.ipcRenderer.invoke('voice:speakOnce', pesanLiveness).catch(() => {});
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

              // Cek apakah API mengembalikan success: false (misal: "anda sudah absen")
              if (res && res.success === false) {
                const namaDepan = finalPegawai.nama.split(/[\s,]+/)[0] || 'Pegawai';
                const pesanGagal = res.message
                  ? `Maaf ${namaDepan}, ${res.message}.`
                  : `Maaf ${namaDepan}, absensi tidak dapat diproses saat ini.`;

                setAbsensiError(res.message || 'Absensi tidak dapat diproses');
                setMode('identified'); // Tetap tampilkan profil
                if (electron) {
                  electron.ipcRenderer.invoke('voice:speakOnce', pesanGagal).catch(() => {});
                }
                autoResetRef.current = setTimeout(() => {
                  handleReset();
                  navigate('/');
                }, 7000);
                return;
              }

              // Success: tampilkan profil dan ucapkan sapaan
              setMode('identified');

              const namaDepan = finalPegawai.nama.split(/[\s,]+/)[0] || 'Pegawai';
              const jamSekarang = now.getHours();
              const sapaanWaktu = jamSekarang < 11 ? 'Selamat pagi' : jamSekarang < 15 ? 'Selamat siang' : 'Selamat sore';

              const pesanSuara = isCheckout
                ? `${sapaanWaktu}, ${namaDepan}! Absensi pulang Anda telah tercatat. Terima kasih atas kerja keras Anda hari ini. Istirahat yang cukup ya, dan sampai jumpa besok! Tetap semangat!`
                : `${sapaanWaktu}, ${namaDepan}! Absensi masuk Anda telah tercatat. Selamat bekerja, semoga hari ini penuh produktivitas dan menyenangkan!`;

              if (electron) {
                electron.ipcRenderer.invoke('voice:speakOnce', pesanSuara).catch(() => {});
              }

              autoResetRef.current = setTimeout(() => {
                handleReset();
                navigate('/');
              }, 10000);
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
          new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.65 })
        ).withFaceLandmarks().withFaceDescriptor();

        if (detection) {
          // Draw Box
          const videoW = videoRef.current.videoWidth;
          const videoH = videoRef.current.videoHeight;
          const box = detection.detection.box;
          const pose = detection.landmarks ? getHeadPose(detection.landmarks) : 'center';
          
          setFaceBox({
            x: (box.x / videoW) * 100,
            y: (box.y / videoH) * 100,
            width: (box.width / videoW) * 100,
            height: (box.height / videoH) * 100,
          });
          setFaceDetected(true);

          // Panduan posisi wajah (Visual & Suara)
          let currentGuidance = { type: 'optimal', text: 'Posisi optimal — Memverifikasi...', color: '#10b981' };
          let voiceText = '';

          if (box.width < 110 || box.height < 110) {
            currentGuidance = { type: 'too_far', text: 'Silakan mendekat ke kamera', color: '#f59e0b' };
            voiceText = 'Silakan mendekat sedikit ke kamera ya.';
          } else if (box.width > 340 || box.height > 340) {
            currentGuidance = { type: 'too_close', text: 'Silakan mundur sedikit', color: '#f59e0b' };
            voiceText = 'Silakan mundur sedikit dari kamera ya.';
          } else if (pose !== 'center') {
            currentGuidance = { type: 'turn_straight', text: 'Arahkan pandangan lurus ke kamera', color: '#38bdf8' };
            voiceText = 'Silakan lihat lurus ke kamera ya.';
          }

          setFaceGuidance(currentGuidance);

          // Ucapkan panduan suara jika dalam kondisi yang sama > 3.5 detik (rate-limited max sekali tiap 9 detik)
          if (mode === 'camera' && electron && currentGuidance.type !== 'optimal') {
            const now = Date.now();
            const tracking = lastVoiceGuidanceRef.current;
            if (tracking.type === currentGuidance.type) {
              if (now - tracking.firstSeen > 3500 && now - tracking.lastSpoken > 9000) {
                tracking.lastSpoken = now;
                electron.ipcRenderer.invoke('voice:speakOnce', voiceText).catch(() => {});
              }
            } else {
              lastVoiceGuidanceRef.current = {
                type: currentGuidance.type,
                firstSeen: now,
                lastSpoken: tracking.lastSpoken || 0,
              };
            }
          } else if (currentGuidance.type === 'optimal') {
            lastVoiceGuidanceRef.current.type = 'optimal';
          }

          if (mode === 'camera' && dbLoaded && electron && !isMatchingFaceRef.current) {
            // Quality Gate: Pastikan wajah cukup dekat dan menghadap lurus ke kamera
            const isFaceBigEnough = box.width >= 110 && box.height >= 110;
            const isFrontal = pose === 'center';

            if (!isFaceBigEnough || !isFrontal) {
              // Wajah terlalu jauh atau menoleh — tunda matching hingga posisi tepat
              detectLoopRef.current = requestAnimationFrame(() => setTimeout(detectFaces, 150));
              return;
            }

            isMatchingFaceRef.current = true;
            
            // Call API via IPC Main Process
            electron.ipcRenderer.invoke('kiosk:api:hrFaceMatch', Array.from(detection.descriptor))
              .then(res => {
                if (res && res.success && res.data && res.matched) {
                  const matchedP = res.data;
                  const targetId = matchedP.id || matchedP.pegawai_id;

                  // Filter Threshold Ketat (jarak maksimal 0.52 atau confidence minimal 0.48)
                  const distance = res.data.distance !== undefined ? res.data.distance : (res.distance !== undefined ? res.distance : null);
                  const confidence = res.data.confidence !== undefined ? res.data.confidence : (res.confidence !== undefined ? res.confidence : null);

                  if (distance !== null && distance > 0.52) {
                    console.warn(`[FaceMatch] Ditolak: Jarak Euclidean ${distance} melebihi batas 0.52`);
                    setTimeout(() => { isMatchingFaceRef.current = false; }, 300);
                    return;
                  }
                  if (confidence !== null && confidence < 0.48) {
                    console.warn(`[FaceMatch] Ditolak: Confidence ${confidence} di bawah batas 0.48`);
                    setTimeout(() => { isMatchingFaceRef.current = false; }, 300);
                    return;
                  }

                  if (targetId) {
                    if (!matchedP.id) matchedP.id = targetId;

                    // Multi-Frame Verification (Wajib cocok 2 frame berturut-turut untuk kandidat yang sama)
                    const tracking = consecutiveMatchRef.current;
                    const isSameCandidate = tracking.pegawaiId === targetId;
                    const isRecent = (Date.now() - tracking.lastTime) < 2500;

                    if (isSameCandidate && isRecent) {
                      tracking.count += 1;
                      tracking.lastTime = Date.now();
                      tracking.matchedData = matchedP;

                      if (tracking.count >= 2) {
                        // Terverifikasi multi-frame secara konsisten!
                        consecutiveMatchRef.current = { pegawaiId: null, count: 0, matchedData: null, lastTime: 0 };
                        startLivenessChallenge(matchedP);
                        return;
                      }
                    } else {
                      // Frame pertama cocok -> simpan ke tracking buffer
                      consecutiveMatchRef.current = {
                        pegawaiId: targetId,
                        count: 1,
                        matchedData: matchedP,
                        lastTime: Date.now()
                      };
                    }

                    // Lanjut frame verifikasi berikutnya secara cepat
                    setTimeout(() => { isMatchingFaceRef.current = false; }, 200);
                  } else {
                    setTimeout(() => { isMatchingFaceRef.current = false; }, 300);
                  }
                } else {
                  // Tidak cocok -> jika buffer lama, reset
                  if (Date.now() - consecutiveMatchRef.current.lastTime > 1500) {
                    consecutiveMatchRef.current = { pegawaiId: null, count: 0, matchedData: null, lastTime: 0 };
                  }
                  setTimeout(() => { isMatchingFaceRef.current = false; }, 300);
                }
              })
              .catch(err => {
                console.error("hrFaceMatch error:", err);
                setTimeout(() => { isMatchingFaceRef.current = false; }, 400);
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
          setFaceGuidance({
            type: 'none',
            text: 'Posisikan wajah Anda di dalam bingkai',
            color: 'rgba(255,255,255,0.7)'
          });
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
    setAbsensiError(null);
    setChallenge(null);
    setLivenessStatus('waiting');
    setIdentifyProgress(0);
    setFaceDetected(false);
    setFaceBox(null);
    setFaceGuidance({
      type: 'none',
      text: 'Arahkan wajah ke kamera',
      color: 'rgba(255,255,255,0.7)'
    });
    matchedPegawaiRef.current = null;
    eyesClosedRef.current = false;
    isMatchingFaceRef.current = false;
    consecutiveMatchRef.current = { pegawaiId: null, count: 0, matchedData: null, lastTime: 0 };
    lastVoiceGuidanceRef.current = { type: null, firstSeen: 0, lastSpoken: 0 };
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
    if (!modelsLoaded) return 'Memuat modul biometrik...';
    if (!dbLoaded) return 'Data biometrik pegawai belum terdaftar';
    if (mode === 'camera') return faceDetected ? 'Memproses pemindaian biometrik...' : 'Posisikan wajah Anda pada area pemindai';
    if (mode === 'liveness') return 'Verifikasi Keaslian Wajah (Liveness)';
    if (mode === 'identifying') return 'Mencocokkan identitas pegawai...';
    if (mode === 'identified') return absensiError ? 'Presensi Belum Dapat Diproses' : 'Presensi Kehadiran Berhasil Dicatat';
    return '';
  };

  const renderLivenessInstruction = () => {
    if (mode !== 'liveness') return null;
    
    let text = "";
    let iconElement = null;
    if (challenge === 'blink') {
      text = 'Kedipkan Mata Anda';
      iconElement = <EyeIcon size={22} color="#38BDF8" />;
    } else if (challenge === 'turn_left') {
      text = 'Menoleh Sedikit ke Kiri';
      iconElement = <ArrowLeftIcon size={22} color="#38BDF8" />;
    } else if (challenge === 'turn_right') {
      text = 'Menoleh Sedikit ke Kanan';
      iconElement = <ArrowRightIcon size={22} color="#38BDF8" />;
    }

    return (
      <div className="liveness-challenge-box" style={{
        marginTop: 14,
        background: livenessStatus === 'passed' ? 'rgba(16,185,129,0.12)' : 'rgba(15,23,42,0.85)',
        backdropFilter: 'blur(12px)',
        color: 'white', padding: '12px 26px', borderRadius: '16px',
        textAlign: 'center', boxShadow: '0 8px 30px rgba(0,0,0,0.35)', minWidth: 260,
        border: livenessStatus === 'passed' ? '1.5px solid var(--accent-success, #10B981)' : '1.5px solid rgba(56,189,248,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      }}>
        {livenessStatus === 'passed' ? (
          <>
            <CheckCircleIcon size={24} color="#10B981" />
            <span style={{ fontWeight: 600, fontSize: 15, color: '#34d399' }}>Verifikasi Biometrik Berhasil</span>
          </>
        ) : (
          <>
            {iconElement}
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
              Verifikasi Keamanan: <span style={{ color: 'var(--accent-info, #38BDF8)' }}>{text}</span>
            </span>
          </>
        )}
      </div>
    );
  };

  const renderGuidanceIcon = () => {
    if (faceGuidance.type === 'optimal') return <CheckCircleIcon size={18} color="#10B981" />;
    if (faceGuidance.type === 'turn_straight') return <ScanFaceIcon size={18} color="#38BDF8" />;
    if (faceGuidance.type === 'too_far' || faceGuidance.type === 'too_close') return <ScanFaceIcon size={18} color="#F59E0B" />;
    return <ScanFaceIcon size={18} color="rgba(255,255,255,0.6)" />;
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
                      stroke: mode === 'liveness' ? 'var(--accent-warning)' : faceDetected ? faceGuidance.color : undefined 
                    }} />
                  </svg>
                </div>
                <div className="face-guide-mask" />

                {mode === 'identifying' && (
                  <div className="camera-scan-overlay">
                    <div className="scan-line" />
                  </div>
                )}

                <div className={`camera-status-badge ${faceDetected ? 'detected' : ''}`}>
                  <span className="camera-status-dot" style={{ background: mode === 'liveness' ? 'var(--accent-warning)' : faceGuidance.color }} />
                  {!cameraReady ? 'Kamera mati' :
                   mode === 'liveness' ? 'Verifikasi Keamanan...' :
                   mode === 'identifying' ? 'Mempersiapkan data...' :
                   faceDetected ? faceGuidance.text : 'Menunggu Wajah'}
                </div>
              </div>

              {/* Panduan Posisi Wajah Interaktif (Mendekat / Menjauh / Lurus) */}
              {mode === 'camera' && (
                <div className={`face-guidance-pill ${faceGuidance.type}`}>
                  {renderGuidanceIcon()}
                  <span>{faceGuidance.text}</span>
                </div>
              )}

              {/* Instruksi liveness di BAWAH kamera, tidak menghalangi wajah */}
              {renderLivenessInstruction()}

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

              <StatusDialog
                isOpen={!!cameraError}
                type="error"
                title="Kamera Tidak Terhubung"
                message={cameraError}
                onClose={() => setCameraError(null)}
                actionText="Coba Lagi"
                onAction={() => { setCameraError(null); startCamera(); }}
                secondaryActionText="Kembali ke Beranda"
                onSecondaryAction={() => { stopCamera(); navigate('/'); }}
              />
            </div>
          )}

          {mode === 'identified' && pegawai && (
            <div className="smart-id-pass-wrapper" onClick={handleReset}>
              <div className="smart-id-pass-card">
                {/* Top Brand Header */}
                <div className="smart-id-header">
                  <div className="smart-id-brand">
                    <LandmarkIcon size={22} color="var(--accent-info, #38BDF8)" />
                    <div className="smart-id-brand-text">
                      <span className="smart-id-org">PEMERINTAH NAGARI MANDIRI</span>
                      <span className="smart-id-suborg">KARTU PRESENSI BIOMETRIK</span>
                    </div>
                  </div>
                  <div className={`smart-id-status-chip ${absensiError ? 'error' : 'success'}`}>
                    <span className="smart-id-status-dot" />
                    <span>{absensiError ? 'GAGAL' : (pegawai.sudah_checkout ? 'PULANG' : 'MASUK')}</span>
                  </div>
                </div>

                {/* Main Employee Hero Profile */}
                <div className="smart-id-body">
                  <div className="smart-id-avatar-frame" style={{ background: `linear-gradient(135deg, ${getAvatarColor(pegawai.nama)[0]}, ${getAvatarColor(pegawai.nama)[1]})` }}>
                    {JSON.parse(localStorage.getItem('anm_face_db') || '{}')[pegawai.id]?.avatarUrl ? (
                      <img src={JSON.parse(localStorage.getItem('anm_face_db') || '{}')[pegawai.id].avatarUrl} alt={pegawai.nama} />
                    ) : (
                      <span className="smart-id-avatar-initials">{getInitials(pegawai.nama)}</span>
                    )}
                    {!absensiError && (
                      <div className="smart-id-avatar-badge">
                        <CheckCircleIcon size={14} color="white" />
                      </div>
                    )}
                  </div>

                  <div className="smart-id-info">
                    <h3 className="smart-id-name">{pegawai.nama}</h3>
                    <div className="smart-id-role-chip">{pegawai.jabatan}</div>
                    <div className="smart-id-nip">NIP: {pegawai.nip || '-'}</div>
                  </div>
                </div>

                {/* Verification Time & Status Strip */}
                <div className={`smart-id-timestamp-strip ${absensiError ? 'error' : 'success'}`}>
                  <div className="smart-id-time-col">
                    <span className="smart-id-time-label">WAKTU PRESENSI</span>
                    <div className="smart-id-time-value">
                      <ClockIcon size={17} color="currentColor" />
                      <span>{absensiTime || 'Tercatat'} WIB</span>
                    </div>
                  </div>
                  <div className="smart-id-method-col">
                    <span className="smart-id-time-label">STATUS VERIFIKASI</span>
                    <div className="smart-id-method-value">
                      {absensiError ? (
                        <span style={{ color: '#F87171', fontSize: 13 }}>{absensiError}</span>
                      ) : (
                        <>
                          <ShieldCheckIcon size={16} color="#10B981" />
                          <span style={{ color: '#34D399', fontSize: 13 }}>Biometrik Sah</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Metadata Grid */}
                <div className="smart-id-grid">
                  <div className="smart-id-grid-item">
                    <span className="smart-id-grid-label">PANGKAT / GOLONGAN</span>
                    <span className="smart-id-grid-val">{pegawai.pangkat || '-'}</span>
                  </div>
                  <div className="smart-id-grid-item">
                    <span className="smart-id-grid-label">UNIT KERJA</span>
                    <span className="smart-id-grid-val">{pegawai.unit || 'Kantor Wali Nagari'}</span>
                  </div>
                </div>

                {/* Footer Return Notice */}
                <div className="smart-id-footer">
                  <div className="smart-id-auto-return">
                    <span className="smart-id-return-dot" />
                    <span>Otomatis kembali ke beranda...</span>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ padding: '6px 16px', fontSize: 13 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReset();
                      navigate('/');
                    }}
                  >
                    Selesai
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button
          className="btn btn-secondary"
          onClick={() => { stopCamera(); navigate('/rekam-wajah'); }}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <ScanFaceIcon size={18} color="currentColor" />
          Pendaftaran Wajah
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => { stopCamera(); navigate('/'); }}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <ArrowLeftIcon size={16} color="currentColor" />
          Kembali ke Beranda
        </button>
      </div>
    </div>
  );
};

export default AbsensiPage;
