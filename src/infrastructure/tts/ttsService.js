/**
 * TTS Service — Edge TTS (Primary) + OS Fallback
 * Text-to-Speech menggunakan Microsoft Edge TTS API
 * Fallback ke macOS `say` / Windows SAPI jika offline
 * 
 * OPTIMASI: Sentence-level chunking
 * - Split teks panjang per kalimat
 * - Generate TTS per kalimat secara paralel
 * - Return audio kalimat pertama lebih cepat
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const VOICE = process.env.EDGE_TTS_VOICE || 'id-ID-ArdiNeural';

// Dalam mode production (packaged), __dirname di dalam app.asar (read-only).
// Gunakan app.getPath('userData') untuk menyimpan cache audio.
let CACHE_DIR;
try {
  const { app } = require('electron');
  const userDataPath = app.getPath('userData');
  CACHE_DIR = process.env.AUDIO_CACHE_DIR
    ? path.resolve(userDataPath, process.env.AUDIO_CACHE_DIR)
    : path.join(userDataPath, 'data', 'audio_cache');
} catch (e) {
  CACHE_DIR = process.env.AUDIO_CACHE_DIR
    ? path.resolve(process.cwd(), process.env.AUDIO_CACHE_DIR)
    : path.join(__dirname, '../../../data/audio_cache');
}

class TextToSpeechService {
  constructor() {
    this.edgeTTSAvailable = false;

    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    this._checkEdgeTTS();

    console.log('🔊 TTS Service initialized.');
    console.log(`   Voice: ${VOICE}`);
    console.log(`   Cache dir: ${CACHE_DIR}`);
  }

  _checkEdgeTTS() {
    try {
      execSync('edge-tts --version', { stdio: 'ignore' });
      this.edgeTTSAvailable = true;
      this.edgeTTSBin = 'edge-tts';
      console.log('✅ Edge TTS available');
      return;
    } catch {}

    const pipxPath = path.join(require('os').homedir(), '.local', 'bin', 'edge-tts');
    try {
      if (fs.existsSync(pipxPath)) {
        execSync(`"${pipxPath}" --version`, { stdio: 'ignore' });
        this.edgeTTSAvailable = true;
        this.edgeTTSBin = pipxPath;
        process.env.PATH = path.join(require('os').homedir(), '.local', 'bin') + ':' + process.env.PATH;
        console.log(`✅ Edge TTS available (via pipx: ${pipxPath})`);
        return;
      }
    } catch {}

    console.warn('⚠️ Edge TTS not found. Will use OS fallback (say/SAPI).');
    this.edgeTTSAvailable = false;
    this.edgeTTSBin = 'edge-tts';
  }

  /**
   * Generate audio dari teks
   * @param {string} text - Teks yang akan di-convert ke suara
   * @returns {Promise<string>} - Path ke file audio
   */
  async generateAudio(text) {
    if (!text || text.trim().length === 0) {
      throw new Error('TTS: Text kosong');
    }

    const hash = crypto.createHash('md5').update(text.trim()).digest('hex');
    const fileName = `tts_${hash}.mp3`;
    const filePath = path.join(CACHE_DIR, fileName);

    // Cache hit
    if (fs.existsSync(filePath)) {
      console.log(`TTS: Cache hit untuk: "${text.substring(0, 50)}..."`);
      return filePath;
    }

    console.log(`TTS: Generating audio untuk: "${text.substring(0, 50)}..."`);

    try {
      if (this.edgeTTSAvailable) {
        await this._generateEdgeTTS(text, filePath);
      } else {
        await this._generateFallbackTTS(text, filePath);
      }

      console.log(`✅ TTS: Audio saved to ${filePath}`);
      return filePath;
    } catch (error) {
      console.error('❌ Edge TTS failed, trying fallback:', error.message);

      try {
        await this._generateFallbackTTS(text, filePath);
        console.log(`✅ TTS (fallback): Audio saved to ${filePath}`);
        return filePath;
      } catch (fallbackError) {
        console.error('❌ TTS Fallback also failed:', fallbackError.message);
        throw new Error('Gagal menghasilkan suara. Semua TTS engine gagal.');
      }
    }
  }

  /**
   * Generate audio per kalimat secara paralel (sentence chunking)
   * Return array of audio paths — kalimat pertama siap lebih cepat
   * 
   * @param {string} text - Teks panjang yang akan di-split per kalimat
   * @returns {Promise<{firstAudioPath: string, allAudioPaths: string[]}>}
   */
  async generateAudioChunked(text) {
    if (!text || text.trim().length === 0) {
      throw new Error('TTS: Text kosong');
    }

    // Split per kalimat
    const sentences = this._splitSentences(text);

    if (sentences.length <= 1) {
      // Kalimat pendek — generate langsung
      const audioPath = await this.generateAudio(text);
      return { firstAudioPath: audioPath, allAudioPaths: [audioPath] };
    }

    console.log(`TTS: Chunking ${sentences.length} sentences for parallel generation`);

    // Generate semua kalimat secara paralel
    const promises = sentences.map(sentence => this.generateAudio(sentence));

    // Race: return kalimat pertama sesegera mungkin
    const firstAudioPath = await promises[0];

    // Sisanya generate di background
    const allAudioPaths = await Promise.all(promises);

    return { firstAudioPath, allAudioPaths };
  }

  /**
   * Split teks menjadi kalimat-kalimat
   */
  _splitSentences(text) {
    // Split di titik, tanda seru, tanda tanya — tapi jaga agar sentence tidak terlalu pendek
    const raw = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    const sentences = [];
    let buffer = '';
    
    for (const part of raw) {
      buffer += part;
      // Minimal 20 karakter per chunk agar TTS natural
      if (buffer.trim().length >= 20) {
        sentences.push(buffer.trim());
        buffer = '';
      }
    }
    
    // Sisa buffer
    if (buffer.trim()) {
      if (sentences.length > 0 && buffer.trim().length < 15) {
        // Terlalu pendek — gabung dengan kalimat terakhir
        sentences[sentences.length - 1] += ' ' + buffer.trim();
      } else {
        sentences.push(buffer.trim());
      }
    }
    
    return sentences;
  }

  /**
   * Edge TTS via CLI
   */
  _generateEdgeTTS(text, outputPath) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.edgeTTSBin, [
        '--voice', VOICE,
        '--text', text,
        '--write-media', outputPath,
      ]);

      let stderr = '';
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          resolve();
        } else {
          reject(new Error(`edge-tts exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`edge-tts spawn error: ${err.message}`));
      });
    });
  }

  /**
   * Fallback TTS menggunakan OS built-in
   */
  _generateFallbackTTS(text, outputPath) {
    return new Promise((resolve, reject) => {
      const platform = process.platform;

      if (platform === 'darwin') {
        const aiffPath = outputPath.replace('.mp3', '.aiff');

        const say = spawn('say', [
          '-v', 'Damayanti',
          '-o', aiffPath,
          text,
        ]);

        say.on('close', (code) => {
          if (code !== 0) {
            const sayDefault = spawn('say', ['-o', aiffPath, text]);
            sayDefault.on('close', () => {
              this._convertToMp3(aiffPath, outputPath).then(resolve).catch(reject);
            });
          } else {
            this._convertToMp3(aiffPath, outputPath).then(resolve).catch(reject);
          }
        });

        say.on('error', reject);
      } else {
        const espeak = spawn('espeak', [
          '-v', 'id',
          '-w', outputPath.replace('.mp3', '.wav'),
          text,
        ]);

        espeak.on('close', () => {
          const wavPath = outputPath.replace('.mp3', '.wav');
          this._convertToMp3(wavPath, outputPath).then(resolve).catch(reject);
        });

        espeak.on('error', reject);
      }
    });
  }

  /**
   * Convert AIFF/WAV ke MP3 via ffmpeg
   */
  _convertToMp3(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputPath,
        '-y',
        '-q:a', '2',
        outputPath,
      ]);

      ffmpeg.on('close', (code) => {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg conversion failed with code ${code}`));
      });

      ffmpeg.on('error', reject);
    });
  }

  getCacheDir() {
    return CACHE_DIR;
  }
}

module.exports = new TextToSpeechService();
