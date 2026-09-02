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

// Persistent Keep-Alive Agents untuk koneksi berulang yang cepat
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 10000,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 10000,
});

const TEMPLATE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 menit
const WARGA_CACHE_TTL_MS = 3 * 60 * 1000;    // 3 menit per NIK

class KioskService {
  constructor() {
    this._cachedDeviceToken = null;
    this._cachedTemplates = null;
    this._templatesCachedAt = 0;
    this._isPreloadingTemplates = false;
    this._wargaCache = new Map(); // key: nik -> { data, timestamp }
  }

  /**
   * Hapus cache data warga (untuk privasi saat sesi berakhir / kembali ke beranda)
   */
  clearWargaCache() {
    this._wargaCache.clear();
  }

  /**
   * Preload daftar template saat aplikasi mulai jalan
   */
  async preloadTemplates() {
    if (this._isPreloadingTemplates) return;
    this._isPreloadingTemplates = true;
    try {
      const res = await this._request('GET', '/api/device/surat/templates');
      if (res && res.success && Array.isArray(res.data)) {
        this._cachedTemplates = res.data;
        this._templatesCachedAt = Date.now();
        console.log(`[KioskService] ✅ Preloaded ${res.data.length} surat templates into memory.`);
      }
    } catch (e) {
      console.warn('[KioskService] Preload templates failed (will retry on demand):', e.message);
    } finally {
      this._isPreloadingTemplates = false;
    }
  }

  /**
   * HTTP request helper
   */
  _request(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, BACKEND_URL);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;
      const agent = isHttps ? httpsAgent : httpAgent;

      const fs = require('fs');
      const path = require('path');
      
      let deviceToken = this._cachedDeviceToken || '';
      if (!deviceToken) {
        try {
          const { app } = require('electron');
          const possiblePaths = [];
          if (app && typeof app.getPath === 'function') {
            possiblePaths.push(path.join(app.getPath('userData'), 'device.json'));
          }
          if (process.env.HOME) {
            possiblePaths.push(path.join(process.env.HOME, 'Library/Application Support/anm/device.json'));
            possiblePaths.push(path.join(process.env.HOME, 'Library/Application Support/SINTA/device.json'));
          }
          possiblePaths.push(path.join(process.cwd(), 'data/device.json'));
          possiblePaths.push(path.join(process.cwd(), 'device.json'));

          const tokenFilePath = possiblePaths.find(p => fs.existsSync(p));
          if (tokenFilePath) {
            const savedData = JSON.parse(fs.readFileSync(tokenFilePath, 'utf-8'));
            deviceToken = savedData.device_token || savedData.token || '';
            if (deviceToken) {
              this._cachedDeviceToken = deviceToken;
            }
          }
        } catch (e) {
          console.warn('[KioskAPI] Gagal baca device.json:', e.message);
        }
      }

      const bodyString = body ? JSON.stringify(body) : '';
      
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Device-Key': deviceToken,
          ...(bodyString && { 'Content-Length': Buffer.byteLength(bodyString) })
        },
        timeout: 10000,
      };

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
            } else if (res.statusCode === 409) {
              // 409 = konflik bisnis yang perlu ditampilkan ramah di UI
              // Contoh: buku tamu sudah diisi hari ini.
              resolve({ ...parsed, success: false, statusCode: 409 });
            } else if (res.statusCode === 422) {
              // 422 = business logic rejection (misal: "sudah absen")
              // Resolve sebagai { success: false } agar frontend bisa tampilkan pesan yang ramah
              resolve({ ...parsed, success: false, message: parsed.message || 'Permintaan tidak dapat diproses', statusCode: 422 });
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              resolve({ ...parsed, success: false, message: parsed.message || 'Perangkat belum terotorisasi', statusCode: res.statusCode });
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
   * Get data warga by NIK (dengan in-memory cache cepat & proteksi TTL)
   */
  async getWarga(nik) {
    if (!nik) return { success: false, message: 'NIK tidak boleh kosong.' };
    const cleanNik = String(nik).trim();

    // Cek in-memory cache
    const cached = this._wargaCache.get(cleanNik);
    if (cached && Date.now() - cached.timestamp < WARGA_CACHE_TTL_MS) {
      return { success: true, data: cached.data, fromCache: true };
    }

    try {
      const res = await this._request('POST', '/api/device/surat/check-nik', { nik: cleanNik });
      if (res && res.success && res.data) {
        this._wargaCache.set(cleanNik, {
          data: res.data,
          timestamp: Date.now(),
        });
      }
      return res;
    } catch (error) {
      console.error('KioskService: getWarga error:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Get daftar template surat (Stale-While-Revalidate untuk performa 0ms)
   */
  async getTemplatesSurat() {
    const isFresh = this._cachedTemplates && (Date.now() - this._templatesCachedAt < TEMPLATE_CACHE_TTL_MS);

    // Jika cache masih segar, langsung kembalikan 0ms
    if (isFresh) {
      return { success: true, data: this._cachedTemplates, fromCache: true };
    }

    // Jika cache sudah agak lama tapi ada data, kembalikan data lama dan fetch baru di background
    if (this._cachedTemplates && this._cachedTemplates.length > 0) {
      this.preloadTemplates(); // Background refresh
      return { success: true, data: this._cachedTemplates, fromCache: true };
    }

    // Fallback: fetch langsung jika belum ada cache sama sekali
    try {
      const res = await this._request('GET', '/api/device/surat/templates');
      if (res && res.success && Array.isArray(res.data)) {
        this._cachedTemplates = res.data;
        this._templatesCachedAt = Date.now();
      }
      return res;
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
   * Cek status bansos by NIK atau card_uid (RFID)
   * @param {Object} params - { nik?: string, card_uid?: string }
   */
  async cekBansos(params) {
    try {
      // Support legacy: jika params string, anggap sebagai NIK
      const body = typeof params === 'string' ? { nik: params } : params;
      return await this._request('POST', '/api/device/bansos/check', body);
    } catch (error) {
      console.error('KioskService: cekBansos error:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Simpan buku tamu digital.
   */
  async createBukuTamu(data) {
    try {
      return await this._request('POST', '/api/device/buku-tamu', data);
    } catch (error) {
      console.error('KioskService: createBukuTamu error:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Cek status Pajak Bumi dan Bangunan berdasarkan NOP.
   */
  async checkPbb(data) {
    try {
      return await this._request('POST', '/api/device/pbb/check', data);
    } catch (error) {
      console.error('KioskService: checkPbb error:', error.message);
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
    this.clearWargaCache();
    try {
      return await this._request('POST', '/v1/kiosk/session/end');
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = new KioskService();
