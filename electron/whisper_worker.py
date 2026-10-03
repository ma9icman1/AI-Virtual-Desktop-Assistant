import os
import queue
import sys
import time
import threading
from collections import deque

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel


SAMPLE_RATE = 16_000
FRAME_MS = 30
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000
MODEL_NAME = os.environ.get("MAGIC_WHISPER_MODEL", "small.en")


def emit(kind, value="", confidence="0.9"):
    safe_value = str(value).replace("\r", " ").replace("\n", " ").replace("|", " ")
    sys.stdout.write(f"{kind}|{safe_value}|{confidence}\n")
    sys.stdout.flush()


def transcribe(model, samples):
    audio = np.asarray(samples, dtype=np.float32)
    if audio.size < SAMPLE_RATE // 3:
        emit("SPEECH_ERROR", "The microphone stopped before enough audio was captured.", "0")
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
            "Magic, hey Magic, okay Magic, ma9icAI, magic AI, magic eye, "
            "Edge, Firefox, Chrome, browser, click, type, open, close, search, screen."
        ),
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if text:
        confidence = max(0.0, min(1.0, 1.0 - float(getattr(info, "no_speech_prob", 0.0))))
        emit("TRANSCRIPT", text, f"{confidence:.3f}")
    else:
        emit("NO_SPEECH", "No speech was detected.", "0")


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
                    emit("COMMAND", command, "1")
                    command_queue.put(command)
                if command == "QUIT":
                    break
        except Exception as error:
            emit("SPEECH_ERROR", f"Whisper command channel failed: {error}", "0")
            command_queue.put("QUIT")

    threading.Thread(target=read_commands, daemon=True).start()

    try:
        device_info = sd.query_devices(kind="input")
        device_index = int(device_info.get("index", sd.default.device[0]))
        device_name = str(device_info.get("name", "Default microphone"))
        max_input_channels = int(device_info.get("max_input_channels", 0))
        if max_input_channels < 1:
            raise RuntimeError(f"Selected input device has no input channels: {device_name}")
        emit("DEVICE", device_name, "0")
        emit("DEVICE_INDEX", device_index, "0")
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

        audio_queue = queue.Queue(maxsize=200)
        stop_recording = threading.Event()

        def callback(indata, frames, time_info, status):
            if status:
                print(f"AUDIO_STATUS|{status}", file=sys.stderr, flush=True)
            try:
                audio_queue.put_nowait(indata[:, 0].copy())
            except queue.Full:
                pass

        try:
            emit("STARTING_RECORDING", device_name, "1")
            with sd.InputStream(
                device=device_index,
                samplerate=SAMPLE_RATE,
                blocksize=FRAME_SAMPLES,
                channels=1,
                dtype="float32",
                callback=callback,
            ):
                emit("RECORDING", "1", "1")
                emit("MIC_ACTIVE", device_name, "1")
                noise_floor = 0.001
                speech = []
                audio_history = deque(maxlen=int(12_000 / FRAME_MS))
                speaking = False
                silence_frames = 0
                start_threshold_floor = 0.0009
                stop_threshold_floor = 0.00055
                start_multiplier = 1.45
                stop_multiplier = 1.15
                last_level_emit = 0.0

                while not stop_recording.is_set():
                    try:
                        command = command_queue.get(timeout=0.05)
                        if command == "STOP":
                            stop_recording.set()
                        elif command == "QUIT":
                            stop_recording.set()
                            break
                        elif command == "START":
                            # Ignore duplicate START presses while already recording.
                            emit("COMMAND_IGNORED", "START while recording", "1")
                    except queue.Empty:
                        pass

                    while not stop_recording.is_set():
                        try:
                            frame = audio_queue.get_nowait()
                        except queue.Empty:
                            break

                        rms = float(np.sqrt(np.mean(np.square(frame)) + 1e-12))
                        audio_history.append(frame)
                        if not speaking:
                            noise_floor = min(0.03, noise_floor * 0.985 + rms * 0.015)
                        start_threshold = max(start_threshold_floor, noise_floor * start_multiplier)
                        stop_threshold = max(stop_threshold_floor, noise_floor * stop_multiplier)

                        now = time.monotonic()
                        if now - last_level_emit >= 0.1:
                            emit("LEVEL", f"{min(1.0, rms / 0.12):.3f}", "0")
                            last_level_emit = now

                        if rms >= start_threshold:
                            if not speaking:
                                speaking = True
                                speech = []
                                emit("SPEECH_START", "1", "1")
                            silence_frames = 0
                            speech.append(frame)
                        elif speaking:
                            speech.append(frame)
                            silence_frames += 1
                            duration = len(speech) * FRAME_MS / 1000
                            if silence_frames >= 15 or duration >= 10:
                                transcribe(model, np.concatenate(speech))
                                speech = []
                                audio_history.clear()
                                speaking = False
                                silence_frames = 0
                                emit("SPEECH_END", "1", "1")

                # Always flush captured audio when the user stops the mic.
                if speaking and speech:
                    transcribe(model, np.concatenate(speech))
                elif audio_history:
                    transcribe(model, np.concatenate(list(audio_history)))
                emit("RECORDING", "0", "1")
                emit("READY", MODEL_NAME, "1")
        except Exception as error:
            emit("SPEECH_ERROR", f"Whisper microphone error: {error}", "0")
            emit("RECORDING", "0", "1")
            emit("READY", MODEL_NAME, "1")


if __name__ == "__main__":
    raise SystemExit(main())
