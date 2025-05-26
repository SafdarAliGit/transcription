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

        # 1. Extract base64 data
        try:
            header, encoded = audio_data.split(',') if ',' in audio_data else ('', audio_data)
            audio_bytes = base64.b64decode(encoded)
        except Exception as e:
            return {"text": f"Error: Invalid audio data format - {str(e)}"}

        # 2. Save to temp file
        _, temp_path = tempfile.mkstemp(suffix='.wav')
        with open(temp_path, 'wb') as f:
            f.write(audio_bytes)

        # 3. Validate WAV format
        try:
            with wave.open(temp_path, 'rb') as wf:
                if not wf.getfrmts() == wave.WAVE_FORMAT_PCM:
                    return {"text": "Error: Audio must be in PCM WAV format"}
                
                # Check audio parameters
                channels = wf.getnchannels()
                sample_width = wf.getsampwidth()
                frame_rate = wf.getframerate()
                
                # Log audio file details for debugging
                frappe.logger().debug(f"Audio details: channels={channels}, width={sample_width}, rate={frame_rate}")
                
                if channels != 1 or sample_width != 2 or frame_rate != 16000:
                    return {"text": f"Error: Audio must be mono (1 channel), 16-bit (2 bytes), 16kHz. Got: {channels} channels, {sample_width*8}-bit, {frame_rate}Hz"}
        except wave.Error as e:
            return {"text": f"Error: Invalid WAV file - {str(e)}"}
        except Exception as e:
            frappe.log_error("Transcription WAV validation error", str(e))
            return {"text": f"Error: Failed to validate audio file - {str(e)}"}

        # 4. Load model
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
