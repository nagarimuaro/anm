import React, { useState, useEffect, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './ui/components/layout/MainLayout';
import GlobalVoiceWidget from './ui/components/GlobalVoiceWidget';

// Pages — eager load (ringan)
import HomePage from './ui/pages/home/HomePage';
import InputNikPage from './ui/pages/surat/InputNikPage';
import ProfilWargaPage from './ui/pages/surat/ProfilWargaPage';
import SuratPage from './ui/pages/surat/SuratPage';
import PrintingPage from './ui/pages/surat/PrintingPage';
import BansosPage from './ui/pages/bansos/BansosPage';
import ScanRfidPage from './ui/pages/bansos/ScanRfidPage';
import ScanRfidPajakPage from './ui/pages/pajak/ScanRfidPajakPage';
import BukuTamuPage from './ui/pages/bukuTamu/BukuTamuPage';
import ScanBarcodePage from './ui/pages/surat/ScanBarcodePage';
import ActivationPage from './ui/pages/activation/ActivationPage';
import SettingsPage from './ui/pages/settings/SettingsPage';

// ✅ LAZY — hanya di-load saat user buka halaman Absensi
// Ini mencegah TensorFlow.js + face-api (~35MB) dari di-bundle/load saat startup
const AbsensiPage = lazy(() => import('./ui/pages/absensi/AbsensiPage'));
const RekamWajahPage = lazy(() => import('./ui/pages/absensi/RekamWajahPage'));

// Fallback ringan saat lazy page sedang di-load
const PageLoader = () => (
  <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'white', fontSize: '18px' }}>
    Memuat halaman...
  </div>
);

const electron = window.require ? window.require('electron') : null;

const ActivationWrapper = ({ children }) => {
  const [status, setStatus] = useState('LOADING'); 
  
  useEffect(() => {
    const checkStatus = async () => {
      if (electron) {
        try {
          const res = await electron.ipcRenderer.invoke('device:status');
          setStatus(res.status);
        } catch (err) {
          setStatus('UNACTIVATED');
        }
      } else {
        setStatus('ACTIVATED'); // Fallback map for local browser dev
      }
    };
    checkStatus();
  }, []);

  // Make it accessible for testing trigger from elsewhere
  window.testActivationStatus = setStatus;

  if (status === 'LOADING') {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: 'white' }}>Memeriksa Proteksi Perangkat...</div>;
  }

  if (status === 'UNACTIVATED' || status === 'INVALID_FINGERPRINT') {
    return (
      <Router>
        <ActivationPage status={status} setActivationStatus={setStatus} />
      </Router>
    );
  }

  return children;
};

import './styles.css';

const App = () => {
  return (
      <ActivationWrapper>
        <Router>
          <MainLayout>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/input-nik" element={<InputNikPage />} />
                <Route path="/profil-warga" element={<ProfilWargaPage />} />
                <Route path="/surat" element={<SuratPage />} />
                <Route path="/bansos" element={<BansosPage />} />
                <Route path="/scan-rfid" element={<ScanRfidPage />} />
                <Route path="/scan-rfid-pajak" element={<ScanRfidPajakPage />} />
                <Route path="/buku-tamu" element={<BukuTamuPage />} />
                <Route path="/scan-barcode" element={<ScanBarcodePage />} />
                <Route path="/printing" element={<PrintingPage />} />
                <Route path="/absensi" element={<AbsensiPage />} />
                <Route path="/rekam-wajah" element={<RekamWajahPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </MainLayout>
          <GlobalVoiceWidget />
        </Router>
      </ActivationWrapper>
  );
};

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
