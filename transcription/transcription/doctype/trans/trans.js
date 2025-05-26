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
  
    async transcribeAudio(audioBlob) {
      try {
        // First convert to known format
        const convertedBlob = await this.convertToSupportedFormat(audioBlob);
        
        // Then proceed with WAV conversion
        const wavBlob = await this.convertToWav(convertedBlob);
        
        const base64data = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(wavBlob);
        });
    
        const response = await frappe.call({
          method: 'your_app.api.transcribe_audio',
          args: { audio_data: base64data, audio_format: 'wav' },
          async: true
        });
    
        return response.message.text || "No transcription";
      } catch (err) {
        console.error("Transcription error:", err);
        return `Error: ${err.message}`;
      }
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