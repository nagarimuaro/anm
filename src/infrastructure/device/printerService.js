/**
 * printerService.js — ANM Thermal Printer Service
 *
 * Mencetak struk resi menggunakan HTML + CSS @page auto height
 * via Electron webContents.print(). Kompatibel dengan driver 4BARCODE.
 */

'use strict';

const QRCode = require('qrcode');

// ─── Nama printer di Windows ─────────────────────────────────────────────────
const PRINTER_NAME = 'thermal-printer';

/**
 * Cetak struk resi thermal.
 *
 * @param {object} params
 * @param {string} params.resi          - Kode resi / tracking code
 * @param {string} params.jenis_surat   - Nama jenis surat
 * @param {string} params.nik           - NIK pemohon
 * @param {string} params.nama          - Nama pemohon
 * @param {string} params.alamat        - Alamat pemohon
 * @returns {Promise<{success: boolean, message?: string}>}
 */
async function printReceipt({ resi, jenis_surat, nik, nama, alamat }) {
  const { BrowserWindow } = require('electron');

  const safeResi   = resi || '-';
  const safeSurat  = jenis_surat || 'Pengajuan Surat';
  const safeNik    = nik || '-';
  const safeNama   = nama || '-';
  const safeAlamat = alamat || '-';

  const dateTime = new Date().toLocaleString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Generate QR code — hanya berisi kode resi saja
  const qrData = await QRCode.toDataURL(safeResi, { width: 150, margin: 1 });

  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  @page {
    size: 80mm auto;
    margin: 0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 80mm;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    text-align: center;
    padding: 4mm 2mm;
  }
  .header { font-size: 16px; font-weight: bold; margin-bottom: 2px; }
  .sub { font-size: 9px; color: #555; margin-bottom: 6px; }
  .line { border-top: 1px dashed #000; margin: 4px 0; }
  .title { font-size: 13px; font-weight: bold; margin: 4px 0 2px; }
  .detail { text-align: left; font-size: 11px; margin: 8px 0; padding: 0 2mm; }
  .resi-label { font-size: 13px; font-weight: bold; margin-top: 4px; }
  .resi-value { font-size: 20px; font-weight: 900; letter-spacing: 2px; margin: 2px 0; }
  .footer { font-size: 9px; margin-top: 6px; }
  .bold { font-weight: bold; }
</style>
</head>
<body>
  <div class="header">ANJUNGAN NAGARI MANDIRI</div>
  <div class="sub">Nagari Aie Angek</div>
  <div class="line"></div>

  <div class="title">BUKTI PENGAJUAN SURAT</div>
  <div>${safeSurat}</div>

  <div class="detail">Nama    : ${safeNama}</div>
  <div class="detail">NIK     : ${safeNik}</div>
  <div class="detail">Waktu   : ${dateTime}</div>

  <div class="line"></div>
  <div class="resi-label">KODE RESI</div>
  <div class="resi-value">${safeResi}</div>
  <div class="line"></div>

  <div style="text-align:center; margin:4px 0;">
    <img src="${qrData}" style="width:35mm; height:35mm;" />
  </div>

  <div class="footer">Simpan struk ini.</div>
  <div class="bold" style="margin-top:4px;">* TERIMA KASIH *</div>
</body>
</html>`;

  return new Promise((resolve) => {
    const win = new BrowserWindow({ show: false, width: 302, height: 800 });

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .then(() => {
        // Tunggu render selesai
        setTimeout(() => {
          win.webContents.print({
            silent: true,
            printBackground: true,
            deviceName: PRINTER_NAME,
            margins: { marginType: 'none' },
          }, (success, failureReason) => {
            setTimeout(() => win.close(), 500);

            if (success) {
              console.log('[Printer] ✅ Struk resi berhasil dicetak.');
              resolve({ success: true });
            } else {
              console.error('[Printer] ❌ Gagal mencetak:', failureReason);
              resolve({ success: false, message: failureReason });
            }
          });
        }, 500);
      })
      .catch((err) => {
        console.error('[Printer] ❌ Gagal load HTML:', err.message);
        try { win.close(); } catch {}
        resolve({ success: false, message: err.message });
      });
  });
}

module.exports = { printReceipt };
