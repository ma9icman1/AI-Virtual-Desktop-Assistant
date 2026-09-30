import os
import queue
import sys
import time
import threading

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel


SAMPLE_RATE = 16_000
FRAME_MS = 30
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000
MODEL_NAME = os.environ.get("MAGIC_WHISPER_MODEL", "small.en")


def emit(kind, value="", confidence="0.9"):
    sys.stdout.write(f"{kind}|{value}|{confidence}\n")
    sys.stdout.flush()


def transcribe(model, samples):
    audio = np.asarray(samples, dtype=np.float32)
    if audio.size < SAMPLE_RATE // 3:
        return
    segments, info = model.transcribe(
        audio,
        language="en",
        task="transcribe",
        beam_size=5,
        best_of=5,
        vad_filter=True,
        condition_on_previous_text=False,
        initial_prompt=(
            "ma9icAI, magic AI, magic eye, ma9ic AI, Edge, Firefox, Chrome, "
            "browser, click, type, open, close, search, screen."
        ),
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if text:
        confidence = max(0.0, min(1.0, 1.0 - float(getattr(info, "no_speech_prob", 0.0))))
        emit("TRANSCRIPT", text.replace("|", " "), f"{confidence:.3f}")


def main():
    command_queue = queue.Queue()
    model = None

    try:
        emit("LOADING", MODEL_NAME, "0")
        model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
    except Exception as error:
        emit("SPEECH_ERROR", f"Whisper could not load: {error}", "0")
        return 1

    def read_commands():
        try:
            for line in sys.stdin:
                command = line.strip().upper()
                if command in {"START", "STOP", "QUIT"}:
                    command_queue.put(command)
                if command == "QUIT":
                    break
        except Exception:
            command_queue.put("QUIT")

    threading.Thread(target=read_commands, daemon=True).start()

    # Keep the Whisper model resident. Opening the input stream is the only
    # per-recording operation, so the mic button can become responsive again
    # without reloading the model.
    try:
        device = sd.query_devices(kind="input")
        device_name = str(device.get("name", "Default microphone"))
        emit("DEVICE", device_name.replace("|", " "), "0")
    except Exception as error:
        emit("SPEECH_ERROR", f"No Windows input microphone is available: {error}", "0")
        return 1

    emit("READY", MODEL_NAME, "1")

    while True:
        try:
            command = command_queue.get(timeout=0.25)
        except queue.Empty:
            continue

        if command == "QUIT":
            return 0
        if command != "START":
            continue

        audio_queue = queue.Queue(maxsize=100)
        stop_recording = threading.Event()

        def callback(indata, frames, time_info, status):
            if status:
                print(f"AUDIO_STATUS|{status}", file=sys.stderr, flush=True)
            try:
                audio_queue.put_nowait(indata[:, 0].copy())
            except queue.Full:
                pass

        try:
            with sd.InputStream(
                samplerate=SAMPLE_RATE,
                blocksize=FRAME_SAMPLES,
                channels=1,
                dtype="float32",
                callback=callback,
            ):
                emit("RECORDING", "1", "1")
                noise_floor = 0.003
                speech = []
                speaking = False
                silence_frames = 0
                start_threshold_floor = 0.0045
                stop_threshold_floor = 0.0035
                last_level_emit = 0.0
                quit_after_recording = False

                while not stop_recording.is_set():
                    try:
                        command = command_queue.get(timeout=0.25)
                        if command == "STOP":
                            stop_recording.set()
                        elif command == "QUIT":
                            stop_recording.set()
                            quit_after_recording = True
                    except queue.Empty:
                        pass

                    while not stop_recording.is_set():
                        try:
                            frame = audio_queue.get_nowait()
                        except queue.Empty:
                            break

                        rms = float(np.sqrt(np.mean(np.square(frame)) + 1e-12))
                        if not speaking:
                            noise_floor = min(0.03, noise_floor * 0.98 + rms * 0.02)
                        start_threshold = max(start_threshold_floor, noise_floor * 2.4)
                        stop_threshold = max(stop_threshold_floor, noise_floor * 1.55)
                        now = time.monotonic()
                        if now - last_level_emit >= 0.1:
                            emit("LEVEL", f"{min(1.0, rms / 0.12):.3f}", "0")
                            last_level_emit = now

                        if rms >= start_threshold:
                            if not speaking:
                                speaking = True
                                speech = []
                            silence_frames = 0
                            speech.append(frame)
                        elif speaking:
                            speech.append(frame)
                            silence_frames += 1
                            duration = len(speech) * FRAME_MS / 1000
                            if silence_frames >= 23 or duration >= 15:
                                transcribe(model, np.concatenate(speech))
                                speech = []
                                speaking = False
                                silence_frames = 0

                    if speaking and len(speech) > 0:
                        # Automatic phrase completion leaves the worker in
                        # RECORDING mode so the next phrase can start instantly.
                        # Manual STOP breaks below and flushes the phrase.
                        pass

                if speaking and speech:
                    transcribe(model, np.concatenate(speech))
                emit("READY", MODEL_NAME, "1")
                if quit_after_recording:
                    return 0
        except Exception as error:
            emit("SPEECH_ERROR", f"Whisper microphone error: {error}", "0")
            emit("READY", MODEL_NAME, "1")


if __name__ == "__main__":
    raise SystemExit(main())
