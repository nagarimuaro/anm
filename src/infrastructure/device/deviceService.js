const si = require('systeminformation');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CURRENT_VERSION = "1.0.0";

class DeviceService {
  constructor() {
    // Determine userData path gracefully (app.getPath works in Main Process)
    const userDataPath = app ? app.getPath('userData') : '';
    this.tokenFilePath = path.join(userDataPath, 'device.json');
    this.cachedUpdate = null; // Menyimpan info update dari Cloud jika ada
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
      const printers = await si.printer();
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
      const usbs = await si.usb();
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
    if (!fs.existsSync(this.tokenFilePath)) return;
      
    try {
      const savedData = JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf-8'));
      if (!savedData.device_token) return;

      const hardwareStatus = await this.checkHardwareStatus();

      // Mengirimkan status hardware lengkap beserta identitas versi OS & Kiosk
      const payloadData = {
          ...hardwareStatus,
          current_version: CURRENT_VERSION,
          platform: process.platform === 'win32' ? 'win' : (process.platform === 'darwin' ? 'mac' : 'linux')
      };

      const response = await fetch('https://sintanagari.cloud/api/device/heartbeat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Device-Key': savedData.device_token
          },
          body: JSON.stringify(payloadData)
      });

      // Validasi Pemutusan Akses Massal dari Admin Web (Revoked)
      if (response.status === 401 || response.status === 403) {
          console.warn('DEVICE REVOKED: Token kedaluwarsa atau dimatikan Admin. Me-reset Kiosk...');
          if (fs.existsSync(this.tokenFilePath)) {
            fs.unlinkSync(this.tokenFilePath);
          }
          return;
      }

      const json = await response.json().catch(() => null);
      if (json && json.success) {
          console.log('[Heartbeat] Sinkronisasi latar belakang berhasil dikirim ke SINTANAGARI C-Admin.');
          
          const updateObj = json.data?.update;
          if (updateObj && updateObj.available && updateObj.version !== CURRENT_VERSION) {
              this.cachedUpdate = updateObj;
              console.log('[Heartbeat] OKE — Tersedia Update Versi:', updateObj.version);
          } else {
              this.cachedUpdate = null;
          }
      }
    } catch (error) {
      console.warn('[Heartbeat Warning] Gagal mencapai server SINTANAGARI:', error.message);
    }
  }

  /**
   * Mengembalikan info versi terbaru (jika ada) ke UI Kiosk
   */
  getPendingUpdate() {
    return this.cachedUpdate;
  }
}

module.exports = new DeviceService();
