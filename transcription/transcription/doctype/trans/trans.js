// Initialize on form load
frappe.ui.form.on('Trans', {
  refresh(frm) {
    new VoiceRecorder(frm).init();
  }
});

class VoiceRecorder {
  constructor(frm) {
    this.frm = frm;
    this.audioChunks = [];
    this.recording = false;
    this.mediaRecorder = null;
    this.stream = null;
    this.$voiceBtn = null;
  }

  init() {
    this.targetField = this.frm.get_field('transcription_text');
    if (!this.targetField) return this.showError("Target field 'transcription_text' not found");
    this.createUI();
    this.bindEvents();
  }

  createUI() {
    this.$container = $(
      `<div class="voice-input-group" style="display:flex;align-items:center;gap:8px;width:100%">
        <div class="voice-input-wrapper" style="flex:1">
          ${this.targetField.$input_wrapper.html()}
        </div>
        <button class="btn btn-default btn-voice" type="button" style="height:34px;min-width:120px">
          🎤 ${__('Hold to Record')}
        </button>
      </div>`
    );
    this.targetField.$input_wrapper.replaceWith(this.$container);
    this.$voiceBtn = this.$container.find('.btn-voice');
  }

  bindEvents() {
    this.$voiceBtn.on('pointerdown', (e) => this.handleStart(e));
    $(document).on('pointerup', (e) => this.handleStop(e));
  }

  async handleStart(e) {
    e.preventDefault();
    if (this.recording) return;
    try {
      this.recording = true;
      this.$voiceBtn.html('🔴 Recording...').addClass('btn-danger');
      this.audioChunks = [];
      // Request audio with specific constraints for voice recording
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,           // mono
          sampleRate: 16000,         // 16 kHz
          sampleSize: 16,            // 16 bits
          echoCancellation: true,    // recommended for voice
          noiseSuppression: true,    // recommended for voice
          autoGainControl: true      // recommended for voice
        }
      });
      this.stream = stream;
      // Use lower bitrate for voice recording
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 32000  // Suitable for voice
      });
      this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
      this.mediaRecorder.start();
    } catch (err) {
      this.showError(`Microphone error: ${err.message}`);
      this.cleanup();
    }
  }

  async handleStop(e) {
    e.preventDefault();
    if (!this.recording || !this.mediaRecorder) return;
    try {
      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const text = await this.transcribeAudio(audioBlob);
        this.frm.set_value('transcription_text', text);
      };
      this.mediaRecorder.stop();
      this.stream.getTracks().forEach(track => track.stop());
    } catch (err) {
      this.showError(`Processing error: ${err.message}`);
    } finally {
      this.cleanup();
      this.$voiceBtn.html('🎤 Hold to Record').removeClass('btn-danger');
    }
  }

  async transcribeAudio(blob) {
    try {
      // Convert WebM to WAV using AudioContext with resampling
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioData = await blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(audioData);
      
      // Create offline context for resampling if needed
      if (audioBuffer.sampleRate !== 16000) {
        const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start();
        audioBuffer = await offlineCtx.startRendering();
      }
      
      // Create WAV file
      const wavBlob = await this.audioBufferToWav(audioBuffer);
      const base64data = await this.blobToBase64(wavBlob);
      const response = await frappe.call({
        method: 'transcription.api.transcribe_audio',
        args: { audio_data: base64data },
        async: true
      });
      return response.message.text || "No transcription";
    } catch (err) {
      console.error("Transcription failed:", err);
      return `Error: ${err.message}`;
    }
  }

  audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const dataLength = buffer.length * numChannels * 2; // 2 bytes per sample
    const arrayBuffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(arrayBuffer);
    
    // RIFF identifier
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    this.writeString(view, 8, 'WAVE');
    
    // fmt chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, bitDepth, true);
    
    // data chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);
    
    // Write the PCM samples
    const data = new Float32Array(buffer.length * numChannels);
    let offset = 44;
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      const channelData = buffer.getChannelData(i);
      for (let j = 0; j < channelData.length; j++) {
        const sample = Math.max(-1, Math.min(1, channelData[j]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    
    return new Blob([view], { type: 'audio/wav' });
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }

  showError(msg) {
    frappe.msgprint({ title: __('Voice Recorder Error'), message: msg, indicator: 'red' });
  }

  cleanup() {
    this.recording = false;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
  }
}
