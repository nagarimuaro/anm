/**
 * mic-worklet.js — AudioWorkletProcessor untuk capture PCM dari mikrofon
 * Menggantikan ScriptProcessorNode yang deprecated di Chromium modern.
 * File ini diload via addModule() dan berjalan di audio thread terpisah.
 */
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 1024; // samples per message
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // Float32Array
    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i]);
    }

    // Kirim ke main thread setiap _bufferSize samples
    while (this._buffer.length >= this._bufferSize) {
      const chunk = new Float32Array(this._buffer.splice(0, this._bufferSize));
      this.port.postMessage({ type: 'audio', chunk }, [chunk.buffer]);
    }

    return true; // keep processor alive
  }
}

registerProcessor('mic-processor', MicProcessor);
