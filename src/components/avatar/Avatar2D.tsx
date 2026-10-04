import React, { useEffect, useRef, useState, useCallback } from "react";
import { LipSyncEngine, VisemeWeights } from "../../services/lipSyncEngine";
import { Mic, Volume2, Maximize2, Sparkles, RefreshCw, Layers } from "lucide-react";

export type EyeState = "open" | "half" | "closed";
export type MouthState = "closed" | "smile" | "open_small" | "open_wide" | "o";

interface Avatar2DProps {
  isSpeaking: boolean;
  isListening?: boolean;
  audioLevel?: number;
  onSpeakGreeting?: () => void;
  onToggleListening?: () => void;
  onToggleFullView?: () => void;
  onSwitchMode?: (mode: "avatar" | "avatar2d" | "orb") => void;
  status?: string;
  voiceNotice?: string | null;
  className?: string;
  enableParallax?: boolean;
}

interface AvatarLayerImageProps {
  name: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}

const AvatarLayerImage: React.FC<AvatarLayerImageProps> = ({
  name,
  alt,
  className = "absolute inset-0 w-full h-full object-contain",
  style,
}) => {
  const [src, setSrc] = useState<string>(`/avatar2d/${name}.png`);

  useEffect(() => {
    setSrc(`/avatar2d/${name}.png`);
  }, [name]);

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={className}
      style={style}
      onError={() => {
        if (src.endsWith(".png")) {
          setSrc(`/avatar2d/${name}.svg`);
        }
      }}
    />
  );
};

