/**
 * Kiosk Service — Komunikasi dengan Laravel Backend
 * REST API client untuk operasi surat, warga, dan bansos
 */
const http = require('http');
const https = require('https');
require('dotenv').config();

// BACKEND_URL harus menunjuk ke BASE url tanpa trailing /api
// Contoh: http://192.168.1.100:8000 atau https://api.nagari.id
const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:8000/api').replace(/\/api\/?$/, '');
const TENANT_TOKEN = process.env.TENANT_TOKEN || '';
const NAGARI_ID = process.env.NAGARI_ID || 'default-nagari';
const EKTP_VALIDATE_ENDPOINT = process.env.EKTP_VALIDATE_ENDPOINT || '/api/device/ektp-registration/validate';
const EKTP_REGISTER_ENDPOINT = process.env.EKTP_REGISTER_ENDPOINT || '/api/device/ektp-registration/register';
const EKTP_CANCEL_ENDPOINT = process.env.EKTP_CANCEL_ENDPOINT || '/api/device/ektp-registration/cancel';

class KioskService {
  /**
   * HTTP request helper
   */
  _request(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, BACKEND_URL);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

        const fs = require('fs');
        const path = require('path');
        const { app } = require('electron');
        const userDataPath = app ? app.getPath('userData') : '';
        const tokenFilePath = path.join(userDataPath, 'device.json');
        
        let deviceToken = '';
        try {
          if (fs.existsSync(tokenFilePath)) {
            const savedData = JSON.parse(fs.readFileSync(tokenFilePath, 'utf-8'));
            // Heartbeat/API device harus memakai token device, bukan API key umum.
            deviceToken = savedData.device_token
              || savedData.token
              || '';
            
            if (!deviceToken) {
              console.warn('[KioskAPI] device.json ditemukan tapi tidak ada token field. Keys:', Object.keys(savedData).join(', '));
            }
          } else {
            console.warn('[KioskAPI] device.json tidak ditemukan di:', tokenFilePath);
          }
        } catch (e) {
          console.warn('[KioskAPI] Gagal baca device.json:', e.message);
        }

        const bodyString = body ? JSON.stringify(body) : '';
        
        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Device-Key': deviceToken,
            ...(bodyString && { 'Content-Length': Buffer.byteLength(bodyString) })
          },
          timeout: 15000,
        };

        console.log(`[KioskAPI] ${method} ${url.href} (token: ${deviceToken ? deviceToken.substring(0,8)+'...' : 'NONE'})`);

        const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else if (res.statusCode === 404) {
              // 404 = data tidak ditemukan (e-KTP belum terdaftar, NIK tidak ditemukan, dsb)
              resolve({ success: false, message: parsed.message || 'Data tidak ditemukan', statusCode: 404 });
            } else if (res.statusCode === 422) {
              // 422 = business logic rejection (misal: "sudah absen")
              // Resolve sebagai { success: false } agar frontend bisa tampilkan pesan yang ramah
              resolve({ success: false, message: parsed.message || 'Permintaan tidak dapat diproses', statusCode: 422 });
            } else {
              reject(new Error(`Backend error ${res.statusCode}: ${parsed.message || data}`));
            }
          } catch (e) {
            reject(new Error(`Backend response parse error: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`Backend connection error: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Backend request timeout'));
      });

      if (bodyString) {
        req.write(bodyString);
      }
      req.end();
    });
  }

  /**
   * Get data warga by NIK
   */
  async getWarga(nik) {
    try {
      return await this._request('POST', '/api/device/surat/check-nik', { nik });
    } catch (error) {
      console.error('KioskService: getWarga error:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Get daftar template surat
   */
  async getTemplatesSurat() {
    try {
      return await this._request('GET', '/api/device/surat/templates');
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Cek Status Surat / Resi
   */
  async cekStatusSurat(trackingCode) {
    try {
      return await this._request('GET', `/api/device/surat/status/${trackingCode}`);
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Riwayat Surat
   */
  async getRiwayatSurat(nik) {
    try {
      return await this._request('POST', '/api/device/surat/history', { nik });
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Cek status bansos by NIK
   */
  async cekBansos(nik) {
    try {
      return await this._request('POST', '/api/device/bansos/check', { nik });
    } catch (error) {
      console.error('KioskService: cekBansos error:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Validasi kode registrasi e-KTP/RFID dari staff.
   */
  async validateEktpRegistrationCode(registrationCode) {
    try {
      return await this._request('POST', EKTP_VALIDATE_ENDPOINT, {
        code: registrationCode,
      });
    } catch (error) {
      console.error('KioskService: validateEktpRegistrationCode error:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Hubungkan UID kartu e-KTP/RFID ke warga yang sudah divalidasi.
   */
  async registerEktpCard({ code, registration_code, card_uid, card_type = 'KTP' }) {
    try {
      return await this._request('POST', EKTP_REGISTER_ENDPOINT, {
        code: code || registration_code,
        card_uid,
        card_type,
      });
    } catch (error) {
      console.error('KioskService: registerEktpCard error:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Batalkan flow registrasi agar kode bisa digenerate ulang dari tabel admin.
   */
  async cancelEktpRegistration(registrationCode) {
    try {
      return await this._request('POST', EKTP_CANCEL_ENDPOINT, {
        code: registrationCode,
      });
    } catch (error) {
      console.error('KioskService: cancelEktpRegistration error:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Buat surat baru
   */
  async buatSurat(data) {
    try {
      // data: { nik, template_id, keperluan, custom_data }
      const response = await this._request('POST', '/api/device/surat/request', data);
      // Unwrap: API response has { success, data: { tracking_code, tracking_qr_base64, ... } }
      const payload = response.data || response;
      
      // Fix QR: API returns full data URL, strip the prefix so we can use it as raw base64
      if (payload.tracking_qr_base64) {
        payload.tracking_qr_base64 = payload.tracking_qr_base64
          .replace(/^data:image\/[a-z]+;base64,/, '');
      }
      
      return { ...response, ...payload };
    } catch (error) {
      console.error('KioskService: buatSurat error:', error.message);
      return { success: false, status: 'error', message: error.message };
    }
  }

  // ── Fitur HR / Absensi Wajah ──
  
  async hrFaceMatch(descriptor) {
    try {
      return await this._request('POST', '/api/device/hr/face-match', { descriptor });
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async hrCheckin(pegawai_id, confidence) {
    try {
      return await this._request('POST', '/api/device/hr/checkin', { pegawai_id, face_confidence: confidence });
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async hrCheckout(pegawai_id, confidence) {
    try {
      return await this._request('POST', '/api/device/hr/checkout', { pegawai_id, face_confidence: confidence });
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async hrFaceEnroll(token, descriptor) {
    try {
      return await this._request('POST', '/api/device/hr/face-enroll', { token, descriptor });
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async hrFaceEnrollCheckToken(token) {
    try {
      return await this._request('POST', '/api/device/hr/face-enroll/check-token', { token });
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async hrStatusMonitor() {
    try {
      return await this._request('GET', '/api/device/hr/status');
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Start kiosk session
   */
  async startSession() {
    try {
      return await this._request('POST', '/v1/kiosk/session/start');
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * End kiosk session
   */
  async endSession() {
    try {
      return await this._request('POST', '/v1/kiosk/session/end');
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = new KioskService();
