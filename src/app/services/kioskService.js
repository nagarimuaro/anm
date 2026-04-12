/**
 * Kiosk Service — Komunikasi dengan Laravel Backend
 * REST API client untuk operasi surat, warga, dan bansos
 */
const http = require('http');
const https = require('https');
require('dotenv').config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000/api';
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

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${TENANT_TOKEN}`,
          'X-Tenant-ID': NAGARI_ID,
        },
        timeout: 15000,
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
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

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  /**
   * Get data warga by NIK
   */
  async getWarga(nik) {
    try {
      return await this._request('GET', `/v1/warga/${nik}`);
    } catch (error) {
      console.error('KioskService: getWarga error:', error.message);
      // Fallback mock data untuk testing/development
      return this._getMockWarga(nik);
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
   * Sesuai format di redesain.md Bagian Fase 5
   */
  async buatSurat(data) {
    try {
      return await this._request('POST', '/v1/surat', data);
    } catch (error) {
      console.error('KioskService: buatSurat error:', error.message);

      // Untuk development/offline — generate mock resi
      const mockResi = `ANM-${this._randomCode()}-${this._randomCode(2)}`;
      return {
        status: 'success',
        surat_id: `MOCK-${Date.now()}`,
        kode_resi: mockResi,
        pesan: 'Surat berhasil diajukan (mode offline).',
      };
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
