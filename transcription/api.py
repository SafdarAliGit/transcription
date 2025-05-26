import base64
import os
import tempfile
from vosk import Model, KaldiRecognizer
import wave
import numpy as np
import frappe

@frappe.whitelist()
def transcribe_audio(audio_data):
    import tempfile
    import os
    import base64
    import wave
    import json
    from vosk import Model, KaldiRecognizer

    temp_path = None
    try:
        # 1. Save to temp file
        _, temp_path = tempfile.mkstemp(suffix='.wav')
        with open(temp_path, 'wb') as f:
            f.write(base64.b64decode(audio_data))

        # 2. Load model
        model_path = "/home/safdar/frappe-bench/apps/transcription/transcription/model"
        if not os.path.exists(model_path):
            return {"text": "Error: Model path does not exist."}

        model = Model(model_path)

        # 3. Process audio
        recognizer = KaldiRecognizer(model, 16000)

        with wave.open(temp_path, 'rb') as wf:
            if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != 16000:
                return {"text": "Error: Audio must be WAV format with 16kHz, mono, 16-bit PCM."}

            while True:
                data = wf.readframes(4000)
                if len(data) == 0:
                    break
                recognizer.AcceptWaveform(data)

        final_result = json.loads(recognizer.FinalResult())
        return {"text": final_result.get("text", "")}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "transcribe_audio")
        return {"text": f"Error: {str(e)}"}

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
