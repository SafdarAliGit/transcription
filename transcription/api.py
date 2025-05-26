import base64
import os
import tempfile
import wave
import json
from vosk import Model, KaldiRecognizer
import frappe

@frappe.whitelist()
def transcribe_audio(audio_data):
    temp_path = None
    try:
        if not audio_data:
            return {"text": "Error: No audio data provided."}

        # 1. Decode base64 and save to temp file
        audio_bytes = base64.b64decode(audio_data)
        _, temp_path = tempfile.mkstemp(suffix='.wav')
        with open(temp_path, 'wb') as f:
            f.write(audio_bytes)

        # 2. Load VOSK model
        model_path = "/home/safdar/frappe-bench/apps/transcription/transcription/model"
        if not os.path.exists(model_path):
            return {"text": "Error: Model path does not exist."}

        model = Model(model_path)

        # 3. Read and validate WAV file
        with wave.open(temp_path, 'rb') as wf:
            if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != 16000:
                return {"text": "Error: Audio must be WAV format, Mono, 16-bit, 16kHz."}

            recognizer = KaldiRecognizer(model, 16000)
            while True:
                data = wf.readframes(4000)
                if len(data) == 0:
                    break
                recognizer.AcceptWaveform(data)

        result = json.loads(recognizer.FinalResult())
        return {"text": result.get("text", "")}

    except Exception as e:
        frappe.log_error(title="Transcription Error", message=str(e))
        return {"text": f"Error: {str(e)}"}

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
