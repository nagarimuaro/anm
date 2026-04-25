/**
 * Kiosk Controller — IPC Handler untuk operasi non-voice
 */
const kioskService = require('../services/kioskService');
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

  ipc.handle('kiosk:api:cekBansos', async (event, nik) => {
    return await kioskService.cekBansos(nik);
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

  // Print PDF dari buffer yang dikirim renderer
  ipc.handle('kiosk:printPdf', async (event, { data, filename }) => {
    try {
      const { app, shell } = require('electron');
      const tempDir = path.join(app.getPath('temp'), 'anm_print');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const filePath = path.join(tempDir, filename || 'surat.pdf');
      fs.writeFileSync(filePath, Buffer.from(data));
      
      // Buka dengan default PDF viewer / Acrobat Reader (akan memunculkan dialog print)
      await shell.openPath(filePath);

      return { success: true, path: filePath };
    } catch (err) {
      console.error('kiosk:printPdf error:', err);
      return { success: false, message: err.message };
    }
  });

  // Print Resi (Thermal / Standard Printer) silently
  ipc.handle('kiosk:printReceipt', async (event, { resi, qrBase64, jenis_surat }) => {
    try {
      const { BrowserWindow } = require('electron');
      const win = new BrowserWindow({ show: false });
      const html = `
        <html>
        <body style="font-family: monospace; text-align: center; padding: 10px; width: 300px; margin: 0 auto;">
          <h3>ANJUNGAN NAGARI MANDIRI</h3>
          <p style="font-size: 14px;"><strong>${jenis_surat || 'Pengajuan Surat'}</strong></p>
          <hr style="border-top: 1px dashed #000;"/>
          <p style="font-size: 12px; margin-top: 16px;">KODE RESI:</p>
          <h1 style="font-size: 28px; border: 2px solid #000; padding: 8px; margin: 4px 0;">${resi}</h1>
          ${qrBase64 ? `<img src="data:image/png;base64,${qrBase64}" style="width: 180px; height: 180px; margin-top: 16px;" />` : ''}
          <p style="font-size: 12px; margin-top: 16px;">Gunakan QR atau Kode Resi ini untuk memantau status atau mencetak dokumen asli.</p>
        </body>
        </html>
      `;
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      win.webContents.print({ silent: true, printBackground: true, margins: { marginType: 'none' } }, (success, errorType) => {
        if (!success) console.log('Receipt print failed', errorType);
        setTimeout(() => win.close(), 1000);
      });
      return { success: true };
    } catch (e) {
      console.error('kiosk:printReceipt error:', e);
      return { success: false, message: e.message };
    }
  });
}

module.exports = { register };
