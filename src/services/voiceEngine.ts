import { VoiceSettings } from "../types";
import { LipSyncEngine } from "./lipSyncEngine";

declare global {
  interface Window {
    magicVoice?: {
      start: () => Promise<boolean>;
      stop: () => void;
      onReady?: (callback: () => void) => () => void;
      onTranscript: (callback: (payload: { text: string; confidence: number }) => void) => () => void;
      onError: (callback: (message: string) => void) => () => void;
      onLevel?: (callback: (level: number) => void) => () => void;
      onDevice?: (callback: (device: string) => void) => () => void;
    };
  }
}

export interface VoiceEngineCallbacks {
  onTranscript: (text: string, isFinal: boolean, confidence: number) => void;
  onWakeWordDetected: (phrase: string) => void;
  onAudioLevel: (level: number) => void; // 0 to 1
  onSpeakingStateChange: (isSpeaking: boolean) => void;
  onError: (error: string) => void;
}

export class VoiceEngine {
  private static instance: VoiceEngine | null = null;
  private static transcriptListeners: Array<(t: string) => void> = [];
  private static wakeWordListeners: Array<(w: string) => void> = [];
  private static audioLevelListeners: Array<(lvl: number) => void> = [];
  private static errorListeners: Array<(message: string) => void> = [];

  public static getInstance(): VoiceEngine {
    if (!this.instance) {
      this.instance = new VoiceEngine(
        {
          pitch: 1.05,
          rate: 1.0,
          volume: 1.0,
          voiceName: "default",
          wakeWordSensitivity: 0.8,
          continuousListening: true,
          localWakeWordEnabled: true,
        },
        {
          onTranscript: (t, isFinal) => {
            if (isFinal) {
              this.transcriptListeners.forEach((l) => l(t));
            }
          },
          onWakeWordDetected: (w) => this.wakeWordListeners.forEach((l) => l(w)),
          onAudioLevel: (lvl) => this.audioLevelListeners.forEach((l) => l(lvl)),
          onSpeakingStateChange: () => {},
          onError: (e) => console.warn(e),
        }
      );
    }
    return this.instance;
  }

  public static speak(text: string, onDone?: () => void): Promise<void> {
    return this.getInstance().speak(text, onDone);
  }

  public static stopSpeaking(): void {
    this.getInstance().stopSpeaking();
  }

  public static startListening(): Promise<void> {
    return this.getInstance().startListening();
  }

  public static setWakeWordMode(enabled: boolean): void {
    this.getInstance().wakeWordMode = enabled;
  }

  public static isWakeWordMode(): boolean {
    return this.getInstance().wakeWordMode;
  }

  public static stopListening(): void {
    this.getInstance().stopListening();
  }

  public static getSettings(): VoiceSettings {
    return this.getInstance().getSettings();
  }

  public static getVoices(): SpeechSynthesisVoice[] {
    return this.getInstance().getVoices();
  }

  public static setVoice(voiceName: string): void {
    this.getInstance().setVoice(voiceName);
  }

  public static updateSettings(newSettings: Partial<VoiceSettings>): void {
    this.getInstance().updateSettings(newSettings);
  }

  public static onSpeechRecognized(cb: (transcript: string) => void) {
    this.transcriptListeners.push(cb);
    return () => {
      this.transcriptListeners = this.transcriptListeners.filter((l) => l !== cb);
    };
  }

  public static onWakeWordDetected(cb: (phrase: string) => void) {
    this.wakeWordListeners.push(cb);
    return () => {
      this.wakeWordListeners = this.wakeWordListeners.filter((l) => l !== cb);
    };
  }

  public static onAudioLevel(cb: (level: number) => void) {
    this.audioLevelListeners.push(cb);
    return () => {
      this.audioLevelListeners = this.audioLevelListeners.filter((l) => l !== cb);
    };
  }

  public static onError(cb: (message: string) => void) {
    this.errorListeners.push(cb);
    return () => {
      this.errorListeners = this.errorListeners.filter((listener) => listener !== cb);
    };
  }

  private recognition: any = null;
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphoneStream: MediaStream | null = null;
  private audioRecorder: MediaRecorder | null = null;
  private recordedAudioChunks: Blob[] = [];
  private cloudCorrectionInFlight = false;
  private animFrameId: number | null = null;
  private isListening: boolean = false;
  private isSpeaking: boolean = false;
  private recognitionRestartTimer: number | null = null;
  private nativeSpeechActive = false;
  private nativeSpeechCleanup: (() => void) | null = null;
  private nativeFallbackAttempted = false;
  private settings: VoiceSettings;
  private callbacks: VoiceEngineCallbacks;
  private availableVoices: SpeechSynthesisVoice[] = [];
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private assistantName = "Nova";
  private wakeWordMode = false;
  private lastWakeWordAt = 0;

