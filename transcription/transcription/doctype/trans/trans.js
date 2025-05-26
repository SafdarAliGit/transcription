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
        const response = await frappe.call({
          method: 'transcription.api.transcribe_audio',
          args: { audio: audioBlob },
          async: true
        });
        return response.message.text || "No text detected";
      } catch (err) {
        console.error("Transcription failed:", err);
        return "Transcription service unavailable";
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