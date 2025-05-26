import base64
import os
import tempfile
from vosk import Model, KaldiRecognizer
import wave
import numpy as np
import frappe

@frappe.whitelist()
def transcribe_audio(audio_data):
    import base64
    import os
    import tempfile
    import wave
    import json
    from vosk import Model, KaldiRecognizer

    temp_path = None
    try:
        if not audio_data:
            return {"text": "Error: No audio data provided."}

        # 1. Save to temp file
        try:
            decoded_data = base64.b64decode(audio_data)
        except Exception as decode_error:
            return {"text": f"Error decoding audio data: {str(decode_error)}"}

        if not decoded_data:
            return {"text": "Error: Decoded audio data is empty."}

        _, temp_path = tempfile.mkstemp(suffix='.wav')
        with open(temp_path, 'wb') as f:
            f.write(decoded_data)

        # 2. Load model
        model_path = "/home/safdar/frappe-bench/apps/transcription/transcription/model"
        if not os.path.exists(model_path):
            return {"text": "Error: Model path does not exist"}

        model = Model(model_path)

        # 3. Open and validate WAV file
        try:
            with wave.open(temp_path, 'rb') as wf:
                if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != 16000:
                    return {"text": "Error: Audio must be WAV format, Mono, 16-bit, 16kHz"}

                recognizer = KaldiRecognizer(model, 16000)
                while True:
                    data = wf.readframes(4000)
                    if len(data) == 0:
                        break
                    recognizer.AcceptWaveform(data)

            result = json.loads(recognizer.FinalResult())
            return {"text": result.get("text", "")}

        except wave.Error as wave_error:
            return {"text": f"Error reading WAV file: {str(wave_error)}"}
        except EOFError:
            return {"text": "Error: Audio file is empty or corrupted."}

    except Exception as e:
        frappe.log_error(title="Transcription Error", message=str(e))
        return {"text": f"Error: {str(e)}"}

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
