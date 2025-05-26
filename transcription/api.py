import base64
import os
import tempfile
from vosk import Model, KaldiRecognizer
import soundfile as sf
import frappe

@frappe.whitelist()
def transcribe_audio(audio_data, audio_format='webm'):
    """Process base64 audio from browser"""
    try:
        # 1. Decode base64
        audio_bytes = base64.b64decode(audio_data)
        
        # 2. Save temporary file
        _, temp_path = tempfile.mkstemp(suffix=f'.{audio_format}')
        with open(temp_path, 'wb') as f:
            f.write(audio_bytes)
        
        # 3. Load Vosk model
        model_path = os.path.join(frappe.get_app_path('transcription'), 'model')
        if not os.path.exists(model_path):
            frappe.throw(f"Model not found at {model_path}")
        
        model = Model(model_path)
        
        # 4. Read audio (convert if needed)
        audio_data, sample_rate = sf.read(temp_path)
        if sample_rate != 16000:
            import librosa
            audio_data = librosa.resample(
                audio_data,
                orig_sr=sample_rate,
                target_sr=16000
            )
        
        # 5. Transcribe
        recognizer = KaldiRecognizer(model, 16000)
        recognizer.AcceptWaveform(audio_data.tobytes())
        result = recognizer.FinalResult()
        
        return {"text": result}
        
    except Exception as e:
        frappe.log_error("Transcription failed", str(e))
        return {"text": f"Error: {str(e)}"}
        
    finally:
        # Cleanup
        if 'temp_path' in locals() and os.path.exists(temp_path):
            os.remove(temp_path)