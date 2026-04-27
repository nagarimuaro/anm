/**
 * PRINTER DEBUG — Kirim beberapa test pattern ke thermal printer
 * untuk menemukan perintah ESC/POS mana yang tidak didukung.
 *
 * Jalankan: node scripts/printer-debug.js
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PRINTER_NAME = 'thermal-printer';
const ESC = 0x1B;
const GS  = 0x1D;
const LF  = 0x0A;

function sendRaw(printerName, buffer) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `debug_${Date.now()}.bin`);
    fs.writeFileSync(tmpFile, buffer);

    const psScript = `
$printerName = '${printerName.replace(/'/g, "''")}'
$file = '${tmpFile.replace(/\\/g, '\\\\')}'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern bool StartDocPrinter(IntPtr h, int lvl, ref DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]
  public struct DOCINFO {
    [MarshalAs(UnmanagedType.LPTStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPTStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPTStr)] public string pDataType;
  }
}
"@ -ErrorAction SilentlyContinue
$hPrinter = [IntPtr]::Zero
if (-not [RawPrinter]::OpenPrinter($printerName, [ref]$hPrinter, [IntPtr]::Zero)) {
  Write-Error "GAGAL membuka printer"; exit 1
}
$di = New-Object RawPrinter+DOCINFO
$di.pDocName = "DEBUG"; $di.pDataType = "RAW"
[RawPrinter]::StartDocPrinter($hPrinter, 1, [ref]$di) | Out-Null
[RawPrinter]::StartPagePrinter($hPrinter) | Out-Null
$bytes = [System.IO.File]::ReadAllBytes($file)
$written = 0
[RawPrinter]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written) | Out-Null
[RawPrinter]::EndPagePrinter($hPrinter) | Out-Null
[RawPrinter]::EndDocPrinter($hPrinter) | Out-Null
[RawPrinter]::ClosePrinter($hPrinter) | Out-Null
Write-Host "OK:$written"
`.trim();

    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
    let stdout = '', stderr = '';
    ps.stdout.on('data', d => { stdout += d.toString(); });
    ps.stderr.on('data', d => { stderr += d.toString(); });
    ps.on('close', (code) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (stdout.includes('OK:')) resolve(parseInt(stdout.match(/OK:(\d+)/)?.[1] || '0'));
      else reject(new Error(stderr.trim() || `exit ${code}`));
    });
  });
}

// ─────────────────────────────────────────
//  TEST PATTERNS — dari paling sederhana
// ─────────────────────────────────────────
async function main() {
  console.log('=== PRINTER DEBUG TEST ===\n');

  // Semua test dalam 1 buffer, dipisah garis putus-putus
  const buf = [];

  // ── TEST 1: Plain ASCII text + LF saja. Tanpa ESC/POS apapun ──
  const t1 = 'TEST 1: PLAIN TEXT\n';
  for (const ch of Buffer.from(t1, 'ascii')) buf.push(ch);
  buf.push(LF);

  // ── TEST 2: Dengan ESC @ (init) dulu ──
  buf.push(ESC, 0x40); // init
  const t2 = 'TEST 2: AFTER ESC @\n';
  for (const ch of Buffer.from(t2, 'ascii')) buf.push(ch);
  buf.push(LF);

  // ── TEST 3: Init + Align center ──
  buf.push(ESC, 0x40);
  buf.push(ESC, 0x61, 1); // center
  const t3 = 'TEST 3: CENTER ALIGN\n';
  for (const ch of Buffer.from(t3, 'ascii')) buf.push(ch);
  buf.push(LF);

  // ── TEST 4: Init + Bold ──
  buf.push(ESC, 0x40);
  buf.push(ESC, 0x45, 1); // bold on
  const t4 = 'TEST 4: BOLD TEXT\n';
  for (const ch of Buffer.from(t4, 'ascii')) buf.push(ch);
  buf.push(ESC, 0x45, 0); // bold off
  buf.push(LF);

  // ── TEST 5: Init + textSize GS ! (yang kita hapus) ──
  buf.push(ESC, 0x40);
  buf.push(GS, 0x21, 0x00); // textSize(0,0) = normal
  const t5 = 'TEST 5: GS ! 0x00\n';
  for (const ch of Buffer.from(t5, 'ascii')) buf.push(ch);
  buf.push(LF);

  // ── TEST 6: Init + ESC t codepage ──
  buf.push(ESC, 0x40);
  buf.push(ESC, 0x74, 0); // codepage CP437
  const t6 = 'TEST 6: AFTER ESC t 0\n';
  for (const ch of Buffer.from(t6, 'ascii')) buf.push(ch);
  buf.push(LF);

  // ── TEST 7: Init + line of dashes ──
  buf.push(ESC, 0x40);
  const t7 = '--------------------------------\n';
  for (const ch of Buffer.from(t7, 'ascii')) buf.push(ch);
  const t7b = 'TEST 7: DASHES ABOVE\n';
  for (const ch of Buffer.from(t7b, 'ascii')) buf.push(ch);
  buf.push(LF);

  // ── TEST 8: Multiple newlines then text ──
  buf.push(ESC, 0x40);
  buf.push(LF, LF, LF);
  const t8 = 'TEST 8: AFTER 3xLF\n';
  for (const ch of Buffer.from(t8, 'ascii')) buf.push(ch);
  buf.push(LF);

  // ── TEST 9: Feed + cut ──
  buf.push(LF, LF, LF, LF, LF);
  buf.push(GS, 0x56, 0x41, 0); // cut

  const data = Buffer.from(buf);
  console.log(`Buffer: ${data.length} bytes`);
  console.log('Mengirim ke printer...\n');

  try {
    const written = await sendRaw(PRINTER_NAME, data);
    console.log(`Terkirim: ${written} bytes`);
    console.log('\nLihat struk — test mana yang tampil?');
    console.log('  TEST 1: Plain text tanpa ESC command');
    console.log('  TEST 2: Setelah ESC @ (init)');
    console.log('  TEST 3: Center align');
    console.log('  TEST 4: Bold');
    console.log('  TEST 5: GS ! (text size)');
    console.log('  TEST 6: ESC t (codepage)');
    console.log('  TEST 7: Dashes + text');
    console.log('  TEST 8: Setelah 3x line feed');
  } catch (err) {
    console.error('GAGAL:', err.message);
  }
}

main();
