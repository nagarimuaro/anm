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

    // Handle OTA Update Download execution
    ipcMain.handle('device:downloadUpdate', async (event, url) => {
      try {
        const { app } = require('electron');
        const path = require('path');
        
        const destPath = path.join(app.getPath('temp'), 'anm-update.exe');
        
        console.log('[OTA Updater] Memulai unduhan dari:', url);
        const response = await fetch(url);

        if (!response.ok) {
           throw new Error(`Server menolak unduhan. Status: ${response.status}`);
        }

        // Tulis stream update ke file fisik di Local Temp
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(destPath, Buffer.from(arrayBuffer));

        console.log('[OTA Updater] Unduhan selesai. Tersimpan di:', destPath);
        return { success: true, path: destPath };
      } catch (error) {
        console.error('[OTA Updater] Gagal mengunduh file:', error);
        return { success: false, message: error.message };
      }
    });

    // Run downloaded installer, then close the kiosk so files can be replaced.
    ipcMain.handle('device:installUpdate', async (event, installerPath) => {
      try {
        const { app } = require('electron');

        if (process.platform !== 'win32') {
          throw new Error('Auto install saat ini hanya tersedia untuk Windows installer.');
        }

        if (!installerPath || !fs.existsSync(installerPath)) {
          throw new Error('File installer tidak ditemukan.');
        }

        console.log('[OTA Updater] Menjalankan installer:', installerPath);
        const child = spawn(installerPath, [], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();

        setTimeout(() => {
          app.quit();
        }, 1000);

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
