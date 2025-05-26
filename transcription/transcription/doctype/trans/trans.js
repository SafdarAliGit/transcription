  // Initialize on form load
  frappe.ui.form.on('Trans', {
    refresh: function(frm) {
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
      // Verify target field exists
      this.targetField = this.frm.get_field('transcription_text');
      if (!this.targetField) {
        this.showError("Target field 'transcription_text' not found");
        return;
      }
  
      this.createUI();
      this.bindEvents();
    }
  
    createUI() {
      // Create container with input + button
      this.$container = $(`
        <div class="voice-input-group" style="display:flex;align-items:center;gap:8px;width:100%">
          <div class="voice-input-wrapper" style="flex:1">
            ${this.targetField.$input_wrapper.html()}
          </div>
          <button class="btn btn-default btn-voice" type="button" 
                  style="height:34px;min-width:120px">
            🎤 ${__('Hold to Record')}
          </button>
        </div>
      `);
  
      // Replace original field
      this.targetField.$input_wrapper.replaceWith(this.$container);
      this.$voiceBtn = this.$container.find('.btn-voice');
    }
  
    bindEvents() {
      // Pointer events for desktop/mobile
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
        
        // Initialize recorder
        this.stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { sampleRate: 16000, channelCount: 1 }
        });
        
        this.mediaRecorder = new MediaRecorder(this.stream);
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
        // Stop recording
        this.mediaRecorder.stop();
        this.stream.getTracks().forEach(track => track.stop());
        
        // Process audio
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
        const text = await this.transcribeAudio(audioBlob);
        
        // Update field
        this.frm.set_value('transcription_text', text);
        
      } catch (err) {
        this.showError(`Processing error: ${err.message}`);
      } finally {
        this.cleanup();
        this.$voiceBtn.html('🎤 Hold to Record').removeClass('btn-danger');
      }
    }
  
    async transcribeAudio() {
      try {
        // 1. Get audio stream with optimal constraints
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,  // Match Vosk's preferred rate
            channelCount: 1,    // Force mono
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
        
        // 2. Record using MediaRecorder with WAV format
        const chunks = [];
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/wav',  // Some browsers support this directly
          audioBitsPerSecond: 128000
        });
        
        mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
        
        // 3. Return a promise that resolves with WAV blob
        return new Promise((resolve) => {
          mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            
            // 4. Ensure proper WAV format
            const blob = new Blob(chunks, { type: 'audio/wav' });
            const validBlob = await this.validateAudioBlob(blob);
            
            // 5. Convert to base64 for transmission
            const base64data = await this.blobToBase64(validBlob);
            
            const response = await frappe.call({
              method: 'transcription.api.transcribe_audio',
              args: { audio_data: base64data },
              async: true
            });
            
            resolve(response.message.text || "No transcription");
          };
          
          mediaRecorder.start();
          setTimeout(() => mediaRecorder.stop(), 5000); // Stop after 5s
        });
        
      } catch (err) {
        console.error("Recording failed:", err);
        return `Error: ${err.message}`;
      }
    }
    
    async validateAudioBlob(blob) {
      // First try direct WAV playback
      try {
        const audio = new Audio();
        audio.src = URL.createObjectURL(blob);
        await new Promise((resolve, reject) => {
          audio.oncanplay = resolve;
          audio.onerror = () => reject(new Error("Invalid WAV"));
        });
        return blob;
      } catch {
        // Fallback to Web Audio conversion
        return await this.convertToWav(blob);
      }
    }
    
    async convertToWav(blob) {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000  // Match Vosk's requirement
      });
      
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Convert to mono if needed
        let sourceBuffer = audioBuffer;
        if (audioBuffer.numberOfChannels > 1) {
          sourceBuffer = this.convertToMono(audioBuffer);
        }
        
        return new Blob([this.audioBufferToWav(sourceBuffer)], { type: 'audio/wav' });
      } catch (err) {
        console.error("Audio conversion failed:", err);
        throw new Error("Could not process audio");
      }
    }
    
    convertToMono(audioBuffer) {
      const monoBuffer = new AudioContext().createBuffer(
        1,
        audioBuffer.length,
        audioBuffer.sampleRate
      );
      
      const mixedChannel = monoBuffer.getChannelData(0);
      for (let i = 0; i < audioBuffer.length; i++) {
        let sum = 0;
        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
          sum += audioBuffer.getChannelData(channel)[i];
        }
        mixedChannel[i] = sum / audioBuffer.numberOfChannels;
      }
      
      return monoBuffer;
    }
    
    blobToBase64(blob) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
    }
    
    async convertToSupportedFormat(blob) {
      // Create temporary audio element to validate format
      return new Promise((resolve, reject) => {
        const audio = new Audio();
        const url = URL.createObjectURL(blob);
        
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          // If native playback fails, convert using Web Audio API
          this.fallbackConvert(blob).then(resolve).catch(reject);
        };
        
        audio.oncanplay = () => {
          URL.revokeObjectURL(url);
          resolve(blob); // Original format is playable
        };
        
        audio.src = url;
      });
    }
    
    async fallbackConvert(blob) {
      // Convert using MediaRecorder API as fallback
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];
      
      return new Promise((resolve) => {
        mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach(track => track.stop());
          resolve(new Blob(chunks, { type: 'audio/webm' }));
        };
        
        mediaRecorder.start();
        setTimeout(() => mediaRecorder.stop(), 100);
      });
    }
    
    async convertToWav(audioBlob) {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        return new Blob([this.audioBufferToWav(audioBuffer)], { type: 'audio/wav' });
      } catch (err) {
        console.error("WAV conversion failed, using fallback:", err);
        return this.rawToWav(audioBlob);
      }
    }
    
    async rawToWav(blob) {
      // Simple header-based conversion for unsupported formats
      const arrayBuffer = await blob.arrayBuffer();
      const wavBuffer = new ArrayBuffer(44 + arrayBuffer.byteLength);
      const view = new DataView(wavBuffer);
      
      // Write WAV header
      this.writeString(view, 0, 'RIFF');
      view.setUint32(4, 36 + arrayBuffer.byteLength, true);
      this.writeString(view, 8, 'WAVE');
      this.writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true);
      view.setUint32(28, 16000 * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      this.writeString(view, 36, 'data');
      view.setUint32(40, arrayBuffer.byteLength, true);
      
      // Copy audio data
      new Uint8Array(wavBuffer, 44).set(new Uint8Array(arrayBuffer));
      
      return new Blob([wavBuffer], { type: 'audio/wav' });
    }
    
    async convertToWav(audioBlob) {
      // Using the Web Audio API to convert to WAV
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Convert to WAV
      const wavBuffer = this.audioBufferToWav(audioBuffer);
      return new Blob([wavBuffer], { type: 'audio/wav' });
    }
    
    audioBufferToWav(buffer) {
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const length = buffer.length * numChannels * 2 + 44;
      const wavBuffer = new ArrayBuffer(length);
      const view = new DataView(wavBuffer);
      
      // Write WAV header
      this.writeString(view, 0, 'RIFF');
      view.setUint32(4, length - 8, true);
      this.writeString(view, 8, 'WAVE');
      this.writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numChannels * 2, true);
      view.setUint16(32, numChannels * 2, true);
      view.setUint16(34, 16, true);
      this.writeString(view, 36, 'data');
      view.setUint32(40, buffer.length * numChannels * 2, true);
      
      // Write PCM samples
      let offset = 44;
      for (let i = 0; i < buffer.numberOfChannels; i++) {
        const channel = buffer.getChannelData(i);
        for (let j = 0; j < channel.length; j++) {
          const sample = Math.max(-1, Math.min(1, channel[j]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
          offset += 2;
        }
      }
      
      return wavBuffer;
    }
    
    writeString(view, offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }
  
    cleanup() {
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
      }
      this.recording = false;
      this.mediaRecorder = null;
      this.stream = null;
    }
  
    showError(message) {
      frappe.msgprint({
        title: __('Error'),
        indicator: 'red',
        message: message
      });
    }
  }
  

  
  // CSS Injection
  $(document).ready(() => {
    $('head').append(`
      <style>
        .voice-input-group {
          margin-bottom: 15px;
        }
        .btn-voice {
          transition: all 0.2s;
        }
        .btn-voice.btn-danger {
          background-color: #ff4444;
          color: white;
        }
      </style>
    `);
  });