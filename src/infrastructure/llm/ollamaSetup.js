/**
 * Ollama Auto-Setup Service
 * Otomatis mendeteksi, mengunduh, dan menginstal Ollama di Windows
 * lalu menarik (pull) model AI yang dibutuhkan oleh SINTA Kiosk.
 */
const { execSync, exec, spawn } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// URL installer Ollama resmi untuk Windows
const OLLAMA_INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';
const OLLAMA_API = 'http://localhost:11434';

class OllamaSetupService {

  /**
   * Cek apakah Ollama sudah terinstal di sistem PATH Windows
   */
  isOllamaInstalled() {
    try {
      execSync('ollama --version', { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cek apakah Ollama server sedang berjalan (API aktif)
   */
  isOllamaRunning() {
    return new Promise((resolve) => {
      const req = http.get(`${OLLAMA_API}/api/tags`, { timeout: 3000 }, (res) => {
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  /**
   * Cek apakah model tertentu sudah di-pull
   */
  async isModelAvailable(modelName) {
    return new Promise((resolve) => {
      const req = http.get(`${OLLAMA_API}/api/tags`, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const models = json.models || [];
            const found = models.some(m => m.name === modelName || m.name === `${modelName}:latest`);
            resolve(found);
          } catch {
            resolve(false);
          }
        });
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  /**
   * Download file dari URL ke path lokal (dengan progress callback)
   */
  downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);

      const request = https.get(url, (response) => {
        // Handle redirect (301/302)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          return this.downloadFile(response.headers.location, destPath, onProgress).then(resolve).catch(reject);
        }

        const totalBytes = parseInt(response.headers['content-length'], 10);
        let downloadedBytes = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (onProgress && totalBytes) {
            onProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve(destPath);
        });
      });

      request.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
  }

  /**
   * Install Ollama secara silent di Windows
   */
  installOllama(installerPath) {
    return new Promise((resolve, reject) => {
      console.log('⚙️  Ollama: Memulai instalasi silent...');
      // Jalankan installer dengan flag silent /VERYSILENT
      const installer = spawn(installerPath, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
        stdio: 'ignore',
        detached: true
      });

      installer.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Ollama: Instalasi selesai!');
          resolve();
        } else {
          reject(new Error(`Ollama installer keluar dengan kode: ${code}`));
        }
      });

      installer.on('error', (err) => {
        reject(new Error(`Gagal menjalankan installer: ${err.message}`));
      });
    });
  }

  /**
   * Jalankan Ollama serve di background
   */
  startOllamaServer() {
    return new Promise(async (resolve) => {
      // Cek apakah sudah berjalan
      const running = await this.isOllamaRunning();
      if (running) {
        console.log('✅ Ollama: Server sudah aktif.');
        return resolve();
      }

      console.log('🚀 Ollama: Menjalankan server di background...');
      const ollamaPath = this._findOllamaPath();
      
      if (!ollamaPath) {
        console.warn('⚠️  Ollama: Tidak dapat menemukan executable ollama.');
        return resolve();
      }

      const server = spawn(ollamaPath, ['serve'], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true
      });
      server.unref();

      // Tunggu server siap (max 15 detik)
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const isUp = await this.isOllamaRunning();
        if (isUp) {
          console.log('✅ Ollama: Server berhasil dijalankan!');
          return resolve();
        }
      }
      console.warn('⚠️  Ollama: Server belum merespons setelah 15 detik.');
      resolve();
    });
  }

