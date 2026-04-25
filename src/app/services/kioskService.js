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
            // Coba berbagai nama field yang mungkin dikembalikan API sintanagari.cloud
            deviceToken = savedData.device_token
              || savedData.token
              || savedData.api_key
              || savedData.key
              || savedData.access_token
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
      // Fallback mock data untuk testing/development
      return this._getMockWarga(nik);
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
      return await this._request('GET', `/v1/bansos/${nik}`);
    } catch (error) {
      console.error('KioskService: cekBansos error:', error.message);
      return this._getMockBansos(nik);
    }
  }

  // ── Mock Data untuk Testing ──

  _getMockWarga(nik) {
    const mockDB = {
      '1111111111111111': {
        nik: '1111111111111111',
        nama: 'Budi Santoso',
        tempat_lahir: 'Padang',
        tanggal_lahir: '1990-05-15',
        jenis_kelamin: 'Laki-Laki',
        alamat: 'Jorong Koto Baru, Nagari Sungai Penuh',
        rt: '002', rw: '005',
        agama: 'Islam',
        pekerjaan: 'Petani',
        status_kawin: 'Kawin',
      },
      '2222222222222222': {
        nik: '2222222222222222',
        nama: 'Siti Aisyah',
        tempat_lahir: 'Bukittinggi',
        tanggal_lahir: '1985-08-21',
        jenis_kelamin: 'Perempuan',
        alamat: 'Jorong Tanjung, Nagari Sungai Penuh',
        rt: '001', rw: '003',
        agama: 'Islam',
        pekerjaan: 'Pedagang',
        status_kawin: 'Kawin',
      },
      '3333333333333333': {
        nik: '3333333333333333',
        nama: 'Ahmad Rizki Pratama',
        tempat_lahir: 'Solok',
        tanggal_lahir: '1998-12-03',
        jenis_kelamin: 'Laki-Laki',
        alamat: 'Jorong Pasar, Nagari Sungai Penuh',
        rt: '003', rw: '001',
        agama: 'Islam',
        pekerjaan: 'Mahasiswa',
        status_kawin: 'Belum Kawin',
      },
    };

    const warga = mockDB[nik];
    if (warga) {
      console.log(`📦 Mock: Data warga ditemukan untuk NIK ${nik}: ${warga.nama}`);
      return { success: true, data: warga };
    }

    console.log(`📦 Mock: NIK ${nik} tidak ditemukan, generate dummy`);
    return {
      success: true,
      data: {
        nik,
        nama: `Warga Test (${nik.slice(-4)})`,
        tempat_lahir: 'Padang',
        tanggal_lahir: '1995-01-01',
        jenis_kelamin: 'Laki-Laki',
        alamat: 'Jorong Koto Baru, Nagari Sungai Penuh',
        rt: '001', rw: '001',
        agama: 'Islam',
        pekerjaan: 'Wiraswasta',
        status_kawin: 'Belum Kawin',
      },
    };
  }

  _getMockBansos(nik) {
    const penerima = ['1111111111111111', '3333333333333333'];
    if (penerima.includes(nik)) {
      return {
        success: true,
        data: {
          nik,
          status: 'Penerima',
          jenis: ['PKH', 'BPNT'],
          periode: '2026',
          keterangan: 'Aktif menerima bantuan',
        },
      };
    }
    return {
      success: true,
      data: {
        nik,
        status: 'Bukan Penerima',
        jenis: [],
        keterangan: 'Tidak terdaftar sebagai penerima bansos',
      },
    };
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

      // Untuk development/offline — generate mock resi
      const mockResi = `ANM-${this._randomCode()}-${this._randomCode(2)}`;
      return {
        status: 'success',
        surat_id: `MOCK-${Date.now()}`,
        kode_resi: mockResi,
        tracking_code: mockResi,
        pesan: 'Surat berhasil diajukan (mode offline).',
      };
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
      return { success: true, message: 'Session started (offline mode)' };
    }
  }

  /**
   * End kiosk session
   */
  async endSession() {
    try {
      return await this._request('POST', '/v1/kiosk/session/end');
    } catch (error) {
      return { success: true, message: 'Session ended (offline mode)' };
    }
  }

  // Helper
  _randomCode(length = 4) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

module.exports = new KioskService();