  constructor(settings: VoiceSettings, callbacks: VoiceEngineCallbacks) {
    this.settings = settings;
    this.callbacks = callbacks;
    this.initSynth();
    this.initSpeechRecognition();
  }

  private initSynth() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      this.synth = window.speechSynthesis;
      const loadVoices = () => {
        this.availableVoices = this.synth?.getVoices() || [];
        const britishVoices = this.availableVoices.filter((v) => v.lang.toLowerCase().startsWith("en-gb"));
        const britishFemale = britishVoices.find((v) => {
          const name = v.name.toLowerCase();
          return ["hazel", "sonia", "susan", "libby", "victoria", "female"].some((hint) => name.includes(hint));
        });
        const selectedVoice = britishFemale || britishVoices.find((v) => !v.name.toLowerCase().includes("george"))
          || this.availableVoices.find((v) => v.lang.toLowerCase().startsWith("en"))
          || this.availableVoices[0];

        this.selectedVoice = selectedVoice || null;
        if (this.settings.voiceName === "default" && selectedVoice) {
          this.settings.voiceName = selectedVoice.name;
        }
      };

      loadVoices();
      if (typeof this.synth.addEventListener === "function") {
        this.synth.addEventListener("voiceschanged", loadVoices);
      } else {
        this.synth.onvoiceschanged = loadVoices;
      }
    }
  }

  public getVoices(): SpeechSynthesisVoice[] {
    return this.availableVoices;
  }

  public setVoice(voiceName: string) {
    if (voiceName === "default") {
      const britishVoice = this.availableVoices.find((voice) => {
        const name = voice.name.toLowerCase();
        return voice.lang.toLowerCase().startsWith("en-gb") &&
          ["hazel", "sonia", "susan", "libby", "victoria", "female"].some((hint) => name.includes(hint));
      }) || this.availableVoices.find((voice) => voice.lang.toLowerCase().startsWith("en-gb"));
      this.selectedVoice = britishVoice || this.availableVoices[0] || null;
      this.settings.voiceName = this.selectedVoice?.name || "default";
      return;
    }

    const found = this.availableVoices.find((v) => v.name === voiceName);
    if (found) {
      this.selectedVoice = found;
      this.settings.voiceName = found.name;
    }
  }

  public updateSettings(newSettings: Partial<VoiceSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    if (newSettings.voiceName) {
      this.setVoice(newSettings.voiceName);
    }
  }

  public setAssistantName(name: string) {
    this.assistantName = name.trim() || "Nova";
  }

  public static setAssistantName(name: string): void {
    this.getInstance().setAssistantName(name);
  }

  public getSettings(): VoiceSettings {
    return { ...this.settings };
  }

  private getWakeWordAliases(): string[] {
    const name = this.assistantName.trim().toLowerCase();
    const normalized = name.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    const aliases = new Set<string>([name, normalized]);
    if (/ma9ic\s*ai|magic\s*ai|magic\s*i|ma9icai/i.test(name)) {
      aliases.add("magic ai");
      aliases.add("magic a i");
      aliases.add("magic eye");
      aliases.add("ma9ic ai");
      aliases.add("ma9ic a i");
    }
    return Array.from(aliases).filter(Boolean);
  }

  private parseWakeWord(text: string): { pure: boolean; command: string | null } {
    const activeText = text.trim().replace(/\s+/g, " ");
    if (!activeText) return { pure: false, command: null };

    // Whisper can repeat a short wake phrase in one segment ("magic AI, magic AI.").
    const spokenNormalized = activeText.toLowerCase()
      .replace(/[!?.,:;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const aliasesRaw = this.getWakeWordAliases();
    const aliases = aliasesRaw.sort((x, y) => y.length - x.length)
      .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const aliasPattern = aliases.join("|");

    const pure = aliasesRaw.some((alias) => {
      const normalizedAlias = alias.toLowerCase()
        .replace(/[!?.,:;]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return spokenNormalized === normalizedAlias ||
        spokenNormalized === `hey ${normalizedAlias}` ||
        spokenNormalized === `hi ${normalizedAlias}` ||
        spokenNormalized === `ok ${normalizedAlias}` ||
        spokenNormalized === `okay ${normalizedAlias}` ||
        spokenNormalized === `${normalizedAlias} ${normalizedAlias}` ||
        spokenNormalized === `hey ${normalizedAlias} ${normalizedAlias}` ||
        spokenNormalized === `hi ${normalizedAlias} ${normalizedAlias}`;
    });
    if (pure) return { pure: true, command: null };

    const prefix = new RegExp(`^\\s*(?:hey\\s+|hi\\s+|ok\\s+|okay\\s+)?(?:${aliasPattern})[,:\\s]+(.+)$`, "i");
    const match = activeText.match(prefix);
    return { pure: false, command: match?.[1]?.trim() || null };
  }
  private initSpeechRecognition() {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("Browser speech recognition unavailable; using Whisper fallback.");
      return;
    }

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = "en-GB";
      this.recognition.maxAlternatives = 3;

      this.recognition.onresult = (event: any) => {
        // Discard microphone audio picked up while the assistant is speaking
        if (this.isSpeaking) return;

        let interimTranscript = "";
        let finalTranscript = "";
        let confidence = 0.9;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          const transcript = result[0].transcript;
          if (result.isFinal) {
            finalTranscript += transcript;
            confidence = result[0].confidence || 0.95;
          } else {
            interimTranscript += transcript;
          }
        }

        const activeText = (finalTranscript || interimTranscript).trim();
        if (!activeText) return;

        // Check if phrase is solely the wake word (e.g. "Magic", "Hey Magic", "Magic!")
        const wake = this.parseWakeWord(activeText);
        if (wake.pure) {
          if (finalTranscript || activeText.length >= 4) {
            this.callbacks.onWakeWordDetected(activeText);
          }
          return;
        }

        // If phrase starts with the wake word followed by a command.
        if (wake.command) {
          const commandText = wake.command;
          if (finalTranscript) {
            this.callbacks.onTranscript(commandText, true, confidence);
          } else if (interimTranscript) {
            this.callbacks.onTranscript(commandText, false, 0.7);
          }
          return;
        }

        if (finalTranscript) {
          this.callbacks.onTranscript(finalTranscript.trim(), true, confidence);
        } else if (interimTranscript) {
          this.callbacks.onTranscript(interimTranscript.trim(), false, 0.7);
        }
      };

      this.recognition.onerror = (event: any) => {
        // Ignore "no-speech" or "aborted" in continuous background mode
        if (event.error !== "no-speech" && event.error !== "aborted") {
          console.warn("Speech recognition error:", event.error);
          const message = event.error === "not-allowed"
            ? "Microphone permission was denied. Allow microphone access for Magic AI in Windows settings."
            : event.error === "network"
            ? "Speech recognition needs the Whisper service or an internet connection."
            : `Speech recognition error: ${event.error}`;
          this.callbacks.onError(message);
          VoiceEngine.errorListeners.forEach((listener) => listener(message));
          if (["network", "service-not-allowed"].includes(event.error) && this.isListening && !this.nativeFallbackAttempted) {
            this.nativeFallbackAttempted = true;
            try {
              this.recognition.stop();
            } catch {
              // Recognition is already ending.
            }
            this.startNativeSpeechFallback().catch((fallbackError) => {
              this.isListening = false;
              VoiceEngine.errorListeners.forEach((listener) => listener(fallbackError.message));
            });
          }
          if (event.error === "not-allowed" || event.error === "audio-capture") {
            this.isListening = false;
            this.stopListening();
          }
        }
      };

      this.recognition.onend = () => {
        if (this.isListening && this.settings.continuousListening) {
          this.scheduleRecognitionRestart();
        }
      };
    } catch (err: any) {
      console.error("Failed to initialize speech recognition:", err);
      VoiceEngine.errorListeners.forEach((listener) => listener("Speech recognition could not be initialized."));
    }
  }

  public async startMicrophoneCapture() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is unavailable in this Electron build.");
      }

      this.microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        const AudioContextClass =
          window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass();
        this.startAudioBuffer(this.microphoneStream);
        const source = this.audioContext.createMediaStreamSource(
          this.microphoneStream
        );
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;
        source.connect(this.analyser);

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        const updateAudioLevel = () => {
          if (!this.analyser) return;
          this.analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }

          const average = sum / dataArray.length;
          const normalized = Math.min(1, average / 128);
          this.callbacks.onAudioLevel(normalized);
          this.animFrameId = requestAnimationFrame(updateAudioLevel);
        };
      updateAudioLevel();
    } catch (err: any) {
      const message = err?.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access for Magic AI."
        : `Microphone could not start: ${err?.message || "unknown microphone error"}`;
      console.warn(message);
      VoiceEngine.errorListeners.forEach((listener) => listener(message));
      throw new Error(message);
    }
  }

  private startAudioBuffer(stream: MediaStream) {
    if (typeof MediaRecorder === "undefined") return;
    try {
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      this.recordedAudioChunks = [];
      this.audioRecorder = new MediaRecorder(stream, { mimeType });
      this.audioRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedAudioChunks.push(event.data);
          if (this.recordedAudioChunks.length > 12) this.recordedAudioChunks.shift();
        }
      };
      this.audioRecorder.start(1000);
    } catch (error) {
      console.warn("Voice correction buffer unavailable:", error);
      this.audioRecorder = null;
    }
  }

  private async requestCloudCorrection(_localText: string, confidence: number): Promise<boolean> {
    if (this.cloudCorrectionInFlight || !this.isListening || confidence >= 0.72 || this.recordedAudioChunks.length === 0) {
      return false;
    }

    this.cloudCorrectionInFlight = true;
    try {
      const blob = new Blob(this.recordedAudioChunks, { type: this.audioRecorder?.mimeType || "audio/webm" });
      const audioBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Could not read recorded audio."));
        reader.readAsDataURL(blob);
      });
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType: blob.type || "audio/webm" }),
      });
      if (!response.ok) return false;
      const result = await response.json();
      const correctedText = typeof result.text === "string" ? result.text.trim() : "";
      if (!result.available || !correctedText) return false;
      this.processRecognizedText(correctedText, true, Number(result.confidence) || 0.9);
      return true;
    } catch (error) {
      console.warn("Cloud voice correction unavailable:", error);
      return false;
    } finally {
      this.cloudCorrectionInFlight = false;
    }
  }

  public async startListening() {
    if (this.isListening) return;
    this.isListening = true;
    this.nativeFallbackAttempted = false;

    // In the Electron desktop build Whisper owns the microphone. Do not open
    // the same Windows input device a second time from Chromium; that can
    // make sounddevice/Whisper receive silence or a busy-device error.
    // Whisper also sends LEVEL events back to the renderer for the meter.
    if (window.magicVoice) {
      await this.startNativeSpeechFallback();
      return;
    }

    // Browser/dev fallback: Chromium owns the microphone and speech service.
    await this.startMicrophoneCapture();

    if (!this.recognition) {
      await this.startNativeSpeechFallback();
      return;
    }
    if (this.recognition) {
      try {
        this.recognition.start();
      } catch (e) {
        if (e instanceof DOMException && e.name === "InvalidStateError") {
          return;
        }
        if (!(e instanceof DOMException) || e.name !== "InvalidStateError") {
          this.stopListening();
          throw new Error("Speech recognition could not start. Check the Whisper service.");
        }
      }
    }
  }

  public stopListening() {
    this.isListening = false;
    this.stopNativeSpeechFallback();
    if (this.recognitionRestartTimer !== null) {
      window.clearTimeout(this.recognitionRestartTimer);
      this.recognitionRestartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Ignored
      }
    }
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach((track) => track.stop());
      this.microphoneStream = null;
    }
    if (this.audioRecorder) {
      try {
        if (this.audioRecorder.state !== "inactive") this.audioRecorder.stop();
      } catch {
        // The recorder may already have stopped with the microphone track.
      }
      this.audioRecorder = null;
    }
    this.recordedAudioChunks = [];
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.callbacks.onAudioLevel(0);
  }

  private async startNativeSpeechFallback() {
    if (!window.magicVoice) {
      this.stopListening();
      throw new Error("Speech recognition is unavailable. Enable Windows Speech services and restart Magic AI.");
    }

    try {
      // Keep the Electron listeners alive across start/stop cycles. Whisper
      // needs a moment to flush its final phrase after STOP is sent; removing
      // the transcript listener immediately would discard that final result.
      if (!this.nativeSpeechCleanup) {
        const nativeTranscriptCleanup = window.magicVoice.onTranscript(({ text, confidence }) => {
          if (this.isSpeaking) return;
          console.debug("[ma9icAI voice] Whisper transcript:", text, confidence);
          this.processRecognizedText(text, true, confidence);
        });
        const nativeErrorCleanup = window.magicVoice.onError((message) => {
          console.error("[ma9icAI voice] Whisper error:", message);
          if (this.isListening || this.nativeSpeechActive) {
            VoiceEngine.errorListeners.forEach((listener) => listener(`Whisper speech service: ${message}`));
          }
        });
        const nativeLevelCleanup = window.magicVoice.onLevel?.((level) => {
          if (this.isListening) this.callbacks.onAudioLevel(Math.max(0, Math.min(1, level)));
        });
        const nativeDeviceCleanup = window.magicVoice.onDevice?.((device) => {
          console.info("[ma9icAI voice] Windows microphone:", device);
        });
        this.nativeSpeechCleanup = () => {
          nativeTranscriptCleanup();
          nativeErrorCleanup();
          nativeLevelCleanup?.();
          nativeDeviceCleanup?.();
          this.nativeSpeechCleanup = null;
        };
      }
      const started = await window.magicVoice.start();
      if (started === false) {
        throw new Error("The Whisper speech process did not start.");
      }
      this.nativeSpeechActive = true;
    } catch (error) {
      this.stopNativeSpeechFallback();
      this.stopListening();
      throw new Error(`Whisper speech recognition could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private stopNativeSpeechFallback() {
    if (this.nativeSpeechActive) {
      console.debug("[ma9icAI voice] Sending STOP to Whisper; waiting for final transcript flush.");
      window.magicVoice?.stop();
    }
    // Do not remove the IPC listeners here. The worker sends the final
    // TRANSCRIPT after receiving STOP, and that event must still reach us.
    this.nativeSpeechActive = false;
  }

  private processRecognizedText(text: string, isFinal: boolean, confidence: number) {
    const activeText = text.trim();
    if (!activeText) return;

    const wake = this.parseWakeWord(activeText);
    if (wake.pure) {
      // Debounce duplicate Whisper segments from the same spoken wake phrase.
      const now = Date.now();
      if (now - this.lastWakeWordAt < 1500) return;
      this.lastWakeWordAt = now;
      this.wakeWordMode = false;
      this.callbacks.onWakeWordDetected(activeText);
      return;
    }

    if (wake.command) {
      this.wakeWordMode = false;
      this.callbacks.onTranscript(wake.command, isFinal, confidence);
      return;
    }

    // Standby mode keeps the local microphone alive only to recognize the
    // wake phrase. Ordinary conversation is ignored until the wake word fires.
    if (this.wakeWordMode) return;

    this.callbacks.onTranscript(activeText, isFinal, confidence);
  }

  private scheduleRecognitionRestart() {
    if (!this.isListening || !this.settings.continuousListening || this.recognitionRestartTimer !== null) {
      return;
    }

    this.recognitionRestartTimer = window.setTimeout(() => {
      this.recognitionRestartTimer = null;
      if (!this.isListening || !this.recognition) return;
      try {
        this.recognition.start();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "InvalidStateError")) {
          this.scheduleRecognitionRestart();
        }
      }
    }, 750);
  }

  public speak(text: string, onDone?: () => void): Promise<void> {
    return new Promise((resolve) => {
      if (!this.synth) {
        console.warn("Speech synthesis not supported");
        onDone?.();
        resolve();
        return;
      }

      // Cancel any ongoing speech
      this.synth.cancel();
      this.synth.resume();

      // Clean markdown tags or symbols from spoken voice
      const cleanText = text
        .replace(/[*_~`#[\]()]/g, "")
        .replace(/https?:\/\/\S+/g, "a web link")
        .trim();

      if (!cleanText) {
        onDone?.();
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(cleanText);
      this.currentUtterance = utterance;

      if (this.selectedVoice) {
        utterance.voice = this.selectedVoice;
      }
      utterance.rate = this.settings.rate || 1.0;
      utterance.pitch = this.settings.pitch || 1.05;
      utterance.volume = this.settings.volume ?? 1.0;

      utterance.onstart = () => {
        this.isSpeaking = true;
        this.callbacks.onSpeakingStateChange(true);
        LipSyncEngine.getInstance().onSpeechStart(cleanText);
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        this.callbacks.onSpeakingStateChange(false);
        this.currentUtterance = null;
        LipSyncEngine.getInstance().onSpeechEnd();
        onDone?.();
        resolve();
      };

      utterance.onerror = (err) => {
        console.warn("Speech synthesis error:", err);
        this.isSpeaking = false;
        this.callbacks.onSpeakingStateChange(false);
        this.currentUtterance = null;
        LipSyncEngine.getInstance().onSpeechEnd();
        onDone?.();
        resolve();
      };

      this.synth.speak(utterance);
      // Chromium can leave synthesis paused after a previous cancelled utterance.
      window.setTimeout(() => {
        if (this.currentUtterance === utterance && this.synth?.paused) {
          this.synth.resume();
        }
      }, 100);
    });
  }

  public stopSpeaking() {
    this.isSpeaking = false;
    LipSyncEngine.getInstance().onSpeechEnd();
    if (this.synth) {
      this.synth.cancel();
      this.callbacks.onSpeakingStateChange(false);
      this.currentUtterance = null;
    }
  }
}