export const Avatar2D: React.FC<Avatar2DProps> = ({
  isSpeaking,
  isListening = false,
  audioLevel = 0,
  onSpeakGreeting,
  onToggleListening,
  onToggleFullView,
  onSwitchMode,
  status = "idle",
  voiceNotice = null,
  className = "",
  enableParallax = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Layer states
  const [eyeState, setEyeState] = useState<EyeState>("open");
  const [mouthState, setMouthState] = useState<MouthState>("closed");

  // Simulated 3D Parallax coordinates (-1 to +1)
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const targetParallax = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef<number | null>(null);

  // Viseme weights from LipSyncEngine
  const currentWeightsRef = useRef<Partial<VisemeWeights>>({});

  // 1. LipSync Subscription & Mouth State Update
  useEffect(() => {
    const unsub = LipSyncEngine.getInstance().subscribe((weights) => {
      currentWeightsRef.current = weights;

      if (!isSpeaking) {
        if ((weights.mouthSmileLeft ?? 0) > 0.2 || isListening) {
          setMouthState("smile");
        } else {
          setMouthState("closed");
        }
        return;
      }

      // Determine active mouth phoneme from visemes
      const jaw = weights.jawOpen ?? 0;
      const visO = weights.viseme_O ?? 0;
      const visU = weights.viseme_U ?? 0;
      const funnel = weights.mouthFunnel ?? 0;
      const visAA = weights.viseme_aa ?? 0;
      const visE = weights.viseme_E ?? 0;
      const visI = weights.viseme_I ?? 0;

      if (visO > 0.35 || visU > 0.35 || funnel > 0.25) {
        setMouthState("o");
      } else if (jaw > 0.4 || visAA > 0.45) {
        setMouthState("open_wide");
      } else if (jaw > 0.08 || visE > 0.25 || visI > 0.25) {
        setMouthState("open_small");
      } else {
        setMouthState("smile");
      }
    });

    return () => unsub();
  }, [isSpeaking, isListening]);

  // Fallback mouth animation if speaking but no visemes fired
  useEffect(() => {
    if (!isSpeaking) return;
    let timer: number;
    let index = 0;
    const cycle: MouthState[] = ["open_small", "open_wide", "open_small", "o", "smile"];

    const interval = window.setInterval(() => {
      const jaw = currentWeightsRef.current.jawOpen ?? 0;
      if (jaw === 0) {
        index = (index + 1) % cycle.length;
        setMouthState(cycle[index]);
      }
    }, 140);

    return () => window.clearInterval(interval);
  }, [isSpeaking]);

  // 2. Natural Blinking Loop with Double-Blink Simulation
  useEffect(() => {
    let blinkTimeout: number;

    const scheduleNextBlink = () => {
      // Human average: blink every 3.5 to 6.5 seconds
      const delay = Math.random() * 3000 + 3500;

      blinkTimeout = window.setTimeout(() => {
        executeBlink(() => {
          // 25% chance of a rapid double-blink
          if (Math.random() < 0.25) {
            window.setTimeout(() => executeBlink(scheduleNextBlink), 120);
          } else {
            scheduleNextBlink();
          }
        });
      }, delay);
    };

    const executeBlink = (onComplete: () => void) => {
      // 0ms: half -> 40ms: closed -> 90ms: half -> 140ms: open
      setEyeState("half");
      window.setTimeout(() => {
        setEyeState("closed");
        window.setTimeout(() => {
          setEyeState("half");
          window.setTimeout(() => {
            setEyeState("open");
            onComplete();
          }, 45);
        }, 50);
      }, 40);
    };

    scheduleNextBlink();
    return () => window.clearTimeout(blinkTimeout);
  }, []);

  // 3. Simulated 3D Parallax Mouse Tracker
  useEffect(() => {
    if (!enableParallax) return;

    const handleMouseMove = (e: MouseEvent) => {
      const { innerWidth, innerHeight } = window;
      const nx = (e.clientX / innerWidth) * 2 - 1; // -1 to +1
      const ny = (e.clientY / innerHeight) * 2 - 1; // -1 to +1
      targetParallax.current = {
        x: Math.max(-1, Math.min(1, nx)),
        y: Math.max(-1, Math.min(1, ny)),
      };
    };

    const updateParallax = () => {
      setParallax((prev) => {
        const dx = targetParallax.current.x - prev.x;
        const dy = targetParallax.current.y - prev.y;
        return {
          x: prev.x + dx * 0.08, // smooth spring interpolation
          y: prev.y + dy * 0.08,
        };
      });
      animFrameRef.current = requestAnimationFrame(updateParallax);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    animFrameRef.current = requestAnimationFrame(updateParallax);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [enableParallax]);

  // Derived 3D rotation angles
  const rotY = parallax.x * 12; // -12deg to +12deg
  const rotX = -parallax.y * 10; // -10deg to +10deg

  return (
    <div
      ref={containerRef}
      className={`avatar2d-shell relative w-full h-full flex flex-col items-center justify-center overflow-hidden bg-transparent select-none ${className}`}
      style={{ perspective: "1000px" }}
    >
      {/* Ambient glow disabled in 2.5D overlay so the real Windows desktop remains visible. */}

      {/* 2.5D Parallax Stage */}
      <div
        className="avatar2d-stage relative w-full flex items-center justify-center transition-transform duration-75 ease-out"
        style={{
          transformStyle: "preserve-3d",
          transform: `rotateY(${rotY}deg) rotateX(${rotX}deg)`,
        }}
      >
        {/* Breathing & Micro-Motion Container */}
        <div
          className="relative w-full h-full animate-[avatarBreathing_4s_ease-in-out_infinite]"
          style={{
            transformStyle: "preserve-3d",
          }}
        >
          {/* Layer 1: Body, Torso, Hair, Face Base */}
          <AvatarLayerImage
            name="body"
            alt="Nova Avatar Base"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
            style={{
              transform: "translateZ(0px)",
              filter: "drop-shadow(0 20px 30px rgba(0,0,0,0.5))",
            }}
          />

          {/* Layer 2: Eyes (With forward depth parallax) */}
          <div
            className="absolute inset-0 w-full h-full pointer-events-none transition-transform duration-75"
            style={{
              transform: `translateZ(20px) translate3d(${parallax.x * 3}px, ${parallax.y * 3}px, 0)`,
            }}
          >
            <AvatarLayerImage
              name={`eyes_${eyeState}`}
              alt={`Eyes ${eyeState}`}
              className="absolute inset-0 w-full h-full object-contain"
            />
          </div>

          {/* Layer 3: Mouth (With forward depth parallax & viseme swap) */}
          <div
            className="absolute inset-0 w-full h-full pointer-events-none transition-transform duration-75"
            style={{
              transform: `translateZ(18px) translate3d(${parallax.x * 2.5}px, ${parallax.y * 2.5}px, 0)`,
            }}
          >
            <AvatarLayerImage
              name={`mouth_${mouthState}`}
              alt={`Mouth ${mouthState}`}
              className="absolute inset-0 w-full h-full object-contain"
            />
          </div>
        </div>
      </div>

      {/* Floating Status & Quick Action Controls Overlay */}
      <div className="avatar2d-controls absolute flex flex-col items-center z-20">
        {/* Status Pills */}
        <div className="avatar2d-status flex items-center gap-2">
          <span
            className={`avatar2d-status-dot w-2 h-2 rounded-full ${
              isSpeaking
                ? "bg-cyan-400 animate-ping"
                : isListening
                ? "bg-purple-400 animate-pulse"
                : "bg-emerald-400"
            }`}
          />
          <span>
            {isSpeaking
              ? "Nova Speaking (Neural TTS)"
              : isListening
              ? "Listening..."
              : voiceNotice || "Nova 2.5D Avatar Ready"}
          </span>
        </div>

        {/* Quick Toolbar */}
        <div className="avatar2d-toolbar flex items-center">
          {onToggleListening && (
            <button
              type="button"
              onClick={onToggleListening}
              className={`avatar2d-tool avatar2d-tool-mic transition-all cursor-pointer ${
                isListening
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-600/30"
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              }`}
              title={isListening ? "Mute Microphone" : "Enable Microphone"}
            >
              <Mic className="w-4 h-4" />
            </button>
          )}

          {onSpeakGreeting && (
            <button
              type="button"
              onClick={onSpeakGreeting}
              className="avatar2d-tool transition-all cursor-pointer"
              title="Test Voice Greeting"
            >
              <Volume2 className="w-4 h-4" />
            </button>
          )}

          {onSwitchMode && (
            <button
              type="button"
              onClick={() => onSwitchMode("avatar")}
              className="avatar2d-tool transition-all cursor-pointer"
              title="Switch to 3D Model View"
            >
              <Layers className="w-4 h-4" />
            </button>
          )}

          {onToggleFullView && (
            <button
              type="button"
              onClick={onToggleFullView}
              className="avatar2d-tool transition-all cursor-pointer"
              title="Toggle Full Desktop View"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
