import base64
import os
import tempfile
from vosk import Model, KaldiRecognizer
import wave
import numpy as np
import frappe

@frappe.whitelist()
def transcribe_audio(audio_data):
    temp_path = None
    try:
        # 1. Save to temp file
        _, temp_path = tempfile.mkstemp(suffix='.wav')
        with open(temp_path, 'wb') as f:
            f.write(base64.b64decode(audio_data))
        
        # 2. Validate WAV header
        with wave.open(temp_path, 'rb') as wf:
            if wf.getnchannels() != 1:
                raise Exception("Audio must be mono")
            if wf.getframerate() != 16000:
                raise Exception("Sample rate must be 16000Hz")
        
        # 3. Load model
        model = Model("/home/safdar/frappe-bench/apps/transcription/transcription/model")
        
        # 4. Process in chunks
        recognizer = KaldiRecognizer(model, 16000)
        with open(temp_path, 'rb') as f:
            while True:
                data = f.read(4000)
                if len(data) == 0:
                    break
                recognizer.AcceptWaveform(data)
        
        return {"text": recognizer.FinalResult()}
        
    except Exception as e:
        return {"text": f"Error: {str(e)}"}
        
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)