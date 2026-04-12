const deviceService = require('../../infrastructure/device/deviceService');
const fs = require('fs');

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
        
        const destPath = path.join(app.getPath('temp'), 'update_dummy.exe');
        
        console.log('[OTA Updater] Memulai unduhan dari:', url);
        const response = await fetch(url);

        if (!response.ok) {
           throw new Error(`Server menolak unduhan. Status: ${response.status}`);
        }

        // Tulis stream dummy ke file fisik di Local Temp
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(destPath, Buffer.from(arrayBuffer));

        console.log('[OTA Updater] Unduhan selesai. Tersimpan di:', destPath);
        return { success: true, path: destPath };
      } catch (error) {
        console.error('[OTA Updater] Gagal mengunduh file:', error);
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
  }
}

module.exports = new DeviceController();
