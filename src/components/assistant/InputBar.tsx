import React, { useState, useRef } from "react";
import { Mic, MicOff, Send, Monitor, Loader2 } from "lucide-react";
import { AssistantState } from "../../types";

const WAKE_WORD = "Magic";

interface InputBarProps {
  onSendMessage: (text: string) => void;
  isListening: boolean;
  onToggleListening: () => void;
  onCaptureScreen: () => void;
  onCaptureCamera: () => void;
  onTakeControl: () => void;
  state: AssistantState;
  isAnalyzingVision?: boolean;
  assistantName?: string;
  voiceNotice?: string | null;
}

export const InputBar: React.FC<InputBarProps> = ({
  onSendMessage,
  isListening,
  onToggleListening,
  onCaptureScreen,
  onCaptureCamera,
  onTakeControl,
  state,
  isAnalyzingVision = false,
  assistantName = "Nova",
  voiceNotice = null,
}) => {
  const [inputText, setInputText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const displayVoiceNotice = voiceNotice?.toLowerCase().startsWith("wake word active")
    ? `Wake word active — say ${WAKE_WORD}.`
    : voiceNotice;

  return (
    <div className="p-2 bg-slate-950/80 border-t border-slate-800/80 backdrop-blur-xl">
      {displayVoiceNotice && (
        <div className="px-2 pb-1 text-[11px] text-cyan-300/90 truncate" role="status">
          {displayVoiceNotice}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex items-center gap-1 mt-1">
        <div className="relative flex-1 flex items-center bg-slate-900 border border-slate-800 focus-within:border-indigo-500 rounded-2xl transition-colors shadow-inner">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isListening
                ? "Listening to your voice... (or type here)"
                : `Ask ${assistantName} anything, or click the mic to talk...`
            }
            className="w-full bg-transparent px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <div className="flex items-center gap-1.5 pr-2">
            <button
              type="button"
              onClick={onCaptureScreen}
              disabled={isAnalyzingVision}
              title="Capture & analyze screen"
              className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Monitor className="w-4 h-4" />
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleListening}
          aria-pressed={isListening}
          aria-label={isListening ? "Stop live microphone" : `Start live microphone or say ${WAKE_WORD}`}
          className={`relative w-11 h-11 shrink-0 rounded-full transition-all duration-200 flex items-center justify-center cursor-pointer ${
            isListening
              ? "bg-cyan-500 text-slate-950 ring-4 ring-cyan-400/40 shadow-[0_0_12px_rgba(34,211,238,0.95),0_0_30px_rgba(34,211,238,0.65)] scale-105"
              : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 shadow-lg"
          }`}
          title={isListening ? "Stop live microphone" : `Start voice listening (or say '${WAKE_WORD}')`}
        >
          {isListening && (
            <span
              aria-hidden="true"
              className="absolute inset-[-5px] rounded-full border-2 border-cyan-300/70 animate-ping pointer-events-none"
            />
          )}
          {isListening && (
            <span
              aria-hidden="true"
              className="absolute inset-[-2px] rounded-full border border-cyan-200/80 pointer-events-none"
            />
          )}
          {isListening ? (
            <Mic className="relative z-10 w-5 h-5 animate-pulse" />
          ) : (
            <MicOff className="w-5 h-5 text-slate-400" />
          )}
        </button>
        <button
          type="submit"
          disabled={!inputText.trim() || state === "processing"}
          className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition-all flex items-center justify-center cursor-pointer shadow-lg shadow-indigo-600/20"
          title="Send message"
        >
          {state === "processing" ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </form>
    </div>
  );
};
