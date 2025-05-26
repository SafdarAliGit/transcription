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
        # 1. Save base64 audio data to a temporary WAV file
        _, temp_path = tempfile.mkstemp(suffix='.wav')
        with open(temp_path, 'wb') as f:
            f.write(base64.b64decode(audio_data))

        # 2. Load Vosk model
        model_path = "/home/safdar/frappe-bench/apps/transcription/transcription/model"
        model = Model(model_path)

        # 3. Create recognizer with sample rate 16000
        recognizer = KaldiRecognizer(model, 16000)

        # 4. Process audio file frame-by-frame
        with wave.open(temp_path, 'rb') as wf:
            while True:
                data = wf.readframes(4000)
                if len(data) == 0:
                    break
                recognizer.AcceptWaveform(data)

        # 5. Return final transcription result
        result = recognizer.FinalResult()
        return {"text": result}

    except Exception as e:
        # Return error as text
        return {"text": f"Error: {str(e)}"}

    finally:
        # Clean up temporary file
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)