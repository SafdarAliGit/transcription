import base64
import os
import tempfile
from vosk import Model, KaldiRecognizer
import wave
import numpy as np
import frappe

@frappe.whitelist()
def transcribe_audio(audio_data, audio_format='wav'):
    temp_path = None
    try:
        # 1. Load model
        model_path = "/home/safdar/frappe-bench/apps/transcription/transcription/model"
        if not os.path.exists(model_path):
            raise Exception(f"Model path {model_path} does not exist")
        
        model = Model(model_path)
        
        # 2. Save audio to temp file
        _, temp_path = tempfile.mkstemp(suffix='.wav')
        with open(temp_path, 'wb') as f:
            f.write(base64.b64decode(audio_data))
        
        # 3. Robust audio reading
        try:
            import soundfile as sf
            audio, sr = sf.read(temp_path)
        except:
            # Fallback for malformed WAV files
            with wave.open(temp_path, 'rb') as wf:
                sr = wf.getframerate()
                audio = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
                audio = audio.astype(np.float32) / 32768.0
        
        # 4. Resample if needed
        if sr != 16000:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
        
        # 5. Process audio
        recognizer = KaldiRecognizer(model, 16000)
        recognizer.AcceptWaveform(audio.tobytes())
        
        return {"text": recognizer.FinalResult()}
        
    except Exception as e:
        return {"text": f"Server Error: {str(e)}"}
        
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)