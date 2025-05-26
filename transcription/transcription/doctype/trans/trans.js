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
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      const base64data = await this.blobToBase64(blob);
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
