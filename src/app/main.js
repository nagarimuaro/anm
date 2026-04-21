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
const llmService = require('../infrastructure/llm/openrouterService');
const ttsService = require('../infrastructure/tts/ttsService');

// Controllers
const voiceController = require('./controllers/voiceController');
const kioskController = require('./controllers/kioskController');
const deviceController = require('./controllers/deviceController');
const deviceService = require('../infrastructure/device/deviceService');
// OpenRouter tidak perlu setup lokal — langsung pakai API cloud

let mainWindow;

// ========================================
// 1. Audio HTTP Server (port 3003)
// ========================================
function startAudioServer() {
  const audioApp = express();
  const audioPort = process.env.AUDIO_SERVER_PORT || 3003;
  const cacheDir = ttsService.getCacheDir();

  // Serve audio with Range request support
  audioApp.get('/audio/:filename', (req, res) => {
    const filePath = path.join(cacheDir, req.params.filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Audio not found');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    if (req.headers.range) {
      // Handle Range request (required by browser Audio element)
      const parts = req.headers.range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
        return;
      }

      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'audio/mpeg',
      });
      stream.pipe(res);
    } else {
      // Full file response
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Health check
  audioApp.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'ANM Audio Server' });
  });

  audioApp.listen(audioPort, () => {
    console.log(`🔊 Audio HTTP Server running at http://localhost:${audioPort}`);
    console.log(`   Serving: ${cacheDir}`);
  });
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
    },
  });

  const isDev = !app.isPackaged;
  console.log(`[DEBUG] app.isPackaged: ${app.isPackaged}, isDev: ${isDev}`);
  if (isDev) {
    const port = process.env.PORT || 3002;
    console.log(`[DEBUG] Loading URL: http://localhost:${port}`);
    mainWindow.loadURL(`http://localhost:${port}`);
    mainWindow.webContents.openDevTools();
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

  // OpenRouter: Test API connection (non-blocking)
  llmService.preloadModel().then(() => {
    console.log('✅ OpenRouter API connection verified.');
  }).catch(err => {
    console.error('⚠️  OpenRouter connection warning:', err.message);
  });

  // Background Heartbeat Loop: Sync kiosk health to Cloud Admin every 60 seconds
  setInterval(() => {
    deviceService.sendHeartbeat().catch(() => {});
  }, 60000);
  
  // Also send an initial heartbeat 5 seconds after startup if activated
  setTimeout(() => {
    deviceService.sendHeartbeat().catch(() => {});
  }, 5000);

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
