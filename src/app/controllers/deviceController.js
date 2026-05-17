const deviceService = require('../../infrastructure/device/deviceService');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class DeviceController {
  register(ipcMain, mainWindow) {
    // Check Status Activation
    ipcMain.handle('device:status', async (event) => {
      try {
        const result = await deviceService.checkActivation();
        return { success: true, ...result };
      } catch (error) {
        console.error('Device check failed:', error);
        return { success: false, status: 'ERROR', message: error.message };
      }
    });

    // Activate Device
    ipcMain.handle('device:activate', async (event, token) => {
      try {
        const data = await deviceService.activateDevice(token);
        deviceService.sendHeartbeat().catch((error) => {
          console.warn('[Heartbeat Warning] Post-activation heartbeat failed:', error.message);
        });
        return { success: true, data };
      } catch (error) {
        return { success: false, message: error.message };
      }
    });

    // Check Auto Update OTA
    ipcMain.handle('device:getUpdate', async () => {
      try {
        const updateInfo = deviceService.getPendingUpdate();
        return { success: true, update: updateInfo };
      } catch (error) {
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('device:heartbeatStatus', async () => {
      try {
        return { success: true, ...deviceService.getHeartbeatStatus() };
      } catch (error) {
        return { success: false, message: error.message };
      }
    });

    ipcMain.handle('device:sendHeartbeat', async () => {
      try {
        await deviceService.sendHeartbeat();
        return { success: true, ...deviceService.getHeartbeatStatus() };
      } catch (error) {
        return { success: false, message: error.message, ...deviceService.getHeartbeatStatus() };
      }
    });

    // Handle OTA Update Download execution — with progress reporting
    let downloadAbortController = null;

    ipcMain.handle('device:downloadUpdate', async (event, url) => {
      try {
        const { app } = require('electron');
        const path = require('path');
        
        const destPath = path.join(app.getPath('temp'), 'anm-update.exe');
        
        // Buat AbortController untuk mendukung pembatalan unduhan
        downloadAbortController = new AbortController();
        const { signal } = downloadAbortController;

        console.log('[OTA Updater] Memulai unduhan dari:', url);
        const response = await fetch(url, { signal });

        if (!response.ok) {
           throw new Error(`Server menolak unduhan. Status: ${response.status}`);
        }

        // Ambil total ukuran file dari header Content-Length
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        console.log('[OTA Updater] Ukuran file:', contentLength, 'bytes');

        // Stream download dengan progress tracking
        const reader = response.body.getReader();
        const chunks = [];
        let receivedLength = 0;
        let lastReportedPercent = -1;

        while (true) {
          // Cek apakah sudah dibatalkan
          if (signal.aborted) {
            await reader.cancel();
            throw new Error('Unduhan dibatalkan oleh pengguna.');
          }

          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          receivedLength += value.length;

          // Hitung persentase dan kirim ke renderer
          const percent = contentLength > 0
            ? Math.round((receivedLength / contentLength) * 100)
            : 0;

          // Kirim progress hanya jika persentase berubah (mengurangi IPC flood)
          if (percent !== lastReportedPercent) {
            lastReportedPercent = percent;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('update:downloadProgress', {
                percent,
                received: receivedLength,
                total: contentLength,
              });
            }
          }
        }

        // Gabungkan semua chunks ke satu buffer dan tulis ke file
        const fullBuffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
        fs.writeFileSync(destPath, fullBuffer);

        // Kirim 100% final
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update:downloadProgress', {
            percent: 100,
            received: receivedLength,
            total: contentLength,
          });
        }

        console.log('[OTA Updater] Unduhan selesai. Tersimpan di:', destPath, `(${receivedLength} bytes)`);
        downloadAbortController = null;
        return { success: true, path: destPath };
      } catch (error) {
        downloadAbortController = null;
        // Bersihkan file partial jika ada
        const { app } = require('electron');
        const destPath = path.join(app.getPath('temp'), 'anm-update.exe');
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (_) {}

        const isCancelled = error.name === 'AbortError' || error.message.includes('dibatalkan');
        console.log('[OTA Updater]', isCancelled ? 'Unduhan dibatalkan.' : `Gagal: ${error.message}`);
        return { success: false, cancelled: isCancelled, message: isCancelled ? 'Unduhan dibatalkan.' : error.message };
      }
    });

    // Batalkan unduhan OTA yang sedang berjalan
    ipcMain.handle('device:cancelDownload', async () => {
      if (downloadAbortController) {
        downloadAbortController.abort();
        console.log('[OTA Updater] Permintaan pembatalan dikirim.');
        return { success: true };
      }
      return { success: false, message: 'Tidak ada unduhan aktif.' };
    });

    // Run downloaded installer silently, then close the kiosk so files can be replaced.
    ipcMain.handle('device:installUpdate', async (event, installerPath) => {
      try {
        const { app } = require('electron');

        if (process.platform !== 'win32') {
          throw new Error('Auto install saat ini hanya tersedia untuk Windows installer.');
        }

        if (!installerPath || !fs.existsSync(installerPath)) {
          throw new Error('File installer tidak ditemukan: ' + (installerPath || 'path kosong'));
        }

        // Verifikasi ukuran file — installer corrupt kalau terlalu kecil
        const fileStat = fs.statSync(installerPath);
        if (fileStat.size < 1024 * 100) {
          throw new Error(`File installer terlalu kecil (${fileStat.size} bytes), kemungkinan corrupt.`);
        }

        const exePath = app.getPath('exe');
        const installDir = path.dirname(exePath);

        console.log('[OTA Updater] Menjalankan installer:', installerPath);
        console.log('[OTA Updater] Ukuran file:', fileStat.size, 'bytes');
        console.log('[OTA Updater] Install directory:', installDir);

        // Gunakan batch script yang:
        // 1. Tampilkan HTA progress window
        // 2. Tunggu app tertutup (3 detik)
        // 3. Jalankan installer dengan admin privileges
        // 4. Tutup progress window & bersihkan file
        const batchPath = path.join(app.getPath('temp'), 'anm-updater.bat');
        const htaPath = path.join(app.getPath('temp'), 'anm-updater-progress.hta');

        // Buat HTA progress window (HTML Application — bawaan Windows)
        const pkg = require('../../../package.json');
        const currentVersion = pkg.version;
        const newVersion = updateInfo?.version || 'terbaru';

        const htaContent = `<html>
<head>
<title>Anjungan Nagari Mandiri — Pembaruan Sistem</title>
<HTA:APPLICATION
  ID="ANMUpdater"
  APPLICATIONNAME="ANM Updater"
  BORDER="none"
  BORDERSTYLE="none"
  CAPTION="no"
  SHOWINTASKBAR="yes"
  SINGLEINSTANCE="yes"
  SYSMENU="no"
  WINDOWSTATE="normal"
  SCROLL="no"
  MAXIMIZEBUTTON="no"
  MINIMIZEBUTTON="no"
/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', sans-serif;
    background: #0f172a;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    overflow: hidden;
  }
  .container {
    text-align: center;
    padding: 40px 50px;
    background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(14,165,233,0.06));
    border: 1px solid rgba(99,102,241,0.2);
    border-radius: 20px;
    width: 480px;
  }
  .icon { font-size: 48px; margin-bottom: 16px; }
  .title { font-size: 20px; font-weight: 700; margin-bottom: 6px; color: #e2e8f0; }
  .subtitle { font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
  .version-badge {
    display: inline-block;
    background: rgba(99,102,241,0.15);
    border: 1px solid rgba(99,102,241,0.3);
    border-radius: 8px;
    padding: 6px 16px;
    font-size: 13px;
    color: #a5b4fc;
    margin-bottom: 24px;
  }
  .progress-track {
    width: 100%;
    height: 8px;
    background: rgba(255,255,255,0.08);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 16px;
  }
  .progress-bar {
    height: 100%;
    width: 30%;
    background: linear-gradient(90deg, #6366f1, #0ea5e9, #6366f1);
    background-size: 200% 100%;
    border-radius: 4px;
    animation: shimmer 1.5s ease-in-out infinite, slide 2s ease-in-out infinite;
  }
  @keyframes shimmer {
    0%, 100% { background-position: 200% 0; }
    50% { background-position: 0 0; }
  }
  @keyframes slide {
    0% { margin-left: 0; width: 30%; }
    50% { margin-left: 35%; width: 40%; }
    100% { margin-left: 70%; width: 30%; }
  }
  .status { font-size: 13px; color: #64748b; }
  .warning { font-size: 11px; color: #475569; margin-top: 16px; }
</style>
<script>
  window.resizeTo(540, 340);
  var sw = screen.width, sh = screen.height;
  window.moveTo((sw - 540) / 2, (sh - 340) / 2);
  var steps = ['Menutup aplikasi...', 'Mempersiapkan installer...', 'Menginstal pembaruan...', 'Membersihkan file sementara...'];
  var idx = 0;
  function cycleStatus() {
    try { document.getElementById('status').innerText = steps[idx % steps.length]; } catch(e) {}
    idx++;
  }
  setInterval(cycleStatus, 4000);
  window.onload = function() { cycleStatus(); };
</script>
</head>
<body>
  <div class="container">
    <div class="icon">&#x1F504;</div>
    <div class="title">Memperbarui Sistem</div>
    <div class="subtitle">Anjungan Nagari Mandiri</div>
    <div class="version-badge">v${currentVersion} &#x2192; v${newVersion}</div>
    <div class="progress-track"><div class="progress-bar"></div></div>
    <div class="status" id="status">Mempersiapkan...</div>
    <div class="warning">&#x26A0; Jangan matikan perangkat selama proses pembaruan</div>
  </div>
</body>
</html>`;

        fs.writeFileSync(htaPath, htaContent, 'utf-8');

        const batchContent = [
          '@echo off',
          'echo [ANM Updater] Menampilkan progress window...',
          `start "" mshta.exe "${htaPath}"`,
          'echo [ANM Updater] Menunggu aplikasi tertutup...',
          'timeout /t 5 /nobreak >nul',
          `echo [ANM Updater] Menjalankan installer: ${installerPath}`,
          '',
          'REM Jalankan installer langsung (blocking) — batch otomatis menunggu selesai',
          `"${installerPath}" /S --force-run /D=${installDir}`,
          '',
          'REM Safety delay — tunggu subprocess installer selesai sepenuhnya',
          'echo [ANM Updater] Menunggu installer selesai...',
          'timeout /t 10 /nobreak >nul',
          '',
          'REM Loop: pastikan tidak ada proses installer yang masih jalan',
          `:waitloop`,
          `tasklist /FI "IMAGENAME eq ${path.basename(installerPath)}" 2>nul | find /I "${path.basename(installerPath)}" >nul`,
          'if not errorlevel 1 (',
          '  echo [ANM Updater] Installer masih berjalan, menunggu...',
          '  timeout /t 3 /nobreak >nul',
          '  goto waitloop',
          ')',
          '',
          'echo [ANM Updater] Menutup progress window...',
          'taskkill /f /im mshta.exe >nul 2>&1',
          `echo [ANM Updater] Membersihkan file...`,
          'timeout /t 2 /nobreak >nul',
          `del /f /q "${installerPath}" >nul 2>&1`,
          `del /f /q "${htaPath}" >nul 2>&1`,
          `del "%~f0"`,
        ].join('\r\n');

        fs.writeFileSync(batchPath, batchContent, 'utf-8');

        console.log('[OTA Updater] Batch script dibuat:', batchPath);
        console.log('[OTA Updater] HTA progress dibuat:', htaPath);

        const child = spawn('cmd.exe', ['/c', batchPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });

        child.on('error', (err) => {
          console.error('[OTA Updater] Spawn batch gagal:', err.message);
        });

        child.unref();

        console.log('[OTA Updater] Menutup aplikasi...');
        
        // Simpan versi lama sebelum quit, agar setelah update bisa tampilkan dialog
        const markerPath = path.join(app.getPath('userData'), 'update-marker.json');
        fs.writeFileSync(markerPath, JSON.stringify({
          previousVersion: pkg.version,
          updatedAt: new Date().toISOString(),
        }), 'utf-8');
        console.log('[OTA Updater] Marker disimpan, versi lama:', pkg.version);

        // Tutup app agar file tidak terkunci saat installer replace
        setTimeout(() => {
          app.quit();
        }, 1500);

        return { success: true };
      } catch (error) {
        console.error('[OTA Updater] Gagal menjalankan installer:', error);
        return { success: false, message: error.message };
      }
    });

    // Cek apakah app baru saja di-update (post-update dialog)
    ipcMain.handle('device:checkPostUpdate', async () => {
      try {
        const { app } = require('electron');
        const markerPath = path.join(app.getPath('userData'), 'update-marker.json');
        
        if (!fs.existsSync(markerPath)) {
          return { updated: false };
        }

        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
        const pkg = require('../../../package.json');
        
        // Hapus marker setelah dibaca (hanya tampil sekali)
        fs.unlinkSync(markerPath);

        // Bandingkan versi — jika berbeda, berarti update berhasil
        if (marker.previousVersion && marker.previousVersion !== pkg.version) {
          return {
            updated: true,
            previousVersion: marker.previousVersion,
            currentVersion: pkg.version,
            updatedAt: marker.updatedAt,
          };
        }

        return { updated: false };
      } catch (error) {
        console.warn('[OTA] checkPostUpdate error:', error.message);
        return { updated: false };
      }
    });

    // Development/Test only: Delete activation token (un-activate)
    ipcMain.handle('device:reset', async () => {
      try {
        if (fs.existsSync(deviceService.tokenFilePath)) {
          fs.unlinkSync(deviceService.tokenFilePath);
        }
        return { success: true };
      } catch (error) {
        return { success: false, message: error.message };
      }
    });

    // Clear runtime caches: audio cache files + voice_cache DB rows.
    ipcMain.handle('device:clearCache', async () => {
      try {
        const { app } = require('electron');
        const { dbRun } = require('../../infrastructure/database/db');
        const cacheDirs = new Set();

        if (process.env.AUDIO_CACHE_DIR) {
          cacheDirs.add(path.resolve(app.getPath('userData'), process.env.AUDIO_CACHE_DIR));
          cacheDirs.add(path.resolve(process.cwd(), process.env.AUDIO_CACHE_DIR));
        }
        cacheDirs.add(path.join(app.getPath('userData'), 'data', 'audio_cache'));
        cacheDirs.add(path.join(process.cwd(), 'data', 'audio_cache'));

        let deletedFiles = 0;
        for (const dir of cacheDirs) {
          if (!fs.existsSync(dir)) continue;
          for (const entry of fs.readdirSync(dir)) {
            const target = path.join(dir, entry);
            const stat = fs.statSync(target);
            if (stat.isFile()) {
              fs.unlinkSync(target);
              deletedFiles++;
            }
          }
        }

        const dbResult = await dbRun('DELETE FROM voice_cache');
        return {
          success: true,
          deletedFiles,
          deletedRows: dbResult.changes || 0,
        };
      } catch (error) {
        console.error('Clear cache failed:', error);
        return { success: false, message: error.message };
      }
    });
  }
}

module.exports = new DeviceController();
