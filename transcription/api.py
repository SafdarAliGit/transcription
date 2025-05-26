import base64
import os
import tempfile
import wave
import json
from vosk import Model, KaldiRecognizer
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
        header, encoded = audio_data.split(',') if ',' in audio_data else ('', audio_data)
        audio_bytes = base64.b64decode(encoded)

        _, temp_path = tempfile.mkstemp(suffix='.wav')
        with open(temp_path, 'wb') as f:
            f.write(audio_bytes)

        # 2. Load model
        model_path = os.path.join(frappe.get_app_path('transcription'), 'model')
        if not os.path.exists(model_path):
            return {"text": "Error: Model path does not exist."}

        model = Model(model_path)

        # 3. Open and validate WAV file
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

    except Exception as e:
        frappe.log_error(title="Transcription Error", message=str(e))
        return {"text": f"Error: {str(e)}"}

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