  pullModel(modelName, onProgress) {
    return new Promise((resolve, reject) => {
      if (onProgress) onProgress('pulling', 0);
      console.log(`📥 Ollama: Mengunduh model ${modelName}... (ini bisa memakan waktu beberapa menit)`);
      
      const postData = JSON.stringify({ name: modelName, stream: true });
      
      const url = new URL('/api/pull', OLLAMA_API);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 600000 // 10 menit timeout untuk download model besar
      };

      const req = http.request(options, (res) => {
        res.on('data', chunk => {
          try {
            const lines = chunk.toString().split('\\n').filter(Boolean);
            for (let line of lines) {
              const json = JSON.parse(line);
              if (json.total && json.completed && onProgress) {
                const percent = Math.round((json.completed / json.total) * 100);
                onProgress('pulling', percent);
              }
            }
          } catch(e) {}
        });
        res.on('end', () => {
          console.log(`✅ Ollama: Model ${modelName} berhasil diunduh!`);
          if (onProgress) onProgress('done', 100);
          resolve();
        });
      });

      req.on('error', (err) => reject(new Error(`Gagal pull model: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Pull model timeout (10 menit)')); });
      req.write(postData);
      req.end();
    });
  }

  /**
   * Cari path executable Ollama di Windows
   */
  _findOllamaPath() {
    const possiblePaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
      'C:\\Program Files\\Ollama\\ollama.exe',
      'ollama' // Fallback ke PATH
    ];

    for (const p of possiblePaths) {
      try {
        if (p === 'ollama') {
          execSync('ollama --version', { stdio: 'ignore', timeout: 3000 });
          return p;
        }
        if (fs.existsSync(p)) return p;
      } catch {}
    }
    return null;
  }

  /**
   * FUNGSI UTAMA: Setup lengkap Ollama + Model
   * Dipanggil saat startup aplikasi SINTA
   */
  async autoSetup(modelName = 'gemma3:4b', onProgress = null) {
    console.log('═══════════════════════════════════════════');
    console.log('  🤖 SINTA — Auto Setup Ollama AI Engine');
    console.log('═══════════════════════════════════════════');

    try {
      // LANGKAH 1: Cek apakah Ollama terinstal
      const installed = this.isOllamaInstalled();
      
      if (!installed && process.platform === 'win32') {
        console.log('📦 Ollama belum terinstal. Memulai auto-download...');
        if (onProgress) onProgress('downloading_installer', 0);
        
        const tempDir = os.tmpdir();
        const installerPath = path.join(tempDir, 'OllamaSetup.exe');
        
        // Download installer
        await this.downloadFile(OLLAMA_INSTALLER_URL, installerPath, (percent) => {
          if (percent % 20 === 0) console.log(`   📥 Download Ollama: ${percent}%`);
          if (onProgress) onProgress('downloading_installer', percent);
        });
        console.log('✅ Download Ollama installer selesai.');
        
        // Install secara silent
        await this.installOllama(installerPath);
        
        // Hapus installer setelah selesai
        try { fs.unlinkSync(installerPath); } catch {}
        
        // Tunggu sebentar agar Ollama terinstall sempurna
        await new Promise(r => setTimeout(r, 3000));
      } else if (installed) {
        console.log('✅ Ollama sudah terinstal.');
      } else {
        console.log(`⚠️  Platform ${process.platform} — skip auto-install Ollama.`);
      }

      // LANGKAH 2: Jalankan Ollama server
      await this.startOllamaServer();

      // LANGKAH 3: Cek dan pull model jika belum ada
      const modelReady = await this.isModelAvailable(modelName);
      if (!modelReady) {
        const running = await this.isOllamaRunning();
        if (running) {
          await this.pullModel(modelName, onProgress);
        } else {
          console.warn('⚠️  Ollama server tidak aktif, tidak bisa pull model.');
        }
      } else {
        console.log(`✅ Model ${modelName} sudah tersedia.`);
        if (onProgress) onProgress('done', 100);
      }

      console.log('═══════════════════════════════════════════');
      console.log('  ✅ SINTA AI Engine — Siap Operasi!');
      console.log('═══════════════════════════════════════════');

    } catch (error) {
      console.error('❌ Ollama Auto-Setup Error:', error.message);
      console.error('   Aplikasi tetap berjalan, fitur AI mungkin tidak tersedia.');
    }
  }
}

module.exports = new OllamaSetupService();
