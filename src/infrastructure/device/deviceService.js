const si = require('systeminformation');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const packageJson = require('../../../package.json');

const CURRENT_VERSION = packageJson.version || "1.0.0";
const HEARTBEAT_URL = 'https://sintanagari.cloud/api/device/heartbeat';
const HEARTBEAT_TIMEOUT_MS = 20000;
const HARDWARE_CHECK_TIMEOUT_MS = 5000;

function withTimeout(promise, timeoutMs, fallbackValue, label) {
  let timeout;
  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => {
      console.warn(`[DeviceService] ${label} timeout setelah ${timeoutMs}ms.`);
      resolve(fallbackValue);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

class DeviceService {
  constructor() {
    // Determine userData path gracefully (app.getPath works in Main Process)
    const userDataPath = app ? app.getPath('userData') : '';
    this.tokenFilePath = path.join(userDataPath, 'device.json');
    this.heartbeatLogPath = path.join(userDataPath, 'heartbeat.log');
    this.cachedUpdate = null; // Menyimpan info update dari Cloud jika ada
    this.lastHeartbeat = null;
  }

  getDeviceToken(savedData) {
    return savedData?.device_token
      || savedData?.token
      || savedData?.api_key
      || savedData?.key
      || savedData?.access_token
      || '';
  }

  writeHeartbeatLog(message, extra = null) {
    const line = `[${new Date().toISOString()}] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`;
    try {
      fs.appendFileSync(this.heartbeatLogPath, line, 'utf-8');
    } catch (error) {
      console.warn('[Heartbeat] Gagal menulis heartbeat.log:', error.message);
    }
  }

  /**
   * Generates a unique hardware footprint hash based on stable System UUID and Serial Number
   */
  async generateFingerprint() {
    try {
      const systemInfo = await si.system();

      // Use persistent System Hardware UUID and Motherboard Serial Number
      const hardwareUUID = systemInfo.uuid || 'unknown-uuid';
      const serialNumber = systemInfo.serial || 'unknown-serial';

      // Create a stable, readable raw string as fingerprint
      const rawString = `${serialNumber}-${hardwareUUID}`;
      
      const hash = rawString;
      
      return { 
        hash, 
        device_name: systemInfo.model || 'ANM Kiosk', 
        debug: { serialNumber, hardwareUUID } 
      };
    } catch (error) {
      console.error('Error generating fingerprint:', error);
      throw new Error('Gagal membaca data perangkat keras keras (Hardware).');
    }
  }

  /**
   * Checks local file for activation status and verifies the fingerprint
   * Returns: { status: 'ACTIVATED'|'UNACTIVATED'|'INVALID_FINGERPRINT', data?: Object }
   */
  async checkActivation() {
    if (!fs.existsSync(this.tokenFilePath)) {
      return { status: 'UNACTIVATED' };
    }

    try {
      const savedData = JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf-8'));
      const currentHardware = await this.generateFingerprint();

      if (savedData.fingerprint !== currentHardware.hash) {
        console.error('DEVICE SECURITY ALERT: Hardware fingerprint mismatch!');
        console.error('Saved:', savedData.fingerprint);
        console.error('Current:', currentHardware.hash);
        return { status: 'INVALID_FINGERPRINT' };
      }

      return { status: 'ACTIVATED', data: savedData };
    } catch (error) {
      console.error('Error reading device.json:', error);
      // Malformed JSON counts as unactivated so they can try again.
      return { status: 'UNACTIVATED' };
    }
  }

  /**
   * Mengirim request aktivasi beneran ke API Backend Server
   */
  async activateDevice(activationToken) {
    const hardware = await this.generateFingerprint();

    try {
      const response = await fetch('https://sintanagari.cloud/api/device/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          activation_token: activationToken,
          device_name: hardware.device_name,
          fingerprint: hardware.hash
        })
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(json.message || `Server menolak dengan status ${response.status}`);
      }

      if (!json.success || !json.data) {
        throw new Error('Mendapatkan struktur respons yang tidak beraturan dari server.');
      }

      // Gabungkan credential payload dari API dengan log hardware lokal kita
      const credentialData = {
        ...json.data,
        fingerprint: hardware.hash,
        device_name: hardware.device_name, // Mengirim/menerima nama alat
        activated_at: new Date().toISOString()
      };

      // Tulis permanen ke `device.json`
      fs.mkdirSync(path.dirname(this.tokenFilePath), { recursive: true });
      fs.writeFileSync(this.tokenFilePath, JSON.stringify(credentialData, null, 2), 'utf-8');
      
      return credentialData;

    } catch (error) {
       console.error('API Activation Error:', error);
       // Lemparkan _message_ langsung ke UI (React) 
       throw new Error(error.message || 'Koneksi ke server API tertutup/gagal.');
    }
  }

  /**
   * Mengukur kesehatan koneksi alat fisik secara nyata asinkron
   */
  async checkHardwareStatus() {
    try {
      const payloads = { cpu: 'ok', printer: 'error', rfid: 'error', webcam: 'error' };
      
      // ====== CEK PRINTER FISIK (Abaikan printer virtual bawaan Windows) ======
      const VIRTUAL_PRINTERS = [
        'microsoft print to pdf',
        'microsoft xps document writer',
        'onenote',
        'send to onenote',
        'fax',
        'adobe pdf',
        'foxit',
        'cutepdf',
        'bullzip',
        'pdfcreator',
        'doPDF',
      ];
      const printers = await withTimeout(si.printer(), HARDWARE_CHECK_TIMEOUT_MS, [], 'Cek printer');
      const physicalPrinters = printers.filter(p => {
        const name = (p.name || '').toLowerCase();
        return !VIRTUAL_PRINTERS.some(vp => name.includes(vp));
      });
      
      if (physicalPrinters.length > 0) {
        const activePrinter = physicalPrinters.find(p => p.status !== 'offline');
        payloads.printer = activePrinter ? 'ok' : 'offline';
      }
      
      // ====== CEK RFID USB READER ======
      // USB Card Reader umumnya terdeteksi dengan kata kunci berikut:
      const RFID_KEYWORDS = ['rfid', 'nfc', 'smart card', 'card reader', 'contactless', 'acr122', 'acr1252', 'mifare', 'hid', 'input device'];
      const usbs = await withTimeout(si.usb(), HARDWARE_CHECK_TIMEOUT_MS, [], 'Cek USB');
      const hasRfid = usbs.some(u => {
        const name = (u.name || '').toLowerCase();
        return RFID_KEYWORDS.some(kw => name.includes(kw));
      });
      if (hasRfid) payloads.rfid = 'ok';

      // ====== CEK WEBCAM ======
      const WEBCAM_KEYWORDS = ['camera', 'webcam', 'video', 'cam', 'imaging'];
      const hasWebcam = usbs.some(u => {
        const name = (u.name || '').toLowerCase();
        return WEBCAM_KEYWORDS.some(kw => name.includes(kw));
      });
      if (hasWebcam) payloads.webcam = 'ok';

      return payloads;
    } catch (e) {
      return { cpu: 'ok', printer: 'unknown', rfid: 'unknown', webcam: 'unknown' };
    }
  }

  /**
   * Latar Belakang: Sinkronisasi Health Ping Kiosk ke Cloud
   */
  async sendHeartbeat() {
    if (!fs.existsSync(this.tokenFilePath)) {
      console.warn('[Heartbeat] Skip: device.json tidak ditemukan di:', this.tokenFilePath);
      this.lastHeartbeat = {
        success: false,
        status: 'SKIPPED',
        message: 'device.json tidak ditemukan',
        at: new Date().toISOString(),
      };
      this.writeHeartbeatLog('SKIP device.json tidak ditemukan', { path: this.tokenFilePath });
      return;
    }
      
    try {
      const savedData = JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf-8'));
      const deviceToken = this.getDeviceToken(savedData);
      if (!deviceToken) {
        const keys = Object.keys(savedData);
        console.warn('[Heartbeat] Skip: device.json ada, tapi token kosong. Keys:', keys.join(', '));
        this.lastHeartbeat = {
          success: false,
          status: 'SKIPPED',
          message: 'Token perangkat tidak ditemukan di device.json',
          at: new Date().toISOString(),
        };
        this.writeHeartbeatLog('SKIP token kosong', { keys });
        return;
      }

      const hardwareStatus = await this.checkHardwareStatus();

      // Mengirimkan status hardware lengkap beserta identitas versi OS & Kiosk
      const payloadData = {
          ...hardwareStatus,
          current_version: CURRENT_VERSION,
          platform: process.platform === 'win32' ? 'win' : (process.platform === 'darwin' ? 'mac' : 'linux'),
          device_name: savedData.device_name || undefined,
          fingerprint: savedData.fingerprint || undefined,
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);

      const response = await fetch(HEARTBEAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Device-Key': deviceToken
          },
          body: JSON.stringify(payloadData),
          signal: controller.signal,
      });
      clearTimeout(timeout);

      const json = await response.json().catch(() => null);
      this.lastHeartbeat = {
        success: response.ok && !!json?.success,
        status: response.status,
        message: json?.message || response.statusText || '',
        at: new Date().toISOString(),
        payload: payloadData,
      };

      // Validasi Pemutusan Akses Massal dari Admin Web (Revoked)
      if (response.status === 401 || response.status === 403) {
          console.warn(`DEVICE REVOKED: Backend menolak heartbeat (${response.status}).`, json?.message || 'Token kedaluwarsa atau dimatikan Admin.');
          this.writeHeartbeatLog('REVOKED backend menolak heartbeat', { status: response.status, message: json?.message });
          if (fs.existsSync(this.tokenFilePath)) {
            fs.unlinkSync(this.tokenFilePath);
          }
          return;
      }

      if (!response.ok) {
          console.warn(`[Heartbeat] Backend menolak request (${response.status}).`, json?.message || 'Tidak ada pesan.');
          this.writeHeartbeatLog('FAILED backend menolak request', { status: response.status, message: json?.message });
          return;
      }

      if (json && json.success) {
          console.log('[Heartbeat] Sinkronisasi latar belakang berhasil dikirim ke SINTANAGARI C-Admin.');
          this.writeHeartbeatLog('OK heartbeat terkirim', { status: response.status });
          
          const updateObj = json.data?.update;
          if (updateObj && updateObj.available && updateObj.version !== CURRENT_VERSION) {
              this.cachedUpdate = updateObj;
              console.log('[Heartbeat] OKE — Tersedia Update Versi:', updateObj.version);
          } else {
              this.cachedUpdate = null;
          }
      } else {
          console.warn('[Heartbeat] Response OK tapi success bukan true.', json);
          this.writeHeartbeatLog('FAILED response success bukan true', { status: response.status, body: json });
      }
    } catch (error) {
      const message = error.name === 'AbortError'
        ? `Request timeout setelah ${HEARTBEAT_TIMEOUT_MS}ms`
        : error.message;
      this.lastHeartbeat = {
        success: false,
        status: 'ERROR',
        message,
        at: new Date().toISOString(),
      };
      console.warn('[Heartbeat Warning] Gagal mencapai server SINTANAGARI:', message);
      this.writeHeartbeatLog('ERROR gagal mencapai server', { message });
    }
  }

  /**
   * Mengembalikan info versi terbaru (jika ada) ke UI Kiosk
   */
  getPendingUpdate() {
    return this.cachedUpdate;
  }

  getHeartbeatStatus() {
    return {
      lastHeartbeat: this.lastHeartbeat,
      tokenFilePath: this.tokenFilePath,
      heartbeatLogPath: this.heartbeatLogPath,
    };
  }
}

module.exports = new DeviceService();
