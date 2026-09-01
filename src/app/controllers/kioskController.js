/**
 * Kiosk Controller — IPC Handler untuk operasi non-voice
 */
const kioskService = require('../services/kioskService');
const printerService = require('../../infrastructure/device/printerService');
const path = require('path');
const fs = require('fs');

function register(ipc) {
  ipc.handle('kiosk:session:start', async () => {
    return await kioskService.startSession();
  });

  ipc.handle('kiosk:session:end', async () => {
    return await kioskService.endSession();
  });

  ipc.handle('kiosk:api:getWarga', async (event, nik) => {
    return await kioskService.getWarga(nik);
  });

  ipc.handle('kiosk:api:cekBansos', async (event, params) => {
    return await kioskService.cekBansos(params);
  });

  ipc.handle('kiosk:api:createBukuTamu', async (event, data) => {
    return await kioskService.createBukuTamu(data);
  });

  ipc.handle('kiosk:api:checkPbb', async (event, data) => {
    return await kioskService.checkPbb(data);
  });

  ipc.handle('kiosk:api:validateEktpRegistrationCode', async (event, registrationCode) => {
    return await kioskService.validateEktpRegistrationCode(registrationCode);
  });

  ipc.handle('kiosk:api:registerEktpCard', async (event, data) => {
    return await kioskService.registerEktpCard(data);
  });

  ipc.handle('kiosk:api:cancelEktpRegistration', async (event, registrationCode) => {
    return await kioskService.cancelEktpRegistration(registrationCode);
  });

  ipc.handle('kiosk:api:buatSurat', async (event, data) => {
    return await kioskService.buatSurat(data);
  });

  ipc.handle('kiosk:api:getTemplatesSurat', async () => {
    return await kioskService.getTemplatesSurat();
  });

  ipc.handle('kiosk:api:cekStatusSurat', async (event, trackingCode) => {
    return await kioskService.cekStatusSurat(trackingCode);
  });

  ipc.handle('kiosk:api:getRiwayatSurat', async (event, nik) => {
    return await kioskService.getRiwayatSurat(nik);
  });

  // HR Endpoints
  ipc.handle('kiosk:api:hrFaceMatch', async (event, descriptor) => {
    return await kioskService.hrFaceMatch(descriptor);
  });

  ipc.handle('kiosk:api:hrCheckin', async (event, data) => {
    return await kioskService.hrCheckin(data.pegawai_id, data.confidence);
  });

  ipc.handle('kiosk:api:hrCheckout', async (event, data) => {
    return await kioskService.hrCheckout(data.pegawai_id, data.confidence);
  });

  ipc.handle('kiosk:api:hrFaceEnroll', async (event, data) => {
    return await kioskService.hrFaceEnroll(data.token, data.descriptor);
  });

  ipc.handle('kiosk:api:hrFaceEnrollCheckToken', async (event, token) => {
    return await kioskService.hrFaceEnrollCheckToken(token);
  });

  ipc.handle('kiosk:api:hrStatusMonitor', async () => {
    return await kioskService.hrStatusMonitor();
  });

  // Print PDF surat ke printer EPSON L120 (A4, silent)
  ipc.handle('kiosk:printPdf', async (event, { data, filename }) => {
    try {
      const { app, BrowserWindow: PrintWindow } = require('electron');
      const tempDir = path.join(app.getPath('temp'), 'anm_print');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const filePath = path.join(tempDir, filename || 'surat.pdf');
      fs.writeFileSync(filePath, Buffer.from(data));

      // Buka PDF di hidden BrowserWindow lalu cetak silent ke EPSON
      const printWin = new PrintWindow({ show: false, width: 800, height: 1130 });

      // Gunakan file:// protocol untuk load PDF lokal
      await printWin.loadURL(`file://${filePath.replace(/\\/g, '/')}`);

      // Tunggu PDF render selesai
      await new Promise(r => setTimeout(r, 1500));

      return new Promise((resolve) => {
        printWin.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: 'EPSON L120 Series',
          pageSize: 'A4',
          margins: { marginType: 'default' },
        }, (success, failureReason) => {
          setTimeout(() => printWin.close(), 500);

          if (success) {
            console.log('[PrintPdf] ✅ Surat berhasil dicetak ke EPSON L120.');
            resolve({ success: true, path: filePath });
          } else {
            console.error('[PrintPdf] ❌ Gagal mencetak:', failureReason);
            resolve({ success: false, message: failureReason });
          }
        });
      });
    } catch (err) {
      console.error('kiosk:printPdf error:', err);
      return { success: false, message: err.message };
    }
  });

  // Print Resi — Thermal Printer ESC/POS RAW via printerService
  ipc.handle('kiosk:printReceipt', async (event, { resi, qrBase64, jenis_surat, warga }) => {
    try {
      const result = await printerService.printReceipt({
        resi,
        jenis_surat,
        nik:    warga?.nik    || '',
        nama:   warga?.nama   || '',
        alamat: warga?.alamat || '',
      });
      return result;
    } catch (e) {
      console.error('kiosk:printReceipt error:', e);
      return { success: false, message: e.message };
    }
  });

  // --- SETTINGS & WINDOW CONTROLS ---
  ipc.handle('kiosk:settings:getLogo', async () => {
    try {
      const { dbGet } = require('../../infrastructure/database/db');
      const row = await dbGet(`SELECT value FROM settings WHERE key = 'app_logo'`);
      return row ? row.value : null;
    } catch (e) {
      return null;
    }
  });

  ipc.handle('kiosk:settings:setLogo', async () => {
    try {
      const { dialog } = require('electron');
      const fs = require('fs');
      const { dbRun } = require('../../infrastructure/database/db');

      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg'] }]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        // Read file and convert to base64
        const bitmap = fs.readFileSync(filePath);
        const ext = path.extname(filePath).substring(1);
        const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
        const base64Data = `data:${mime};base64,${bitmap.toString('base64')}`;

        await dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES ('app_logo', ?)`, [base64Data]);
        return { success: true, logo: base64Data };
      }
      return { success: false, message: 'Dibatalkan' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipc.handle('kiosk:settings:getBackground', async () => {
    try {
      const { dbGet } = require('../../infrastructure/database/db');
      const row = await dbGet(`SELECT value FROM settings WHERE key = 'app_background'`);
      return row ? row.value : null;
    } catch (e) {
      return null;
    }
  });

  ipc.handle('kiosk:settings:setBackground', async () => {
    try {
      const { dialog } = require('electron');
      const fs = require('fs');
      const { dbRun } = require('../../infrastructure/database/db');

      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const bitmap = fs.readFileSync(filePath);
        const ext = path.extname(filePath).substring(1);
        const mime = `image/${ext}`;
        const base64Data = `data:${mime};base64,${bitmap.toString('base64')}`;

        await dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES ('app_background', ?)`, [base64Data]);
        return { success: true, bg: base64Data };
      }
      return { success: false, message: 'Dibatalkan' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipc.handle('kiosk:settings:get', async (event, key) => {
    try {
      const { dbGet } = require('../../infrastructure/database/db');
      const row = await dbGet(`SELECT value FROM settings WHERE key = ?`, [key]);
      if (row && row.value) return row.value;
      if (key === 'gemini_api_key') {
        return process.env.GEMINI_API_KEY || null;
      }
      return null;
    } catch (e) {
      if (key === 'gemini_api_key') {
        return process.env.GEMINI_API_KEY || null;
      }
      return null;
    }
  });

  ipc.handle('kiosk:settings:set', async (event, { key, value }) => {
    try {
      const { dbRun } = require('../../infrastructure/database/db');
      await dbRun(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
      return { success: true };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipc.handle('kiosk:exitApp', () => {
    const { app } = require('electron');
    app.quit();
  });
}

module.exports = { register };
