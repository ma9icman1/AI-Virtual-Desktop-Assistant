import React, { useEffect, useRef, useState, useCallback } from "react";
import { LipSyncEngine, VisemeWeights } from "../../services/lipSyncEngine";
import { Mic, Volume2, Maximize2, Sparkles, RefreshCw, Layers, Settings2, RotateCcw } from "lucide-react";

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
  speechText?: string;
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
      onLoad={() => console.log("[AVATAR2D DEBUG] image loaded", name, src)}
      onError={() => {
        console.error("[AVATAR2D DEBUG] image FAILED", name, src);
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
  speechText = "",
  className = "",
  enableParallax = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const speechTextRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = speechTextRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [speechText]);

  // Layer states
  const [eyeState, setEyeState] = useState<EyeState>("open");
  const [mouthState, setMouthState] = useState<MouthState>("closed");
  const [mouthLayerReady, setMouthLayerReady] = useState(true);
  const [showDevControls, setShowDevControls] = useState(false);
  const [devAutoAnimate, setDevAutoAnimate] = useState(true);
  const [devMouthIndex, setDevMouthIndex] = useState(0);
  const [devEyeIndex, setDevEyeIndex] = useState(0);
  const [devMouthX, setDevMouthX] = useState(0);
  const [devMouthY, setDevMouthY] = useState(0);
  const [devMouthScale, setDevMouthScale] = useState(100);
  const [devMouthOpacity, setDevMouthOpacity] = useState(100);
  const [devFaceX, setDevFaceX] = useState(0);
  const [devFaceY, setDevFaceY] = useState(0);
  const [devFaceScale, setDevFaceScale] = useState(100);
  const [devFaceOpacity, setDevFaceOpacity] = useState(100);

  const mouthStates: MouthState[] = ["closed", "smile", "open_small", "open_wide", "o"];
  const eyeStates: EyeState[] = ["open", "half", "closed"];

  const updateDevNumber = useCallback((setter: React.Dispatch<React.SetStateAction<number>>, min: number, max: number, value: number) => {
    setter(Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)));
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nova_avatar_dev_controls") || "{}");
      if (typeof saved.mouthX === "number") setDevMouthX(saved.mouthX);
      if (typeof saved.mouthY === "number") setDevMouthY(saved.mouthY);
      if (typeof saved.mouthScale === "number") setDevMouthScale(saved.mouthScale);
      if (typeof saved.mouthOpacity === "number") setDevMouthOpacity(saved.mouthOpacity);
      if (typeof saved.faceX === "number") setDevFaceX(saved.faceX);
      if (typeof saved.faceY === "number") setDevFaceY(saved.faceY);
      if (typeof saved.faceScale === "number") setDevFaceScale(saved.faceScale);
      if (typeof saved.faceOpacity === "number") setDevFaceOpacity(saved.faceOpacity);
    } catch {
      // Keep defaults when stored developer calibration is unavailable.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("nova_avatar_dev_controls", JSON.stringify({
        mouthX: devMouthX,
        mouthY: devMouthY,
        mouthScale: devMouthScale,
        mouthOpacity: devMouthOpacity,
        faceX: devFaceX,
        faceY: devFaceY,
        faceScale: devFaceScale,
        faceOpacity: devFaceOpacity,
      }));
    } catch {
      // Calibration still works for the current session.
    }
  }, [devMouthX, devMouthY, devMouthScale, devMouthOpacity, devFaceX, devFaceY, devFaceScale, devFaceOpacity]);

  useEffect(() => {
    const preloadNames = [
      "body",
      ...eyeStates.map((state) => `eyes_${state}`),
      ...mouthStates.map((state) => `mouth_${state}`),
    ];
    const images = preloadNames.map((name) => {
      const image = new Image();
      image.src = `/avatar2d/${name}.png`;
      return image;
    });
    return () => images.forEach((image) => { image.onload = null; image.onerror = null; });
  }, []);

  useEffect(() => {
    if (devAutoAnimate) return;
    setMouthState(mouthStates[devMouthIndex] || "closed");
    setEyeState(eyeStates[devEyeIndex] || "open");
  }, [devAutoAnimate, devMouthIndex, devEyeIndex]);

  // Simulated 3D Parallax coordinates (-1 to +1)
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const targetParallax = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef<number | null>(null);

  // Viseme weights from LipSyncEngine
  const currentWeightsRef = useRef<Partial<VisemeWeights>>({});

  // 1. LipSync Subscription & Mouth State Update
  useEffect(() => {
    if (!devAutoAnimate) return;

    const unsub = LipSyncEngine.getInstance().subscribe((weights) => {
      currentWeightsRef.current = weights;
      console.log("[AVATAR2D DEBUG] LipSyncEngine weights", weights);

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
  }, [isSpeaking, isListening, devAutoAnimate]);

  // Reliable fallback lip animation. Do not depend on viseme callbacks
  // arriving from the TTS analyser; those can be absent for short speech turns.
  useEffect(() => {
    console.log("[AVATAR2D DEBUG] mouth effect", { isSpeaking, isListening, audioLevel });
    if (!devAutoAnimate) return;
    const active = isSpeaking || audioLevel > 0.015;
    if (!active) {
      setMouthState(isListening ? "smile" : "closed");
      return;
    }

    let index = 0;
    const cycle: MouthState[] = ["open_small", "open_wide", "open_small", "o", "open_wide", "smile"];

    const animateMouth = () => {
      const level = Math.max(0, Math.min(1, audioLevel));
      if (level > 0.42) {
        setMouthState(index % 3 === 0 ? "open_wide" : "o");
      } else if (level > 0.08) {
        setMouthState(index % 2 === 0 ? "open_small" : "open_wide");
      } else {
        setMouthState(cycle[index % cycle.length]);
      console.log("[AVATAR2D DEBUG] fallback mouth", { level, next: cycle[index % cycle.length] });
      }
      index += 1;
    };

    animateMouth();
    const interval = window.setInterval(animateMouth, 105);
    return () => window.clearInterval(interval);
  }, [isSpeaking, isListening, audioLevel]);

  // 2. Natural Blinking Loop with Double-Blink Simulation
  useEffect(() => {
    if (!devAutoAnimate) {
      setEyeState(eyeStates[devEyeIndex] || "open");
      return;
    }

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
  }, [devAutoAnimate, devEyeIndex]);

  // TEMP DEBUG: trace whether native mouse events reach the transparent 2.5D renderer.
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      console.log("[2.5D DEBUG] pointerdown", {
        x: event.clientX,
        y: event.clientY,
        target: target?.tagName,
        targetClass: target?.className,
        hit: hit?.tagName,
        hitClass: hit?.className,
        controls: Boolean(hit?.closest?.(".avatar2d-controls")),
      });
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
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
              style={{
                transform: `translate3d(${devFaceX}px, ${devFaceY}px, 0) scale(${devFaceScale / 100})`,
                opacity: devFaceOpacity / 100,
              }}
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
              style={{
                zIndex: 30,
                transform: `translate3d(${devMouthX}px, ${devMouthY}px, 0) scale(${devMouthScale / 100})`,
                opacity: devMouthOpacity / 100,
              }}
            />
          </div>
        </div>
      </div>

      {/* Developer calibration controls */}
      {showDevControls && (
        <div className="absolute top-3 right-3 z-[120] w-[310px] max-w-[calc(100vw-24px)] max-h-[calc(100% - 24px)] overflow-y-auto rounded-xl border border-cyan-400/40 bg-slate-950/95 p-3 text-slate-100 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div>
              <div className="text-xs font-bold text-cyan-300">NOVA AVATAR DEV</div>
              <div className="text-[9px] text-slate-500">Live layer calibration • auto-loaded assets</div>
            </div>
            <button type="button" onClick={() => setShowDevControls(false)} className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:border-cyan-300/50">Close</button>
          </div>

          <div className="mt-3 rounded-lg border border-cyan-400/20 bg-slate-900/70 p-2.5">
            <label className="flex items-center justify-between text-[10px] font-semibold">
              <span>Animation mode</span>
              <span className="text-cyan-300">{devAutoAnimate ? "AUTO LIP SYNC" : "MANUAL"}</span>
            </label>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => setDevAutoAnimate(true)} className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold ${devAutoAnimate ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}>Auto</button>
              <button type="button" onClick={() => setDevAutoAnimate(false)} className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold ${!devAutoAnimate ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}>Manual</button>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/70 p-2.5">
            <div className="text-[10px] font-bold text-white">MOUTH ANIMATION</div>
            <div className="mt-2 text-[9px] text-slate-400">Frame: <b className="text-cyan-200">{mouthStates[devMouthIndex]}</b></div>
            <input aria-label="Mouth animation frame" type="range" min="0" max="4" step="1" value={devMouthIndex} onChange={(e) => updateDevNumber(setDevMouthIndex, 0, 4, Number(e.target.value))} className="w-full accent-cyan-400" />
            {mouthStates.map((state, index) => (
              <div key={state} className="mt-1 flex items-center gap-2">
                <span className="w-20 text-[9px] text-slate-400">{state}</span>
                <input aria-label={`Mouth ${state} selector`} type="range" min="0" max="100" step="1" value={devMouthIndex === index ? 100 : 0} onChange={() => { setDevMouthIndex(index); setDevAutoAnimate(false); }} className="w-full accent-cyan-400" />
              </div>
            ))}
            <label className="mt-2 block text-[9px] text-slate-400">Mouth X <input type="range" min="-40" max="40" value={devMouthX} onChange={(e) => updateDevNumber(setDevMouthX, -40, 40, Number(e.target.value))} className="w-full accent-cyan-400" /></label>
            <label className="mt-2 block text-[9px] text-slate-400">Mouth Y <input type="range" min="-40" max="40" value={devMouthY} onChange={(e) => updateDevNumber(setDevMouthY, -40, 40, Number(e.target.value))} className="w-full accent-cyan-400" /></label>
            <label className="mt-2 block text-[9px] text-slate-400">Mouth Scale <input type="range" min="85" max="115" value={devMouthScale} onChange={(e) => updateDevNumber(setDevMouthScale, 85, 115, Number(e.target.value))} className="w-full accent-cyan-400" /></label>
            <label className="mt-2 block text-[9px] text-slate-400">Mouth Opacity <input type="range" min="0" max="100" value={devMouthOpacity} onChange={(e) => updateDevNumber(setDevMouthOpacity, 0, 100, Number(e.target.value))} className="w-full accent-cyan-400" /></label>
          </div>

          <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/70 p-2.5">
            <div className="text-[10px] font-bold text-white">FACE / EYES</div>
            <div className="mt-2 text-[9px] text-slate-400">Eye frame: <b className="text-cyan-200">{eyeStates[devEyeIndex]}</b></div>
            <input aria-label="Eye animation frame" type="range" min="0" max="2" step="1" value={devEyeIndex} onChange={(e) => { setDevEyeIndex(Number(e.target.value)); setDevAutoAnimate(false); }} className="w-full accent-cyan-400" />
            <div className="mt-1 flex justify-between text-[8px] text-slate-500"><span>open</span><span>half</span><span>closed</span></div>
            <label className="mt-2 block text-[9px] text-slate-400">Face X <input type="range" min="-40" max="40" value={devFaceX} onChange={(e) => updateDevNumber(setDevFaceX, -40, 40, Number(e.target.value))} className="w-full accent-cyan-400" /></label>
            <label className="mt-2 block text-[9px] text-slate-400">Face Y <input type="range" min="-40" max="40" value={devFaceY} onChange={(e) => updateDevNumber(setDevFaceY, -40, 40, Number(e.target.value))} className="w-full accent-cyan-400" /></label>
            <label className="mt-2 block text-[9px] text-slate-400">Face Scale <input type="range" min="85" max="115" value={devFaceScale} onChange={(e) => updateDevNumber(setDevFaceScale, 85, 115, Number(e.target.value))} className="w-full accent-cyan-400" /></label>
            <label className="mt-2 block text-[9px] text-slate-400">Face Opacity <input type="range" min="0" max="100" value={devFaceOpacity} onChange={(e) => updateDevNumber(setDevFaceOpacity, 0, 100, Number(e.target.value))} className="w-full accent-cyan-400" /></label>
          </div>

          <button type="button" onClick={() => { setDevMouthX(0); setDevMouthY(0); setDevMouthScale(100); setDevMouthOpacity(100); setDevFaceX(0); setDevFaceY(0); setDevFaceScale(100); setDevFaceOpacity(100); setDevMouthIndex(0); setDevEyeIndex(0); setDevAutoAnimate(true); }} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:border-cyan-300/40">
            <RotateCcw className="h-3 w-3" /> Reset calibration
          </button>
        </div>
      )}

      {/* Floating Status & Quick Action Controls Overlay */}
      <div className="avatar2d-debug absolute top-3 left-3 z-[100] rounded-lg border border-cyan-400/50 bg-black/90 px-3 py-2 font-mono text-[11px] text-cyan-200 shadow-xl" style={{ minWidth: "270px" }}>
        <div className="font-bold text-cyan-300">AVATAR DEBUG</div>
        <div>speaking: <b>{String(isSpeaking)}</b></div>
        <div>listening: <b>{String(isListening)}</b></div>
        <div>audioLevel: <b>{audioLevel.toFixed(3)}</b></div>
        <div>mouthState: <b>{mouthState}</b></div>
        <div>jawOpen: <b>{(currentWeightsRef.current.jawOpen ?? 0).toFixed(3)}</b></div>
        <div>viseme_O: <b>{(currentWeightsRef.current.viseme_O ?? 0).toFixed(3)}</b></div>
        <div>viseme_AA: <b>{(currentWeightsRef.current.viseme_aa ?? 0).toFixed(3)}</b></div>
        <div className="mt-1 flex gap-1 flex-wrap">
          {(["closed","smile","open_small","open_wide","o"] as MouthState[]).map((m) => (
            <button key={m} type="button" onClick={() => { setMouthState(m); console.log("[AVATAR2D DEBUG] FORCE MOUTH", m); }} className="rounded bg-slate-800 px-1.5 py-0.5 hover:bg-cyan-800">{m}</button>
          ))}
        </div>
      </div>

      <div className="avatar2d-controls absolute flex flex-col items-center z-20">
        <button type="button" onClick={() => setShowDevControls((open) => !open)} className={`avatar2d-tool rounded-full transition-all cursor-pointer ${showDevControls ? "bg-cyan-600 text-white" : ""}`} title="Open Nova avatar developer controls">
          <Settings2 className="w-4 h-4" />
        </button>

        {/* Status Pills */}
        <div
          className="relative flex items-center justify-center rounded-full border border-slate-700/80 bg-slate-950/90 shadow-lg shadow-black/30"
          style={{
            width: "360px",
            height: "68px",
            maxWidth: "calc(100vw - 40px)",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <span
            className={`avatar2d-status-dot absolute left-4 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${
              isSpeaking
                ? "bg-cyan-400 animate-ping"
                : isListening
                ? "bg-purple-400 animate-pulse"
                : "bg-emerald-400"
            }`}
          />
          <span className="w-full px-8 text-center break-words">
            {speechText.trim() || voiceNotice || ""}
          </span>
        </div>

        {/* Quick Toolbar */}
        <div className="avatar2d-toolbar flex items-center">
          {onToggleListening && (
            <button
              type="button"
              onClick={() => { console.log("[2.5D DEBUG] MIC click"); onToggleListening(); }}
              className={`avatar2d-tool avatar2d-tool-mic rounded-full transition-all cursor-pointer ${
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
              onClick={() => { console.log("[2.5D DEBUG] SPEAKER click"); onSpeakGreeting(); }}
              className="avatar2d-tool rounded-full transition-all cursor-pointer"
              title="Test Voice Greeting"
            >
              <Volume2 className="w-4 h-4" />
            </button>
          )}

          {onSwitchMode && (
            <button
              type="button"
              onClick={() => { console.log("[2.5D DEBUG] LAYERS click"); onSwitchMode("avatar"); }}
              className="avatar2d-tool rounded-full transition-all cursor-pointer"
              title="Switch to 3D Model View"
            >
              <Layers className="w-4 h-4" />
            </button>
          )}

          {onToggleFullView && (
            <button
              type="button"
              onClick={() => { console.log("[2.5D DEBUG] EXPAND click"); onToggleFullView(); }}
              className="avatar2d-tool rounded-full transition-all cursor-pointer"
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
