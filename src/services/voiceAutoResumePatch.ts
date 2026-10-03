import { VoiceEngine } from "./voiceEngine";

/**
 * Voice turns are intentionally single-shot so Whisper cannot hear TTS.
 * The renderer's transcript handler stops listening before sending a command,
 * but the old handler also cleared React's isListening state before the send
 * handler could capture the fact that voice mode should resume. Keep the
 * underlying Whisper session alive across the assistant's spoken reply.
 */
let resumeAfterAssistantSpeech = false;
let installed = false;

export function installVoiceAutoResume() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const nativeVoice = window.magicVoice;
  if (!nativeVoice?.onTranscript) return;

  nativeVoice.onTranscript(() => {
    // The App transcript listener will stop Whisper immediately after this
    // event. Remember that this was a real voice turn so the next TTS reply
    // can hand the microphone back to Whisper automatically.
    resumeAfterAssistantSpeech = true;
  });

  const originalSpeak = VoiceEngine.speak.bind(VoiceEngine);
  (VoiceEngine as any).speak = (text: string, onDone?: () => void) => {
    const shouldResume = resumeAfterAssistantSpeech;
    resumeAfterAssistantSpeech = false;

    if (!shouldResume) {
      return originalSpeak(text, onDone);
    }

    return originalSpeak(text, async () => {
      try {
        await onDone?.();
      } finally {
        // Give the audio element a tick to finish releasing its resources
        // before reopening the Windows input device.
        window.setTimeout(() => {
          void VoiceEngine.startListening().catch((error) => {
            console.warn("[ma9icAI voice] Auto-resume failed:", error);
          });
        }, 100);
      }
    });
  };
}
