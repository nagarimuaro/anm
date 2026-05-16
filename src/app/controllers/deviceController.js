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
          throw new Error('File installer tidak ditemukan.');
        }

        // Resolve install directory — gunakan lokasi exe saat ini agar NSIS
        // meng-overwrite instalasi yang ada, bukan membuat folder baru.
        const exePath = app.getPath('exe');
        const installDir = path.dirname(exePath);

        console.log('[OTA Updater] Menjalankan installer SILENT:', installerPath);
        console.log('[OTA Updater] Install directory:', installDir);

        // /S          = Silent install (tanpa wizard interaktif)
        // --force-run = Auto-launch SINTA.exe setelah install selesai
        // /D=<path>   = Install ke direktori yang sama dengan instalasi saat ini
        //               PENTING: /D= harus argumen TERAKHIR dan TANPA kutip
        const args = ['/S', '--force-run', `/D=${installDir}`];

        console.log('[OTA Updater] Spawn args:', args);
        const child = spawn(installerPath, args, {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();

        // Beri waktu agar installer process benar-benar start sebelum quit
        setTimeout(() => {
          console.log('[OTA Updater] Menutup aplikasi untuk proses pembaruan...');
          app.quit();
        }, 2000);

        return { success: true };
      } catch (error) {
        console.error('[OTA Updater] Gagal menjalankan installer:', error);
        return { success: false, message: error.message };
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
