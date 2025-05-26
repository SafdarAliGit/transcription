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
        
        # 3. Verify WAV file
        try:
            with wave.open(temp_path, 'rb') as wf:
                if wf.getnchannels() != 1:
                    raise Exception("Vosk requires mono audio")
                if wf.getsampwidth() != 2:
                    raise Exception("16-bit WAV required")
        except Exception as e:
            raise Exception(f"Invalid WAV file: {str(e)}")
        
        # 4. Process audio
        with open(temp_path, 'rb') as f:
            recognizer = KaldiRecognizer(model, 16000)
            while True:
                data = f.read(4000)
                if len(data) == 0:
                    break
                if not recognizer.AcceptWaveform(data):
                    continue
        
        return {
            "text": recognizer.FinalResult(),
            "error": None
        }
        
    except Exception as e:
        return {
            "text": None,
            "error": str(e)
        }
        
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)