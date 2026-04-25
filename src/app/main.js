/**
 * ANM — Electron Main Process
 * Entry point untuk Anjungan Nagari Mandiri
 * 
 * Responsibilities:
 * 1. Buat Electron window (kiosk mode)
 * 2. Register IPC handlers
 * 3. Start audio HTTP server (untuk serve TTS cache)
 * 4. Test OpenRouter API connection
 * 5. Initialize database
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Infrastructure
const db = require('../infrastructure/database/db');
// const llmService = require('../infrastructure/llm/openrouterService'); // DISABLED
// const ttsService = require('../infrastructure/tts/ttsService'); // DISABLED

// Controllers
const voiceController = require('./controllers/voiceController');
const kioskController = require('./controllers/kioskController');
const deviceController = require('./controllers/deviceController');
const deviceService = require('../infrastructure/device/deviceService');
// OpenRouter tidak perlu setup lokal — langsung pakai API cloud

let mainWindow;

// Izinkan AudioContext tanpa user gesture — diperlukan untuk absensi (face recognition)
// dan speakOnce yang dipanggil secara programatik bukan dari klik user
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Audio server disabled (EdgeTTS not used)
function startAudioServer() {
  console.log('[AudioServer] Disabled for debugging.');
}

// ========================================
// 2. Electron Window
// ========================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    kiosk: app.isPackaged,
    fullscreen: app.isPackaged,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  const isDev = !app.isPackaged;
  console.log(`[DEBUG] app.isPackaged: ${app.isPackaged}, isDev: ${isDev}`);
  if (isDev) {
    const port = process.env.PORT || 3002;
    console.log(`[DEBUG] Loading URL: http://localhost:${port}`);
    mainWindow.loadURL(`http://localhost:${port}`);
    mainWindow.webContents.openDevTools(); // TEMP: Debug audio playback
  } else {
    console.log(`[DEBUG] Loading static file from dist`);
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// ========================================
// 3. App Lifecycle
// ========================================
app.whenReady().then(async () => {
  console.log('═══════════════════════════════════════════');
  console.log('  ANM — Anjungan Nagari Mandiri');
  console.log('  Voice AI Kiosk System');
  console.log('═══════════════════════════════════════════');

  // Initialize Database
  db.init();

  // Mencegah Popup Izin Akses (Auto-Allow Media, Mic, Camera)
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Langsung izinkan akses media dan sistem tanpa pop-up persetujuan
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return true;
  });

  // Start Audio HTTP Server
  startAudioServer();

  // Register IPC Handlers
  const window = createWindow();
  voiceController.register(ipcMain, window);
  kioskController.register(ipcMain);
  deviceController.register(ipcMain, window);

  console.log('✅ ANM ready — Gemini Live mode active');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow();
      voiceController.register(ipcMain, w);
    }
  });
});

app.on('window-all-closed', () => {
  // Di Windows dan Linux, tutup semua = MATIKAN TOTAL aplikasi
  // Ini penting agar uninstaller NSIS tidak terblokir
  app.quit();
});

// Pastikan semua proses background mati saat app akan quit
app.on('before-quit', () => {
  // Hentikan semua interval/timeout yang tersisa
  const highestId = setTimeout(() => {}, 0);
  for (let i = 0; i < highestId; i++) {
    clearTimeout(i);
    clearInterval(i);
  }
});
