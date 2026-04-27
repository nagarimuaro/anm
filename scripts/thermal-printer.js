/**
 * Test Thermal Printer — HTML + @page auto height
 * npx electron scripts/thermal-printer.js
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const QRCode = require('qrcode');

app.whenReady().then(async () => {
  const PRINTER_NAME = 'thermal-printer';
  const qrData = await QRCode.toDataURL('RESI:ANM-2026-TEST|NIK:1371020304050007', { width: 150, margin: 1 });

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
  .detail { text-align: left; font-size: 11px; margin: 12px 0; padding: 0 2mm; }
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
  <div>Surat Keterangan Domisili</div>

  <div class="detail">Nama    : BUDI SANTOSO</div>
  <div class="detail">NIK     : 1371020304050007</div>
  <div class="detail">Waktu   : ${new Date().toLocaleString('id-ID')}</div>

  <div class="line"></div>
  <div class="resi-label">KODE RESI</div>
  <div class="resi-value">ANM-2026-TEST</div>
  <div class="line"></div>

  <div style="text-align:center; margin:4px 0;">
    <img src="${qrData}" style="width:35mm; height:35mm;" />
  </div>

  <div class="footer">Simpan struk ini.</div>
  <div class="bold" style="margin-top:4px;">* TERIMA KASIH *</div>
</body>
</html>`;

  const win = new BrowserWindow({ show: false, width: 302, height: 800 });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  // Tunggu render selesai
  await new Promise(r => setTimeout(r, 500));

  win.webContents.print({
    silent: true,
    printBackground: true,
    deviceName: PRINTER_NAME,
    margins: { marginType: 'none' },
  }, (success, failureReason) => {
    console.log(success ? '✅ Cetak berhasil!' : `❌ Gagal: ${failureReason}`);
    setTimeout(() => { win.close(); app.quit(); }, 1000);
  });
});

app.on('window-all-closed', () => app.quit());
